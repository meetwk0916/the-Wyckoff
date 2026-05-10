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
    applyTrade(state.tradeFlow, event)
  } else if (event.eventType === 'book_delta') {
    applyBookDelta(state.orderBook, event)
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

function applyTrade(tradeFlow, event) {
  const bucket = tradeFlow[event.instrumentType]
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

function applyBookDelta(orderBook, event) {
  const bucket = orderBook[event.instrumentType]
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
      updateBookSummary(bucket)
    }
  }
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
    return
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
}

function applyLiquidation(liquidation, event) {
  liquidation.events += 1

  for (const item of event.payload?.data || []) {
    for (const detail of item.details || []) {
      const rawSize = toNumber(detail.sz)
      const bankruptcyPrice = toNumber(detail.bkPx)
      const timestamp = detail.ts ? new Date(Number(detail.ts)).toISOString() : event.eventTime

      liquidation.details += 1
      if (Number.isFinite(rawSize)) {
        liquidation.totalRawSize += rawSize
        liquidation.maxRawSize = liquidation.maxRawSize === null ? rawSize : Math.max(liquidation.maxRawSize, rawSize)
        if (detail.side === 'buy') {
          liquidation.buyRawSize += rawSize
        } else if (detail.side === 'sell') {
          liquidation.sellRawSize += rawSize
        }
      }
      if (Number.isFinite(bankruptcyPrice)) {
        liquidation.minBankruptcyPrice =
          liquidation.minBankruptcyPrice === null ? bankruptcyPrice : Math.min(liquidation.minBankruptcyPrice, bankruptcyPrice)
        liquidation.maxBankruptcyPrice =
          liquidation.maxBankruptcyPrice === null ? bankruptcyPrice : Math.max(liquidation.maxBankruptcyPrice, bankruptcyPrice)
      }
      updateTimestampRange(liquidation, timestamp)
      if (liquidation.samples.length < 10) {
        liquidation.samples.push({
          timestamp,
          instrument: item.instId,
          side: detail.side,
          posSide: detail.posSide,
          rawSize,
          bankruptcyPrice,
        })
      }
    }
  }
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
      tradeFlow: roundObject(state.tradeFlow),
      orderBookRecovery: buildOrderBookRecovery(state.orderBook),
      liquidationSpike: roundObject(state.liquidation),
      derivativesContext: roundObject(state.derivatives),
    },
    interpretation: {
      label: missingPhaseCInputs.length === 0 ? 'phase_c_evidence_ready' : 'insufficient_evidence',
      reasons,
      note: 'Evidence only. This report does not classify Spring, LPS, or trade actions.',
    },
  }
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

function buildOrderBookRecovery(orderBook) {
  return {
    spot: summarizeBookBucket(orderBook.spot),
    perp: summarizeBookBucket(orderBook.perp),
  }
}

function summarizeBookBucket(bucket) {
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
  })
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

function updatePriceRange(bucket, price) {
  bucket.firstPrice ??= price
  bucket.lastPrice = price
  bucket.minPrice = bucket.minPrice === null ? price : Math.min(bucket.minPrice, price)
  bucket.maxPrice = bucket.maxPrice === null ? price : Math.max(bucket.maxPrice, price)
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
