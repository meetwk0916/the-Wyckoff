// A-share Wyckoff evidence math. Pure functions only: this module never emits
// trade actions, only structured evidence used by the classifier downstream.

export const DEFAULT_PARAMS = {
  backgroundLookback: 60,
  backgroundDeclinePct: 0.18,
  structureLookback: 30,
  supportTolerancePct: 0.01,
  springPenetrationPct: 0.015,
  rsLookback: 20,
  betaLookback: 20,
  rsThreshold: -0.02,
  maxBeta: 1.2,
  macroMaWindow: 20,
  imbalanceThreshold: 0.1,
  utadCloseThreshold: 0.5,
  invalidationBars: 5,
  targetExtensionRatio: 1.0,
}

export function num(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

export function sma(values, window) {
  if (!Array.isArray(values) || values.length === 0) {
    return null
  }
  const slice = values.slice(-window)
  if (slice.length === 0) {
    return null
  }
  return slice.reduce((sum, value) => sum + num(value), 0) / slice.length
}

function returnsOf(closes) {
  const out = []
  for (let i = 1; i < closes.length; i += 1) {
    const prev = num(closes[i - 1])
    if (prev !== 0) {
      out.push((num(closes[i]) - prev) / prev)
    }
  }
  return out
}

function covariance(a, b) {
  const n = Math.min(a.length, b.length)
  if (n === 0) {
    return 0
  }
  const meanA = a.slice(0, n).reduce((s, v) => s + v, 0) / n
  const meanB = b.slice(0, n).reduce((s, v) => s + v, 0) / n
  let cov = 0
  for (let i = 0; i < n; i += 1) {
    cov += (a[i] - meanA) * (b[i] - meanB)
  }
  return cov / n
}

function variance(values) {
  const n = values.length
  if (n === 0) {
    return 0
  }
  const mean = values.reduce((s, v) => s + v, 0) / n
  return values.reduce((s, v) => s + (v - mean) ** 2, 0) / n
}

// Background: did the symbol build an accumulation-type decline before the anchor?
export function buildBackground(knownBars, params) {
  const window = knownBars.slice(-params.backgroundLookback)
  if (window.length === 0) {
    return { observations: 0, accumulationContext: false }
  }
  const priorHigh = Math.max(...window.map((bar) => num(bar.h)))
  const recentLow = Math.min(...window.map((bar) => num(bar.l)))
  const declinePct = priorHigh > 0 ? (priorHigh - recentLow) / priorHigh : 0
  return {
    observations: window.length,
    priorHigh,
    recentLow,
    declinePct,
    accumulationContext: declinePct >= params.backgroundDeclinePct,
  }
}

// Structure: support/resistance from bars strictly before the anchor bar.
export function buildStructure(knownBars, anchorIndex, params) {
  const priorBars = knownBars.slice(Math.max(0, anchorIndex - params.structureLookback), anchorIndex)
  if (priorBars.length === 0) {
    return { observations: 0 }
  }
  const support = Math.min(...priorBars.map((bar) => num(bar.l)))
  const resistance = Math.max(...priorBars.map((bar) => num(bar.h)))
  const anchor = knownBars[anchorIndex]
  const low = num(anchor.l)
  const close = num(anchor.c)
  const high = num(anchor.h)
  const penetrationPct = support > 0 ? (support - low) / support : 0
  const brokeSupport = low < support
  const reclaimedSupport = close > support
  const springPenetration = brokeSupport && penetrationPct <= params.springPenetrationPct + 0.02
  const failedBreakout = high > resistance && close < resistance
  // candle position of the close within its own range (1 = closed at high)
  const range = high - low
  const closePosition = range > 0 ? (close - low) / range : 0.5
  return {
    observations: priorBars.length,
    support,
    resistance,
    anchorLow: low,
    anchorClose: close,
    anchorHigh: high,
    penetrationPct,
    brokeSupport,
    reclaimedSupport,
    springPenetration,
    failedBreakout,
    closePosition,
    springConfirmed: springPenetration && reclaimedSupport,
  }
}

export function buildRelativeStrength(knownBars, benchmarkBars, params) {
  const symbolCloses = knownBars.map((bar) => num(bar.c)).slice(-params.rsLookback - 1)
  const benchCloses = (benchmarkBars || []).map((bar) => num(bar.c)).slice(-params.rsLookback - 1)
  if (symbolCloses.length < 2 || benchCloses.length < 2) {
    return { observations: 0, available: false }
  }
  const symbolReturn = (symbolCloses.at(-1) - symbolCloses[0]) / symbolCloses[0]
  const benchReturn = (benchCloses.at(-1) - benchCloses[0]) / benchCloses[0]
  const rs = symbolReturn - benchReturn
  const symbolRets = returnsOf(symbolCloses)
  const benchRets = returnsOf(benchCloses)
  const beta = variance(benchRets) > 0 ? covariance(symbolRets, benchRets) / variance(benchRets) : 0
  return {
    observations: symbolCloses.length,
    available: true,
    symbolReturn,
    benchReturn,
    rs,
    beta,
    rsOk: rs >= params.rsThreshold,
    betaOk: beta <= params.maxBeta,
  }
}

export function buildMacro(benchmarkBars, params) {
  const closes = (benchmarkBars || []).map((bar) => num(bar.c))
  if (closes.length < 2) {
    return { available: false, macroOk: false }
  }
  const ma = sma(closes, params.macroMaWindow)
  const last = closes.at(-1)
  return {
    available: true,
    last,
    ma,
    macroOk: ma !== null && last >= ma,
  }
}

// Order book imbalance + CVD from L2/transaction snapshots around the anchor.
export function buildMicrostructure(orderFlow, l2Available, params) {
  if (!l2Available || !Array.isArray(orderFlow) || orderFlow.length === 0) {
    return { available: false, bookRecovered: false, cvdSupport: false }
  }
  const imbalances = []
  let cvd = 0
  const cvdSeries = []
  for (const snap of orderFlow) {
    const bidSz = sumLevels(snap.bid)
    const askSz = sumLevels(snap.ask)
    const total = bidSz + askSz
    imbalances.push(total > 0 ? (bidSz - askSz) / total : 0)
    for (const tx of snap.transactions || []) {
      cvd += (tx.side === 'buy' ? 1 : -1) * num(tx.sz)
    }
    cvdSeries.push(cvd)
  }
  const minImbalance = Math.min(...imbalances)
  const lastImbalance = imbalances.at(-1)
  const minCvd = Math.min(...cvdSeries)
  const lastCvd = cvdSeries.at(-1)
  return {
    available: true,
    snapshots: orderFlow.length,
    minImbalance,
    lastImbalance,
    lastCvd,
    minCvd,
    // buyers returned to the book after the washout low
    bookRecovered: lastImbalance > minImbalance && lastImbalance >= -params.imbalanceThreshold,
    // cumulative delta turned up from its washout trough
    cvdSupport: lastCvd > minCvd,
  }
}

function sumLevels(levels) {
  if (!Array.isArray(levels)) {
    return 0
  }
  return levels.reduce((sum, level) => sum + num(level.sz), 0)
}

export function buildEvidence(fixture) {
  const params = { ...DEFAULT_PARAMS, ...(fixture.params || {}) }
  const dailyBars = Array.isArray(fixture.dailyBars) ? fixture.dailyBars : []
  const anchorIndex = Number.isInteger(fixture.anchorIndex) ? fixture.anchorIndex : dailyBars.length - 1
  const knownBars = dailyBars.slice(0, anchorIndex + 1)
  const l2Available = Boolean(fixture.l2Available)

  const background = buildBackground(knownBars, params)
  const structure = buildStructure(knownBars, anchorIndex, params)
  const relativeStrength = buildRelativeStrength(knownBars, fixture.benchmarkBars, params)
  const macro = buildMacro(fixture.benchmarkBars, params)
  const microstructure = buildMicrostructure(fixture.orderFlow, l2Available, params)

  const inputsReady = knownBars.length >= 2 && structure.observations > 0 && macro.available
  const fullSensorReady = inputsReady && microstructure.available

  return {
    id: fixture.id,
    symbol: fixture.symbol,
    description: fixture.description,
    filters: fixture.filters || {},
    params,
    anchorIndex,
    l2Available,
    readiness: { inputsReady, fullSensorReady },
    evidence: { background, structure, relativeStrength, macro, microstructure },
  }
}
