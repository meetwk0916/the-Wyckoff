import { createReadStream } from 'node:fs'
import { mkdir, readdir, stat, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'

const workspaceDir = dirname(dirname(fileURLToPath(import.meta.url)))
const defaultDataDir = resolve(workspaceDir, 'data/raw')
const defaultReportPath = resolve(workspaceDir, 'reports/phase-c-candidates-last.json')
const fullSensorInputs = ['trade', 'book_delta', 'open_interest', 'funding_rate', 'liquidation']
const phaseCInputs = ['book_delta', 'liquidation']

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const files = await listJsonlFiles(options.dataDir)
  const events = []
  const totals = {
    filesScanned: files.length,
    lines: 0,
    parsedEvents: 0,
    parseErrors: 0,
    btcEvents: 0,
    btcLiquidationEvents: 0,
  }

  for (const filePath of files) {
    await scanJsonlFile(filePath, options, events, totals)
  }

  events.sort(compareEvents)
  const liquidationEvents = events.filter((event) => event.eventType === 'liquidation')
  const candidates = liquidationEvents.map((event) => buildCandidate(event, events, options))
  const report = {
    reportType: 'crypto_phase_c_candidate_scan',
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    dataDir: options.dataDir,
    filters: {
      symbol: options.symbol,
      provider: options.provider,
      beforeMinutes: options.beforeMinutes,
      afterMinutes: options.afterMinutes,
    },
    totals: buildTotals(totals, candidates),
    candidates,
    fixtureDrafts: candidates.map((candidate) => candidate.fixtureDraft),
    notes: [
      'Candidate scan only. It does not classify Spring, approve paper trades, or emit live trade actions.',
      'Fixture drafts should be reviewed before adding to config/replay-fixtures.json.',
    ],
  }

  await mkdir(dirname(options.reportPath), { recursive: true })
  await writeFile(options.reportPath, `${JSON.stringify(report, null, 2)}\n`)
  printSummary(report, options.reportPath)
}

function parseArgs(args) {
  const options = {
    dataDir: defaultDataDir,
    reportPath: defaultReportPath,
    symbol: 'BTC',
    provider: 'all',
    beforeMinutes: 5,
    afterMinutes: 5,
  }

  for (const arg of args) {
    if (arg.startsWith('--data-dir=')) {
      options.dataDir = resolve(arg.slice('--data-dir='.length))
    } else if (arg.startsWith('--report=')) {
      options.reportPath = resolve(arg.slice('--report='.length))
    } else if (arg.startsWith('--symbol=')) {
      options.symbol = arg.slice('--symbol='.length).toUpperCase()
    } else if (arg.startsWith('--provider=')) {
      options.provider = arg.slice('--provider='.length)
    } else if (arg.startsWith('--before-min=')) {
      options.beforeMinutes = Number(arg.slice('--before-min='.length))
    } else if (arg.startsWith('--after-min=')) {
      options.afterMinutes = Number(arg.slice('--after-min='.length))
    } else if (arg === '--help' || arg === '-h') {
      printHelp()
      process.exit(0)
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }

  if (!Number.isFinite(options.beforeMinutes) || options.beforeMinutes < 0) {
    throw new Error('--before-min must be a non-negative number')
  }
  if (!Number.isFinite(options.afterMinutes) || options.afterMinutes < 0) {
    throw new Error('--after-min must be a non-negative number')
  }

  return options
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

async function scanJsonlFile(filePath, options, events, totals) {
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

    totals.lines += 1

    let event
    try {
      event = JSON.parse(line)
      totals.parsedEvents += 1
    } catch {
      totals.parseErrors += 1
      continue
    }

    if (options.provider !== 'all' && event.provider !== options.provider) {
      continue
    }
    if (!eventMatchesSymbol(event, options.symbol)) {
      continue
    }

    const eventTime = parseEventDate(event)
    if (!eventTime) {
      continue
    }

    totals.btcEvents += 1
    if (event.eventType === 'liquidation') {
      totals.btcLiquidationEvents += 1
    }

    events.push({
      provider: event.provider,
      venue: event.venue,
      instrumentType: event.instrumentType,
      symbol: event.symbol,
      providerSymbol: event.providerSymbol,
      eventType: event.eventType,
      eventTime: eventTime.toISOString(),
      receivedAt: event.receivedAt || '',
      payload: event.payload,
    })
  }
}

function buildCandidate(liquidationEvent, events, options) {
  const center = new Date(liquidationEvent.eventTime)
  const start = new Date(center.getTime() - options.beforeMinutes * 60 * 1000)
  const end = new Date(center.getTime() + options.afterMinutes * 60 * 1000)
  const windowEvents = events.filter((event) => {
    const eventTime = new Date(event.eventTime)
    return eventTime >= start && eventTime <= end
  })
  const byEventType = countBy(windowEvents, (event) => event.eventType || 'unknown')
  const byProvider = countBy(windowEvents, (event) => event.provider || 'unknown')
  const direction = classifyLiquidationDirection(liquidationEvent)
  const missingPhaseCInputs = phaseCInputs.filter((eventType) => !byEventType[eventType])
  const missingFullSensorInputs = fullSensorInputs.filter((eventType) => !byEventType[eventType])
  const fixtureId = buildFixtureId(liquidationEvent, center)

  return {
    id: fixtureId,
    center: center.toISOString(),
    provider: liquidationEvent.provider,
    symbol: options.symbol,
    liquidation: summarizeLiquidation(liquidationEvent, direction),
    window: {
      start: start.toISOString(),
      end: end.toISOString(),
      beforeMinutes: options.beforeMinutes,
      afterMinutes: options.afterMinutes,
    },
    byEventType,
    byProvider,
    readiness: {
      phaseCInputsReady: missingPhaseCInputs.length === 0,
      missingPhaseCInputs,
      fullSensorReady: missingFullSensorInputs.length === 0,
      missingFullSensorInputs,
    },
    priority: rankCandidate(direction, missingPhaseCInputs, missingFullSensorInputs),
    fixtureDraft: {
      id: fixtureId,
      description: buildFixtureDescription(direction, liquidationEvent),
      provider: 'all',
      symbol: options.symbol,
      eventType: 'all',
      start: start.toISOString(),
      end: end.toISOString(),
      limit: 200,
      expected: {
        minimumPhaseCReady: missingPhaseCInputs.length === 0,
        fullSensorReady: missingFullSensorInputs.length === 0,
        requiredEventTypes: fullSensorInputs.filter((eventType) => Boolean(byEventType[eventType])),
      },
    },
  }
}

function summarizeLiquidation(event, direction) {
  const details = extractLiquidationDetails(event)

  return {
    direction,
    details: details.length,
    buyRawSize: sumDetails(details, (detail) => (detail.side === 'buy' ? detail.rawSize : 0)),
    sellRawSize: sumDetails(details, (detail) => (detail.side === 'sell' ? detail.rawSize : 0)),
    instruments: Array.from(new Set(details.map((detail) => detail.instrument).filter(Boolean))),
    samples: details.slice(0, 5),
  }
}

function classifyLiquidationDirection(event) {
  const details = extractLiquidationDetails(event)
  const shortDetails = details.filter((detail) => detail.posSide === 'short' || detail.side === 'buy')
  const longDetails = details.filter((detail) => detail.posSide === 'long' || detail.side === 'sell')
  const buyRawSize = sumDetails(details, (detail) => (detail.side === 'buy' ? detail.rawSize : 0))
  const sellRawSize = sumDetails(details, (detail) => (detail.side === 'sell' ? detail.rawSize : 0))

  if (buyRawSize > sellRawSize && shortDetails.length >= longDetails.length) {
    return 'short'
  }
  if (sellRawSize > buyRawSize && longDetails.length >= shortDetails.length) {
    return 'long'
  }
  if (shortDetails.length > 0 && longDetails.length === 0) {
    return 'short'
  }
  if (longDetails.length > 0 && shortDetails.length === 0) {
    return 'long'
  }
  return details.length > 0 ? 'mixed_or_unknown' : 'none'
}

function extractLiquidationDetails(event) {
  const details = []

  if (event.provider === 'binance' && event.payload?.o) {
    const order = event.payload.o
    details.push({
      timestamp: parseProviderTimestamp(order.T || event.payload.E) || event.eventTime,
      instrument: order.s,
      side: normalizeBinanceLiquidationSide(order.S),
      posSide: normalizeBinancePositionSide(order.S),
      rawSize: toNumber(order.q),
      bankruptcyPrice: toNumber(order.ap || order.p),
    })
  }

  if (event.provider === 'bybit') {
    for (const item of event.payload?.data || []) {
      details.push({
        timestamp: parseProviderTimestamp(item.T) || event.eventTime,
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
      details.push({
        timestamp: parseProviderTimestamp(detail.ts) || event.eventTime,
        instrument: item.instId,
        side: detail.side,
        posSide: detail.posSide,
        rawSize: toNumber(detail.sz),
        bankruptcyPrice: toNumber(detail.bkPx),
      })
    }
  }

  return details
}

function rankCandidate(direction, missingPhaseCInputs, missingFullSensorInputs) {
  if (direction === 'long' && missingFullSensorInputs.length === 0) {
    return 'p0_long_liquidation_full_sensor'
  }
  if (direction === 'long' && missingPhaseCInputs.length === 0) {
    return 'p1_long_liquidation_phase_c_ready'
  }
  if (direction === 'short' && missingPhaseCInputs.length === 0) {
    return 'control_short_squeeze'
  }
  return 'needs_more_context'
}

function buildFixtureId(event, center) {
  const provider = event.provider || 'unknown'
  const timestamp = center.toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', 'T')
  return `${provider}-btc-liquidation-${timestamp}Z`
}

function buildFixtureDescription(direction, event) {
  return `${event.provider || 'Unknown'} BTC ${direction} liquidation candidate window for Phase C review.`
}

function buildTotals(totals, candidates) {
  return {
    ...totals,
    candidates: candidates.length,
    longLiquidationCandidates: candidates.filter((candidate) => candidate.liquidation.direction === 'long').length,
    shortLiquidationCandidates: candidates.filter((candidate) => candidate.liquidation.direction === 'short').length,
    mixedOrUnknownLiquidationCandidates: candidates.filter((candidate) => candidate.liquidation.direction === 'mixed_or_unknown').length,
    phaseCReadyCandidates: candidates.filter((candidate) => candidate.readiness.phaseCInputsReady).length,
    fullSensorReadyCandidates: candidates.filter((candidate) => candidate.readiness.fullSensorReady).length,
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

function parseProviderTimestamp(value) {
  if (!value) {
    return ''
  }
  const parsed = new Date(Number(value))
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString()
}

function normalizeBinanceLiquidationSide(side) {
  if (side === 'BUY') {
    return 'buy'
  }
  if (side === 'SELL') {
    return 'sell'
  }
  return ''
}

function normalizeBinancePositionSide(side) {
  if (side === 'BUY') {
    return 'short'
  }
  if (side === 'SELL') {
    return 'long'
  }
  return ''
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

function compareEvents(left, right) {
  return left.eventTime.localeCompare(right.eventTime)
}

function countBy(items, getKey) {
  return items.reduce((counts, item) => {
    const key = getKey(item)
    counts[key] = (counts[key] || 0) + 1
    return counts
  }, {})
}

function sumDetails(details, getValue) {
  return details.reduce((sum, detail) => {
    const value = getValue(detail)
    return sum + (Number.isFinite(value) ? value : 0)
  }, 0)
}

function toNumber(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function printSummary(report, reportPath) {
  console.log(`Phase C candidate scan report written to ${reportPath}`)
  console.log(`BTC events: ${report.totals.btcEvents}`)
  console.log(`BTC liquidation events: ${report.totals.btcLiquidationEvents}`)
  console.log(`Candidates: ${report.totals.candidates}`)
  console.log(`Long liquidation candidates: ${report.totals.longLiquidationCandidates}`)
  console.log(`Short liquidation candidates: ${report.totals.shortLiquidationCandidates}`)
  console.log(`Full sensor ready candidates: ${report.totals.fullSensorReadyCandidates}`)
}

function printHelp() {
  console.log(`Usage: npm run crypto:phase-c:candidates -- [options]

Options:
  --data-dir=<path>    Raw JSONL data directory. Default: crypto-workspace/data/raw.
  --report=<path>      Output candidate scan report path.
  --symbol=<text>      Symbol text filter. Default: BTC.
  --provider=<name>    Provider filter. Default: all.
  --before-min=<num>   Minutes before each liquidation event. Default: 5.
  --after-min=<num>    Minutes after each liquidation event. Default: 5.
`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
