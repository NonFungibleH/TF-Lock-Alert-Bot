// lib/alert-formatter.js
// Pure function — builds the Telegram message string from the shared context.
// Returns a string under 4000 chars (Telegram limit enforced here).

const MAX_LENGTH = 4000;

function formatNumber(n) {
  if (n == null) return 'N/A';
  return n.toLocaleString('en-US');
}

function formatUsd(n) {
  if (n == null) return 'N/A';
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

function formatPrice(p) {
  if (p == null) return 'N/A';
  if (p >= 100) return `$${p.toFixed(2)}`;
  if (p >= 1) return `$${p.toFixed(4)}`;
  if (p >= 0.0001) return `$${p.toFixed(6).replace(/\.?0+$/, '')}`;
  return `$${p.toFixed(8).replace(/\.?0+$/, '')}`;
}

function devWalletShort(addr) {
  if (!addr) return 'Unknown';
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function buildOpportunityHeader(ctx) {
  const lines = [];
  lines.push(`🟢 *OPPORTUNITY DETECTED — Score: ${ctx.totalScore}/100*`);
  lines.push('');
  lines.push(`🧠 Lock: ${ctx.lockScore}/25 | Social: ${ctx.socialScore}/25 | On-chain: ${ctx.onchainScore}/25 | Market: ${ctx.marketScore}/25`);
  lines.push('');

  // Social block
  if (ctx.twitterHandle) {
    const tweetsLine = ctx.twitterActiveLast7Days ? 'Active this week' : 'Inactive';
    lines.push(`🐦 *Social:* ${ctx.twitterHandle} | ${formatNumber(ctx.twitterFollowers)} followers | ${tweetsLine} | Sentiment: ${ctx.twitterSentiment || 'N/A'}`);
  } else {
    lines.push(`🐦 *Social:* No account found`);
  }

  // Dev wallet block
  const walletAge = ctx.devWalletAgeDays != null ? `${ctx.devWalletAgeDays} days old` : 'Age unknown';
  const rugHistory = ctx.devWalletRugsInHuntrDb == null
    ? 'No rug history'
    : ctx.devWalletRugsInHuntrDb === 0
    ? '0 rugs tracked by Hunt3r'
    : `⚠️ ${ctx.devWalletRugsInHuntrDb} rug(s) tracked`;
  lines.push(`👤 *Dev Wallet:* ${devWalletShort(ctx.devWallet)} | ${walletAge} | ${rugHistory}`);
  lines.push('');

  return lines.join('\n');
}

function buildStandardBody(ctx) {
  const lines = [];

  // Token info
  lines.push(`💎 *Token info*`);
  lines.push(`Token: $${ctx.tokenSymbol || 'UNKNOWN'}`);
  if (ctx.price != null) lines.push(`Price: ${formatPrice(ctx.price)}`);
  if (ctx.priceChange1h != null) {
    const sign = ctx.priceChange1h >= 0 ? '+' : '';
    lines.push(`1h: ${sign}${ctx.priceChange1h.toFixed(1)}%`);
  }
  if (ctx.marketCap != null) lines.push(`MC: ${formatUsd(ctx.marketCap)}`);
  if (ctx.liquidity != null) lines.push(`Pool Liquidity: ${formatUsd(ctx.liquidity)}`);
  if (ctx.nativeLockedUsd != null && ctx.nativeSymbol) {
    lines.push(`Native Locked: ${formatUsd(ctx.nativeLockedUsd)} in ${ctx.nativeSymbol}`);
  }
  lines.push('');

  // Lock details
  lines.push(`🔐 *Lock details*`);
  if (ctx.lockDurationDays != null) lines.push(`Duration: ${ctx.lockDurationDays} days`);
  if (ctx.lockedPercent != null) lines.push(`Locked: ${ctx.lockedPercent.toFixed(1)}% of LP supply`);
  lines.push(`Platform: ${ctx.source}`);
  lines.push(`Chain: ${ctx.chain}`);
  lines.push('');

  // Security
  lines.push(`⚡ *Security*`);
  lines.push(ctx.contractVerified ? '✅ Verified contract' : '❌ Unverified contract');
  lines.push(ctx.isHoneypot === false ? '✅ Not honeypot' : '⚠️ Honeypot check failed');
  lines.push(ctx.ownershipRenounced ? '✅ Ownership renounced' : '⚠️ Ownership not renounced');
  if (ctx.ownerHoldPercent != null) lines.push(`Owner holds: ${ctx.ownerHoldPercent.toFixed(1)}%`);
  lines.push('');

  // Dev wallet
  lines.push(`👤 *Dev wallet*`);
  lines.push(devWalletShort(ctx.devWallet));
  lines.push('');

  // Trading stats
  lines.push(`📊 *Trading stats*`);
  if (ctx.volume24h != null) lines.push(`Volume 24h: ${formatUsd(ctx.volume24h)}`);
  if (ctx.buySellRatio != null) lines.push(`Buy/Sell ratio: ${ctx.buySellRatio.toFixed(1)}x`);
  if (ctx.holderCount != null) lines.push(`Holders: ${formatNumber(ctx.holderCount)}`);
  lines.push('');

  return lines.join('\n');
}

function formatAlert(ctx) {
  const link = `[View Transaction](${ctx.explorerLink})`;
  let content = '';

  if (ctx.tier === 'opportunity') {
    content = buildOpportunityHeader(ctx) + buildStandardBody(ctx);
  } else if (ctx.tier === 'moderate') {
    content = `🟡 *Lock Detected — Moderate*\n\n🧠 *Analysis:* ${ctx.totalScore}/100 (Moderate)\n\n` + buildStandardBody(ctx);
  } else {
    const disqLine = ctx.disqualifierReason ? `\n⛔ ${ctx.disqualifierReason}` : '';
    content = `🔒 *Lock Detected — High Risk*\n\n⚠️ *Score: ${ctx.totalScore}/100*\nChain: ${ctx.chain} | Platform: ${ctx.source}\n\nToken: $${ctx.tokenSymbol || 'UNKNOWN'} | Lock: ${ctx.lockDurationDays ?? '?'} days (${ctx.lockedPercent?.toFixed(0) ?? '?'}% of pool)${disqLine}\n\n`;
  }

  const fullMessage = content + link;

  if (fullMessage.length <= MAX_LENGTH) return fullMessage;

  // Truncate content to fit, then re-append link
  const budget = MAX_LENGTH - link.length - 2; // 2 for \n\n
  const truncated = content.substring(0, budget);
  const lastNewline = truncated.lastIndexOf('\n');
  const cutAt = lastNewline > budget * 0.8 ? lastNewline : budget;
  return content.substring(0, cutAt) + '\n\n' + link;
}

module.exports = { formatAlert };
