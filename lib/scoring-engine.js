// lib/scoring-engine.js
// Pure function — no I/O, no side effects.
// Input: shared context object from the enrichment pipeline
// Output: { lockScore, marketScore, totalScore, tier, disqualifierReason }

function computeLockScore(ctx) {
  let score = 0;
  const { lockDurationDays, lockedPercent, nativeLockedUsd } = ctx;

  // Duration (0–10 pts)
  if (lockDurationDays >= 365) score += 10;
  else if (lockDurationDays >= 180) score += 7;
  else if (lockDurationDays >= 30) score += 4;
  // < 30 days → 0 pts

  // % of LP token supply locked (0–8 pts)
  if (lockedPercent != null) {
    if (lockedPercent >= 75) score += 8;
    else if (lockedPercent >= 50) score += 5;
    else if (lockedPercent >= 25) score += 3;
  }

  // Native USD value locked (0–7 pts)
  if (nativeLockedUsd != null) {
    if (nativeLockedUsd >= 10000) score += 7;
    else if (nativeLockedUsd >= 1000) score += 4;
  }

  return score;
}

function computeMarketScore(ctx) {
  let score = 0;
  const {
    contractVerified, isHoneypot, ownershipRenounced,
    holderCount, buySellRatio
  } = ctx;

  if (contractVerified === true) score += 5;
  if (isHoneypot === false) score += 5;
  if (ownershipRenounced === true) score += 5;
  if (holderCount != null && holderCount > 100) score += 5;
  if (buySellRatio != null && buySellRatio > 2) score += 5;

  return score;
}

function computeScore(ctx) {
  const lockScore = computeLockScore(ctx);
  const socialScore = ctx.socialScore ?? 0;
  const onchainScore = ctx.onchainScore ?? 0;
  const marketScore = computeMarketScore(ctx);

  const rawTotal = lockScore + socialScore + onchainScore + marketScore;

  // Hard disqualifiers
  let disqualifierReason = null;
  if (ctx.devWalletFlagged === true) {
    disqualifierReason = 'Dev wallet flagged in rug database';
  } else if (ctx.isHoneypot === true) {
    disqualifierReason = 'Token confirmed as honeypot';
  } else if (ctx.lockDurationDays < 7) {
    disqualifierReason = 'Lock duration under 7 days';
  }

  const totalScore = disqualifierReason !== null ? 0 : rawTotal;

  let tier;
  if (totalScore >= 61) tier = 'opportunity';
  else if (totalScore >= 31) tier = 'moderate';
  else tier = 'high-risk';

  return { lockScore, socialScore, onchainScore, marketScore, totalScore, tier, disqualifierReason };
}

module.exports = { computeScore };
