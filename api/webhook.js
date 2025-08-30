const axios = require("axios");
const { ethers } = require("ethers");

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// Track seen transactions
const sentTxs = new Set();
let lockCounter = 1;

// Helpers
function formatUSD(num) {
  return `$${Number(num).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function makeLockId() {
  return lockCounter++;
}

// Known lock contract sources
const TEAM_FINANCE_CONTRACTS = new Set([
  "0xdbf72370021babafbceb05ab10f99ad275c6220a".toLowerCase(),
  "0xe2fe530c047f2d85298b07d9333c05737f1435fb".toLowerCase(),
  "0x7536592bb74b5d62eb82e8b93b17eed4eed9a85c".toLowerCase(),
  "0x0c89c0407775dd89b12918b9c0aa42bf96518820".toLowerCase(),
  "0x4f0fd563be89ec8c3e7d595bf3639128c0a7c33a".toLowerCase(),
  "0x586c21a779c24efd2a8af33c9f7df2a2ea9af55c".toLowerCase(),
  "0x3ef7442df454ba6b7c1deec8ddf29cfb2d6e56c7".toLowerCase(),
]);

const UNCX_CONTRACTS = new Set([
  "0x30529ac67d5ac5f33a4e7fe533149a567451f023".toLowerCase(),
  "0xfd235968e65b0990584585763f837a5b5330e6de".toLowerCase(),
  "0x663a5c229c09b049e36dcc11a9b0d4a8eb9db214".toLowerCase(),
  "0xed9180976c2a4742c7a57354fd39d8bec6cbd8ab".toLowerCase(),
  "0xfe88dab083964c56429baa01f37ec2265abf1557".toLowerCase(),
  "0x7229247bd5cf29fa9b0764aa1568732be024084b".toLowerCase(),
  "0xc765bddb93b0d1c1a88282ba0fa6b2d00e3e0c83".toLowerCase(),
  "0x610b43e981960b45f818a71cd14c91d35cdA8502".toLowerCase(),
  "0x231278edd38b00b07fbd52120cef685b9baebcc1".toLowerCase(),
  "0xc4e637d37113192f4f1f060daebd7758de7f4131".toLowerCase(),
  "0xbeddF48499788607B4c2e704e9099561ab38Aae8".toLowerCase(),
  "0x40f6301edb774e8b22adc874f6cb17242baeb8c4".toLowerCase(),
  "0xadb2437e6f65682b85f814fbc12fec0508a7b1d0".toLowerCase(),
]);

// ABIs
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

// Skip Sniffer tokens
const SKIP_SNIFFER = new Set(["eth", "usdc", "usdt", "weth", "wbnb", "wmatic"]);

// Map chain to explorer + coingecko platform
const chains = {
  "0x1":   { name: "Ethereum", explorer: "https://etherscan.io/tx/", gecko: "ethereum" },
  "1":     { name: "Ethereum", explorer: "https://etherscan.io/tx/", gecko: "ethereum" },
  "0x38":  { name: "BNB Chain", explorer: "https://bscscan.com/tx/", gecko: "binance-smart-chain" },
  "56":    { name: "BNB Chain", explorer: "https://bscscan.com/tx/", gecko: "binance-smart-chain" },
  "0x89":  { name: "Polygon", explorer: "https://polygonscan.com/tx/", gecko: "polygon-pos" },
  "137":   { name: "Polygon", explorer: "https://polygonscan.com/tx/", gecko: "polygon-pos" },
  "0x2105":{ name: "Base", explorer: "https://basescan.org/tx/", gecko: "base" },
  "8453":  { name: "Base", explorer: "https://basescan.org/tx/", gecko: "base" },
};

module.exports = async (req, res) => {
  try {
    if (req.method !== "POST") return res.status(200).json({ ok: true });
    const body = req.body || {};

    if (!body.chainId) return res.status(200).json({ ok: true, note: "Validation ping" });

    const chainId = body.chainId;
    const txHash = body.logs?.[0]?.transactionHash || body.txs?.[0]?.hash;
    if (!txHash) return res.status(200).json({ ok: true, note: "No txHash" });

    // Skip dupes
    if (sentTxs.has(txHash)) return res.status(200).json({ ok: true, note: "Duplicate skipped" });
    sentTxs.add(txHash);

    const chainInfo = chains[chainId] || { name: chainId, explorer: "" };
    const explorerLink = `${chainInfo.explorer}${txHash}`;
    const log = body.logs?.[0] || {};
    const eventName = log.name || log.decoded?.name || "";
    const type = eventName === "DepositNFT" ? "V3 Token" : "V2 Token";

    // Source
    const contractAddr = (log.address || "").toLowerCase();
    let source = "Unknown";
    if (TEAM_FINANCE_CONTRACTS.has(contractAddr)) source = "Team Finance";
    else if (UNCX_CONTRACTS.has(contractAddr)) source = "UNCX";

    const lockId = makeLockId();

    // Enrichment lines
    let liquidityLine = "";
    let chartLinks = "";
    let snifferLine = "";

    if (type === "V2 Token") {
      try {
        const provider = new ethers.providers.JsonRpcProvider(process.env.ALCHEMY_URL_BASE);
        const lp = new ethers.Contract(contractAddr, LP_ABI, provider);
        const [token0Addr, token1Addr, reserves, totalSupply] = await Promise.all([
          lp.token0(),
          lp.token1(),
          lp.getReserves(),
          lp.totalSupply()
        ]);

        const amountLocked = log.decoded?.amount ? ethers.BigNumber.from(log.decoded.amount) : null;
        if (amountLocked && totalSupply.gt(0)) {
          const share = amountLocked.mul(ethers.constants.WeiPerEther).div(totalSupply);
          const [r0, r1] = [reserves[0], reserves[1]];
          const token0Share = ethers.BigNumber.from(r0).mul(share).div(ethers.constants.WeiPerEther);
          const token1Share = ethers.BigNumber.from(r1).mul(share).div(ethers.constants.WeiPerEther);

          const token0 = new ethers.Contract(token0Addr, ERC20_ABI, provider);
          const token1 = new ethers.Contract(token1Addr, ERC20_ABI, provider);
          const [sym0, sym1, dec0, dec1] = await Promise.all([
            token0.symbol(), token1.symbol(), token0.decimals(), token1.decimals()
          ]);

          const amt0 = Number(ethers.utils.formatUnits(token0Share, dec0));
          const amt1 = Number(ethers.utils.formatUnits(token1Share, dec1));

          // Get USD prices
          let usdValue = 0;
          try {
            const cgPlatform = chainInfo.gecko;
            const url = `https://api.coingecko.com/api/v3/simple/token_price/${cgPlatform}?contract_addresses=${token0Addr},${token1Addr}&vs_currencies=usd`;
            const { data } = await axios.get(url);
            const p0 = data[token0Addr.toLowerCase()]?.usd || 0;
            const p1 = data[token1Addr.toLowerCase()]?.usd || 0;
            usdValue = (amt0 * p0) + (amt1 * p1);
          } catch (e) {
            console.error("CoinGecko price lookup failed:", e.message);
          }

          liquidityLine = `💰 Liquidity Locked: ${amt0.toFixed(2)} ${sym0} + ${amt1.toFixed(2)} ${sym1}`;
          if (usdValue > 0) liquidityLine += ` (${formatUSD(usdValue)})`;

          chartLinks = `📊 Charts: [DEXTools](https://www.dextools.io/app/en/${chainInfo.name.toLowerCase()}/pair-explorer/${contractAddr}) | [DexScreener](https://dexscreener.com/${chainInfo.name.toLowerCase()}/${contractAddr})`;

          if (!SKIP_SNIFFER.has(sym0.toLowerCase())) {
            snifferLine = `🛡 Safety: [TokenSniffer](https://tokensniffer.com/token/${token0Addr})`;
          } else if (!SKIP_SNIFFER.has(sym1.toLowerCase())) {
            snifferLine = `🛡 Safety: [TokenSniffer](https://tokensniffer.com/token/${token1Addr})`;
          }
        }
      } catch (err) {
        console.error("Liquidity enrich error:", err.message);
      }
    }

    const message = `
🔒 *New Lock Created* \`#${lockId}\`
🌐 Chain: ${chainInfo.name}
📌 Type: ${type}
🔖 Source: ${source}
${liquidityLine}

${chartLinks}
${snifferLine}

🔗 [View Tx](${explorerLink})
`;

    await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
      chat_id: TELEGRAM_CHAT_ID,
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
