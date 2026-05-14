import { mkdir, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const workspaceDir = dirname(dirname(fileURLToPath(import.meta.url)))
const defaultRawDataDir = resolve(workspaceDir, 'data/raw')
const defaultReportPath = resolve(workspaceDir, 'reports/coinglass-liquidation-import-last.json')
const defaultEndpoint = 'https://open-api-v4.coinglass.com/api/futures/liquidation/history'

async function main() {
  const options = parseArgs(process.argv.slice(2))
  await mkdir(options.rawDataDir, { recursive: true })
  await mkdir(dirname(options.reportPath), { recursive: true })

  const plan = buildPlan(options)
  const result = options.download ? await downloadAndImport(plan, options) : buildDryRunResult(plan)
  const report = {
    reportType: 'crypto_coinglass_liquidation_import',
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    mode: options.download ? 'download_and_import' : 'dry_run',
    filters: {
      symbol: options.symbol,
      exchange: options.exchange,
      interval: options.interval,
      start: options.start.toISOString(),
      end: options.end.toISOString(),
      limitRows: options.limitRows,
    },
    imports: [result],
    notes: [
      'CoinGlass liquidation history is imported as aggregate_liquidation_context.',
      'It can help find historical BTC long / short liquidation windows, but it is not exchange-native raw liquidation evidence.',
      'Phase C candidates still require structure recovery, CVD support, book recovery, and open-interest deleveraging confirmation.',
    ],
  }

  await writeFile(options.reportPath, `${JSON.stringify(report, null, 2)}\n`)
  printSummary(report, options.reportPath)
}

function parseArgs(args) {
  const defaultDate = new Date().toISOString().slice(0, 10)
  const options = {
    rawDataDir: defaultRawDataDir,
    reportPath: defaultReportPath,
    endpoint: defaultEndpoint,
    symbol: 'BTCUSDT',
    exchange: 'Binance',
    interval: '1m',
    start: new Date(`${defaultDate}T00:00:00Z`),
    end: new Date(`${defaultDate}T23:59:59Z`),
    download: false,
    limitRows: 1000,
    apiKeyEnv: 'COINGLASS_API_KEY',
  }

  for (const arg of args) {
    if (arg === '--download') {
      options.download = true
    } else if (arg.startsWith('--raw-data-dir=')) {
      options.rawDataDir = resolve(arg.slice('--raw-data-dir='.length))
    } else if (arg.startsWith('--report=')) {
      options.reportPath = resolve(arg.slice('--report='.length))
    } else if (arg.startsWith('--endpoint=')) {
      options.endpoint = arg.slice('--endpoint='.length)
    } else if (arg.startsWith('--symbol=')) {
      options.symbol = arg.slice('--symbol='.length).toUpperCase()
    } else if (arg.startsWith('--exchange=')) {
      options.exchange = arg.slice('--exchange='.length)
    } else if (arg.startsWith('--interval=')) {
      options.interval = arg.slice('--interval='.length)
    } else if (arg.startsWith('--date=')) {
      const date = parseDate(arg.slice('--date='.length))
      options.start = new Date(`${date}T00:00:00Z`)
      options.end = new Date(`${date}T23:59:59Z`)
    } else if (arg.startsWith('--start=')) {
      options.start = parseDateTime(arg.slice('--start='.length), '--start')
    } else if (arg.startsWith('--end=')) {
      options.end = parseDateTime(arg.slice('--end='.length), '--end')
    } else if (arg.startsWith('--limit-rows=')) {
      options.limitRows = Number(arg.slice('--limit-rows='.length))
    } else if (arg.startsWith('--api-key-env=')) {
      options.apiKeyEnv = arg.slice('--api-key-env='.length)
    } else if (arg === '--help' || arg === '-h') {
      printHelp()
      process.exit(0)
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }

  if (options.start > options.end) {
    throw new Error('--start must be before --end')
  }
  if (!Number.isInteger(options.limitRows) || options.limitRows <= 0) {
    throw new Error('--limit-rows must be a positive integer')
  }

  return options
}

function buildPlan(options) {
  const url = new URL(options.endpoint)
  url.searchParams.set('symbol', options.symbol)
  url.searchParams.set('exchange', options.exchange)
  url.searchParams.set('interval', options.interval)
  url.searchParams.set('startTime', String(options.start.getTime()))
  url.searchParams.set('endTime', String(options.end.getTime()))

  const outputPath = resolve(
    options.rawDataDir,
    'coinglass',
    options.start.toISOString().slice(0, 10),
    `pair-liquidation-${options.exchange}-${options.symbol}-${options.interval}.jsonl`,
  )

  return {
    name: 'coinglass_pair_liquidation_history',
    eventType: 'liquidation',
    coverage: 'aggregate_liquidation_context',
    url: url.toString(),
    outputPath,
  }
}

function buildDryRunResult(plan) {
  return {
    ...plan,
    status: 'planned',
    writtenEvents: 0,
  }
}

async function downloadAndImport(plan, options) {
  const apiKey = process.env[options.apiKeyEnv]
  if (!apiKey) {
    throw new Error(`Set ${options.apiKeyEnv} before using --download`)
  }

  const response = await fetchJson(plan.url, apiKey)
  const rows = extractRows(response).slice(0, options.limitRows)
  const events = rows.map((row) => normalizeLiquidationRow(row, options)).filter(Boolean)

  await mkdir(dirname(plan.outputPath), { recursive: true })
  await writeFile(plan.outputPath, `${events.map((event) => JSON.stringify(event)).join('\n')}${events.length > 0 ? '\n' : ''}`)

  return {
    ...plan,
    status: 'imported',
    readRows: rows.length,
    writtenEvents: events.length,
    truncated: rows.length >= options.limitRows,
  }
}

async function fetchJson(url, apiKey) {
  const { stdout } = await execFileAsync('curl', [
    '--fail',
    '--location',
    '--silent',
    '--show-error',
    '--header',
    `CG-API-KEY: ${apiKey}`,
    url,
  ])

  return JSON.parse(stdout)
}

function extractRows(response) {
  const data = response?.data
  if (Array.isArray(data)) {
    return data
  }
  if (Array.isArray(data?.list)) {
    return data.list
  }
  if (Array.isArray(data?.data)) {
    return data.data
  }
  if (data && typeof data === 'object') {
    return Object.entries(data).map(([key, value]) => ({ timestamp: key, ...(typeof value === 'object' ? value : { value }) }))
  }
  return []
}

function normalizeLiquidationRow(row, options) {
  const timestamp = parseRowTimestamp(row)
  if (!timestamp) {
    return null
  }

  const longUsd = firstNumber(row, [
    'longLiquidationUsd',
    'longLiquidation',
    'long_liquidation',
    'longVolUsd',
    'longVol',
    'long',
  ])
  const shortUsd = firstNumber(row, [
    'shortLiquidationUsd',
    'shortLiquidation',
    'short_liquidation',
    'shortVolUsd',
    'shortVol',
    'short',
  ])
  const details = []

  if (longUsd > 0) {
    details.push({
      timestamp,
      instrument: `${options.exchange}:${options.symbol}`,
      side: 'sell',
      posSide: 'long',
      rawSize: longUsd,
      notionalUsd: longUsd,
      sourceKind: 'aggregate_liquidation_context',
    })
  }
  if (shortUsd > 0) {
    details.push({
      timestamp,
      instrument: `${options.exchange}:${options.symbol}`,
      side: 'buy',
      posSide: 'short',
      rawSize: shortUsd,
      notionalUsd: shortUsd,
      sourceKind: 'aggregate_liquidation_context',
    })
  }

  return {
    provider: 'coinglass',
    venue: options.exchange.toLowerCase(),
    instrumentType: 'aggregate',
    symbol: 'BTC-USDT-PERP',
    providerSymbol: options.symbol,
    eventType: 'liquidation',
    eventTime: timestamp,
    receivedAt: new Date().toISOString(),
    sequence: row.id ?? row.timestamp ?? row.time ?? null,
    source: 'rest',
    payload: {
      data: [
        {
          symbol: options.symbol,
          exchange: options.exchange,
          interval: options.interval,
          details,
          raw: row,
        },
      ],
      sourceKind: 'aggregate_liquidation_context',
    },
    quality: {
      isDelayed: true,
      isGapFill: true,
      warnings: ['aggregate_liquidation_context', 'not_exchange_native_liquidation'],
    },
  }
}

function parseRowTimestamp(row) {
  const value = row.time ?? row.timestamp ?? row.t ?? row.date
  if (value === undefined || value === null) {
    return ''
  }

  if (typeof value === 'string' && Number.isNaN(Number(value))) {
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString()
  }

  const number = Number(value)
  if (!Number.isFinite(number)) {
    return ''
  }

  const milliseconds = number > 9999999999 ? number : number * 1000
  const parsed = new Date(milliseconds)
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString()
}

function firstNumber(row, keys) {
  for (const key of keys) {
    const value = Number(row[key])
    if (Number.isFinite(value)) {
      return value
    }
  }
  return 0
}

function parseDate(value) {
  const parsed = new Date(`${value}T00:00:00Z`)
  if (Number.isNaN(parsed.getTime())) {
    throw new Error('--date must be YYYY-MM-DD')
  }
  return value
}

function parseDateTime(value, name) {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`${name} must be an ISO timestamp`)
  }
  return parsed
}

function printSummary(report, reportPath) {
  console.log(`CoinGlass liquidation import report written to ${reportPath}`)
  console.log(`Mode: ${report.mode}`)
  for (const item of report.imports) {
    console.log(`${item.name}: ${item.status}, writtenEvents=${item.writtenEvents}`)
  }
}

function printHelp() {
  console.log(`Usage: npm run crypto:history:coinglass -- [options]

Options:
  --download            Fetch CoinGlass API and write normalized JSONL. Omit for dry-run.
  --symbol=<symbol>     Pair symbol. Default: BTCUSDT.
  --exchange=<name>     Exchange filter. Default: Binance.
  --interval=<value>    History interval. Default: 1m.
  --date=<YYYY-MM-DD>   Full UTC day to import. Default: today.
  --start=<ISO>         Start timestamp. Overrides --date start.
  --end=<ISO>           End timestamp. Overrides --date end.
  --limit-rows=<num>    Maximum rows to import. Default: 1000.
  --api-key-env=<name>  Environment variable containing the CoinGlass API key. Default: COINGLASS_API_KEY.
  --raw-data-dir=<path> Normalized JSONL output root.
  --report=<path>       Output report path.
`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
