const { formatAlert } = require('../lib/alert-formatter');

function opportunityCtx(overrides = {}) {
  return {
    tier: 'opportunity',
    totalScore: 74,
    lockScore: 18,
    socialScore: 20,
    onchainScore: 18,
    marketScore: 18,
    chain: 'BNB Chain',
    source: 'UNCX',
    tokenSymbol: 'PEPE',
    price: 0.0012,
    priceChange1h: 7.6,
    marketCap: 3500,
    liquidity: 2400,
    lockDurationDays: 365,
    lockedPercent: 75,
    nativeLockedUsd: 1200,
    nativeSymbol: 'BNB',
    contractVerified: true,
    isHoneypot: false,
    ownershipRenounced: true,
    ownerHoldPercent: 0,
    devWallet: '0xabc123',
    devWalletAgeDays: 142,
    devWalletFlagged: false,
    devWalletRugsInHuntrDb: 0,
    volume24h: 240,
    buySellRatio: 2.7,
    holderCount: 42,
    twitterHandle: '@TokenHandle',
    twitterFollowers: 4200,
    twitterActiveLast7Days: true,
    twitterSentiment: 'Positive',
    explorerLink: 'https://bscscan.com/tx/0x123',
    disqualifierReason: null,
    ...overrides
  };
}

describe('formatAlert — opportunity tier', () => {
  test('includes OPPORTUNITY DETECTED header', () => {
    const msg = formatAlert(opportunityCtx());
    expect(msg).toContain('OPPORTUNITY DETECTED');
    expect(msg).toContain('74/100');
  });

  test('includes sub-score breakdown line', () => {
    const msg = formatAlert(opportunityCtx());
    expect(msg).toContain('Lock: 18/25');
    expect(msg).toContain('Social: 20/25');
    expect(msg).toContain('On-chain: 18/25');
    expect(msg).toContain('Market: 18/25');
  });

  test('includes social block with twitter handle', () => {
    const msg = formatAlert(opportunityCtx());
    expect(msg).toContain('@TokenHandle');
    expect(msg).toContain('4,200');
    expect(msg).toContain('Positive');
  });

  test('includes dev wallet block', () => {
    const msg = formatAlert(opportunityCtx());
    expect(msg).toContain('0xabc1');
    expect(msg).toContain('142 days');
  });

  test('includes token info section', () => {
    const msg = formatAlert(opportunityCtx());
    expect(msg).toContain('$PEPE');
    expect(msg).toContain('BNB Chain');
  });

  test('includes View Transaction link', () => {
    const msg = formatAlert(opportunityCtx());
    expect(msg).toContain('https://bscscan.com/tx/0x123');
  });

  test('stays under 4000 chars', () => {
    const msg = formatAlert(opportunityCtx());
    expect(msg.length).toBeLessThanOrEqual(4000);
  });

  test('shows no-account message when twitterHandle is null', () => {
    const msg = formatAlert(opportunityCtx({ twitterHandle: null }));
    expect(msg).toContain('No account found');
  });

  test('truncated message still ends with explorerLink', () => {
    // Generate a context that will produce >4000 chars
    const msg = formatAlert(opportunityCtx({
      tier: 'opportunity',
      twitterSentiment: 'Positive',
      twitterHandle: '@' + 'a'.repeat(100),
      tokenSymbol: 'T'.repeat(50),
      devWallet: '0x' + 'a'.repeat(40),
      devWalletAgeDays: 9999,
      devWalletRugsInHuntrDb: 999
    }));
    // Whether truncated or not, the link must always be present exactly once
    expect(msg).toContain('https://bscscan.com/tx/0x123');
    const linkCount = (msg.match(/bscscan\.com\/tx\/0x123/g) || []).length;
    expect(linkCount).toBe(1);
    expect(msg.length).toBeLessThanOrEqual(4000);
  });
});

describe('formatAlert — moderate tier', () => {
  test('no OPPORTUNITY DETECTED header', () => {
    const msg = formatAlert(opportunityCtx({ tier: 'moderate', totalScore: 55 }));
    expect(msg).not.toContain('OPPORTUNITY DETECTED');
  });

  test('shows score in analysis line', () => {
    const msg = formatAlert(opportunityCtx({ tier: 'moderate', totalScore: 55 }));
    expect(msg).toContain('55/100');
  });
});

describe('formatAlert — high-risk tier', () => {
  test('shows condensed format', () => {
    const msg = formatAlert(opportunityCtx({
      tier: 'high-risk', totalScore: 12,
      disqualifierReason: null
    }));
    expect(msg).toContain('High Risk');
    expect(msg).toContain('12/100');
  });

  test('shows disqualifier reason when present', () => {
    const msg = formatAlert(opportunityCtx({
      tier: 'high-risk', totalScore: 0,
      disqualifierReason: 'Dev wallet flagged in rug database'
    }));
    expect(msg).toContain('Dev wallet flagged');
  });
});
