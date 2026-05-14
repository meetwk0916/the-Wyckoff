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
    totals: buildTotals(fileSummaries),
    files: fileSummaries,
  }

  await mkdir(dirname(options.reportPath), { recursive: true })
  await writeFile(options.reportPath, `${JSON.stringify(report, null, 2)}\n`)

  printSummary(report)
}

function parseArgs(args) {
  const options = {
    dataDir: defaultDataDir,
    reportPath: defaultReportPath,
    screenName: DEFAULT_SCREEN_NAME,
  }

  for (const arg of args) {
    if (arg.startsWith('--data-dir=')) {
      options.dataDir = resolve(arg.slice('--data-dir='.length))
    } else if (arg.startsWith('--report=')) {
      options.reportPath = resolve(arg.slice('--report='.length))
    } else if (arg.startsWith('--screen=')) {
      options.screenName = arg.slice('--screen='.length)
    } else if (arg === '--help' || arg === '-h') {
      printHelp()
      process.exit(0)
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }

  return options
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
    firstEventAt: '',
    lastEventAt: '',
    lastEventPath: '',
    firstReceivedAt: '',
    lastReceivedAt: '',
    lastProviderStatusAt: '',
    lastProviderStatusPath: '',
    symbols: {},
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
        if (providerStatusAt >= (summary.lastProviderStatusAt || '')) {
          summary.lastProviderStatusAt = providerStatusAt
          summary.lastProviderStatusPath = filePath
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
`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
