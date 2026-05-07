import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildWsProviderPlans, runWsProviderPlan } from './providers/wsProbeProviders.mjs'

const workspaceDir = dirname(dirname(fileURLToPath(import.meta.url)))
const defaultConfigPath = resolve(workspaceDir, 'config/markets.json')
const defaultReportPath = resolve(workspaceDir, 'reports/ws-provider-probe-last.json')

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const config = JSON.parse(await readFile(options.configPath, 'utf8'))
  const market = config.markets.find((item) => item.id === options.marketId)

  if (!market) {
    throw new Error(`Unknown market id: ${options.marketId}`)
  }

  const providerPlans = buildWsProviderPlans(market)
  const providers = options.provider === 'all' ? Object.keys(providerPlans) : [options.provider]
  const unknownProvider = providers.find((provider) => !providerPlans[provider])

  if (unknownProvider) {
    throw new Error(`Unknown provider: ${unknownProvider}`)
  }

  const providerResults = []
  for (const provider of providers) {
    providerResults.push(await runWsProviderPlan(providerPlans[provider], { live: options.live }))
  }

  const report = {
    reportType: 'crypto_ws_provider_probe',
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    mode: options.live ? 'live' : 'dry_run',
    marketId: market.id,
    requiredEventTypes: ['book_delta', 'liquidation'],
    providers: providerResults,
    decisionNotes: buildDecisionNotes(providerResults),
  }

  await mkdir(dirname(options.reportPath), { recursive: true })
  await writeFile(options.reportPath, `${JSON.stringify(report, null, 2)}\n`)
  console.log(`Crypto WebSocket provider probe report written to ${options.reportPath}`)
}

function parseArgs(args) {
  const options = {
    live: false,
    provider: 'all',
    marketId: 'btc-usdt',
    configPath: defaultConfigPath,
    reportPath: defaultReportPath,
  }

  for (const arg of args) {
    if (arg === '--live') {
      options.live = true
    } else if (arg.startsWith('--provider=')) {
      options.provider = arg.slice('--provider='.length)
    } else if (arg.startsWith('--market=')) {
      options.marketId = arg.slice('--market='.length)
    } else if (arg.startsWith('--config=')) {
      options.configPath = resolve(arg.slice('--config='.length))
    } else if (arg.startsWith('--report=')) {
      options.reportPath = resolve(arg.slice('--report='.length))
    } else if (arg === '--help' || arg === '-h') {
      printHelp()
      process.exit(0)
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }

  return options
}

function buildDecisionNotes(providerResults) {
  const notes = []

  for (const result of providerResults) {
    if (result.missingPhase0EventTypes.length > 0) {
      notes.push(
        `${result.provider} is missing WebSocket Phase 0 event types: ${result.missingPhase0EventTypes.join(', ')}`,
      )
    }

    const quietLiquidationChannels = result.endpoints.filter(
      (endpoint) => endpoint.eventType === 'liquidation' && endpoint.status === 'connected_no_sample',
    )

    if (quietLiquidationChannels.length > 0) {
      notes.push(`${result.provider} liquidation channel connected but emitted no sample during the probe window.`)
    }

    if (result.mode === 'dry_run') {
      notes.push(`${result.provider} was not contacted; rerun with --live to validate WebSocket reachability.`)
    }
  }

  if (notes.length === 0) {
    notes.push('All WebSocket probes covered the planned Phase 0 event types.')
  }

  return notes
}

function printHelp() {
  console.log(`Usage: npm run crypto:ws-probe -- [options]

Options:
  --live                 Connect to public WebSocket endpoints. Default is dry-run.
  --provider=<name>      Provider to probe: all, binance, okx. Default: all.
  --market=<id>          Market id from config/markets.json. Default: btc-usdt.
  --config=<path>        Market config path.
  --report=<path>        Output report path.
`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
