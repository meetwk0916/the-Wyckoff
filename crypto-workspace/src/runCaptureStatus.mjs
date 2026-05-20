import { execFile } from 'node:child_process'
import { readdir, readFile, stat, writeFile, mkdir } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { classifyLiquidationDirection } from './utils/liquidations.mjs'

const execFileAsync = promisify(execFile)
const workspaceDir = dirname(dirname(fileURLToPath(import.meta.url)))
const defaultDataDir = resolve(workspaceDir, 'data/raw')
const defaultReportPath = resolve(workspaceDir, 'reports/capture-status-last.json')
const DEFAULT_SCREEN_NAME = 'wyckoff_liq_capture_24h'
const DEFAULT_STALE_DATA_PAYLOAD_MINUTES = 15
const monitoredSources = [
  {
    key: 'okx_trade',
    label: 'OKX trade',
    provider: 'okx',
    eventTypes: ['trade'],
    screenIncludes: ['okx_trade'],
    noPayloadStatus: 'connected_no_payload',
  },
  {
    key: 'okx_book',
    label: 'OKX book',
    provider: 'okx',
    eventTypes: ['book_delta', 'book_snapshot'],
    screenIncludes: ['okx_book'],
    noPayloadStatus: 'connected_no_payload',
  },
  {
    key: 'okx_liquidation',
    label: 'OKX liquidation',
    provider: 'okx',
    eventTypes: ['liquidation'],
    screenIncludes: ['okx_liq', 'okx_liquidation'],
    noPayloadStatus: 'connected_no_sample',
  },
  {
    key: 'binance_force_order',
    label: 'Binance forceOrder',
    provider: 'binance',
    eventTypes: ['liquidation'],
    streams: ['perp_force_order'],
    screenIncludes: ['binance_liq', 'binance_force'],
    noPayloadStatus: 'connected_no_sample',
  },
  {
    key: 'bybit_liquidation',
    label: 'Bybit liquidation',
    provider: 'bybit',
    eventTypes: ['liquidation'],
    streams: ['linear_all_liquidation'],
    screenIncludes: ['bybit_liq', 'bybit_liquidation'],
    noPayloadStatus: 'connected_no_payload',
  },
  {
    key: 'binance_open_interest',
    label: 'Binance OI',
    provider: 'binance',
    eventTypes: ['open_interest'],
    screenIncludes: ['derivatives_state_snapshot'],
    noPayloadStatus: 'connected_no_payload',
  },
  {
    key: 'binance_funding',
    label: 'Binance Funding',
    provider: 'binance',
    eventTypes: ['funding_rate'],
    screenIncludes: ['derivatives_state_snapshot'],
    noPayloadStatus: 'connected_no_payload',
  },
  {
    key: 'okx_open_interest',
    label: 'OKX OI',
    provider: 'okx',
    eventTypes: ['open_interest'],
    screenIncludes: ['derivatives_state_snapshot'],
    noPayloadStatus: 'connected_no_payload',
  },
  {
    key: 'okx_funding',
    label: 'OKX Funding',
    provider: 'okx',
    eventTypes: ['funding_rate'],
    screenIncludes: ['derivatives_state_snapshot'],
    noPayloadStatus: 'connected_no_payload',
  },
]

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const [screenStatus, files] = await Promise.all([readScreenStatus(options.screenName), listJsonlFiles(options.dataDir)])
  const fileSummaries = []

  for (const filePath of files) {
    fileSummaries.push(await summarizeJsonlFile(filePath))
  }

  const report = {
    reportType: 'crypto_capture_status',
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    screen: screenStatus,
    dataDir: options.dataDir,
    staleDataPayloadMinutes: options.staleDataPayloadMinutes,
    totals: buildTotals(fileSummaries),
    files: fileSummaries,
  }
  report.captureHealth = buildCaptureHealth(report)
  report.sourceHealth = buildSourceHealth(report, monitoredSources)

  await mkdir(dirname(options.reportPath), { recursive: true })
  await writeFile(options.reportPath, `${JSON.stringify(report, null, 2)}\n`)

  printSummary(report)
}

function parseArgs(args) {
  const options = {
    dataDir: defaultDataDir,
    reportPath: defaultReportPath,
    screenName: DEFAULT_SCREEN_NAME,
    staleDataPayloadMinutes: DEFAULT_STALE_DATA_PAYLOAD_MINUTES,
  }

  for (const arg of args) {
    if (arg.startsWith('--data-dir=')) {
      options.dataDir = resolve(arg.slice('--data-dir='.length))
    } else if (arg.startsWith('--report=')) {
      options.reportPath = resolve(arg.slice('--report='.length))
    } else if (arg.startsWith('--screen=')) {
      options.screenName = arg.slice('--screen='.length)
    } else if (arg.startsWith('--stale-data-payload-min=')) {
      options.staleDataPayloadMinutes = parsePositiveNumber(arg.slice('--stale-data-payload-min='.length))
    } else if (arg === '--help' || arg === '-h') {
      printHelp()
      process.exit(0)
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }

  return options
}

function parsePositiveNumber(value) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Expected positive number, got: ${value}`)
  }
  return parsed
}

async function readScreenStatus(screenName) {
  try {
    const { stdout, stderr } = await execFileAsync('screen', ['-ls'])
    const output = `${stdout}${stderr}`
    const sessions = parseScreenSessions(output)
    const matched = sessions.find((session) => session.name === screenName)
    return {
      name: screenName,
      status: matched ? 'running' : 'not_found',
      matchedSession: matched || null,
      sessions,
      output: output.trim(),
    }
  } catch (error) {
    const output = `${error.stdout || ''}${error.stderr || ''}`
    const sessions = parseScreenSessions(output)
    const matched = sessions.find((session) => session.name === screenName)
    return {
      name: screenName,
      status: matched ? 'running' : 'not_found',
      matchedSession: matched || null,
      sessions,
      output: output.trim(),
    }
  }
}

function parseScreenSessions(output) {
  return output
    .split('\n')
    .map((line) => line.trim())
    .map((line) => {
      const match = line.match(/^(\d+)\.([^\s]+)\s+\(([^)]+)\)/)
      if (!match) {
        return null
      }
      return {
        id: match[1],
        name: match[2],
        state: match[3],
      }
    })
    .filter(Boolean)
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

async function summarizeJsonlFile(filePath) {
  const fileStat = await stat(filePath)
  const summary = {
    path: filePath,
    bytes: fileStat.size,
    lines: 0,
    events: 0,
    btcEvents: 0,
    btcLiquidationEvents: 0,
    btcLongLiquidationEvents: 0,
    btcShortLiquidationEvents: 0,
    btcMixedOrUnknownLiquidationEvents: 0,
    liquidationEvents: 0,
    providerStatusEvents: 0,
    dataPayloadEvents: 0,
    providerStatuses: {},
    lastCaptureHeartbeat: null,
    firstDataPayloadAt: '',
    lastDataPayloadAt: '',
    lastDataPayloadPath: '',
    lastDataPayloadEventType: '',
    firstEventAt: '',
    lastEventAt: '',
    lastEventPath: '',
    firstReceivedAt: '',
    lastReceivedAt: '',
    lastProviderStatusAt: '',
    lastProviderStatusPath: '',
    symbols: {},
    sources: {},
    liquidationDirections: {
      long: 0,
      short: 0,
      mixedOrUnknown: 0,
    },
    parseErrors: 0,
  }

  if (fileStat.size === 0) {
    return summary
  }

  const reader = createInterface({
    input: createReadStream(filePath),
    crlfDelay: Infinity,
  })

  for await (const line of reader) {
    if (!line.trim()) {
      continue
    }

    summary.lines += 1

    try {
      const event = JSON.parse(line)
      summary.events += 1

      if (!summary.firstReceivedAt) {
        summary.firstReceivedAt = event.receivedAt || ''
      }
      summary.lastReceivedAt = event.receivedAt || summary.lastReceivedAt
      if (!summary.firstEventAt) {
        summary.firstEventAt = event.eventTime || ''
      }
      if ((event.eventTime || '') >= (summary.lastEventAt || '')) {
        summary.lastEventAt = event.eventTime || summary.lastEventAt
        summary.lastEventPath = filePath
      }

      if (event.eventType === 'liquidation') {
        summary.liquidationEvents += 1
      }
      if (event.eventType === 'provider_status') {
        summary.providerStatusEvents += 1
        const providerStatusAt = event.receivedAt || event.eventTime || ''
        const providerStatus = event.payload?.status || 'unknown'
        summary.providerStatuses[providerStatus] = (summary.providerStatuses[providerStatus] || 0) + 1
        if (providerStatusAt >= (summary.lastProviderStatusAt || '')) {
          summary.lastProviderStatusAt = providerStatusAt
          summary.lastProviderStatusPath = filePath
        }
        if (providerStatus === 'capture_heartbeat') {
          summary.lastCaptureHeartbeat = parseCaptureHeartbeat(event)
        }
      } else {
        summary.dataPayloadEvents += 1
        const dataPayloadAt = event.receivedAt || event.eventTime || ''
        if (!summary.firstDataPayloadAt) {
          summary.firstDataPayloadAt = dataPayloadAt
        }
        if (dataPayloadAt >= (summary.lastDataPayloadAt || '')) {
          summary.lastDataPayloadAt = dataPayloadAt
          summary.lastDataPayloadPath = filePath
          summary.lastDataPayloadEventType = event.eventType || ''
        }
      }

      const btcMatched = eventMatchesSymbol(event, 'BTC')
      const symbols = extractSymbols(event)
      for (const symbol of symbols) {
        summary.symbols[symbol] = (summary.symbols[symbol] || 0) + 1
      }

      if (btcMatched) {
        summary.btcEvents += 1
      }

      if (btcMatched && event.eventType === 'liquidation') {
        summary.btcLiquidationEvents += 1
        const direction = classifyLiquidationDirection(event)
        incrementLiquidationDirection(summary, direction)
      }

      updateSourceSummaries(summary.sources, event, filePath)
    } catch {
      summary.parseErrors += 1
    }
  }

  return summary
}

function extractSymbols(event) {
  const symbols = new Set()

  addSymbol(symbols, event.symbol)
  addSymbol(symbols, event.providerSymbol)

  for (const symbol of extractPayloadSymbols(event)) {
    addSymbol(symbols, symbol)
  }

  return Array.from(symbols)
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

function buildTotals(fileSummaries) {
  return fileSummaries.reduce(
    (totals, file) => ({
      files: totals.files + 1,
      bytes: totals.bytes + file.bytes,
      events: totals.events + file.events,
      btcEvents: totals.btcEvents + file.btcEvents,
      btcLiquidationEvents: totals.btcLiquidationEvents + file.btcLiquidationEvents,
      btcLongLiquidationEvents: totals.btcLongLiquidationEvents + file.btcLongLiquidationEvents,
      btcShortLiquidationEvents: totals.btcShortLiquidationEvents + file.btcShortLiquidationEvents,
      btcMixedOrUnknownLiquidationEvents:
        totals.btcMixedOrUnknownLiquidationEvents + file.btcMixedOrUnknownLiquidationEvents,
      liquidationEvents: totals.liquidationEvents + file.liquidationEvents,
      providerStatusEvents: totals.providerStatusEvents + file.providerStatusEvents,
      dataPayloadEvents: totals.dataPayloadEvents + file.dataPayloadEvents,
      firstDataPayloadAt: earlierTimestamp(totals.firstDataPayloadAt, file.firstDataPayloadAt),
      ...latestTimestampFields(
        totals.lastDataPayloadAt,
        totals.lastDataPayloadPath,
        file.lastDataPayloadAt,
        file.lastDataPayloadPath,
        'lastDataPayloadAt',
        'lastDataPayloadPath',
      ),
      lastDataPayloadEventType:
        file.lastDataPayloadAt && (!totals.lastDataPayloadAt || file.lastDataPayloadAt > totals.lastDataPayloadAt)
          ? file.lastDataPayloadEventType
          : totals.lastDataPayloadEventType,
      firstEventAt: earlierTimestamp(totals.firstEventAt, file.firstEventAt),
      ...latestTimestampFields(
        totals.lastEventAt,
        totals.lastEventPath,
        file.lastEventAt,
        file.lastEventPath,
        'lastEventAt',
        'lastEventPath',
      ),
      firstReceivedAt: earlierTimestamp(totals.firstReceivedAt, file.firstReceivedAt),
      lastReceivedAt: laterTimestamp(totals.lastReceivedAt, file.lastReceivedAt),
      ...latestTimestampFields(
        totals.lastProviderStatusAt,
        totals.lastProviderStatusPath,
        file.lastProviderStatusAt,
        file.lastProviderStatusPath,
        'lastProviderStatusAt',
        'lastProviderStatusPath',
      ),
      parseErrors: totals.parseErrors + file.parseErrors,
    }),
    {
      files: 0,
      bytes: 0,
      events: 0,
      btcEvents: 0,
      btcLiquidationEvents: 0,
      btcLongLiquidationEvents: 0,
      btcShortLiquidationEvents: 0,
      btcMixedOrUnknownLiquidationEvents: 0,
      liquidationEvents: 0,
      providerStatusEvents: 0,
      dataPayloadEvents: 0,
      firstDataPayloadAt: '',
      lastDataPayloadAt: '',
      lastDataPayloadPath: '',
      lastDataPayloadEventType: '',
      firstEventAt: '',
      lastEventAt: '',
      lastEventPath: '',
      firstReceivedAt: '',
      lastReceivedAt: '',
      lastProviderStatusAt: '',
      lastProviderStatusPath: '',
      parseErrors: 0,
    },
  )
}

function parseCaptureHeartbeat(event) {
  const message = event.payload?.message || ''
  const receivedMessages = parseHeartbeatMetric(message, 'receivedMessages')
  const writtenEvents = parseHeartbeatMetric(message, 'writtenEvents')

  return {
    eventTime: event.eventTime || '',
    receivedAt: event.receivedAt || '',
    receivedMessages,
    writtenEvents,
    message,
  }
}

function parseHeartbeatMetric(message, key) {
  const match = String(message || '').match(new RegExp(`${key}=([0-9]+)`))
  if (!match) {
    return null
  }
  const value = Number(match[1])
  return Number.isFinite(value) ? value : null
}

function buildCaptureHealth(report) {
  const latestStatusFile = report.files.find((file) => file.path === report.totals.lastProviderStatusPath) || null
  const heartbeat = latestStatusFile?.lastCaptureHeartbeat || null
  const lastDataPayloadAgeMinutes = minutesSince(report.totals.lastDataPayloadAt, report.generatedAt)
  const reasons = []

  if (report.screen.status !== 'running') {
    reasons.push('capture_screen_not_running')
  }
  if (!report.totals.lastProviderStatusAt) {
    reasons.push('missing_provider_heartbeat')
  }
  if (latestStatusFile && latestStatusFile.dataPayloadEvents === 0) {
    reasons.push('latest_status_file_has_no_data_payload')
  }
  if (!report.totals.lastDataPayloadAt) {
    reasons.push('missing_data_payload')
  } else if (lastDataPayloadAgeMinutes > report.staleDataPayloadMinutes) {
    reasons.push('data_payload_stale')
  }
  if (heartbeat?.receivedMessages !== null && heartbeat?.receivedMessages <= 1) {
    reasons.push('heartbeat_received_messages_not_increasing')
  }
  if (heartbeat?.writtenEvents !== null && heartbeat?.writtenEvents === 0) {
    reasons.push('heartbeat_written_events_zero')
  }

  let status = 'unknown'
  if (report.screen.status !== 'running') {
    status = 'not_running'
  } else if (!report.totals.lastProviderStatusAt) {
    status = 'no_heartbeat'
  } else if (!report.totals.lastDataPayloadAt) {
    status = 'connected_no_payload'
  } else if (lastDataPayloadAgeMinutes > report.staleDataPayloadMinutes) {
    status = 'market_payload_stale'
  } else if ((report.totals.btcLiquidationEvents || 0) === 0) {
    status = 'connected_no_btc_liquidation'
  } else {
    status = 'data_available'
  }

  return {
    status,
    latestStatusFile: latestStatusFile
      ? {
          path: latestStatusFile.path,
          events: latestStatusFile.events,
          providerStatusEvents: latestStatusFile.providerStatusEvents,
          dataPayloadEvents: latestStatusFile.dataPayloadEvents,
          liquidationEvents: latestStatusFile.liquidationEvents,
          btcLiquidationEvents: latestStatusFile.btcLiquidationEvents,
          lastProviderStatusAt: latestStatusFile.lastProviderStatusAt,
          lastCaptureHeartbeat: heartbeat,
          providerStatuses: latestStatusFile.providerStatuses,
        }
      : null,
    reasons,
    lastDataPayload: {
      at: report.totals.lastDataPayloadAt || '',
      ageMinutes: lastDataPayloadAgeMinutes,
      path: report.totals.lastDataPayloadPath || '',
      eventType: report.totals.lastDataPayloadEventType || '',
      staleAfterMinutes: report.staleDataPayloadMinutes,
    },
  }
}

function updateSourceSummaries(sources, event, filePath) {
  const key = buildSourceKey(event)
  if (!key) {
    return
  }

  const source = (sources[key] ||= {
    key,
    provider: event.provider || 'unknown',
    stream: event.stream || '',
    eventType: event.eventType === 'provider_status' ? inferStatusEventType(event) : event.eventType || '',
    events: 0,
    dataPayloadEvents: 0,
    providerStatusEvents: 0,
    providerStatuses: {},
    firstDataPayloadAt: '',
    lastDataPayloadAt: '',
    lastDataPayloadPath: '',
    lastProviderStatusAt: '',
    lastProviderStatusPath: '',
    lastProviderStatus: '',
    lastErrorAt: '',
    lastError: '',
  })

  source.events += 1

  if (event.eventType === 'provider_status') {
    source.providerStatusEvents += 1
    const status = event.payload?.status || 'unknown'
    const statusAt = event.receivedAt || event.eventTime || ''
    source.providerStatuses[status] = (source.providerStatuses[status] || 0) + 1
    if (statusAt >= (source.lastProviderStatusAt || '')) {
      source.lastProviderStatusAt = statusAt
      source.lastProviderStatusPath = filePath
      source.lastProviderStatus = status
    }
    if (status === 'capture_error' && statusAt >= (source.lastErrorAt || '')) {
      source.lastErrorAt = statusAt
      source.lastError = event.payload?.message || 'capture_error'
    }
    return
  }

  source.dataPayloadEvents += 1
  const dataAt = event.receivedAt || event.eventTime || ''
  if (!source.firstDataPayloadAt) {
    source.firstDataPayloadAt = dataAt
  }
  if (dataAt >= (source.lastDataPayloadAt || '')) {
    source.lastDataPayloadAt = dataAt
    source.lastDataPayloadPath = filePath
  }
}

function buildSourceKey(event) {
  const provider = event.provider || 'unknown'
  const stream = event.stream || ''
  const eventType = event.eventType === 'provider_status' ? inferStatusEventType(event) : event.eventType || ''

  if (stream) {
    return `${provider}:${stream}:${eventType}`
  }
  if (event.payload?.endpoint) {
    return `${provider}:${event.payload.endpoint}:${eventType || 'provider_status'}`
  }
  return `${provider}:${eventType}`
}

function inferStatusEventType(event) {
  const stream = event.stream || ''
  const endpoint = event.payload?.endpoint || ''
  const name = stream || endpoint

  if (name.includes('trade')) {
    return 'trade'
  }
  if (name.includes('book') || name.includes('depth')) {
    return 'book_delta'
  }
  if (name.includes('liq') || name.includes('liquidation') || name.includes('force_order')) {
    return 'liquidation'
  }
  if (name.includes('open_interest')) {
    return 'open_interest'
  }
  if (name.includes('funding')) {
    return 'funding_rate'
  }
  return ''
}

function buildSourceHealth(report, definitions) {
  const generatedAt = report.generatedAt
  const sourceRows = flattenSourceSummaries(report.files || [])

  return definitions.map((definition) => {
    const rows = sourceRows.filter((source) => matchesSourceDefinition(source, definition))
    const screen = findSourceScreen(report.screen?.sessions || [], definition)
    const aggregate = aggregateSourceRows(rows)
    const dataAgeMinutes = minutesSince(aggregate.lastDataPayloadAt, generatedAt)
    const statusAgeMinutes = minutesSince(aggregate.lastProviderStatusAt, generatedAt)
    const status = classifySourceHealth(definition, screen, aggregate, dataAgeMinutes, report.staleDataPayloadMinutes)

    return {
      key: definition.key,
      label: definition.label,
      provider: definition.provider,
      eventTypes: definition.eventTypes,
      streams: definition.streams || [],
      screen,
      status,
      dataPayloadEvents: aggregate.dataPayloadEvents,
      providerStatusEvents: aggregate.providerStatusEvents,
      providerStatuses: aggregate.providerStatuses,
      lastDataPayloadAt: aggregate.lastDataPayloadAt,
      lastDataPayloadAgeMinutes: dataAgeMinutes,
      lastDataPayloadPath: aggregate.lastDataPayloadPath,
      lastProviderStatusAt: aggregate.lastProviderStatusAt,
      lastProviderStatusAgeMinutes: statusAgeMinutes,
      lastProviderStatus: aggregate.lastProviderStatus,
      lastProviderStatusPath: aggregate.lastProviderStatusPath,
      lastErrorAt: aggregate.lastErrorAt,
      lastError: aggregate.lastError,
      staleAfterMinutes: report.staleDataPayloadMinutes,
    }
  })
}

function flattenSourceSummaries(files) {
  return files.flatMap((file) =>
    Object.values(file.sources || {}).map((source) => ({
      ...source,
      filePath: file.path,
    })),
  )
}

function matchesSourceDefinition(source, definition) {
  if (source.provider !== definition.provider) {
    return false
  }
  if (definition.streams?.length > 0) {
    return definition.streams.includes(source.stream)
  }
  return definition.eventTypes.includes(source.eventType)
}

function findSourceScreen(sessions, definition) {
  const matched = sessions.find((session) =>
    definition.screenIncludes.some((needle) => session.name.toLowerCase().includes(needle)),
  )

  return matched
    ? {
        status: 'running',
        session: matched,
      }
    : {
        status: 'not_found',
        session: null,
      }
}

function aggregateSourceRows(rows) {
  return rows.reduce(
    (aggregate, row) => ({
      dataPayloadEvents: aggregate.dataPayloadEvents + row.dataPayloadEvents,
      providerStatusEvents: aggregate.providerStatusEvents + row.providerStatusEvents,
      providerStatuses: mergeCounts(aggregate.providerStatuses, row.providerStatuses),
      firstDataPayloadAt: earlierTimestamp(aggregate.firstDataPayloadAt, row.firstDataPayloadAt),
      ...latestTimestampFields(
        aggregate.lastDataPayloadAt,
        aggregate.lastDataPayloadPath,
        row.lastDataPayloadAt,
        row.lastDataPayloadPath,
        'lastDataPayloadAt',
        'lastDataPayloadPath',
      ),
      ...latestTimestampFields(
        aggregate.lastProviderStatusAt,
        aggregate.lastProviderStatusPath,
        row.lastProviderStatusAt,
        row.lastProviderStatusPath,
        'lastProviderStatusAt',
        'lastProviderStatusPath',
      ),
      lastProviderStatus:
        row.lastProviderStatusAt && (!aggregate.lastProviderStatusAt || row.lastProviderStatusAt > aggregate.lastProviderStatusAt)
          ? row.lastProviderStatus
          : aggregate.lastProviderStatus,
      lastErrorAt: laterTimestamp(aggregate.lastErrorAt, row.lastErrorAt),
      lastError: row.lastErrorAt && (!aggregate.lastErrorAt || row.lastErrorAt > aggregate.lastErrorAt) ? row.lastError : aggregate.lastError,
    }),
    {
      dataPayloadEvents: 0,
      providerStatusEvents: 0,
      providerStatuses: {},
      firstDataPayloadAt: '',
      lastDataPayloadAt: '',
      lastDataPayloadPath: '',
      lastProviderStatusAt: '',
      lastProviderStatusPath: '',
      lastProviderStatus: '',
      lastErrorAt: '',
      lastError: '',
    },
  )
}

function mergeCounts(left, right) {
  const merged = { ...left }
  for (const [key, value] of Object.entries(right || {})) {
    merged[key] = (merged[key] || 0) + value
  }
  return merged
}

function classifySourceHealth(definition, screen, aggregate, dataAgeMinutes, staleAfterMinutes) {
  if (screen.status !== 'running') {
    return 'not_running'
  }
  if (aggregate.lastProviderStatus === 'capture_error' && aggregate.lastErrorAt >= (aggregate.lastDataPayloadAt || '')) {
    return 'error'
  }
  if (!aggregate.lastDataPayloadAt) {
    return aggregate.providerStatusEvents > 0 ? definition.noPayloadStatus : 'no_status'
  }
  if (dataAgeMinutes !== null && dataAgeMinutes > staleAfterMinutes) {
    if (definition.noPayloadStatus === 'connected_no_sample' && aggregate.lastProviderStatusAt) {
      return definition.noPayloadStatus
    }
    return 'stale'
  }
  return 'fresh'
}

function minutesSince(timestamp, nowTimestamp) {
  if (!timestamp) {
    return null
  }
  const timestampMs = new Date(timestamp).getTime()
  const nowMs = new Date(nowTimestamp).getTime()
  if (!Number.isFinite(timestampMs) || !Number.isFinite(nowMs)) {
    return null
  }
  return Math.round(((nowMs - timestampMs) / 60_000) * 10) / 10
}

function incrementLiquidationDirection(summary, direction) {
  if (direction === 'long') {
    summary.btcLongLiquidationEvents += 1
    summary.liquidationDirections.long += 1
  } else if (direction === 'short') {
    summary.btcShortLiquidationEvents += 1
    summary.liquidationDirections.short += 1
  } else {
    summary.btcMixedOrUnknownLiquidationEvents += 1
    summary.liquidationDirections.mixedOrUnknown += 1
  }
}

function earlierTimestamp(left, right) {
  if (!left) {
    return right || ''
  }
  if (!right) {
    return left
  }
  return left <= right ? left : right
}

function laterTimestamp(left, right) {
  if (!left) {
    return right || ''
  }
  if (!right) {
    return left
  }
  return left >= right ? left : right
}

function latestTimestampFields(leftAt, leftPath, rightAt, rightPath, atKey, pathKey) {
  if (!rightAt || (leftAt && leftAt >= rightAt)) {
    return { [atKey]: leftAt, [pathKey]: leftPath }
  }

  return { [atKey]: rightAt, [pathKey]: rightPath }
}

function printSummary(report) {
  console.log(`Capture screen: ${report.screen.status}`)
  console.log(`Files: ${report.totals.files}`)
  console.log(`Bytes: ${report.totals.bytes}`)
  console.log(`Events: ${report.totals.events}`)
  console.log(`BTC events: ${report.totals.btcEvents}`)
  console.log(`BTC liquidation events: ${report.totals.btcLiquidationEvents}`)
  console.log(`BTC long liquidation events: ${report.totals.btcLongLiquidationEvents}`)
  console.log(`BTC short liquidation events: ${report.totals.btcShortLiquidationEvents}`)
  console.log(`BTC mixed/unknown liquidation events: ${report.totals.btcMixedOrUnknownLiquidationEvents}`)
  console.log(`Liquidation events: ${report.totals.liquidationEvents}`)
  console.log(`Provider status events: ${report.totals.providerStatusEvents}`)
  console.log(`Data payload events: ${report.totals.dataPayloadEvents}`)
  console.log(`Capture health: ${report.captureHealth.status}`)
  console.log(`Capture health reasons: ${report.captureHealth.reasons.join(', ') || 'none'}`)
  if (report.sourceHealth?.length > 0) {
    console.log('Source health:')
    for (const source of report.sourceHealth) {
      console.log(
        `- ${source.label}: ${source.status}; lastData=${
          source.lastDataPayloadAgeMinutes === null ? 'n/a' : `${source.lastDataPayloadAgeMinutes}m`
        }; statuses=${source.providerStatusEvents}; data=${source.dataPayloadEvents}`,
      )
    }
  }
  console.log(`Last data payload at: ${report.totals.lastDataPayloadAt || 'n/a'}`)
  console.log(
    `Last data payload age: ${
      report.captureHealth.lastDataPayload.ageMinutes === null
        ? 'n/a'
        : `${report.captureHealth.lastDataPayload.ageMinutes}m`
    }`,
  )
  console.log(`Last data payload type: ${report.totals.lastDataPayloadEventType || 'n/a'}`)
  console.log(`Last data payload file: ${report.totals.lastDataPayloadPath || 'n/a'}`)
  if (report.captureHealth.latestStatusFile?.lastCaptureHeartbeat) {
    const heartbeat = report.captureHealth.latestStatusFile.lastCaptureHeartbeat
    console.log(
      `Latest heartbeat payload: receivedMessages=${heartbeat.receivedMessages ?? 'n/a'}; writtenEvents=${
        heartbeat.writtenEvents ?? 'n/a'
      }`,
    )
  }
  console.log(`First event at: ${report.totals.firstEventAt || 'n/a'}`)
  console.log(`Last event at: ${report.totals.lastEventAt || 'n/a'}`)
  console.log(`Last event file: ${report.totals.lastEventPath || 'n/a'}`)
  console.log(`Last received at: ${report.totals.lastReceivedAt || 'n/a'}`)
  console.log(`Last provider status at: ${report.totals.lastProviderStatusAt || 'n/a'}`)
  console.log(`Last provider status file: ${report.totals.lastProviderStatusPath || 'n/a'}`)
  console.log(`Parse errors: ${report.totals.parseErrors}`)
}

function printHelp() {
  console.log(`Usage: npm run crypto:capture:status -- [options]

Options:
  --data-dir=<path>  Raw JSONL data directory. Default: crypto-workspace/data/raw.
  --report=<path>    Output status report path.
  --screen=<name>    Screen session name. Default: wyckoff_liq_capture_24h.
  --stale-data-payload-min=<minutes>
                     Mark market payload stale after this many minutes. Default: ${DEFAULT_STALE_DATA_PAYLOAD_MINUTES}.
`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
