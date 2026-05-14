import { createReadStream } from 'node:fs'
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'

const workspaceDir = dirname(dirname(fileURLToPath(import.meta.url)))
const defaultDataDir = resolve(workspaceDir, 'data/raw')
const defaultFixtureConfigPath = resolve(workspaceDir, 'config/replay-fixtures.json')
const defaultReportPath = resolve(workspaceDir, 'reports/phase-c-evidence-last.json')
const fullSensorInputs = ['trade', 'book_delta', 'open_interest', 'funding_rate', 'liquidation']
const phaseCInputs = ['book_delta', 'liquidation']
const cvdBiasThreshold = 0.05

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const windows = await buildWindows(options)
  const files = await listJsonlFiles(options.dataDir)
  const results = []

  for (const window of windows) {
    results.push(await buildEvidenceForWindow(window, files, options))
  }

  const report = {
    reportType: 'crypto_phase_c_evidence',
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    dataDir: options.dataDir,
    fixtureConfigPath: options.fixtureConfigPath,
    totals: buildReportTotals(results),
    windows: results,
  }

  await mkdir(dirname(options.reportPath), { recursive: true })
  await writeFile(options.reportPath, `${JSON.stringify(report, null, 2)}\n`)
  printSummary(report, options.reportPath)
}

function parseArgs(args) {
  const options = {
    dataDir: defaultDataDir,
    fixtureConfigPath: defaultFixtureConfigPath,
    reportPath: defaultReportPath,
    fixtureId: 'all',
    start: null,
    end: null,
    symbol: 'BTC',
    provider: 'all',
  }

  for (const arg of args) {
    if (arg.startsWith('--data-dir=')) {
      options.dataDir = resolve(arg.slice('--data-dir='.length))
    } else if (arg.startsWith('--config=')) {
      options.fixtureConfigPath = resolve(arg.slice('--config='.length))
    } else if (arg.startsWith('--report=')) {
      options.reportPath = resolve(arg.slice('--report='.length))
    } else if (arg.startsWith('--fixture=')) {
      options.fixtureId = arg.slice('--fixture='.length)
    } else if (arg.startsWith('--start=')) {
      options.start = parseDateArg(arg.slice('--start='.length), '--start')
    } else if (arg.startsWith('--end=')) {
      options.end = parseDateArg(arg.slice('--end='.length), '--end')
    } else if (arg.startsWith('--symbol=')) {
      options.symbol = arg.slice('--symbol='.length).toUpperCase()
    } else if (arg.startsWith('--provider=')) {
      options.provider = arg.slice('--provider='.length)
    } else if (arg === '--help' || arg === '-h') {
      printHelp()
      process.exit(0)
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }

  if ((options.start && !options.end) || (!options.start && options.end)) {
    throw new Error('--start and --end must be provided together')
  }
  if (options.start && options.end && options.start > options.end) {
    throw new Error('--start must be before --end')
  }

  return options
}

function parseDateArg(value, name) {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`${name} must be an ISO timestamp`)
  }
  return parsed
}

async function buildWindows(options) {
  if (options.start && options.end) {
    return [
      {
        id: 'manual-window',
        description: 'Manual Phase C evidence window.',
        provider: options.provider,
        symbol: options.symbol,
        start: options.start,
        end: options.end,
      },
    ]
  }

  const config = JSON.parse(await readFile(options.fixtureConfigPath, 'utf8'))
  const fixtures = Array.isArray(config.fixtures) ? config.fixtures : []
  const selected = fixtures.filter((fixture) => options.fixtureId === 'all' || fixture.id === options.fixtureId)

  if (selected.length === 0) {
    throw new Error(`No replay fixtures matched --fixture=${options.fixtureId}`)
  }

  return selected.map((fixture) => ({
    id: fixture.id,
    description: fixture.description,
    provider: fixture.provider || 'all',
    symbol: fixture.symbol || 'BTC',
    start: parseDateArg(fixture.start, `${fixture.id}.start`),
    end: parseDateArg(fixture.end, `${fixture.id}.end`),
  }))
}

async function listJsonlFiles(rootDir) {
  const files = []

  async function walk(currentDir) {
    let entries

    try {
      entries = await readdir(currentDir, { withFileTypes: true })
    } catch {
      return
    }

    for (const entry of entries) {
      const entryPath = join(currentDir, entry.name)

      if (entry.isDirectory()) {
        await walk(entryPath)
      } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        files.push(entryPath)
      }
    }
  }

  await walk(rootDir)
  return files.sort()
}

async function buildEvidenceForWindow(window, files, options) {
  const state = createWindowState(window, files.length)

  for (const filePath of files) {
    await scanJsonlFile(filePath, window, state)
  }

  return finalizeEvidence(state, options.dataDir)
}

function createWindowState(window, filesScanned) {
  return {
    window,
    totals: {
      filesScanned,
      lines: 0,
      parsedEvents: 0,
      matchedEvents: 0,
      parseErrors: 0,
    },
    byEventType: {},
    byInstrumentType: {},
    firstMatchedAt: '',
    lastMatchedAt: '',
    tradeFlow: createTradeFlowState(),
    orderBook: createOrderBookState(),
    priceObservations: createPriceObservationState(),
    liquidation: createLiquidationState(),
    derivatives: createDerivativesState(),
    warnings: [],
  }
}

function createTradeFlowState() {
  return {
    spot: createTradeBucket(),
    perp: createTradeBucket(),
  }
}

function createPriceObservationState() {
  return {
    spot: [],
    perp: [],
  }
}

function createTradeBucket() {
  return {
    trades: 0,
    buyTrades: 0,
    sellTrades: 0,
    buyRawSize: 0,
    sellRawSize: 0,
    netRawSize: 0,
    buyRawNotional: 0,
    sellRawNotional: 0,
    netRawNotional: 0,
    firstPrice: null,
    lastPrice: null,
    minPrice: null,
    maxPrice: null,
  }
}

function createOrderBookState() {
  return {
    spot: createBookBucket(),
    perp: createBookBucket(),
  }
}

function createBookBucket() {
  return {
    initialized: false,
    bids: new Map(),
    asks: new Map(),
    samples: 0,
    updateMessages: 0,
    snapshotMessages: 0,
    firstMid: null,
    lastMid: null,
    minMid: null,
    maxMid: null,
    firstSpread: null,
    lastSpread: null,
    averageSpread: null,
    firstTopDepth: null,
    lastTopDepth: null,
    averageImbalance: null,
    observations: [],
  }
}

function createLiquidationState() {
  return {
    events: 0,
    details: 0,
    buyRawSize: 0,
    sellRawSize: 0,
    totalRawSize: 0,
    maxRawSize: null,
    minBankruptcyPrice: null,
    maxBankruptcyPrice: null,
    firstAt: '',
    lastAt: '',
    samples: [],
  }
}

function createDerivativesState() {
  return {
    openInterest: createNumericSeries(),
    fundingRate: createNumericSeries(),
  }
}

function createNumericSeries() {
  return {
    samples: 0,
    first: null,
    last: null,
    min: null,
    max: null,
    change: null,
    changePct: null,
    firstAt: '',
    lastAt: '',
  }
}

async function scanJsonlFile(filePath, window, state) {
  const fileStat = await stat(filePath)
  if (fileStat.size === 0) {
    return
  }

  const reader = createInterface({
    input: createReadStream(filePath),
    crlfDelay: Infinity,
  })

  for await (const line of reader) {
    if (!line.trim()) {
      continue
    }

    state.totals.lines += 1

    let event
    try {
      event = JSON.parse(line)
      state.totals.parsedEvents += 1
    } catch {
      state.totals.parseErrors += 1
      continue
    }

    if (!matchesWindow(event, window)) {
      continue
    }

    state.totals.matchedEvents += 1
    incrementCounter(state.byEventType, event.eventType || 'unknown')
    incrementCounter(state.byInstrumentType, event.instrumentType || 'unknown')
    updateWindowBounds(state, event)
    applyEvent(state, event)
  }
}

function matchesWindow(event, window) {
  if (window.provider !== 'all' && event.provider !== window.provider) {
    return false
  }

  if (window.symbol && !eventMatchesSymbol(event, window.symbol)) {
    return false
  }

  const eventDate = parseEventDate(event)
  if (!eventDate) {
    return false
  }

  return eventDate >= window.start && eventDate <= window.end
}

function applyEvent(state, event) {
  if (event.eventType === 'trade') {
    applyTrade(state, event)
  } else if (event.eventType === 'book_delta') {
    applyBookDelta(state, event)
  } else if (event.eventType === 'liquidation') {
    applyLiquidation(state.liquidation, event)
  } else if (event.eventType === 'open_interest') {
    applyOpenInterest(state.derivatives.openInterest, event)
  } else if (event.eventType === 'funding_rate') {
    applyFundingRate(state.derivatives.fundingRate, event)
  } else if (event.eventType === 'provider_status') {
    addWarning(state, 'provider_status_events_present')
  }
}

function applyTrade(state, event) {
  const bucket = state.tradeFlow[event.instrumentType]
  if (!bucket || !Array.isArray(event.payload?.data)) {
    return
  }

  for (const item of event.payload.data) {
    const side = item.side
    const size = toNumber(item.sz)
    const price = toNumber(item.px)

    if (!Number.isFinite(size) || !Number.isFinite(price)) {
      continue
    }

    bucket.trades += 1
    updatePriceRange(bucket, price)
    recordPriceObservation(state, event.instrumentType, price, timestampFromPayloadItem(item, event), 'trade')

    const notional = size * price
    if (side === 'buy') {
      bucket.buyTrades += 1
      bucket.buyRawSize += size
      bucket.buyRawNotional += notional
    } else if (side === 'sell') {
      bucket.sellTrades += 1
      bucket.sellRawSize += size
      bucket.sellRawNotional += notional
    }
  }

  bucket.netRawSize = bucket.buyRawSize - bucket.sellRawSize
  bucket.netRawNotional = bucket.buyRawNotional - bucket.sellRawNotional
}

function applyBookDelta(state, event) {
  const bucket = state.orderBook[event.instrumentType]
  if (!bucket || !Array.isArray(event.payload?.data)) {
    return
  }

  for (const item of event.payload.data) {
    const action = event.payload.action || 'update'

    if (action === 'snapshot') {
      bucket.bids.clear()
      bucket.asks.clear()
      bucket.initialized = true
      bucket.snapshotMessages += 1
    } else {
      bucket.updateMessages += 1
    }

    applyLevels(bucket.bids, item.bids)
    applyLevels(bucket.asks, item.asks)

    if (bucket.initialized) {
      const summary = updateBookSummary(bucket)
      if (summary) {
        recordPriceObservation(state, event.instrumentType, summary.mid, event.eventTime, 'book_mid')
        recordBookObservation(bucket, event.eventTime, summary)
      }
    }
  }
}

function recordBookObservation(bucket, timestamp, summary) {
  if (!timestamp) {
    return
  }

  bucket.observations.push({
    timestamp,
    mid: summary.mid,
    bidDepth: summary.bidDepth,
    askDepth: summary.askDepth,
    imbalance: summary.imbalance,
  })
}

function applyLevels(levels, updates) {
  if (!Array.isArray(updates)) {
    return
  }

  for (const level of updates) {
    const price = toNumber(level[0])
    const size = toNumber(level[1])
    if (!Number.isFinite(price) || !Number.isFinite(size)) {
      continue
    }
    if (size === 0) {
      levels.delete(price)
    } else {
      levels.set(price, size)
    }
  }
}

function updateBookSummary(bucket) {
  const bestBid = maxKey(bucket.bids)
  const bestAsk = minKey(bucket.asks)

  if (!Number.isFinite(bestBid) || !Number.isFinite(bestAsk) || bestAsk <= bestBid) {
    return null
  }

  const bidDepth = topDepth(bucket.bids, 'bid')
  const askDepth = topDepth(bucket.asks, 'ask')
  const topDepthTotal = bidDepth + askDepth
  const imbalance = topDepthTotal > 0 ? (bidDepth - askDepth) / topDepthTotal : null
  const mid = (bestBid + bestAsk) / 2
  const spread = bestAsk - bestBid
  const previousSamples = bucket.samples

  bucket.samples += 1
  bucket.firstMid ??= mid
  bucket.lastMid = mid
  bucket.minMid = bucket.minMid === null ? mid : Math.min(bucket.minMid, mid)
  bucket.maxMid = bucket.maxMid === null ? mid : Math.max(bucket.maxMid, mid)
  bucket.firstSpread ??= spread
  bucket.lastSpread = spread
  bucket.averageSpread = rollingAverage(bucket.averageSpread, spread, previousSamples)
  bucket.firstTopDepth ??= { bid: bidDepth, ask: askDepth, imbalance }
  bucket.lastTopDepth = { bid: bidDepth, ask: askDepth, imbalance }
  if (imbalance !== null) {
    bucket.averageImbalance = rollingAverage(bucket.averageImbalance, imbalance, previousSamples)
  }

  return { mid, spread, bidDepth, askDepth, imbalance }
}

function applyLiquidation(liquidation, event) {
  liquidation.events += 1

  if (event.provider === 'bybit') {
    for (const item of event.payload?.data || []) {
      updateLiquidationDetail(liquidation, {
        timestamp: item.T ? new Date(Number(item.T)).toISOString() : event.eventTime,
        instrument: item.s,
        side: normalizeBybitLiquidationSide(item.S),
        posSide: normalizeBybitPositionSide(item.S),
        rawSize: toNumber(item.v),
        bankruptcyPrice: toNumber(item.p),
      })
    }
  }

  for (const item of event.payload?.data || []) {
    for (const detail of item.details || []) {
      updateLiquidationDetail(liquidation, {
        timestamp: detail.ts ? new Date(Number(detail.ts)).toISOString() : event.eventTime,
        instrument: item.instId,
        side: detail.side,
        posSide: detail.posSide,
        rawSize: toNumber(detail.sz),
        bankruptcyPrice: toNumber(detail.bkPx),
      })
    }
  }
}

function updateLiquidationDetail(liquidation, detail) {
  liquidation.details += 1
  if (Number.isFinite(detail.rawSize)) {
    liquidation.totalRawSize += detail.rawSize
    liquidation.maxRawSize =
      liquidation.maxRawSize === null ? detail.rawSize : Math.max(liquidation.maxRawSize, detail.rawSize)
    if (detail.side === 'buy') {
      liquidation.buyRawSize += detail.rawSize
    } else if (detail.side === 'sell') {
      liquidation.sellRawSize += detail.rawSize
    }
  }
  if (Number.isFinite(detail.bankruptcyPrice)) {
    liquidation.minBankruptcyPrice =
      liquidation.minBankruptcyPrice === null
        ? detail.bankruptcyPrice
        : Math.min(liquidation.minBankruptcyPrice, detail.bankruptcyPrice)
    liquidation.maxBankruptcyPrice =
      liquidation.maxBankruptcyPrice === null
        ? detail.bankruptcyPrice
        : Math.max(liquidation.maxBankruptcyPrice, detail.bankruptcyPrice)
  }
  updateTimestampRange(liquidation, detail.timestamp)
  if (liquidation.samples.length < 10) {
    liquidation.samples.push(detail)
  }
}

function normalizeBybitLiquidationSide(side) {
  if (side === 'Buy') {
    return 'sell'
  }
  if (side === 'Sell') {
    return 'buy'
  }
  return ''
}

function normalizeBybitPositionSide(side) {
  if (side === 'Buy') {
    return 'long'
  }
  if (side === 'Sell') {
    return 'short'
  }
  return ''
}

function applyOpenInterest(series, event) {
  for (const item of event.payload?.data || []) {
    updateNumericSeries(series, toNumber(item.oiUsd ?? item.oiCcy ?? item.oi), event.eventTime)
  }
}

function applyFundingRate(series, event) {
  for (const item of event.payload?.data || []) {
    updateNumericSeries(series, toNumber(item.fundingRate), event.eventTime)
  }
}

function updateNumericSeries(series, value, timestamp) {
  if (!Number.isFinite(value)) {
    return
  }

  series.samples += 1
  if (series.first === null) {
    series.first = value
    series.firstAt = timestamp
  }
  series.last = value
  series.lastAt = timestamp
  series.min = series.min === null ? value : Math.min(series.min, value)
  series.max = series.max === null ? value : Math.max(series.max, value)
  series.change = series.last - series.first
  series.changePct = series.first === 0 ? null : series.change / series.first
}

function finalizeEvidence(state, dataDir) {
  const presentEventTypes = Object.keys(state.byEventType)
  const missingFullSensorInputs = fullSensorInputs.filter((eventType) => !presentEventTypes.includes(eventType))
  const missingPhaseCInputs = phaseCInputs.filter((eventType) => !presentEventTypes.includes(eventType))
  const reasons = []

  if (state.totals.matchedEvents === 0) {
    reasons.push('no_matched_events')
  }
  if (missingPhaseCInputs.length > 0) {
    reasons.push(`missing_phase_c_inputs:${missingPhaseCInputs.join(',')}`)
  }
  if (missingFullSensorInputs.length > 0) {
    reasons.push(`missing_full_sensor_inputs:${missingFullSensorInputs.join(',')}`)
  }
  if (state.warnings.length > 0) {
    reasons.push(...state.warnings)
  }

  return {
    id: state.window.id,
    description: state.window.description,
    filters: {
      start: state.window.start.toISOString(),
      end: state.window.end.toISOString(),
      symbol: state.window.symbol,
      provider: state.window.provider,
    },
    dataDir,
    totals: state.totals,
    byEventType: state.byEventType,
    byInstrumentType: state.byInstrumentType,
    firstMatchedAt: state.firstMatchedAt,
    lastMatchedAt: state.lastMatchedAt,
    readiness: {
      phaseCInputs,
      phaseCInputsReady: missingPhaseCInputs.length === 0,
      missingPhaseCInputs,
      fullSensorInputs,
      fullSensorReady: missingFullSensorInputs.length === 0,
      missingFullSensorInputs,
    },
    evidence: {
      priceAction: buildPriceAction(state.tradeFlow, state.orderBook),
      structureContext: buildStructureContext(state),
      tradeFlow: roundObject(state.tradeFlow),
      cvdContext: buildCvdContext(state.tradeFlow),
      orderBookRecovery: buildOrderBookRecovery(state.orderBook, state),
      liquidationSpike: roundObject(state.liquidation),
      derivativesContext: buildDerivativesContext(state.derivatives),
    },
    interpretation: {
      label: missingPhaseCInputs.length === 0 ? 'phase_c_evidence_ready' : 'insufficient_evidence',
      reasons,
      note: 'Evidence only. This report does not classify Spring, LPS, or trade actions.',
    },
  }
}

function buildDerivativesContext(derivatives) {
  return roundObject({
    ...derivatives,
    openInterestShock: summarizeOpenInterestShock(derivatives.openInterest),
    fundingContext: summarizeFundingContext(derivatives.fundingRate),
  })
}

function summarizeFundingContext(fundingRate) {
  const samples = fundingRate.samples || 0
  const last = fundingRate.last
  const maxAbs = maxAbsDefined(fundingRate.min, fundingRate.max)
  const isObserved = samples > 0 && last !== null

  return {
    samples,
    first: fundingRate.first,
    last,
    min: fundingRate.min,
    max: fundingRate.max,
    maxAbs,
    crowding: classifyFundingCrowding(last),
    extremeCrowding: isObserved && maxAbs !== null && maxAbs >= 0.0005,
    quality: isObserved ? 'observed' : 'missing_funding_rate',
    note:
      'Funding is crowding context only. Positive values point to crowded longs; negative values point to crowded shorts.',
  }
}

function classifyFundingCrowding(value) {
  if (value === null) {
    return 'unknown'
  }
  if (value >= 0.0005) {
    return 'extreme_crowded_long'
  }
  if (value >= 0.0001) {
    return 'crowded_long'
  }
  if (value <= -0.0005) {
    return 'extreme_crowded_short'
  }
  if (value <= -0.0001) {
    return 'crowded_short'
  }
  return 'neutral'
}

function summarizeOpenInterestShock(openInterest) {
  const changePct = openInterest.changePct
  const change = openInterest.change
  const samples = openInterest.samples || 0
  const isObserved = samples >= 2 && changePct !== null

  return {
    samples,
    first: openInterest.first,
    last: openInterest.last,
    change,
    changePct,
    direction: classifyOpenInterestShock(changePct),
    isDeleveraging: isObserved && changePct <= -0.03,
    quality: isObserved ? 'observed' : 'insufficient_open_interest_samples',
    note: 'Open-interest drops help confirm liquidation-driven deleveraging when exchange liquidation feeds are underreported.',
  }
}

function classifyOpenInterestShock(changePct) {
  if (changePct === null) {
    return 'unknown'
  }
  if (changePct <= -0.03) {
    return 'sharp_decrease'
  }
  if (changePct < 0) {
    return 'decrease'
  }
  if (changePct > 0.03) {
    return 'sharp_increase'
  }
  if (changePct > 0) {
    return 'increase'
  }
  return 'flat'
}

function buildCvdContext(tradeFlow) {
  const spot = summarizeCvdBucket(tradeFlow.spot)
  const perp = summarizeCvdBucket(tradeFlow.perp)
  const divergence = classifyCvdDivergence(spot, perp)
  const phaseCFlowSupport = isPhaseCFlowSupportive(spot, perp)

  return {
    spot,
    perp,
    divergence,
    phaseCFlowSupport,
    verdict: buildCvdVerdict(spot, perp, divergence, phaseCFlowSupport),
    thresholds: {
      demandDeltaRatio: cvdBiasThreshold,
      supplyDeltaRatio: -cvdBiasThreshold,
    },
  }
}

function summarizeCvdBucket(bucket) {
  const buyNotional = bucket.buyRawNotional || 0
  const sellNotional = bucket.sellRawNotional || 0
  const totalNotional = buyNotional + sellNotional
  const notionalDelta = buyNotional - sellNotional
  const deltaRatio = totalNotional === 0 ? null : notionalDelta / totalNotional

  return roundObject({
    trades: bucket.trades,
    buyTrades: bucket.buyTrades,
    sellTrades: bucket.sellTrades,
    buyRawSize: bucket.buyRawSize,
    sellRawSize: bucket.sellRawSize,
    rawSizeDelta: bucket.buyRawSize - bucket.sellRawSize,
    buyRawNotional: buyNotional,
    sellRawNotional: sellNotional,
    notionalDelta,
    totalRawNotional: totalNotional,
    deltaRatio,
    bias: classifyCvdBias(deltaRatio),
    quality: bucket.trades > 0 ? 'observed' : 'missing_trades',
  })
}

function classifyCvdBias(deltaRatio) {
  if (deltaRatio === null) {
    return 'unknown'
  }
  if (deltaRatio >= cvdBiasThreshold) {
    return 'demand'
  }
  if (deltaRatio <= -cvdBiasThreshold) {
    return 'supply'
  }
  return 'balanced'
}

function classifyCvdDivergence(spot, perp) {
  if (spot.quality !== 'observed' || perp.quality !== 'observed') {
    return 'insufficient_trade_flow'
  }
  if (spot.bias === 'demand' && perp.bias === 'supply') {
    return 'spot_demand_perp_supply'
  }
  if (spot.bias === 'supply' && perp.bias === 'demand') {
    return 'spot_supply_perp_demand'
  }
  if (spot.bias === 'demand' && perp.bias === 'demand') {
    return 'broad_demand'
  }
  if (spot.bias === 'supply' && perp.bias === 'supply') {
    return 'broad_supply'
  }
  return 'mixed_or_balanced'
}

function isPhaseCFlowSupportive(spot, perp) {
  if (spot.quality !== 'observed' || perp.quality !== 'observed') {
    return false
  }
  if (spot.bias === 'supply') {
    return false
  }
  return spot.bias === 'demand' || (spot.bias === 'balanced' && perp.bias !== 'demand')
}

function buildCvdVerdict(spot, perp, divergence, phaseCFlowSupport) {
  const reasons = []
  const observed = spot.quality === 'observed' && perp.quality === 'observed'

  if (!observed) {
    reasons.push('missing_spot_or_perp_trade_flow')
  }
  if (spot.bias === 'demand') {
    reasons.push('spot_demand')
  } else if (spot.bias === 'supply') {
    reasons.push('spot_supply')
  }
  if (perp.bias === 'supply') {
    reasons.push('perp_supply')
  } else if (perp.bias === 'demand') {
    reasons.push('perp_demand')
  }
  if (divergence === 'spot_demand_perp_supply') {
    reasons.push('spot_absorption_against_perp_selling')
  } else if (divergence === 'broad_supply') {
    reasons.push('broad_selling_pressure')
  } else if (divergence === 'broad_demand') {
    reasons.push('broad_demand_pressure')
  }

  return {
    quality: observed ? 'observed' : 'insufficient_trade_flow',
    phaseCFlowSupport,
    demandConfirmation: observed && (spot.bias === 'demand' || divergence === 'spot_demand_perp_supply'),
    distributionRisk: observed && (spot.bias === 'supply' || divergence === 'broad_supply'),
    divergence,
    reasons,
  }
}

function buildStructureContext(state) {
  const spot = summarizeStructureForInstrument(state.priceObservations.spot, state)
  const perp = summarizeStructureForInstrument(state.priceObservations.perp, state)

  return {
    anchor: buildStructureAnchor(state),
    spot,
    perp,
    verdict: summarizePhaseCStructure(spot, perp),
  }
}

function buildStructureAnchor(state) {
  if (state.liquidation.firstAt) {
    return {
      type: 'first_liquidation',
      timestamp: state.liquidation.firstAt,
    }
  }

  return {
    type: 'window_midpoint',
    timestamp: midpointIso(state.window.start, state.window.end),
  }
}

function summarizeStructureForInstrument(observations, state) {
  const sorted = observations
    .filter((observation) => Number.isFinite(observation.price) && observation.timestamp)
    .sort((left, right) => left.timestamp.localeCompare(right.timestamp))
  const sourceCounts = countObservationSources(sorted)

  if (sorted.length < 3) {
    return {
      observations: sorted.length,
      sourceCounts,
      supportMethod: 'insufficient_observations',
      support: null,
      resistance: null,
      supportBroken: false,
      supportRecovered: false,
      recoveryQuality: 'insufficient_observations',
      breakDepth: null,
      breakDepthPct: null,
      reclaimDistance: null,
      reclaimDistancePct: null,
      recoveryFromBreak: null,
      recoveryFromBreakPct: null,
    }
  }

  const anchorTimestamp = state.liquidation.firstAt || midpointIso(state.window.start, state.window.end)
  const preAnchor = sorted.filter((observation) => observation.timestamp <= anchorTimestamp)
  const fallbackSampleSize = Math.max(1, Math.ceil(sorted.length * 0.3))
  const reference = preAnchor.length >= 3 ? preAnchor : sorted.slice(0, fallbackSampleSize)
  const prices = reference.map((observation) => observation.price).sort((left, right) => left - right)
  const support = quantile(prices, 0.1)
  const resistance = quantile(prices, 0.9)
  const postAnchor = sorted.filter((observation) => observation.timestamp >= anchorTimestamp)
  const evaluation = postAnchor.length > 0 ? postAnchor : sorted
  const postAnchorLow = minDefined(...evaluation.map((observation) => observation.price))
  const last = sorted[sorted.length - 1].price
  const supportBroken = support !== null && postAnchorLow !== null && postAnchorLow < support
  const breakDepth = supportBroken ? support - postAnchorLow : null
  const supportRecovered = supportBroken && last !== null && support !== null && last >= support
  const reclaimDistance = supportRecovered ? last - support : null
  const recoveryFromBreak = supportRecovered && postAnchorLow !== null ? last - postAnchorLow : null

  return roundObject({
    observations: sorted.length,
    sourceCounts,
    anchorTimestamp,
    supportMethod: preAnchor.length >= 3 ? 'pre_anchor_p10_price' : 'first_window_slice_p10_price',
    supportSampleCount: reference.length,
    support,
    resistance,
    windowLow: minDefined(...sorted.map((observation) => observation.price)),
    windowHigh: maxDefined(...sorted.map((observation) => observation.price)),
    postAnchorLow,
    last,
    supportBroken,
    supportRecovered,
    recoveryQuality: classifyStructureRecovery(supportBroken, supportRecovered),
    breakDepth,
    breakDepthPct: breakDepth === null || support === 0 ? null : breakDepth / support,
    reclaimDistance,
    reclaimDistancePct: reclaimDistance === null || support === 0 ? null : reclaimDistance / support,
    recoveryFromBreak,
    recoveryFromBreakPct: recoveryFromBreak === null || support === 0 ? null : recoveryFromBreak / support,
    distanceToResistance: resistance === null || last === null ? null : resistance - last,
  })
}

function classifyStructureRecovery(supportBroken, supportRecovered) {
  if (supportRecovered) {
    return 'support_broken_and_recovered'
  }
  if (supportBroken) {
    return 'support_broken_not_recovered'
  }
  return 'support_not_broken'
}

function summarizePhaseCStructure(spot, perp) {
  const instruments = [spot, perp].filter((item) => item.supportMethod !== 'insufficient_observations')
  const supportBrokenCount = instruments.filter((item) => item.supportBroken).length
  const supportRecoveredCount = instruments.filter((item) => item.supportRecovered).length
  const reasons = []

  if (instruments.length === 0) {
    reasons.push('insufficient_structure_observations')
  }
  if (supportBrokenCount > 0) {
    reasons.push('support_broken')
  }
  if (supportRecoveredCount > 0) {
    reasons.push('support_recovered')
  }
  if (supportRecoveredCount === 2) {
    reasons.push('spot_and_perp_support_recovered')
  }

  return roundObject({
    quality: classifyPhaseCStructureQuality(instruments.length, supportBrokenCount, supportRecoveredCount),
    phaseCStructureSupport: supportRecoveredCount > 0,
    supportBroken: supportBrokenCount > 0,
    supportRecovered: supportRecoveredCount > 0,
    bothSupportRecovered: supportRecoveredCount === 2,
    observedInstruments: instruments.length,
    supportBrokenCount,
    supportRecoveredCount,
    maxBreakDepthPct: maxDefined(...instruments.map((item) => item.breakDepthPct)),
    minReclaimDistancePct: minDefined(...instruments.map((item) => item.reclaimDistancePct)),
    reasons,
  })
}

function classifyPhaseCStructureQuality(observedInstruments, supportBrokenCount, supportRecoveredCount) {
  if (observedInstruments === 0) {
    return 'insufficient_structure_observations'
  }
  if (supportRecoveredCount >= 2) {
    return 'strong_support_reclaim'
  }
  if (supportRecoveredCount === 1) {
    return 'partial_support_reclaim'
  }
  if (supportBrokenCount > 0) {
    return 'support_broken_not_recovered'
  }
  return 'support_not_broken'
}

function buildPriceAction(tradeFlow, orderBook) {
  return {
    spot: buildInstrumentPriceAction(tradeFlow.spot, orderBook.spot),
    perp: buildInstrumentPriceAction(tradeFlow.perp, orderBook.perp),
  }
}

function buildInstrumentPriceAction(trades, book) {
  const first = trades.firstPrice ?? book.firstMid
  const last = trades.lastPrice ?? book.lastMid
  const min = minDefined(trades.minPrice, book.minMid)
  const max = maxDefined(trades.maxPrice, book.maxMid)

  return roundObject({
    first,
    last,
    min,
    max,
    change: first === null || last === null ? null : last - first,
    drawdownFromFirst: first === null || min === null ? null : min - first,
    recoveryFromLow: last === null || min === null ? null : last - min,
  })
}

function buildOrderBookRecovery(orderBook, state) {
  const anchorTimestamp = state.liquidation.firstAt || midpointIso(state.window.start, state.window.end)

  return {
    anchorTimestamp,
    spot: summarizeBookBucket(orderBook.spot, anchorTimestamp),
    perp: summarizeBookBucket(orderBook.perp, anchorTimestamp),
  }
}

function summarizeBookBucket(bucket, anchorTimestamp) {
  const buckets = buildBookTimeBuckets(bucket.observations, anchorTimestamp)

  return roundObject({
    samples: bucket.samples,
    snapshotMessages: bucket.snapshotMessages,
    updateMessages: bucket.updateMessages,
    firstMid: bucket.firstMid,
    lastMid: bucket.lastMid,
    minMid: bucket.minMid,
    maxMid: bucket.maxMid,
    midChange: bucket.firstMid === null || bucket.lastMid === null ? null : bucket.lastMid - bucket.firstMid,
    recoveryFromLow: bucket.lastMid === null || bucket.minMid === null ? null : bucket.lastMid - bucket.minMid,
    firstSpread: bucket.firstSpread,
    lastSpread: bucket.lastSpread,
    averageSpread: bucket.averageSpread,
    firstTopDepth: bucket.firstTopDepth,
    lastTopDepth: bucket.lastTopDepth,
    averageImbalance: bucket.averageImbalance,
    buckets,
  })
}

function buildBookTimeBuckets(observations, anchorTimestamp) {
  const anchorMs = new Date(anchorTimestamp).getTime()
  if (!Number.isFinite(anchorMs)) {
    return {
      preAnchor: summarizeBookObservations([]),
      post1m: summarizeBookObservations([]),
      post3m: summarizeBookObservations([]),
    }
  }

  return {
    preAnchor: summarizeBookObservations(
      observations.filter((observation) => new Date(observation.timestamp).getTime() <= anchorMs),
    ),
    post1m: summarizeBookObservations(
      observations.filter((observation) => {
        const timestamp = new Date(observation.timestamp).getTime()
        return timestamp >= anchorMs && timestamp <= anchorMs + 60_000
      }),
    ),
    post3m: summarizeBookObservations(
      observations.filter((observation) => {
        const timestamp = new Date(observation.timestamp).getTime()
        return timestamp >= anchorMs && timestamp <= anchorMs + 180_000
      }),
    ),
  }
}

function summarizeBookObservations(observations) {
  const sorted = observations.slice().sort((left, right) => left.timestamp.localeCompare(right.timestamp))
  const first = sorted[0]
  const last = sorted[sorted.length - 1]

  return {
    samples: sorted.length,
    firstAt: first?.timestamp || '',
    lastAt: last?.timestamp || '',
    averageBidDepth: averageDefined(sorted.map((observation) => observation.bidDepth)),
    averageAskDepth: averageDefined(sorted.map((observation) => observation.askDepth)),
    averageImbalance: averageDefined(sorted.map((observation) => observation.imbalance)),
    bidDepthChange: first && last ? last.bidDepth - first.bidDepth : null,
    askDepthChange: first && last ? last.askDepth - first.askDepth : null,
    imbalanceChange: first && last ? last.imbalance - first.imbalance : null,
    askDepthChangePct: first?.askDepth ? (last.askDepth - first.askDepth) / first.askDepth : null,
  }
}

function buildReportTotals(results) {
  return {
    windows: results.length,
    phaseCInputsReady: results.filter((result) => result.readiness.phaseCInputsReady).length,
    fullSensorReady: results.filter((result) => result.readiness.fullSensorReady).length,
  }
}

function eventMatchesSymbol(event, symbolQuery) {
  const normalizedQuery = String(symbolQuery || '').toUpperCase()
  const payloadSymbols = extractPayloadSymbols(event)
  const symbols = payloadSymbols.length > 0 ? payloadSymbols : [event.symbol, event.providerSymbol]

  return symbols.some((symbol) => String(symbol || '').toUpperCase().includes(normalizedQuery))
}

function extractPayloadSymbols(event) {
  const symbols = new Set()
  const payload = event.payload

  addSymbol(symbols, payload?.s)
  addSymbol(symbols, payload?.o?.s)
  addSymbol(symbols, payload?.symbol)
  addSymbol(symbols, payload?.instId)
  addSymbol(symbols, payload?.instFamily)
  addSymbol(symbols, payload?.uly)

  if (Array.isArray(payload?.data)) {
    for (const item of payload.data) {
      addSymbol(symbols, item.s)
      addSymbol(symbols, item.symbol)
      addSymbol(symbols, item.instId)
      addSymbol(symbols, item.instFamily)
      addSymbol(symbols, item.uly)
    }
  }

  return Array.from(symbols)
}

function addSymbol(symbols, value) {
  if (typeof value === 'string' && value) {
    symbols.add(value)
  }
}

function parseEventDate(event) {
  const timestamp = event.eventTime || event.receivedAt
  const parsed = new Date(timestamp)
  if (Number.isNaN(parsed.getTime())) {
    return null
  }
  return parsed
}

function updateWindowBounds(state, event) {
  const timestamp = event.eventTime || event.receivedAt || ''
  if (!timestamp) {
    return
  }

  if (!state.firstMatchedAt || timestamp < state.firstMatchedAt) {
    state.firstMatchedAt = timestamp
  }

  if (!state.lastMatchedAt || timestamp > state.lastMatchedAt) {
    state.lastMatchedAt = timestamp
  }
}

function recordPriceObservation(state, instrumentType, price, timestamp, source) {
  const bucket = state.priceObservations[instrumentType]
  if (!bucket || !Number.isFinite(price) || !timestamp) {
    return
  }

  bucket.push({ timestamp, price, source })
}

function updatePriceRange(bucket, price) {
  bucket.firstPrice ??= price
  bucket.lastPrice = price
  bucket.minPrice = bucket.minPrice === null ? price : Math.min(bucket.minPrice, price)
  bucket.maxPrice = bucket.maxPrice === null ? price : Math.max(bucket.maxPrice, price)
}

function timestampFromPayloadItem(item, event) {
  if (item?.ts) {
    const parsed = new Date(Number(item.ts))
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString()
    }
  }
  return event.eventTime || event.receivedAt || ''
}

function midpointIso(start, end) {
  return new Date((start.getTime() + end.getTime()) / 2).toISOString()
}

function countObservationSources(observations) {
  return observations.reduce((counts, observation) => {
    incrementCounter(counts, observation.source || 'unknown')
    return counts
  }, {})
}

function quantile(sortedValues, percentile) {
  if (sortedValues.length === 0) {
    return null
  }
  if (sortedValues.length === 1) {
    return sortedValues[0]
  }

  const index = (sortedValues.length - 1) * percentile
  const lowerIndex = Math.floor(index)
  const upperIndex = Math.ceil(index)
  if (lowerIndex === upperIndex) {
    return sortedValues[lowerIndex]
  }

  const weight = index - lowerIndex
  return sortedValues[lowerIndex] * (1 - weight) + sortedValues[upperIndex] * weight
}

function updateTimestampRange(bucket, timestamp) {
  if (!timestamp) {
    return
  }
  if (!bucket.firstAt || timestamp < bucket.firstAt) {
    bucket.firstAt = timestamp
  }
  if (!bucket.lastAt || timestamp > bucket.lastAt) {
    bucket.lastAt = timestamp
  }
}

function incrementCounter(counter, key) {
  counter[key] = (counter[key] || 0) + 1
}

function addWarning(state, warning) {
  if (!state.warnings.includes(warning)) {
    state.warnings.push(warning)
  }
}

function toNumber(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function maxKey(map) {
  let max = null
  for (const key of map.keys()) {
    max = max === null ? key : Math.max(max, key)
  }
  return max
}

function minKey(map) {
  let min = null
  for (const key of map.keys()) {
    min = min === null ? key : Math.min(min, key)
  }
  return min
}

function topDepth(levels, side) {
  const prices = Array.from(levels.keys()).sort((left, right) => (side === 'bid' ? right - left : left - right))
  return prices.slice(0, 10).reduce((total, price) => total + (levels.get(price) || 0), 0)
}

function rollingAverage(previousAverage, nextValue, previousSamples) {
  const previous = previousAverage || 0
  return (previous * previousSamples + nextValue) / (previousSamples + 1)
}

function minDefined(...values) {
  const defined = values.filter((value) => value !== null && value !== undefined)
  return defined.length === 0 ? null : Math.min(...defined)
}

function maxDefined(...values) {
  const defined = values.filter((value) => value !== null && value !== undefined)
  return defined.length === 0 ? null : Math.max(...defined)
}

function maxAbsDefined(...values) {
  const defined = values.filter((value) => value !== null && value !== undefined).map((value) => Math.abs(value))
  return defined.length === 0 ? null : Math.max(...defined)
}

function averageDefined(values) {
  const defined = values.filter((value) => value !== null && value !== undefined)
  if (defined.length === 0) {
    return null
  }
  return defined.reduce((sum, value) => sum + value, 0) / defined.length
}

function roundObject(value) {
  if (typeof value === 'number') {
    return Math.round(value * 100000000) / 100000000
  }
  if (Array.isArray(value)) {
    return value.map((item) => roundObject(item))
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, roundObject(item)]))
  }
  return value
}

function printSummary(report, reportPath) {
  console.log(`Phase C evidence report written to ${reportPath}`)
  console.log(`Windows: ${report.totals.windows}`)
  console.log(`Phase C inputs ready: ${report.totals.phaseCInputsReady}`)
  console.log(`Full sensor ready: ${report.totals.fullSensorReady}`)
}

function printHelp() {
  console.log(`Usage: npm run crypto:phase-c:evidence -- [options]

Options:
  --data-dir=<path>  Raw JSONL data directory. Default: crypto-workspace/data/raw.
  --config=<path>    Replay fixture config path. Default: crypto-workspace/config/replay-fixtures.json.
  --fixture=<id>     Fixture id to run. Default: all.
  --report=<path>    Output evidence report path.
  --start=<iso>      Manual inclusive eventTime lower bound.
  --end=<iso>        Manual inclusive eventTime upper bound.
  --symbol=<text>    Manual symbol text filter. Default: BTC.
  --provider=<name>  Manual provider filter. Default: all.
`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
