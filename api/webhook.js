const axios = require("axios");
const { keccak256 } = require("js-sha3");
const ethers = require("ethers");
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_GROUP_CHAT_ID = process.env.TELEGRAM_GROUP_CHAT_ID;
const ETHEREUM_PROVIDER_URL = process.env.ETHEREUM_PROVIDER_URL || "https://mainnet.infura.io/v3/YOUR_INFURA_KEY"; // Set in env

// -----------------------------------------
// Helpers
// -----------------------------------------
const sentTxs = new Set(); // In-memory Set; consider persistent storage for production
function toDecChainId(maybeHex) {
  if (typeof maybeHex === "string" && maybeHex.startsWith("0x")) {
    return String(parseInt(maybeHex, 16));
  }
  return String(maybeHex);
}

const CHAINS = {
  "1": { name: "Ethereum", explorer: "https://etherscan.io/tx/", providerUrl: ETHEREUM_PROVIDER_URL },
  "56": { name: "BNB Chain", explorer: "https://bscscan.com/tx/", providerUrl: process.env.BSC_PROVIDER_URL || "https://bsc-dataseed.binance.org/" },
  "137": { name: "Polygon", explorer: "https://polygonscan.com/tx/", providerUrl: process.env.POLYGON_PROVIDER_URL || "https://polygon-rpc.com/" },
  "8453": { name: "Base", explorer: "https://basescan.org/tx/", providerUrl: process.env.BASE_PROVIDER_URL || "https://mainnet.base.org" },
};

// -----------------------------------------
// Contract ABIs
// -----------------------------------------
const ERC20_ABI = [
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "function getReserves() view returns (uint112, uint112, uint32)"
];
const V3_POSITION_MANAGER_ABI = [
  "function positions(uint256 tokenId) view returns (uint96 nonce, address operator, address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint128 liquidity, uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128, uint128 tokensOwed0, uint128 tokensOwed1)"
];

// -----------------------------------------
// Known locker contracts
// -----------------------------------------
const TEAM_FINANCE_CONTRACTS = new Set([
  "0xe2fe530c047f2d85298b07d9333c05737f1435fb", // ETH V3
  "0x0c89c0407775dd89b12918b9c0aa42bf96518820", // BSC V3
  "0x4f0fd563be89ec8c3e7d595bf3639128c0a7c33a", // BASE V3
  "0x3ef7442df454ba6b7c1deec8ddf29cfb2d6e56c7", // Polygon V3
].map(s => s.toLowerCase()));
const UNCX_CONTRACTS = {
  "0x30529ac67d5ac5f33a4e7fe533149a567451f023": "V4",
  "0xfd235968e65b0990584585763f837a5b5330e6de": "V3",
  "0x663a5c229c09b049e36dcc11a9b0d4a8eb9db214": "Uniswap V2",
  "0xed9180976c2a4742c7a57354fd39d8bec6cbd8ab": "SushiSwap V2",
  "0xfe88dab083964c56429baa01f37ec2265abf1557": "V3",
  "0x7229247bd5cf29fa9b0764aa1568732be024084b": "Uniswap V2",
  "0xc765bddb93b0d1c1a88282ba0fa6b2d00e3e0c83": "PancakeSwap V2",
  "0x610b43e981960b45f818a71cd14c91d35cda8502": "V4",
  "0x231278edd38b00b07fbd52120cef685b9baebcc1": "V3",
  "0xc4e637d37113192f4f1f060daebd7758de7f4131": "Uniswap V2",
  "0xbeddf48499788607b4c2e704e9099561ab38aae8": "SushiSwap V2",
  "0x40f6301edb774e8b22adc874f6cb17242baeb8c4": "V3",
  "0xadb2437e6f65682b85f814fbc12fec0508a7b1d0": "QuickSwap V2",
};
const GOPLUS_CONTRACTS = {
  "0xe7873eb8dda56ed49e51c87185ebcb93958e76f2": "V4",
  "0x25c9c4b56e820e0dea438b145284f02d9ca9bd52": "V3",
  "0xf17a08a7d41f53b24ad07eb322cbbda2ebdec04b": "V2",
  "0x25c9c4b56e820e0dea438b145284f02d9ca9bd52": "V3",
  "0xf17a08a7d41f53b24ad07eb322cbbda2ebdec04b": "V2",
  "0x25c9c4b56e820e0dea438b145284f02d9ca9bd52": "V3",
  "0xf17a08a7d41f53b24ad07eb322cbbda2ebdec04b": "V2",
  "0x25c9c4b56e820e0dea438b145284f02d9ca9bd52": "V3",
};
const KNOWN_LOCKERS = new Set([
  ...TEAM_FINANCE_CONTRACTS,
  ...Object.keys(UNCX_CONTRACTS),
  ...Object.keys(GOPLUS_CONTRACTS),
].map(s => s.toLowerCase()));

// -----------------------------------------
// Events
// -----------------------------------------
const LOCK_EVENTS = new Set([
  "onNewLock",
  "onDeposit",
  "onLock",
  "LiquidityLocked",
  "Deposit",
  "DepositNFT"
]);
const ADS_FUND_FACTORY = "0xe38ed031b2bb2ef8f3a3d4a4eaf5bf4dd889e0be".toLowerCase();
const TOKEN_CREATED_TOPIC = "0x98921a5f40ea8e12813fad8a9f6b602aa9ed159a0f0e552428b96c24de1994f3";

// -----------------------------------------
// Helper to Fetch Token and Lock Details
// -----------------------------------------
async function fetchLockDetails(lockLog, chainId, eventMap) {
  try {
    const chain = CHAINS[chainId] || { name: chainId, providerUrl: ETHEREUM_PROVIDER_URL };
    const provider = new ethers.providers.JsonRpcProvider(chain.providerUrl);
    const eventName = lockLog.resolvedEvent || "Unknown";
    const lockerAddr = (lockLog.address || "").toLowerCase();
    const isTeamFinance = TEAM_FINANCE_CONTRACTS.has(lockerAddr);
    const isGoPlus = GOPLUS_CONTRACTS[lockerAddr];
    const uncxVersion = UNCX_CONTRACTS[lockerAddr];
    const type = isTeamFinance
      ? (eventName === "Deposit" ? "V2 Token" :
         eventName === "DepositNFT" ? "V3 Token" :
         eventName === "onLock" ? "V3 Token" :
         eventName === "LiquidityLocked" ? "V4 Token" : "Unknown")
      : uncxVersion
      ? uncxVersion.includes("V2") ? uncxVersion : `${uncxVersion} Token`
      : isGoPlus
      ? isGoPlus.includes("V2") ? isGoPlus : `${isGoPlus} Token`
      : "Unknown";

    // Decode event parameters
    let tokenAddress, amount, unlockTime, tokenId;
    const event = eventMap[lockLog.topic0];
    if (event && lockLog.data && lockLog.topics) {
      const iface = new ethers.utils.Interface([event]);
      const decoded = iface.parseLog({
        topics: [lockLog.topic0, lockLog.topic1, lockLog.topic2, lockLog.topic3].filter(t => t),
        data: lockLog.data
      });
      tokenAddress = decoded.args.tokenAddress;
      amount = decoded.args.amount;
      unlockTime = decoded.args.unlockTime;
      tokenId = decoded.args.tokenId;
    } else {
      console.log("⚠️ No event ABI or data for decoding");
      return { type, token0Symbol: "Unknown", token1Symbol: "Unknown", amount0: "0", amount1: "0", usdValue: "0", unlockDate: "Unknown" };
    }

    if (!tokenAddress || !amount) {
      console.log("⚠️ Missing token or amount in event data");
      return { type, token0Symbol: "Unknown", token1Symbol: "Unknown", amount0: "0", amount1: "0", usdValue: "0", unlockDate: "Unknown" };
    }

    // Initialize token details
    let token0Symbol = "Unknown", token1Symbol = "Unknown", amount0 = "0", amount1 = "0", usdValue = "0";
    let unlockDate = unlockTime
      ? new Date(Number(unlockTime) * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })
      : "Unknown";

    // V2: Assume tokenAddress is an LP pair
    if (type.includes("V2")) {
      const pairContract = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
      const [symbol, decimals, token0, token1, reserves] = await Promise.all([
        pairContract.symbol().catch(() => "LP"),
        pairContract.decimals().catch(() => 18),
        pairContract.token0().catch(() => ethers.constants.AddressZero),
        pairContract.token1().catch(() => ethers.constants.AddressZero),
        pairContract.getReserves().catch(() => [0, 0, 0])
      ]);
      const token0Contract = new ethers.Contract(token0, ERC20_ABI, provider);
      const token1Contract = new ethers.Contract(token1, ERC20_ABI, provider);
      const [token0SymbolRes, token0Decimals, token1SymbolRes, token1Decimals] = await Promise.all([
        token0Contract.symbol().catch(() => "Unknown"),
        token0Contract.decimals().catch(() => 18),
        token1Contract.symbol().catch(() => "Unknown"),
        token1Contract.decimals().catch(() => 18)
      ]);
      token0Symbol = token0SymbolRes;
      token1Symbol = token1SymbolRes;
      const totalSupply = await pairContract.totalSupply().catch(() => ethers.BigNumber.from("1"));
      const share = ethers.BigNumber.from(amount).mul(ethers.utils.parseUnits("1", decimals)).div(totalSupply);
      amount0 = ethers.utils.formatUnits(ethers.BigNumber.from(reserves[0]).mul(share).div(ethers.utils.parseUnits("1", decimals)), token0Decimals);
      amount1 = ethers.utils.formatUnits(ethers.BigNumber.from(reserves[1]).mul(share).div(ethers.utils.parseUnits("1", decimals)), token1Decimals);

      // Fetch USD value via CoinGecko (assume token1 is priced, e.g., WETH or stablecoin)
      const priceRes = await axios.get(`https://api.coingecko.com/api/v3/simple/price?ids=${token1Symbol.toLowerCase()}&vs_currencies=usd`, { timeout: 5000 }).catch(() => ({ data: {} }));
      const token1Price = priceRes.data[token1Symbol.toLowerCase()]?.usd || (["USDT", "USDC", "DAI"].includes(token1Symbol) ? 1 : 0);
      usdValue = token1Price ? (parseFloat(amount1) * token1Price).toFixed(2) : "0";
    }
    // V3: Assume tokenId is provided for NFT-based locks
    else if (type.includes("V3")) {
      const positionManagerAddr = chainId === "1" ? "0xC36442b4a4522E871399CD717aBDD847Ab11FE88" : // Ethereum
                               chainId === "56" ? "0x7b8A6e4d6AB6b2f8Db165aC39Fb9B1f7E43C1A6F" : // BSC
                               chainId === "137" ? "0xC36442b4a4522E871399CD717aBDD847Ab11FE88" : // Polygon
                               chainId === "8453" ? "0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1" : // Base
                               ethers.constants.AddressZero;
      if (tokenId && positionManagerAddr !== ethers.constants.AddressZero) {
        const positionContract = new ethers.Contract(positionManagerAddr, V3_POSITION_MANAGER_ABI, provider);
        const position = await positionContract.positions(tokenId).catch(() => null);
        if (position) {
          const token0Contract = new ethers.Contract(position.token0, ERC20_ABI, provider);
          const token1Contract = new ethers.Contract(position.token1, ERC20_ABI, provider);
          const [token0SymbolRes, token0Decimals, token1SymbolRes, token1Decimals] = await Promise.all([
            token0Contract.symbol().catch(() => "Unknown"),
            token0Contract.decimals().catch(() => 18),
            token1Contract.symbol().catch(() => "Unknown"),
            token1Contract.decimals().catch(() => 18)
          ]);
          token0Symbol = token0SymbolRes;
          token1Symbol = token1SymbolRes;
          // Simplified: Use liquidity as proxy for amounts (real amounts need sqrtPriceX96)
          amount0 = ethers.utils.formatUnits(position.liquidity, token0Decimals);
          amount1 = ethers.utils.formatUnits(position.liquidity, token1Decimals);
          const priceRes = await axios.get(`https://api.coingecko.com/api/v3/simple/price?ids=${token1Symbol.toLowerCase()}&vs_currencies=usd`, { timeout: 5000 }).catch(() => ({ data: {} }));
          const token1Price = priceRes.data[token1Symbol.toLowerCase()]?.usd || (["USDT", "USDC", "DAI"].includes(token1Symbol) ? 1 : 0);
          usdValue = token1Price ? (parseFloat(amount1) * token1Price).toFixed(2) : "0";
        }
      }
    }
    // V4: Fallback to single token lock (pending specific ABI)
    else if (type.includes("V4")) {
      const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
      const [symbol, decimals] = await Promise.all([
        tokenContract.symbol().catch(() => "Unknown"),
        tokenContract.decimals().catch(() => 18)
      ]);
      token0Symbol = symbol;
      token1Symbol = "";
      amount0 = ethers.utils.formatUnits(amount, decimals);
      amount1 = "0";
      const priceRes = await axios.get(`https://api.coingecko.com/api/v3/simple/price?ids=${symbol.toLowerCase()}&vs_currencies=usd`, { timeout: 5000 }).catch(() => ({ data: {} }));
      const tokenPrice = priceRes.data[symbol.toLowerCase()]?.usd || (["USDT", "USDC", "DAI"].includes(symbol) ? 1 : 0);
      usdValue = tokenPrice ? (parseFloat(amount0) * tokenPrice).toFixed(2) : "0";
    }

    return { type, token0Symbol, token1Symbol, amount0, amount1, usdValue, unlockDate };
  } catch (err) {
    console.error("❌ Error fetching lock details:", err.message);
    return { type: "Unknown", token0Symbol: "Unknown", token1Symbol: "Unknown", amount0: "0", amount1: "0", usdValue: "0", unlockDate: "Unknown" };
  }
}

// -----------------------------------------
// Webhook
// -----------------------------------------
module.exports = async (req, res) => {
  try {
    if (req.method !== "POST") return res.status(200).json({ ok: true });
    const body = req.body || {};
    console.log("🚀 Full incoming body:", JSON.stringify(body, null, 2));
    if (!body.chainId) return res.status(200).json({ ok: true, note: "Validation ping" });
    const chainId = toDecChainId(body.chainId);
    console.log(`🌐 Parsed chainId: ${chainId}`);
    const chain = CHAINS[chainId] || { name: chainId, explorer: "" };
    const logs = Array.isArray(body.logs) ? body.logs : [];
    console.log("🪵 Logs array length:", logs.length);

    // Build ABI event map
    const eventMap = {};
    if (Array.isArray(body.abi)) {
      body.abi.forEach(ev => {
        if (ev.type === "event") {
          const sig = `${ev.name}(${ev.inputs.map(i => i.type).join(",")})`;
          const hash = "0x" + keccak256(sig);
          eventMap[hash] = { name: ev.name, signature: sig, inputs: ev.inputs };
        }
      });
      console.log(`🗺️ Built eventMap with ${Object.keys(eventMap).length} entries`);
    }

    let lockLog = null;
    let isAdshareSource = false;
    for (let i = 0; i < logs.length; i++) {
      const l = logs[i];
      const addr = (l.address || "").toLowerCase();
      let ev =
        l.name ||
        l.eventName ||
        l.decoded?.name ||
        l.decoded?.event ||
        (eventMap[l.topic0] ? eventMap[l.topic0].name : "");
      const sig = eventMap[l.topic0]?.signature || "N/A";
      console.log(`Log[${i}]`);
      console.log(` ↳ addr=${addr}`);
      console.log(` ↳ topic0=${l.topic0}`);
      console.log(` ↳ resolvedEvent=${ev || "N/A"}`);
      console.log(` ↳ signature=${sig}`);
      const isKnown = KNOWN_LOCKERS.has(addr);
      const isLockEvent = LOCK_EVENTS.has(ev);
      console.log(`🔎 Check: known=${isKnown}, lockEvent=${isLockEvent}`);
      if (isKnown && isLockEvent) {
        lockLog = { ...l, resolvedEvent: ev };
      }
      if (addr === ADS_FUND_FACTORY && l.topic0 === TOKEN_CREATED_TOPIC) {
        isAdshareSource = true;
        console.log("📂 Detected Adshares factory source");
      }
    }

    if (!lockLog) {
      console.log("❌ No matching lock log found");
      return res.status(200).json({ ok: true, note: "No lock event detected" });
    }

    const txHash = lockLog.transactionHash || body.txs?.[0]?.hash;
    if (!txHash) {
      console.log("⚠️ No txHash found in payload");
      return res.status(200).json({ ok: true, note: "No txHash" });
    }

    if (sentTxs.has(txHash)) {
      console.log(`⏩ Duplicate txHash skipped: ${txHash}`);
      return res.status(200).json({ ok: true, note: "Duplicate skipped" });
    }
    sentTxs.add(txHash);

    const lockerAddr = (lockLog.address || "").toLowerCase();
    const isTeamFinance = TEAM_FINANCE_CONTRACTS.has(lockerAddr);
    const isGoPlus = GOPLUS_CONTRACTS[lockerAddr];
    const uncxVersion = UNCX_CONTRACTS[lockerAddr];
    const source = isTeamFinance ? (isAdshareSource ? "Team Finance (via Adshare)" : "Team Finance")
                  : isGoPlus ? "GoPlus"
                  : uncxVersion ? "UNCX"
                  : "Unknown";

    // Fetch lock details
    const { type, token0Symbol, token1Symbol, amount0, amount1, usdValue, unlockDate } = await fetchLockDetails(lockLog, chainId, eventMap);

    // Build Telegram message
    const explorerLink = chain.explorer ? `${chain.explorer}${txHash}` : txHash;
    const pairSymbol = token1Symbol ? `${token0Symbol}/${token1Symbol}` : token0Symbol;
    const parts = [
      "🔒 *New LP Lock Detected ✨*",
      "*Locked*",
      `💥 Token: ${pairSymbol}`,
      `💰 Value: $${usdValue}`,
      `  • ${parseFloat(amount0).toFixed(2)} ${token0Symbol} ($${parseFloat(usdValue)/2 || 0})`,
      token1Symbol ? `  • ${parseFloat(amount1).toFixed(2)} ${token1Symbol} ($${parseFloat(usdValue)/2 || 0})` : "",
      `⏳ Unlock: ${unlockDate}`,
      "*Details*",
      `🌐 Chain: ${chain.name}`,
      `📌 Type: ${type}`,
      `🔖 Source: ${source}`,
      `🔗 [View Tx](${explorerLink})`,
      "*Due Diligence*",
      `🔄 [DexScreener](https://dexscreener.com/${chainId}/${tokenAddress})`,
      `🔎 [DexTools](https://www.dextools.io/app/en/pair-explorer/${tokenAddress})`,
      `🚨 [Token Sniffer](https://tokensniffer.com/token/${chainId}/${tokenAddress})`
    ].filter(line => line); // Remove empty lines
    const message = parts.join("\n");

    if (!TELEGRAM_TOKEN || !TELEGRAM_GROUP_CHAT_ID) {
      console.log("❌ Missing Telegram credentials");
      return res.status(200).json({ ok: true, note: "Missing Telegram credentials" });
    }

    await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
      chat_id: TELEGRAM_GROUP_CHAT_ID,
      text: message,
      parse_mode: "Markdown",
      disable_web_page_preview: true,
    });
    console.log("📤 Telegram message sent:", message);
    return res.status(200).json({ status: "sent" });
