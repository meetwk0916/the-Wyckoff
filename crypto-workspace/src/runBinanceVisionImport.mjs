import { createReadStream } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { buildFreeHistoricalPlans } from './providers/freeHistoricalSources.mjs'

const execFileAsync = promisify(execFile)
const workspaceDir = dirname(dirname(fileURLToPath(import.meta.url)))
const defaultConfigPath = resolve(workspaceDir, 'config/markets.json')
const defaultDataDir = resolve(workspaceDir, 'data/free-sources/binance_vision')
const defaultRawDataDir = resolve(workspaceDir, 'data/raw')
const defaultReportPath = resolve(workspaceDir, 'reports/binance-vision-import-last.json')
const supportedResources = [
  'spot_agg_trades_daily',
  'spot_klines_daily',
  'um_futures_agg_trades_daily',
  'um_futures_klines_daily',
]

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const market = await readMarket(options)
  const plan = buildFreeHistoricalPlans({
    symbol: options.symbol,
    date: options.date,
    interval: options.interval,
  }).find((item) => item.provider === 'binance_vision')
  const resources = plan.resources.filter((resource) => shouldImportResource(resource, options))

  if (resources.length === 0) {
    throw new Error(`No supported Binance Vision resource matched --resource=${options.resource}`)
  }

  await mkdir(options.dataDir, { recursive: true })
  await mkdir(options.rawDataDir, { recursive: true })
  await mkdir(dirname(options.reportPath), { recursive: true })

  const imports = []
  for (const resource of resources) {
    imports.push(await importResource(resource, market, options))
  }

  const report = {
    reportType: 'crypto_binance_vision_import',
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    mode: options.download ? 'download_and_import' : 'dry_run',
    filters: {
      symbol: options.symbol,
      date: options.date,
      interval: options.interval,
      resource: options.resource,
      limitRows: options.limitRows,
    },
    imports,
    notes: [
      'Binance Vision aggTrades are imported as normalized trade events.',
      'Binance Vision 1m klines are imported as normalized kline events for historical price context.',
      'Imported events do not include liquidation evidence.',
      'ZIP and JSONL outputs are written under crypto-workspace/data/ and ignored by git.',
    ],
  }

  await writeFile(options.reportPath, `${JSON.stringify(report, null, 2)}\n`)
  printSummary(report, options.reportPath)
}

function parseArgs(args) {
  const options = {
    configPath: defaultConfigPath,
    dataDir: defaultDataDir,
    rawDataDir: defaultRawDataDir,
    reportPath: defaultReportPath,
    symbol: 'BTCUSDT',
    date: new Date().toISOString().slice(0, 10),
    interval: '1m',
    resource: 'all',
    download: false,
    limitRows: 1000,
  }

  for (const arg of args) {
    if (arg === '--download') {
      options.download = true
    } else if (arg.startsWith('--config=')) {
      options.configPath = resolve(arg.slice('--config='.length))
    } else if (arg.startsWith('--data-dir=')) {
      options.dataDir = resolve(arg.slice('--data-dir='.length))
    } else if (arg.startsWith('--raw-data-dir=')) {
      options.rawDataDir = resolve(arg.slice('--raw-data-dir='.length))
    } else if (arg.startsWith('--report=')) {
      options.reportPath = resolve(arg.slice('--report='.length))
    } else if (arg.startsWith('--symbol=')) {
      options.symbol = arg.slice('--symbol='.length).toUpperCase()
    } else if (arg.startsWith('--date=')) {
      options.date = parseDate(arg.slice('--date='.length))
    } else if (arg.startsWith('--interval=')) {
      options.interval = arg.slice('--interval='.length)
    } else if (arg.startsWith('--resource=')) {
      options.resource = arg.slice('--resource='.length)
    } else if (arg.startsWith('--limit-rows=')) {
      options.limitRows = Number(arg.slice('--limit-rows='.length))
    } else if (arg === '--help' || arg === '-h') {
      printHelp()
      process.exit(0)
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }

  if (!Number.isInteger(options.limitRows) || options.limitRows <= 0) {
    throw new Error('--limit-rows must be a positive integer')
  }

  return options
}

async function readMarket(options) {
  const config = JSON.parse(await readFile(options.configPath, 'utf8'))
  const market = config.markets.find((item) =>
    item.instruments.some((instrument) => instrument.providerSymbols?.binance === options.symbol),
  )

  if (!market) {
    throw new Error(`No market maps Binance symbol ${options.symbol}`)
  }

  return market
}

function shouldImportResource(resource, options) {
  if (!supportedResources.includes(resource.name)) {
    return false
  }
  return options.resource === 'all' || resource.name === options.resource
}

async function importResource(resource, market, options) {
  const outputPaths = buildOutputPaths(resource, options)
  const baseResult = {
    name: resource.name,
    eventType: resource.eventType,
    url: resource.url,
    zipPath: outputPaths.zipPath,
    outputPath: outputPaths.outputPath,
  }

  if (!options.download) {
    return {
      ...baseResult,
      status: 'planned',
      writtenEvents: 0,
    }
  }

  await mkdir(dirname(outputPaths.zipPath), { recursive: true })
  await mkdir(dirname(outputPaths.outputPath), { recursive: true })
  await downloadFile(resource.url, outputPaths.zipPath)
  const importResult = await importZip(outputPaths.zipPath, outputPaths.outputPath, resource, market, options)

  return {
    ...baseResult,
    ...importResult,
  }
}

function buildOutputPaths(resource, options) {
  const zipPath = resolve(options.dataDir, options.date, `${resource.name}-${options.symbol}-${options.date}.zip`)
  const outputPath = resolve(options.rawDataDir, 'binance_vision', options.date, `${resource.name}-${options.symbol}-${options.date}.jsonl`)

  return { zipPath, outputPath }
}

async function downloadFile(url, outputPath) {
  await execFileAsync('curl', ['--fail', '--location', '--silent', '--show-error', '--output', outputPath, url])
}

async function importZip(zipPath, outputPath, resource, market, options) {
  const { stdout } = await execFileAsync('unzip', ['-Z1', zipPath])
  const csvName = stdout
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.endsWith('.csv'))

  if (!csvName) {
    throw new Error(`No CSV file found in ${zipPath}`)
  }

  if (resource.name.includes('klines')) {
    return await importKlinesCsv(zipPath, outputPath, csvName, resource, market, options)
  }

  return await importAggTradesCsv(zipPath, outputPath, csvName, resource, market, options)
}

async function importAggTradesCsv(zipPath, outputPath, csvName, resource, market, options) {
  const unzipProcess = execFile('unzip', ['-p', zipPath, csvName])
  const reader = createInterface({
    input: unzipProcess.stdout,
    crlfDelay: Infinity,
  })
  const events = []
  const instrument = inferInstrument(resource, market, options.symbol)
  let rows = 0
  let skippedRows = 0

  for await (const line of reader) {
    if (!line.trim()) {
      continue
    }
    if (line.startsWith('agg_trade_id') || line.startsWith('a,')) {
      skippedRows += 1
      continue
    }
    if (events.length >= options.limitRows) {
      break
    }

    const event = parseAggTradeLine(line, resource, instrument)
    if (!event) {
      skippedRows += 1
      continue
    }

    rows += 1
    events.push(JSON.stringify(event))
  }

  await writeFile(outputPath, `${events.join('\n')}${events.length > 0 ? '\n' : ''}`)

  return {
    status: 'imported',
    csvName,
    readRows: rows,
    skippedRows,
    writtenEvents: events.length,
    truncated: events.length >= options.limitRows,
  }
}

async function importKlinesCsv(zipPath, outputPath, csvName, resource, market, options) {
  const unzipProcess = execFile('unzip', ['-p', zipPath, csvName])
  const reader = createInterface({
    input: unzipProcess.stdout,
    crlfDelay: Infinity,
  })
  const events = []
  const instrument = inferInstrument(resource, market, options.symbol)
  let rows = 0
  let skippedRows = 0

  for await (const line of reader) {
    if (!line.trim()) {
      continue
    }
    if (line.startsWith('open_time') || line.startsWith('t,')) {
      skippedRows += 1
      continue
    }
    if (events.length >= options.limitRows) {
      break
    }

    const event = parseKlineLine(line, resource, instrument)
    if (!event) {
      skippedRows += 1
      continue
    }

    rows += 1
    events.push(JSON.stringify(event))
  }

  await writeFile(outputPath, `${events.join('\n')}${events.length > 0 ? '\n' : ''}`)

  return {
    status: 'imported',
    csvName,
    readRows: rows,
    skippedRows,
    writtenEvents: events.length,
    truncated: events.length >= options.limitRows,
  }
}

function parseAggTradeLine(line, resource, instrument) {
  const columns = line.split(',')
  if (columns.length < 7) {
    return null
  }

  const [aggTradeId, price, quantity, firstTradeId, lastTradeId, timestamp, buyerMaker, bestMatch] = columns
  const eventTime = timestampToIso(timestamp)
  if (!eventTime) {
    return null
  }

  const isBuyerMaker = parseBoolean(buyerMaker)
  const side = isBuyerMaker === null ? 'unknown' : isBuyerMaker ? 'sell' : 'buy'

  return {
    provider: 'binance_vision',
    venue: 'binance',
    instrumentType: instrument.instrumentType,
    symbol: instrument.canonicalSymbol,
    providerSymbol: instrument.providerSymbol,
    eventType: 'trade',
    eventTime,
    receivedAt: new Date().toISOString(),
    sequence: aggTradeId,
    source: 'file',
    payload: {
      data: [
        {
          a: Number(aggTradeId),
          p: price,
          q: quantity,
          f: Number(firstTradeId),
          l: Number(lastTradeId),
          T: Number(timestamp),
          m: isBuyerMaker,
          M: parseBoolean(bestMatch),
          px: price,
          sz: quantity,
          side,
        },
      ],
      sourceFileType: resource.name,
    },
    quality: {
      isDelayed: true,
      isGapFill: true,
      warnings: ['historical_file_import', 'liquidation_not_included'],
    },
  }
}

function parseKlineLine(line, resource, instrument) {
  const columns = line.split(',')
  if (columns.length < 12) {
    return null
  }

  const [
    openTime,
    open,
    high,
    low,
    close,
    volume,
    closeTime,
    quoteVolume,
    trades,
    takerBuyBaseVolume,
    takerBuyQuoteVolume,
  ] = columns
  const eventTime = timestampToIso(openTime)
  const closeAt = timestampToIso(closeTime)
  if (!eventTime) {
    return null
  }

  return {
    provider: 'binance_vision',
    venue: 'binance',
    instrumentType: instrument.instrumentType,
    symbol: instrument.canonicalSymbol,
    providerSymbol: instrument.providerSymbol,
    eventType: 'kline',
    eventTime,
    receivedAt: new Date().toISOString(),
    sequence: openTime,
    source: 'file',
    payload: {
      data: [
        {
          t: Number(openTime),
          T: Number(closeTime),
          i: resource.name.includes('klines_daily') ? '1m' : '',
          o: open,
          h: high,
          l: low,
          c: close,
          v: volume,
          q: quoteVolume,
          n: Number(trades),
          V: takerBuyBaseVolume,
          Q: takerBuyQuoteVolume,
          closeAt,
        },
      ],
      sourceFileType: resource.name,
    },
    quality: {
      isDelayed: true,
      isGapFill: true,
      warnings: ['historical_file_import', 'kline_aggregate', 'liquidation_not_included'],
    },
  }
}

function inferInstrument(resource, market, providerSymbol) {
  const instrumentType = resource.name.startsWith('spot_') ? 'spot' : 'perp'
  const instrument = market.instruments.find((item) => item.instrumentType === instrumentType)

  return {
    instrumentType,
    canonicalSymbol: instrument?.canonicalSymbol || providerSymbol,
    providerSymbol,
  }
}

function timestampToIso(value) {
  const raw = Number(value)
  if (!Number.isFinite(raw)) {
    return ''
  }

  const milliseconds = raw > 9999999999999 ? Math.floor(raw / 1000) : raw
  const parsed = new Date(milliseconds)
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString()
}

function parseBoolean(value) {
  const normalized = String(value || '').trim().toLowerCase()
  if (normalized === 'true') {
    return true
  }
  if (normalized === 'false') {
    return false
  }
  return null
}

function parseDate(value) {
  const parsed = new Date(`${value}T00:00:00Z`)
  if (Number.isNaN(parsed.getTime())) {
    throw new Error('--date must be YYYY-MM-DD')
  }
  return value
}

function printSummary(report, reportPath) {
  console.log(`Binance Vision import report written to ${reportPath}`)
  console.log(`Mode: ${report.mode}`)
  for (const item of report.imports) {
    console.log(`${item.name}: ${item.status}, writtenEvents=${item.writtenEvents}`)
  }
}

function printHelp() {
  console.log(`Usage: npm run crypto:history:binance-vision -- [options]

Options:
  --download            Download and import the ZIP file. Omit for dry-run.
  --symbol=<symbol>     Binance symbol. Default: BTCUSDT.
  --date=<YYYY-MM-DD>   Date to import. Default: today.
  --resource=<name>     all, spot_agg_trades_daily, spot_klines_daily, um_futures_agg_trades_daily, or um_futures_klines_daily. Default: all.
  --limit-rows=<num>    Maximum rows to import per resource. Default: 1000.
  --data-dir=<path>     ZIP download directory.
  --raw-data-dir=<path> Normalized JSONL output root.
  --report=<path>       Output report path.
`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
