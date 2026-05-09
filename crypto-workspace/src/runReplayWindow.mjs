import { createReadStream } from 'node:fs'
import { mkdir, readdir, stat, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'

const workspaceDir = dirname(dirname(fileURLToPath(import.meta.url)))
const defaultDataDir = resolve(workspaceDir, 'data/raw')
const defaultReportPath = resolve(workspaceDir, 'reports/replay-window-last.json')
const DEFAULT_LIMIT = 200

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const files = await listJsonlFiles(options.dataDir)
  const replay = {
    reportType: 'crypto_replay_window',
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    dataDir: options.dataDir,
    filters: {
      start: options.start ? options.start.toISOString() : '',
      end: options.end ? options.end.toISOString() : '',
      eventType: options.eventType,
      symbol: options.symbol,
      provider: options.provider,
      limit: options.limit,
    },
    totals: {
      filesScanned: files.length,
      lines: 0,
      parsedEvents: 0,
      matchedEvents: 0,
      parseErrors: 0,
      emittedEvents: 0,
    },
    byEventType: {},
    byProvider: {},
    byInstrumentType: {},
    latency: {
      samples: 0,
      minMs: null,
      maxMs: null,
      averageMs: null,
    },
    evidence: {},
    firstMatchedAt: '',
    lastMatchedAt: '',
    events: [],
  }

  for (const filePath of files) {
    await scanJsonlFile(filePath, options, replay)
  }

  replay.events.sort(compareEvents)
  if (replay.events.length > options.limit) {
    replay.events = replay.events.slice(0, options.limit)
  }
  replay.totals.emittedEvents = replay.events.length
  replay.evidence = buildEvidenceSummary(replay)

  await mkdir(dirname(options.reportPath), { recursive: true })
  await writeFile(options.reportPath, `${JSON.stringify(replay, null, 2)}\n`)

  printSummary(replay, options.reportPath)
}

function parseArgs(args) {
  const options = {
    dataDir: defaultDataDir,
    reportPath: defaultReportPath,
    start: null,
    end: null,
    eventType: 'all',
    symbol: 'BTC',
    provider: 'all',
    limit: DEFAULT_LIMIT,
  }

  for (const arg of args) {
    if (arg.startsWith('--data-dir=')) {
      options.dataDir = resolve(arg.slice('--data-dir='.length))
    } else if (arg.startsWith('--report=')) {
      options.reportPath = resolve(arg.slice('--report='.length))
    } else if (arg.startsWith('--start=')) {
      options.start = parseDateArg(arg.slice('--start='.length), '--start')
    } else if (arg.startsWith('--end=')) {
      options.end = parseDateArg(arg.slice('--end='.length), '--end')
    } else if (arg.startsWith('--event-type=')) {
      options.eventType = arg.slice('--event-type='.length)
    } else if (arg.startsWith('--symbol=')) {
      options.symbol = arg.slice('--symbol='.length).toUpperCase()
    } else if (arg.startsWith('--provider=')) {
      options.provider = arg.slice('--provider='.length)
    } else if (arg.startsWith('--limit=')) {
      options.limit = Number(arg.slice('--limit='.length))
    } else if (arg === '--help' || arg === '-h') {
      printHelp()
      process.exit(0)
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }

  if (!Number.isInteger(options.limit) || options.limit <= 0) {
    throw new Error('--limit must be a positive integer')
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

async function scanJsonlFile(filePath, options, replay) {
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

    replay.totals.lines += 1

    let event
    try {
      event = JSON.parse(line)
      replay.totals.parsedEvents += 1
    } catch {
      replay.totals.parseErrors += 1
      continue
    }

    if (!matchesFilters(event, options)) {
      continue
    }

    replay.totals.matchedEvents += 1
    incrementCounter(replay.byEventType, event.eventType || 'unknown')
    incrementCounter(replay.byProvider, event.provider || 'unknown')
    incrementCounter(replay.byInstrumentType, event.instrumentType || 'unknown')
    updateLatencySummary(replay, event)
    updateWindowBounds(replay, event)

    if (replay.events.length < options.limit) {
      replay.events.push(summarizeEvent(event, filePath))
    }
  }
}

function matchesFilters(event, options) {
  if (options.provider !== 'all' && event.provider !== options.provider) {
    return false
  }

  if (options.eventType !== 'all' && event.eventType !== options.eventType) {
    return false
  }

  if (options.symbol && !eventMatchesSymbol(event, options.symbol)) {
    return false
  }

  const eventDate = parseEventDate(event)
  if (!eventDate) {
    return false
  }

  if (options.start && eventDate < options.start) {
    return false
  }

  if (options.end && eventDate > options.end) {
    return false
  }

  return true
}

function buildEvidenceSummary(replay) {
  const minimumPhaseCInputs = ['book_delta', 'liquidation']
  const fullSensorInputs = ['trade', 'book_delta', 'open_interest', 'funding_rate', 'liquidation']
  const presentEventTypes = Object.keys(replay.byEventType)
  const missingMinimumInputs = minimumPhaseCInputs.filter((eventType) => !presentEventTypes.includes(eventType))
  const missingFullSensorInputs = fullSensorInputs.filter((eventType) => !presentEventTypes.includes(eventType))
  const warnings = []

  if (replay.totals.matchedEvents === 0) {
    warnings.push('no_matched_events')
  }
  if (replay.byEventType.provider_status) {
    warnings.push('provider_status_events_present')
  }

  return {
    minimumPhaseCInputs,
    minimumPhaseCReady: missingMinimumInputs.length === 0,
    missingMinimumInputs,
    fullSensorInputs,
    fullSensorReady: missingFullSensorInputs.length === 0,
    missingFullSensorInputs,
    warnings,
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

function summarizeEvent(event, filePath) {
  return {
    provider: event.provider,
    venue: event.venue,
    instrumentType: event.instrumentType,
    symbol: event.symbol,
    providerSymbol: event.providerSymbol,
    eventType: event.eventType,
    eventTime: event.eventTime,
    receivedAt: event.receivedAt,
    source: event.source,
    stream: event.stream,
    payloadSymbols: extractPayloadSymbols(event),
    payloadSummary: summarizePayload(event.payload),
    filePath,
  }
}

function summarizePayload(payload) {
  if (!payload || typeof payload !== 'object') {
    return {}
  }

  const firstDataItem = Array.isArray(payload.data) ? payload.data[0] : null

  return {
    status: payload.status,
    message: payload.message,
    symbol: payload.s || payload.o?.s || firstDataItem?.instId,
    side: payload.S || payload.o?.S || firstDataItem?.side,
    orderStatus: payload.X || payload.o?.X,
    price: payload.p || payload.o?.p || firstDataItem?.px,
    quantity: payload.q || payload.o?.q || firstDataItem?.sz,
    dataItems: Array.isArray(payload.data) ? payload.data.length : undefined,
  }
}

function updateWindowBounds(replay, event) {
  const timestamp = event.eventTime || event.receivedAt || ''
  if (!timestamp) {
    return
  }

  if (!replay.firstMatchedAt || timestamp < replay.firstMatchedAt) {
    replay.firstMatchedAt = timestamp
  }

  if (!replay.lastMatchedAt || timestamp > replay.lastMatchedAt) {
    replay.lastMatchedAt = timestamp
  }
}

function updateLatencySummary(replay, event) {
  const eventTime = new Date(event.eventTime)
  const receivedAt = new Date(event.receivedAt)

  if (Number.isNaN(eventTime.getTime()) || Number.isNaN(receivedAt.getTime())) {
    return
  }

  const latencyMs = Math.max(0, receivedAt.getTime() - eventTime.getTime())
  const previousSamples = replay.latency.samples
  const previousAverage = replay.latency.averageMs || 0

  replay.latency.samples += 1
  replay.latency.minMs = replay.latency.minMs === null ? latencyMs : Math.min(replay.latency.minMs, latencyMs)
  replay.latency.maxMs = replay.latency.maxMs === null ? latencyMs : Math.max(replay.latency.maxMs, latencyMs)
  replay.latency.averageMs = Math.round(((previousAverage * previousSamples + latencyMs) / replay.latency.samples) * 100) / 100
}

function incrementCounter(counter, key) {
  counter[key] = (counter[key] || 0) + 1
}

function compareEvents(left, right) {
  const leftTime = left.eventTime || left.receivedAt || ''
  const rightTime = right.eventTime || right.receivedAt || ''
  return leftTime.localeCompare(rightTime)
}

function printSummary(replay, reportPath) {
  console.log(`Replay report written to ${reportPath}`)
  console.log(`Files scanned: ${replay.totals.filesScanned}`)
  console.log(`Parsed events: ${replay.totals.parsedEvents}`)
  console.log(`Matched events: ${replay.totals.matchedEvents}`)
  console.log(`Emitted events: ${replay.totals.emittedEvents}`)
  console.log(`Parse errors: ${replay.totals.parseErrors}`)
}

function printHelp() {
  console.log(`Usage: npm run crypto:replay -- [options]

Options:
  --data-dir=<path>      Raw JSONL data directory. Default: crypto-workspace/data/raw.
  --report=<path>        Output replay report path.
  --start=<iso>          Inclusive eventTime lower bound.
  --end=<iso>            Inclusive eventTime upper bound.
  --event-type=<type>    Event type filter. Default: all.
  --symbol=<text>        Symbol text filter. Default: BTC.
  --provider=<name>      Provider filter. Default: all.
  --limit=<number>       Max summarized events to write. Default: 200.
`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
