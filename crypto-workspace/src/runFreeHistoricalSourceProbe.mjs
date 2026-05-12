import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildFreeHistoricalPlans, probeFreeHistoricalPlans } from './providers/freeHistoricalSources.mjs'

const workspaceDir = dirname(dirname(fileURLToPath(import.meta.url)))
const defaultReportPath = resolve(workspaceDir, 'reports/free-historical-sources-last.json')

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const plans = buildFreeHistoricalPlans({
    symbol: options.symbol,
    date: options.date,
    interval: options.interval,
  })
  const providers =
    options.provider === 'all' ? plans : plans.filter((plan) => plan.provider === options.provider)

  if (providers.length === 0) {
    throw new Error(`No free historical source matched --provider=${options.provider}`)
  }

  const results = await probeFreeHistoricalPlans(providers, { live: options.live })
  const report = {
    reportType: 'crypto_free_historical_sources',
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    filters: {
      symbol: options.symbol,
      date: options.date,
      interval: options.interval,
      provider: options.provider,
      live: options.live,
    },
    totals: buildTotals(results),
    providers: results,
    nextSteps: [
      'For available Binance Vision ZIP files, use crypto:history:binance-vision to import trade / kline context.',
      'For CoinGlass, set COINGLASS_API_KEY and use crypto:history:coinglass to import aggregate liquidation context.',
      'For OKX Historical Data, manually verify downloadable file names and sample schema first.',
      'For CryptoHFTData, verify account/API-key requirements, license, coverage, and schema before importing.',
    ],
  }

  await mkdir(dirname(options.reportPath), { recursive: true })
  await writeFile(options.reportPath, `${JSON.stringify(report, null, 2)}\n`)
  printSummary(report, options.reportPath)
}

function parseArgs(args) {
  const options = {
    reportPath: defaultReportPath,
    symbol: 'BTCUSDT',
    date: new Date().toISOString().slice(0, 10),
    interval: '1m',
    provider: 'all',
    live: false,
  }

  for (const arg of args) {
    if (arg === '--live') {
      options.live = true
    } else if (arg.startsWith('--report=')) {
      options.reportPath = resolve(arg.slice('--report='.length))
    } else if (arg.startsWith('--symbol=')) {
      options.symbol = arg.slice('--symbol='.length).toUpperCase()
    } else if (arg.startsWith('--date=')) {
      options.date = parseDate(arg.slice('--date='.length))
    } else if (arg.startsWith('--interval=')) {
      options.interval = arg.slice('--interval='.length)
    } else if (arg.startsWith('--provider=')) {
      options.provider = arg.slice('--provider='.length)
    } else if (arg === '--help' || arg === '-h') {
      printHelp()
      process.exit(0)
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }

  return options
}

function parseDate(value) {
  const parsed = new Date(`${value}T00:00:00Z`)
  if (Number.isNaN(parsed.getTime())) {
    throw new Error('--date must be YYYY-MM-DD')
  }
  return value
}

function buildTotals(results) {
  const resources = results.flatMap((result) => result.resources || [])

  return {
    providers: results.length,
    resources: resources.length,
    available: resources.filter((resource) => resource.status === 'available').length,
    planned: resources.filter((resource) => resource.status === 'planned').length,
    manualCheckRequired: resources.filter((resource) => resource.status === 'manual_check_required').length,
    unavailable: resources.filter((resource) => resource.status === 'unavailable').length,
    errors: resources.filter((resource) => resource.status === 'error').length,
  }
}

function printSummary(report, reportPath) {
  console.log(`Free historical source report written to ${reportPath}`)
  console.log(`Providers: ${report.totals.providers}`)
  console.log(`Resources: ${report.totals.resources}`)
  console.log(`Available: ${report.totals.available}`)
  console.log(`Planned: ${report.totals.planned}`)
  console.log(`Manual checks: ${report.totals.manualCheckRequired}`)
  console.log(`Unavailable: ${report.totals.unavailable}`)
  console.log(`Errors: ${report.totals.errors}`)
}

function printHelp() {
  console.log(`Usage: npm run crypto:history:free-sources -- [options]

Options:
  --live                Run HEAD checks for predictable public download URLs.
  --symbol=<symbol>     Symbol to probe. Default: BTCUSDT.
  --date=<YYYY-MM-DD>   Date to probe. Default: today.
  --interval=<value>    Kline interval for Binance Vision URLs. Default: 1m.
  --provider=<name>     One of all, binance_vision, okx_historical_data, coinglass, cryptohftdata. Default: all.
  --report=<path>       Output report path.
`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
