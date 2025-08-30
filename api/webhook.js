const axios = require("axios");
const { ethers } = require("ethers");

// Telegram
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// Provider for fetching LP + token info
const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);

// Minimal ABIs
const UNI_V2_LP_ABI = [
  "function token0() view returns (address)",
  "function token1() view returns (address)"
];
const ERC20_ABI = [
  "function symbol() view returns (string)"
];

// In-memory store
let sentTxs = new Set();
let counter = 1;

// Chain explorer + TokenSniffer chain slugs
const CHAINS = {
  "0x1":   { name: "Ethereum", explorer: "https://etherscan.io/tx/", sniffer: "ethereum" },
  "1":     { name: "Ethereum", explorer: "https://etherscan.io/tx/", sniffer: "ethereum" },
  "0x38":  { name: "BNB Chain", explorer: "https://bscscan.com/tx/", sniffer: "bsc" },
  "56":    { name: "BNB Chain", explorer: "https://bscscan.com/tx/", sniffer: "bsc" },
  "0x89":  { name: "Polygon", explorer: "https://polygonscan.com/tx/", sniffer: "polygon" },
  "137":   { name: "Polygon", explorer: "https://polygonscan.com/tx/", sniffer: "polygon" },
  "0x2105":{ name: "Base", explorer: "https://basescan.org/tx/", sniffer: "base" },
  "8453":  { name: "Base", explorer: "https://basescan.org/tx/", sniffer: "base" },
};

// Skip these tokens for TokenSniffer links
const SKIP_SNIFFER = new Set(["ETH", "WETH", "USDC", "USDT", "DAI", "WBTC"]);

// Known lock contract sources
const TEAM_FINANCE_CONTRACTS = new Set([
  "0xdbf72370021babafbceb05ab10f99ad275c6220a",
  "0xe2fe530c047f2d85298b07d9333c05737f1435fb",
  "0x7536592bb74b5d62eb82e8b93b17eed4eed9a85c",
  "0x0c89c0407775dd89b12918b9c0aa42bf96518820",
  "0x4f0fd563be89ec8c3e7d595bf3639128c0a7c33a",
  "0x586c21a779c24efd2a8af33c9f7df2a2ea9af55c",
  "0x3ef7442df454ba6b7c1deec8ddf29cfb2d6e56c7",
].map(a => a.toLowerCase()));

const UNCX_CONTRACTS = new Set([
  "0x30529ac67d5ac5f33a4e7fe533149a567451f023",
  "0xfd235968e65b0990584585763f837a5b5330e6de",
  "0x663a5c229c09b049e36dcc11a9b0d4a8eb9db214",
  "0xed9180976c2a4742c7a57354fd39d8bec6cbd8ab",
  "0xfe88dab083964c56429baa01f37ec2265abf1557",
  "0x7229247bd5cf29fa9b0764aa1568732be024084b",
  "0xc765bddb93b0d1c1a88282ba0fa6b2d00e3e0c83",
  "0x610b43e981960b45f818a71cd14c91d35cdA8502",
  "0x231278edd38b00b07fbd52120cef685b9baebcc1",
  "0xc4e637d37113192f4f1f060daebd7758de7f4131",
  "0xbeddF48499788607B4c2e704e9099561ab38Aae8",
  "0x40f6301edb774e8b22adc874f6cb17242baeb8c4",
  "0xadb2437e6f65682b85f814fbc12fec0508a7b1d0",
].map(a => a.toLowerCase()));

// Resolve V2 LP token pair + TokenSniffer links
async function tryResolvePair(lpTokenAddress, chainSlug) {
  try {
    const lp = new ethers.Contract(lpTokenAddress, UNI_V2_LP_ABI, provider);
    const [token0, token1] = await Promise.all([lp.token0(), lp.token1()]);

    const t0 = new ethers.Contract(token0, ERC20_ABI, provider);
    const t1 = new ethers.Contract(token1, ERC20_ABI, provider);
    const [s0, s1] = await Promise.all([t0.symbol(), t1.symbol()]);

    const pair = `${s0}/${s1}`;

    let snifferLinks = "";
    if (chainSlug) {
      const links = [];
      if (!SKIP_SNIFFER.has(s0)) {
        links.push(`[${s0} Sniffer](https://tokensniffer.com/token/${chainSlug}/${token0})`);
      }
      if (!SKIP_SNIFFER.has(s1)) {
        links.push(`[${s1} Sniffer](https://tokensniffer.com/token/${chainSlug}/${token1})`);
      }
      if (links.length) {
        snifferLinks = `🔎 ${links.join(" | ")}\n`;
      }
    }

    return { pair, snifferLinks };
  } catch (err) {
    console.error("❌ Could not resolve pair:", err.message);
    return null;
  }
}

module.exports = async (req, res) => {
  try {
    if (req.method !== "POST") {
      return res.status(200).json({ ok: true });
    }

    const body = req.body || {};
    console.log("🔍 Incoming payload:", JSON.stringify(body, null, 2));

    if (!body.chainId) {
      return res.status(200).json({ ok: true, note: "Validation ping" });
    }

    const chainId = body.chainId;
    const txHash = body.logs?.[0]?.transactionHash || body.txs?.[0]?.hash || "N/A";

    // Prevent duplicate alerts for same tx
    if (sentTxs.has(txHash)) {
      return res.status(200).json({ ok: true, note: "Duplicate skipped" });
    }
    sentTxs.add(txHash);

    const chainInfo = CHAINS[chainId] || { name: chainId, explorer: "", sniffer: "" };
    const explorerLink = chainInfo.explorer ? `${chainInfo.explorer}${txHash}` : txHash;

    // detect type + source
    const logs = body.logs || [];
    const log = logs[0] || {};
    const eventName = log.name || log.decoded?.name || "";
    const type = eventName === "DepositNFT" ? "V3 Token" : "V2 Token";

    const contractAddr = (log.address || "").toLowerCase();
    let source = "Unknown";
    if (TEAM_FINANCE_CONTRACTS.has(contractAddr)) source = "Team Finance";
    else if (UNCX_CONTRACTS.has(contractAddr)) source = "UNCX";

    // Optional: try resolve V2 pair
    let pairLine = "";
    if (type === "V2 Token" && log.decoded?.lpToken) {
      const pairInfo = await tryResolvePair(log.decoded.lpToken, chainInfo.sniffer);
      if (pairInfo) {
        pairLine = `📊 Pair: ${pairInfo.pair}\n${pairInfo.snifferLinks}`;
      }
    }

    // Build message
    const message = `
🔒 *New Lock Created* \`#${counter}\`
🌐 Chain: ${chainInfo.name}
📌 Type: ${type}
🔖 Source: ${source}
${pairLine}🔗 [View Tx](${explorerLink})
`;

    counter++;

    await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
      chat_id: TELEGRAM_CHAT_ID,
      text: message,
      parse_mode: "Markdown",
    });

    return res.status(200).json({ status: "sent" });
  } catch (err) {
    console.error("❌ Telegram webhook error:", err.response?.data || err.message);
    return res.status(200).json({ ok: true, error: err.message });
  }
};
