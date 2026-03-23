const { computeScore } = require('../lib/scoring-engine');

// Minimal valid context — all scores available
function ctx(overrides = {}) {
  return {
    lockDurationDays: 365,
    lockedPercent: 75,
    nativeLockedUsd: 10000,
    socialScore: 20,
    onchainScore: 21,
    isHoneypot: false,
    contractVerified: true,
    ownershipRenounced: true,
    holderCount: 150,
    buySellRatio: 2.5,
    devWalletFlagged: false,
    ...overrides
  };
}

describe('computeScore — Lock Quality sub-score', () => {
  test('duration >= 1 year → 10 pts', () => {
    const { lockScore } = computeScore(ctx({ lockDurationDays: 365 }));
    // 10 (duration) + 8 (≥75% locked) + 7 (≥$10K) = 25
    expect(lockScore).toBe(25);
  });

  test('duration 6–12 months → 7 pts', () => {
    const { lockScore } = computeScore(ctx({ lockDurationDays: 200 }));
    // 7 + 8 + 7 = 22
    expect(lockScore).toBe(22);
  });

  test('duration 1–6 months → 4 pts', () => {
    const { lockScore } = computeScore(ctx({ lockDurationDays: 60 }));
    // 4 + 8 + 7 = 19
    expect(lockScore).toBe(19);
  });

  test('duration < 1 month → 0 pts on duration', () => {
    const { lockScore } = computeScore(ctx({ lockDurationDays: 20 }));
    // 0 + 8 + 7 = 15
    expect(lockScore).toBe(15);
  });

  test('50–74% locked → 5 pts', () => {
    const { lockScore } = computeScore(ctx({ lockedPercent: 60 }));
    // 10 + 5 + 7 = 22
    expect(lockScore).toBe(22);
  });

  test('nativeLockedUsd $1K–$10K → 4 pts', () => {
    const { lockScore } = computeScore(ctx({ nativeLockedUsd: 5000 }));
    // 10 + 8 + 4 = 22
    expect(lockScore).toBe(22);
  });

  test('nativeLockedUsd < $1K → 0 pts', () => {
    const { lockScore } = computeScore(ctx({ nativeLockedUsd: 500 }));
    // 10 + 8 + 0 = 18
    expect(lockScore).toBe(18);
  });
});

describe('computeScore — Market & Safety sub-score', () => {
  test('all 5 signals true → 25 pts', () => {
    const { marketScore } = computeScore(ctx());
    expect(marketScore).toBe(25);
  });

  test('honeypot = true → 0 on honeypot signal', () => {
    const { marketScore } = computeScore(ctx({ isHoneypot: true }));
    // 5 (verified) + 0 (honeypot) + 5 (renounced) + 5 (holders) + 5 (buy/sell) = 20
    expect(marketScore).toBe(20);
  });

  test('holderCount <= 100 → 0 on holder signal', () => {
    const { marketScore } = computeScore(ctx({ holderCount: 50 }));
    // 5 + 5 + 5 + 0 + 5 = 20
    expect(marketScore).toBe(20);
  });

  test('buySellRatio <= 2 → 0 on ratio signal', () => {
    const { marketScore } = computeScore(ctx({ buySellRatio: 1.5 }));
    // 5 + 5 + 5 + 5 + 0 = 20
    expect(marketScore).toBe(20);
  });
});

describe('computeScore — total score and tier', () => {
  test('high-quality lock → Opportunity tier', () => {
    const { totalScore, tier } = computeScore(ctx({ socialScore: 20, onchainScore: 21 }));
    // lockScore=25 + social=20 + onchain=21 + market=25 = 91
    expect(totalScore).toBe(91);
    expect(tier).toBe('opportunity');
  });

  test('score 31–60 → Moderate tier', () => {
    const { totalScore, tier } = computeScore(ctx({
      lockDurationDays: 60, lockedPercent: 50, nativeLockedUsd: 5000,
      socialScore: 10, onchainScore: 10,
      contractVerified: true, ownershipRenounced: true, isHoneypot: false,
      holderCount: 150, buySellRatio: 2.5
    }));
    // lockScore: 4 + 5 + 4 = 13, social: 10, onchain: 10, market: 5+5+5+5+5 = 25
    // total: 13 + 10 + 10 + 25 = 58
    expect(totalScore).toBeGreaterThanOrEqual(31);
    expect(totalScore).toBeLessThanOrEqual(60);
    expect(tier).toBe('moderate');
  });

  test('score 0–30 → High Risk tier', () => {
    const { totalScore, tier } = computeScore(ctx({
      lockDurationDays: 10, lockedPercent: 5, nativeLockedUsd: 200,
      socialScore: 0, onchainScore: 0,
      contractVerified: false, ownershipRenounced: false,
      holderCount: 10, buySellRatio: 0.5
    }));
    expect(totalScore).toBeLessThanOrEqual(30);
    expect(tier).toBe('high-risk');
  });
});

describe('computeScore — hard disqualifiers', () => {
  test('devWalletFlagged → totalScore capped to 0', () => {
    const { totalScore, tier } = computeScore(ctx({ devWalletFlagged: true }));
    expect(totalScore).toBe(0);
    expect(tier).toBe('high-risk');
  });

  test('isHoneypot → totalScore capped to 0', () => {
    const { totalScore, tier } = computeScore(ctx({ isHoneypot: true, devWalletFlagged: false }));
    // Note: honeypot = hard disqualifier
    expect(totalScore).toBe(0);
    expect(tier).toBe('high-risk');
  });

  test('lockDurationDays < 7 → totalScore capped to 0', () => {
    const { totalScore, tier } = computeScore(ctx({ lockDurationDays: 5 }));
    expect(totalScore).toBe(0);
    expect(tier).toBe('high-risk');
  });

  test('disqualified alert still returns sub-scores for display', () => {
    const result = computeScore(ctx({ devWalletFlagged: true }));
    // Sub-scores computed before disqualification, stored separately for transparency
    expect(result.lockScore).toBeGreaterThan(0);
    expect(result.disqualifierReason).toBeDefined();
  });
});

describe('computeScore — null/missing data graceful handling', () => {
  test('null lockedPercent → 0 pts on lock % signal', () => {
    const { lockScore } = computeScore(ctx({ lockedPercent: null }));
    // 10 + 0 + 7 = 17
    expect(lockScore).toBe(17);
  });

  test('null nativeLockedUsd → 0 pts on USD signal', () => {
    const { lockScore } = computeScore(ctx({ nativeLockedUsd: null }));
    // 10 + 8 + 0 = 18
    expect(lockScore).toBe(18);
  });

  test('null holderCount → 0 pts on holder signal', () => {
    const { marketScore } = computeScore(ctx({ holderCount: null }));
    // 5 + 5 + 5 + 0 + 5 = 20
    expect(marketScore).toBe(20);
  });
});
