export const CRYPTO_PHASE_C_WATCH_URL = '/mock/crypto-phase-c-watch.json'

export const EMPTY_CRYPTO_PHASE_C_WATCH = {
  generatedAt: '',
  exportedAt: '',
  sourceSummary: {
    healthy: 0,
    fresh: 0,
    quiet: 0,
    issues: 0,
    sources: [],
  },
  candidateSummary: {
    btcLiquidationEvents: 0,
    liquidationClusters: 0,
    candidates: 0,
    longLiquidation: 0,
    shortLiquidation: 0,
    fullSensorReady: 0,
    unreviewed: 0,
    unreviewedLongLiquidation: 0,
    unreviewedFullSensorReady: 0,
    bestLong: null,
  },
  reviewNext: {
    status: 'unknown',
    suggestedLabel: '',
    suggestedConfidence: '',
    nextAction: '',
  },
  attention: {
    needsAttention: false,
    reasons: [],
    sourceIssues: [],
  },
  nextAction: '',
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function normalizeCryptoPhaseCWatch(payload) {
  const safePayload = isPlainObject(payload) ? payload : {}
  const sourceSummary = isPlainObject(safePayload.sourceSummary) ? safePayload.sourceSummary : {}
  const candidateSummary = isPlainObject(safePayload.candidateSummary) ? safePayload.candidateSummary : {}
  const reviewNext = isPlainObject(safePayload.reviewNext) ? safePayload.reviewNext : {}
  const attention = isPlainObject(safePayload.attention) ? safePayload.attention : {}

  return {
    ...EMPTY_CRYPTO_PHASE_C_WATCH,
    generatedAt: safePayload.generatedAt || '',
    exportedAt: safePayload.exportedAt || '',
    sourceSummary: {
      ...EMPTY_CRYPTO_PHASE_C_WATCH.sourceSummary,
      ...sourceSummary,
      sources: Array.isArray(sourceSummary.sources) ? sourceSummary.sources : [],
    },
    candidateSummary: {
      ...EMPTY_CRYPTO_PHASE_C_WATCH.candidateSummary,
      ...candidateSummary,
      bestLong: isPlainObject(candidateSummary.bestLong) ? candidateSummary.bestLong : null,
    },
    reviewNext: {
      ...EMPTY_CRYPTO_PHASE_C_WATCH.reviewNext,
      ...reviewNext,
    },
    attention: {
      ...EMPTY_CRYPTO_PHASE_C_WATCH.attention,
      ...attention,
      reasons: Array.isArray(attention.reasons) ? attention.reasons : [],
      sourceIssues: Array.isArray(attention.sourceIssues) ? attention.sourceIssues : [],
    },
    nextAction: safePayload.nextAction || '',
  }
}

export async function loadCryptoPhaseCWatch() {
  const response = await fetch(CRYPTO_PHASE_C_WATCH_URL, {
    cache: 'no-store',
    headers: {
      Accept: 'application/json',
    },
  })

  if (!response.ok) {
    throw new Error(`BTC Phase C 快照加载失败（HTTP ${response.status}）`)
  }

  return normalizeCryptoPhaseCWatch(await response.json())
}
