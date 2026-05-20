import { createReadStream } from 'node:fs'
import { mkdir, readdir, stat, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import {
  classifyLiquidationDirection,
  extractLiquidationDetails,
  sumLiquidationDetails,
} from './utils/liquidations.mjs'

const workspaceDir = dirname(dirname(fileURLToPath(import.meta.url)))
const defaultDataDir = resolve(workspaceDir, 'data/raw')
const defaultReportPath = resolve(workspaceDir, 'reports/phase-c-candidates-last.json')
const fullSensorInputs = ['trade', 'book_delta', 'open_interest', 'funding_rate', 'liquidation']
const phaseCInputs = ['book_delta', 'liquidation']

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const files = await listJsonlFiles(options.dataDir, options)
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
  const liquidationClusters = options.cluster
    ? buildLiquidationClusters(liquidationEvents, options)
    : liquidationEvents.map((event) => buildSingleEventCluster(event, options))
  const candidates = liquidationClusters.map((cluster) => buildCandidate(cluster, events, options))
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
      since: options.since,
      until: options.until,
      lookbackHours: options.lookbackHours,
      cluster: options.cluster,
    },
    totals: buildTotals(totals, liquidationClusters, candidates),
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
    since: '',
    until: '',
    sinceMs: null,
    untilMs: null,
    scanStartMs: null,
    scanEndMs: null,
    lookbackHours: null,
    cluster: true,
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
    } else if (arg.startsWith('--since=')) {
      options.since = arg.slice('--since='.length)
    } else if (arg.startsWith('--until=')) {
      options.until = arg.slice('--until='.length)
    } else if (arg.startsWith('--lookback-hours=')) {
      options.lookbackHours = Number(arg.slice('--lookback-hours='.length))
    } else if (arg === '--no-cluster') {
      options.cluster = false
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
  if (options.lookbackHours !== null && (!Number.isFinite(options.lookbackHours) || options.lookbackHours <= 0)) {
    throw new Error('--lookback-hours must be a positive number')
  }

  if (options.lookbackHours !== null) {
    const sinceMs = Date.now() - options.lookbackHours * 60 * 60 * 1000
    options.sinceMs = sinceMs
    options.since = new Date(sinceMs).toISOString()
  }
  if (options.since) {
    options.sinceMs = parseDateMs(options.since, '--since')
  }
  if (options.until) {
    options.untilMs = parseDateMs(options.until, '--until')
  }
  if (options.sinceMs !== null && options.untilMs !== null && options.untilMs < options.sinceMs) {
    throw new Error('--until must be greater than or equal to --since')
  }

  options.scanStartMs = options.sinceMs === null ? null : options.sinceMs - options.beforeMinutes * 60 * 1000
  options.scanEndMs = options.untilMs === null ? null : options.untilMs + options.afterMinutes * 60 * 1000

  return options
}

function parseDateMs(value, optionName) {
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) {
    throw new Error(`${optionName} must be a valid date or timestamp`)
  }
  return parsed
}

async function listJsonlFiles(rootDir, options) {
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
        if (!shouldWalkDirectory(entryPath, options)) {
          continue
        }
        await walk(entryPath)
      } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        files.push(entryPath)
      }
    }
  }

  await walk(rootDir)
  return files.sort()
}

function shouldWalkDirectory(dirPath, options) {
  if (options.scanStartMs === null && options.scanEndMs === null) {
    return true
  }

  const dateText = extractDateText(dirPath)
  if (!dateText) {
    return true
  }

  const dayStartMs = Date.parse(`${dateText}T00:00:00.000Z`)
  const dayEndMs = Date.parse(`${dateText}T23:59:59.999Z`)
  if (!Number.isFinite(dayStartMs) || !Number.isFinite(dayEndMs)) {
    return true
  }

  if (options.scanStartMs !== null && dayEndMs < options.scanStartMs) {
    return false
  }
  if (options.scanEndMs !== null && dayStartMs > options.scanEndMs) {
    return false
  }
  return true
}

function extractDateText(pathText) {
  const match = pathText.match(/(?:^|[/\\])(\d{4}-\d{2}-\d{2})(?:[/\\]|$)/)
  return match?.[1] || ''
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
    if (!isWithinScanRange(eventTime, options)) {
      continue
    }

    totals.btcEvents += 1
    if (event.eventType === 'liquidation') {
      totals.btcLiquidationEvents += 1
    }

    events.push(buildScannedEvent(event, eventTime))
  }
}

function buildScannedEvent(event, eventTime) {
  const scannedEvent = {
    provider: event.provider,
    venue: event.venue,
    instrumentType: event.instrumentType,
    symbol: event.symbol,
    providerSymbol: event.providerSymbol,
    eventType: event.eventType,
    eventTime: eventTime.toISOString(),
    receivedAt: event.receivedAt || '',
  }

  if (event.eventType === 'liquidation') {
    scannedEvent.payload = event.payload
  }

  return scannedEvent
}

function buildLiquidationClusters(liquidationEvents, options) {
  const clusters = []

  for (const event of liquidationEvents.filter((item) => isCandidateAnchor(item, options))) {
    const eventTime = new Date(event.eventTime)
    const direction = classifyLiquidationDirection(event)
    const start = new Date(eventTime.getTime() - options.beforeMinutes * 60 * 1000)
    const end = new Date(eventTime.getTime() + options.afterMinutes * 60 * 1000)
    const lastCluster = clusters.at(-1)

    if (
      lastCluster &&
      lastCluster.provider === event.provider &&
      lastCluster.direction === direction &&
      start <= lastCluster.end
    ) {
      lastCluster.events.push(event)
      if (end > lastCluster.end) {
        lastCluster.end = end
      }
      if (eventTime < lastCluster.firstEventAt) {
        lastCluster.firstEventAt = eventTime
      }
      if (eventTime > lastCluster.lastEventAt) {
        lastCluster.lastEventAt = eventTime
      }
      continue
    }

    clusters.push({
      provider: event.provider,
      direction,
      events: [event],
      firstEventAt: eventTime,
      lastEventAt: eventTime,
      start,
      end,
    })
  }

  return clusters.map((cluster) => ({
    ...cluster,
    anchor: pickClusterAnchor(cluster.events),
    center: midpointDate(cluster.firstEventAt, cluster.lastEventAt),
  }))
}

function isWithinScanRange(eventTime, options) {
  const eventMs = eventTime.getTime()
  if (options.scanStartMs !== null && eventMs < options.scanStartMs) {
    return false
  }
  if (options.scanEndMs !== null && eventMs > options.scanEndMs) {
    return false
  }
  return true
}

function isCandidateAnchor(event, options) {
  const eventMs = Date.parse(event.eventTime)
  if (!Number.isFinite(eventMs)) {
    return false
  }
  if (options.sinceMs !== null && eventMs < options.sinceMs) {
    return false
  }
  if (options.untilMs !== null && eventMs > options.untilMs) {
    return false
  }
  return true
}

function buildSingleEventCluster(event, options) {
  const eventTime = new Date(event.eventTime)
  return {
    provider: event.provider,
    direction: classifyLiquidationDirection(event),
    events: [event],
    firstEventAt: eventTime,
    lastEventAt: eventTime,
    start: new Date(eventTime.getTime() - options.beforeMinutes * 60 * 1000),
    end: new Date(eventTime.getTime() + options.afterMinutes * 60 * 1000),
    anchor: event,
    center: eventTime,
  }
}

function pickClusterAnchor(events) {
  return [...events].sort((left, right) => liquidationMagnitude(right) - liquidationMagnitude(left))[0]
}

function liquidationMagnitude(event) {
  const details = extractLiquidationDetails(event)
  return sumLiquidationDetails(details, (detail) => detail.rawSize || 0)
}

function midpointDate(start, end) {
  return new Date(start.getTime() + (end.getTime() - start.getTime()) / 2)
}

function buildCandidate(cluster, events, options) {
  const center = cluster.center
  const start = cluster.start
  const end = cluster.end
  const windowEvents = events.filter((event) => {
    const eventTime = new Date(event.eventTime)
    return eventTime >= start && eventTime <= end
  })
  const byEventType = countBy(windowEvents, (event) => event.eventType || 'unknown')
  const byProvider = countBy(windowEvents, (event) => event.provider || 'unknown')
  const direction = cluster.direction
  const missingPhaseCInputs = phaseCInputs.filter((eventType) => !byEventType[eventType])
  const missingFullSensorInputs = fullSensorInputs.filter((eventType) => !byEventType[eventType])
  const fixtureId = buildFixtureId(cluster, center)

  return {
    id: fixtureId,
    center: center.toISOString(),
    provider: cluster.provider,
    symbol: options.symbol,
    liquidation: summarizeLiquidation(cluster, direction),
    cluster: {
      events: cluster.events.length,
      firstEventAt: cluster.firstEventAt.toISOString(),
      lastEventAt: cluster.lastEventAt.toISOString(),
      anchorEventAt: cluster.anchor.eventTime,
    },
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
      description: buildFixtureDescription(direction, cluster),
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

function summarizeLiquidation(cluster, direction) {
  const details = cluster.events.flatMap((event) => extractLiquidationDetails(event))

  return {
    direction,
    clusterEvents: cluster.events.length,
    details: details.length,
    buyRawSize: sumLiquidationDetails(details, (detail) => (detail.side === 'buy' ? detail.rawSize : 0)),
    sellRawSize: sumLiquidationDetails(details, (detail) => (detail.side === 'sell' ? detail.rawSize : 0)),
    instruments: Array.from(new Set(details.map((detail) => detail.instrument).filter(Boolean))),
    samples: details.slice(0, 5),
  }
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

function buildFixtureId(cluster, center) {
  const provider = cluster.provider || 'unknown'
  const timestamp = center.toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', 'T')
  return `${provider}-btc-liquidation-cluster-${timestamp}Z`
}

function buildFixtureDescription(direction, cluster) {
  return `${cluster.provider || 'Unknown'} BTC ${direction} liquidation cluster with ${
    cluster.events.length
  } event(s) for Phase C review.`
}

function buildTotals(totals, liquidationClusters, candidates) {
  return {
    ...totals,
    liquidationClusters: liquidationClusters.length,
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

function printSummary(report, reportPath) {
  console.log(`Phase C candidate scan report written to ${reportPath}`)
  console.log(`BTC events: ${report.totals.btcEvents}`)
  console.log(`BTC liquidation events: ${report.totals.btcLiquidationEvents}`)
  console.log(`Liquidation clusters: ${report.totals.liquidationClusters}`)
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
  --since=<timestamp>  Only emit candidates anchored at or after this timestamp.
  --until=<timestamp>  Only emit candidates anchored at or before this timestamp.
  --lookback-hours=<n> Shortcut for --since=<now - n hours>.
  --no-cluster         Emit one candidate per liquidation event instead of default overlapping-window clusters.
`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
