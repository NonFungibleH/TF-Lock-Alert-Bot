// api/webhook.js
const axios = require("axios");
const { ethers } = require("ethers");

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_GROUP_CHAT_ID = process.env.TELEGRAM_GROUP_CHAT_ID;

// -----------------------------------------
// Helpers
// -----------------------------------------
const sentTxs = new Set();

function formatUSD(num) {
  return `$${Number(num).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function toDecChainId(maybeHex) {
  if (typeof maybeHex === "string" && maybeHex.startsWith("0x")) {
    return String(parseInt(maybeHex, 16));
  }
  return String(maybeHex);
}

// Per-chain settings (explorers, slugs, CoinGecko platform, RPC envs)
const CHAINS = {
  "1":    { name: "Ethereum", explorer: "https://etherscan.io/tx/",   gecko: "ethereum",            dextools: "ether",   ds: "ethereum", rpcEnv: ["RPC_ETH","ALCHEMY_URL_ETH","INFURA_URL_ETH"] },
  "56":   { name: "BNB Chain", explorer: "https://bscscan.com/tx/",   gecko: "binance-smart-chain", dextools: "bsc",     ds: "bsc",      rpcEnv: ["RPC_BSC"] },
  "137":  { name: "Polygon",  explorer: "https://polygonscan.com/tx/",gecko: "polygon-pos",         dextools: "polygon", ds: "polygon",  rpcEnv: ["RPC_POLYGON","ALCHEMY_URL_POLYGON"] },
  "8453": { name: "Base",     explorer: "https://basescan.org/tx/",   gecko: "base",                dextools: "base",    ds: "base",     rpcEnv: ["RPC_BASE","ALCHEMY_URL_BASE"] },
};

// Resolve an RPC URL from env for the given chain
function rpcFor(chainIdDec) {
  const info = CHAINS[chainIdDec];
  if (!info) return null;
  for (const key of info.rpcEnv) {
    if (process.env[key]) return process.env[key];
  }
  return null;
}

// -----------------------------------------
// Known locker contracts (lowercased)
// -----------------------------------------
const TEAM_FINANCE_CONTRACTS = new Set([
  "0xdbf72370021babafbceb05ab10f99ad275c6220a",
  "0xe2fe530c047f2d85298b07d9333c05737f1435fb",
  "0x7536592bb74b5d62eb82e8b93b17eed4eed9a85c",
  "0x0c89c0407775dd89b12918b9c0aa42bf96518820",
  "0x4f0fd563be89ec8c3e7d595bf3639128c0a7c33a",
  "0x586c21a779c24efd2a8af33c9f7df2a2ea9af55c",
  "0x3ef7442df454ba6b7c1deec8ddf29cfb2d6e56c7",
].map(s => s.toLowerCase()));

const UNCX_CONTRACTS = new Set([
  // Multichain UNCX lockers (v2/v3/v4 proofs, including Base/BSC/Eth)
  "0x30529ac67d5ac5f33a4e7fe533149a567451f023",
  "0xfd235968e65b0990584585763f837a5b5330e6de", // (seen on ETH)
  "0x663a5c229c09b049e36dcc11a9b0d4a8eb9db214",
  "0xed9180976c2a4742c7a57354fd39d8bec6cbd8ab",
  "0xfe88dab083964c56429baa01f37ec2265abf1557",
  "0x7229247bd5cf29fa9b0764aa1568732be024084b",
  "0xc765bddb93b0d1c1a88282ba0fa6b2d00e3e0c83",
  "0x610b43e981960b45f818a71cd14c91d35cda8502",
  "0x231278edd38b00b07fbd52120cef685b9baebcc1",
  "0xc4e637d37113192f4f1f060daebd7758de7f4131", // Base UNCX V2 (from your screenshot)
  "0xbeddf48499788607b4c2e704e9099561ab38aae8",
  "0x40f6301edb774e8b22adc874f6cb17242baeb8c4",
  "0xadb2437e6f65682b85f814fbc12fec0508a7b1d0",
].map(s => s.toLowerCase()));

// For quick checks
const KNOWN_LOCKERS = new Set([...TEAM_FINANCE_CONTRACTS, ...UNCX_CONTRACTS]);

// -----------------------------------------
// ABIs & constants
// -----------------------------------------
const ERC20_ABI = [
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)"
];

const LP_ABI = [
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "function getReserves() view returns (uint112,uint112,uint32)",
  "function totalSupply() view returns (uint256)"
];

// Events we consider a **new lock**
const LOCK_EVENTS = new Set(["onNewLock", "onDeposit", "onLock", "LiquidityLocked"]);

// TokenSniffer skip list
const SKIP_SNIFFER = new Set(["eth", "weth", "wbnb", "wmatic", "usdc", "usdt"]);

// -----------------------------------------
// Webhook
// -----------------------------------------
module.exports = async (req, res) => {
  try {
    if (req.method !== "POST") return res.status(200).json({ ok: true });

    const body = req.body || {};
    if (!body.chainId) return res.status(200).json({ ok: true, note: "Validation ping" });

    // Normalize chain id to decimal string
    const chainId = toDecChainId(body.chainId);
    const chain = CHAINS[chainId] || { name: chainId, explorer: "" };

    // Try to find a relevant log: must come from a known locker and be one of our lock events
    const logs = Array.isArray(body.logs) ? body.logs : [];
    const lockLog = logs.find(l => {
      const addr = (l.address || "").toLowerCase();
      const ev = l.name || l.decoded?.name || "";
      return KNOWN_LOCKERS.has(addr) && LOCK_EVENTS.has(ev);
    });

    // If we didn't find a relevant lock log, skip silently
    if (!lockLog) {
      return res.status(200).json({ ok: true, note: "No lock event in known lockers (skipped)" });
    }

    // Transaction hash
    const txHash = lockLog.transactionHash || body.txs?.[0]?.hash;
    if (!txHash) return res.status(200).json({ ok: true, note: "No txHash" });

    // Skip dupes
    if (sentTxs.has(txHash)) return res.status(200).json({ ok: true, note: "Duplicate skipped" });
    sentTxs.add(txHash);

    const eventName = lockLog.name || lockLog.decoded?.name || "";
    const explorerLink = chain.explorer ? `${chain.explorer}${txHash}` : txHash;

    // Determine type from event name
    const type =
      eventName === "onNewLock"    ? "V2 Token" :
      eventName === "onDeposit"    ? "V2 Token" :
      eventName === "onLock"       ? "V3 Token" :
      eventName === "LiquidityLocked" ? "V4 Token" :
      "Unknown";

    // Source from contract address
    const lockerAddr = (lockLog.address || "").toLowerCase();
    const source = TEAM_FINANCE_CONTRACTS.has(lockerAddr) ? "Team Finance"
                  : UNCX_CONTRACTS.has(lockerAddr)        ? "UNCX"
                  : "Unknown";

    // Message parts (only add when we have content)
    const parts = [];
    parts.push("🔒 *New Lock Created*");
    parts.push(`🌐 Chain: ${chain.name}`);
    parts.push(`📌 Type: ${type}`);
    parts.push(`🔖 Source: ${source}`);

    // -----------------------------
    // V2 enrichment (lpToken + amount)
    // -----------------------------
    if (type === "V2 Token") {
      try {
        const lpAddr = (lockLog.decoded?.lpToken || "").toLowerCase();
        const amountLockedRaw = lockLog.decoded?.amount;

        if (lpAddr && amountLockedRaw) {
          // Provider for this chain
          const rpcUrl = rpcFor(chainId);
          if (rpcUrl) {
            const provider = new ethers.providers.JsonRpcProvider(rpcUrl);

            // Read LP & tokens
            const lp = new ethers.Contract(lpAddr, LP_ABI, provider);
            const [token0Addr, token1Addr, reserves, totalSupply] = await Promise.all([
              lp.token0(),
              lp.token1(),
              lp.getReserves(),
              lp.totalSupply(),
            ]);

            const amountLocked = ethers.BigNumber.from(amountLockedRaw);
            if (totalSupply.gt(0) && amountLocked.gt(0)) {
              const share = amountLocked.mul(ethers.constants.WeiPerEther).div(totalSupply);
              const r0 = ethers.BigNumber.from(reserves[0]);
              const r1 = ethers.BigNumber.from(reserves[1]);

              const token0Share = r0.mul(share).div(ethers.constants.WeiPerEther);
              const token1Share = r1.mul(share).div(ethers.constants.WeiPerEther);

              const token0 = new ethers.Contract(token0Addr, ERC20_ABI, provider);
              const token1 = new ethers.Contract(token1Addr, ERC20_ABI, provider);
              const [sym0, sym1, dec0, dec1] = await Promise.all([
                token0.symbol(), token1.symbol(), token0.decimals(), token1.decimals()
              ]);

              const amt0 = Number(ethers.utils.formatUnits(token0Share, dec0));
              const amt1 = Number(ethers.utils.formatUnits(token1Share, dec1));

              // USD estimate (best-effort)
              let usdValue = 0;
              try {
                const url = `https://api.coingecko.com/api/v3/simple/token_price/${chain.gecko}?contract_addresses=${token0Addr},${token1Addr}&vs_currencies=usd`;
                const { data } = await axios.get(url);
                const p0 = data[token0Addr.toLowerCase()]?.usd || 0;
                const p1 = data[token1Addr.toLowerCase()]?.usd || 0;
                usdValue = amt0 * p0 + amt1 * p1;
              } catch (e) {
                // Price lookup can fail silently
              }

              let liq = `💰 Liquidity Locked: ${amt0.toFixed(2)} ${sym0} + ${amt1.toFixed(2)} ${sym1}`;
              if (usdValue > 0) liq += ` (${formatUSD(usdValue)})`;
              parts.push(liq);

              // Charts (pair address)
              if (chain.dextools && chain.ds) {
                parts.push(
                  `📊 Charts: [DEXTools](https://www.dextools.io/app/en/${chain.dextools}/pair-explorer/${lpAddr}) | [DexScreener](https://dexscreener.com/${chain.ds}/${lpAddr})`
                );
              }

              // TokenSniffer for non-stable/ETH
              if (!SKIP_SNIFFER.has(sym0.toLowerCase())) {
                parts.push(`🛡 Safety: [TokenSniffer](https://tokensniffer.com/token/${token0Addr})`);
              } else if (!SKIP_SNIFFER.has(sym1.toLowerCase())) {
                parts.push(`🛡 Safety: [TokenSniffer](https://tokensniffer.com/token/${token1Addr})`);
              }
            }
          }
        }
      } catch (e) {
        // Ignore enrichment errors; message still goes out
      }
    }

    // For V3/V4 we currently keep it simple (alert-only). If later you want pair symbols/fee,
    // we can read token0/token1 from the decoded position/pool and add a light line here.

    // Footer: tx link
    if (explorerLink) parts.push(`\n🔗 [View Tx](${explorerLink})`);

    const message = parts.join("\n");

    // Send to group
    await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
      chat_id: TELEGRAM_GROUP_CHAT_ID,
      text: message,
      parse_mode: "Markdown",
      disable_web_page_preview: true,
    });

    return res.status(200).json({ status: "sent" });
  } catch (err) {
    console.error("❌ Telegram webhook error:", err.response?.data || err.message);
    return res.status(200).json({ ok: true, error: err.message });
  }
};
