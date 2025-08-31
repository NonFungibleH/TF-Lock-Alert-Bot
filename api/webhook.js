// Event → Type mapping
function getLockType(eventName) {
  if (["onNewLock", "onIncrementLock", "onRelock", "onSplitLock"].includes(eventName)) {
    return "V2 Token";
  }
  if (eventName === "onLock") {
    return "V3 Token";
  }
  if (eventName === "LiquidityLocked") {
    return "V4 Token";
  }
  return null; // Unknown → skip
}

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

    const type = getLockType(eventName);
    if (!type) {
      // Not a lock event → skip
      return res.status(200).json({ ok: true, note: `Skipped non-lock event ${eventName}` });
    }

    // Source detection (normalize address)
    const contractAddr = (log.address || "").toLowerCase();
    let source = "Unknown";
    if (TEAM_FINANCE_CONTRACTS.has(contractAddr)) source = "Team Finance";
    else if (UNCX_CONTRACTS.has(contractAddr)) source = "UNCX";

    // Enrichment
    let parts = [];
    parts.push("🔒 *New Lock Created*");
    parts.push(`🌐 Chain: ${chainInfo.name}`);
    parts.push(`📌 Type: ${type}`);
    parts.push(`🔖 Source: ${source}`);

    // (liquidityLine, chartLinks, snifferLine appended only if populated)
    if (type === "V2 Token") {
      try {
        const provider = new ethers.providers.JsonRpcProvider(process.env.ALCHEMY_URL_BASE);
        const lpAddr = (log.decoded?.lpToken || "").toLowerCase();
        if (lpAddr) {
          const lp = new ethers.Contract(lpAddr, LP_ABI, provider);
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

            let usdValue = 0;
            try {
              const url = `https://api.coingecko.com/api/v3/simple/token_price/${chainInfo.gecko}?contract_addresses=${token0Addr},${token1Addr}&vs_currencies=usd`;
              const { data } = await axios.get(url);
              const p0 = data[token0Addr.toLowerCase()]?.usd || 0;
              const p1 = data[token1Addr.toLowerCase()]?.usd || 0;
              usdValue = (amt0 * p0) + (amt1 * p1);
            } catch (e) {}

            let liquidityLine = `💰 Liquidity Locked: ${amt0.toFixed(2)} ${sym0} + ${amt1.toFixed(2)} ${sym1}`;
            if (usdValue > 0) liquidityLine += ` (${formatUSD(usdValue)})`;
            parts.push(liquidityLine);

            parts.push(`📊 Charts: [DEXTools](https://www.dextools.io/app/en/${chainInfo.name.toLowerCase()}/pair-explorer/${lpAddr}) | [DexScreener](https://dexscreener.com/${chainInfo.name.toLowerCase()}/${lpAddr})`);

            if (!SKIP_SNIFFER.has(sym0.toLowerCase())) {
              parts.push(`🛡 Safety: [TokenSniffer](https://tokensniffer.com/token/${token0Addr})`);
            } else if (!SKIP_SNIFFER.has(sym1.toLowerCase())) {
              parts.push(`🛡 Safety: [TokenSniffer](https://tokensniffer.com/token/${token1Addr})`);
            }
          }
        }
      } catch (err) {
        console.error("Liquidity enrich error:", err.message);
      }
    }

    parts.push(`🔗 [View Tx](${explorerLink})`);

    const message = parts.join("\n");

    // Send to Telegram
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
