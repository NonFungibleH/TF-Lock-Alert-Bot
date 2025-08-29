const axios = require("axios");

const TELEGRAM_TOKEN = process.env.TOKENGRAM_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

function formatDate(unixTime) {
  if (!unixTime) return "N/A";
  const date = new Date(unixTime * 1000);
  return date.toISOString().replace("T", " ").replace(".000Z", " UTC");
}

// Generate unique lock ID: YYYYMMDD-HHMM
function makeLockId() {
  const now = new Date();
  return now.toISOString().replace(/[-:]/g, "").slice(0, 12);
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
    const txHash =
      body.logs?.[0]?.transactionHash ||
      body.txs?.[0]?.hash ||
      "N/A";

    const chains = {
      "0x1": { name: "Ethereum", explorer: "https://etherscan.io/tx/" },
      "1":   { name: "Ethereum", explorer: "https://etherscan.io/tx/" },
      "0x38":{ name: "BNB Chain", explorer: "https://bscscan.com/tx/" },
      "56":  { name: "BNB Chain", explorer: "https://bscscan.com/tx/" },
      "0x89":{ name: "Polygon", explorer: "https://polygonscan.com/tx/" },
      "137": { name: "Polygon", explorer: "https://polygonscan.com/tx/" },
      "0x2105": { name: "Base", explorer: "https://basescan.org/tx/" },
      "8453":   { name: "Base", explorer: "https://basescan.org/tx/" },
    };

    const chainInfo = chains[chainId] || { name: chainId, explorer: "" };
    const explorerLink = chainInfo.explorer ? `${chainInfo.explorer}${txHash}` : txHash;

    // detect type from logs
    const logs = body.logs || [];
    const log = logs[0] || {};
    const eventName = log.name || log.decoded?.name || "";
    const type = eventName === "DepositNFT" ? "V3 Token" : "V2 Token";

    // expiry from decoded event
    const unlockTime = parseInt(log.decoded?.unlockTime || 0);
    const expiry = unlockTime ? formatDate(unlockTime) : "N/A";

    // detect lock source
    const contractAddr = (log.address || "").toLowerCase();
    let source = "Unknown";
    if (TEAM_FINANCE_CONTRACTS.has(contractAddr)) {
      source = "Team Finance";
    } else if (UNCX_CONTRACTS.has(contractAddr)) {
      source = "UNCX";
    }

    // add unique ID
    const lockId = makeLockId();

    const message = `
🔒 *New Lock Created* \`#${lockId}\`
🌐 Chain: ${chainInfo.name}
📌 Type: ${type}
🔖 Source: ${source}
⏳ Unlocks: ${expiry}
🔗 [View Tx](${explorerLink})
`;

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
