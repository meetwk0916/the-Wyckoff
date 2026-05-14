import { execFile } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { buildProviderPlans } from './providers/probeProviders.mjs'

const execFileAsync = promisify(execFile)
const workspaceDir = dirname(dirname(fileURLToPath(import.meta.url)))
const defaultConfigPath = resolve(workspaceDir, 'config/markets.json')
const defaultDataDir = resolve(workspaceDir, 'data/raw')
const defaultReportPath = resolve(workspaceDir, 'reports/rest-capture-last.json')
const REQUEST_TIMEOUT_MS = 8000

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const config = JSON.parse(await readFile(options.configPath, 'utf8'))
  const market = config.markets.find((item) => item.id === options.marketId)

  if (!market) {
    throw new Error(`Unknown market id: ${options.marketId}`)
  }

  const providerPlans = buildProviderPlans(market)
  const providers = options.provider === 'all' ? Object.keys(providerPlans) : [options.provider]
  const unknownProvider = providers.find((provider) => !providerPlans[provider])

  if (unknownProvider) {
    throw new Error(`Unknown provider: ${unknownProvider}`)
  }

  await mkdir(options.dataDir, { recursive: true })
  await mkdir(dirname(options.reportPath), { recursive: true })

  const startedAt = new Date()
  const endpointResults = []

  for (const provider of providers) {
    const endpoints = providerPlans[provider].endpoints.filter((endpoint) => shouldCaptureEndpoint(endpoint, options))
    for (const endpoint of endpoints) {
      endpointResults.push(await captureEndpoint(providerPlans[provider], endpoint, options, startedAt))
    }
  }

  const report = {
    reportType: 'crypto_rest_capture',
    schemaVersion: 1,
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    marketId: market.id,
    eventType: options.eventType,
    providers: options.provider,
    endpoints: endpointResults,
  }

  await writeFile(options.reportPath, `${JSON.stringify(report, null, 2)}\n`)
  console.log(`Crypto REST capture report written to ${options.reportPath}`)
}

function parseArgs(args) {
  const options = {
    provider: 'all',
    eventType: 'derivatives_state',
    marketId: 'btc-usdt',
    configPath: defaultConfigPath,
    dataDir: defaultDataDir,
    reportPath: defaultReportPath,
  }

  for (const arg of args) {
    if (arg.startsWith('--provider=')) {
      options.provider = arg.slice('--provider='.length)
    } else if (arg.startsWith('--event-type=')) {
      options.eventType = arg.slice('--event-type='.length)
    } else if (arg.startsWith('--market=')) {
      options.marketId = arg.slice('--market='.length)
    } else if (arg.startsWith('--config=')) {
      options.configPath = resolve(arg.slice('--config='.length))
    } else if (arg.startsWith('--data-dir=')) {
      options.dataDir = resolve(arg.slice('--data-dir='.length))
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

function shouldCaptureEndpoint(endpoint, options) {
  if (options.eventType === 'all') {
    return true
  }

  if (options.eventType === 'derivatives_state') {
    return ['open_interest', 'funding_rate'].includes(endpoint.eventType)
  }

  return endpoint.eventType === options.eventType
}

async function captureEndpoint(providerPlan, endpoint, options, startedAt) {
  const requestedAt = Date.now()
  const outputPath = buildOutputPath(options.dataDir, providerPlan.provider, endpoint, startedAt)
  await mkdir(dirname(outputPath), { recursive: true })

  try {
    const response = hasProxyEnv() ? await curlJson(endpoint.url) : await fetchJson(endpoint.url)
    const receivedAt = new Date()
    const event = buildCaptureEvent(providerPlan, endpoint, response.payload, receivedAt)

    await writeFile(outputPath, `${JSON.stringify(event)}\n`)

    return {
      provider: providerPlan.provider,
      venue: providerPlan.venue,
      name: endpoint.name,
      eventType: endpoint.eventType,
      outputPath,
      httpStatus: response.status,
      latencyMs: Date.now() - requestedAt,
      writtenEvents: 1,
      status: response.ok ? 'captured' : 'http_error',
      error: '',
    }
  } catch (error) {
    const statusEvent = buildStatusEvent(providerPlan, endpoint, error)
    await writeFile(outputPath, `${JSON.stringify(statusEvent)}\n`)

    return {
      provider: providerPlan.provider,
      venue: providerPlan.venue,
      name: endpoint.name,
      eventType: endpoint.eventType,
      outputPath,
      httpStatus: 0,
      latencyMs: Date.now() - requestedAt,
      writtenEvents: 0,
      status: 'error',
      error: error instanceof Error ? error.message : 'unknown REST capture error',
    }
  }
}

function buildCaptureEvent(providerPlan, endpoint, payload, receivedAt) {
  const instrument = inferInstrument(endpoint)
  const eventTime = inferEventTime(payload, receivedAt)

  return {
    provider: providerPlan.provider,
    venue: providerPlan.venue,
    instrumentType: instrument.instrumentType,
    symbol: instrument.symbol,
    providerSymbol: instrument.providerSymbol,
    eventType: endpoint.eventType,
    eventTime,
    receivedAt: receivedAt.toISOString(),
    source: 'rest',
    payload,
  }
}

function buildStatusEvent(providerPlan, endpoint, error) {
  const instrument = inferInstrument(endpoint)
  const now = new Date().toISOString()

  return {
    provider: providerPlan.provider,
    venue: providerPlan.venue,
    instrumentType: instrument.instrumentType,
    symbol: instrument.symbol,
    providerSymbol: instrument.providerSymbol,
    eventType: 'provider_status',
    eventTime: now,
    receivedAt: now,
    source: 'rest',
    payload: {
      status: 'capture_error',
      message: error instanceof Error ? error.message : 'unknown REST capture error',
      endpoint: endpoint.name,
    },
  }
}

function inferInstrument(endpoint) {
  const providerSymbol = extractProviderSymbol(endpoint.url)
  const instrumentType = endpoint.name.includes('perp') ? 'perp' : endpoint.name.includes('spot') ? 'spot' : 'aggregate'
  let symbol = providerSymbol

  if (providerSymbol === 'BTCUSDT') {
    symbol = instrumentType === 'spot' ? 'BTC-USDT-SPOT' : 'BTC-USDT-PERP'
  } else if (providerSymbol === 'BTC-USDT') {
    symbol = 'BTC-USDT-SPOT'
  } else if (providerSymbol === 'BTC-USDT-SWAP') {
    symbol = 'BTC-USDT-PERP'
  }

  return { instrumentType, symbol, providerSymbol }
}

function extractProviderSymbol(url) {
  try {
    const parsed = new URL(url)
    return parsed.searchParams.get('symbol') || parsed.searchParams.get('instId') || ''
  } catch {
    return ''
  }
}

function inferEventTime(payload, receivedAt) {
  const directTimestamp =
    payload?.time ||
    payload?.nextFundingTime ||
    payload?.fundingTime ||
    payload?.ts ||
    payload?.data?.[0]?.ts ||
    payload?.data?.[0]?.fundingTime
  const asNumber = Number(directTimestamp)

  if (Number.isFinite(asNumber) && asNumber > 0) {
    return new Date(asNumber).toISOString()
  }

  return receivedAt.toISOString()
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })

  return {
    ok: response.ok,
    status: response.status,
    payload: await response.json(),
  }
}

async function curlJson(url) {
  const marker = '__WYCKOFF_HTTP_META__'
  const { stdout } = await execFileAsync('curl', [
    '--silent',
    '--show-error',
    '--location',
    '--max-time',
    String(Math.ceil(REQUEST_TIMEOUT_MS / 1000)),
    '--header',
    'Accept: application/json',
    '--write-out',
    `\n${marker}%{http_code}`,
    url,
  ])

  const markerIndex = stdout.lastIndexOf(`\n${marker}`)
  if (markerIndex === -1) {
    throw new Error('curl response did not include HTTP status marker')
  }

  const body = stdout.slice(0, markerIndex)
  const status = Number(stdout.slice(markerIndex + marker.length + 1).trim())

  return {
    ok: status >= 200 && status < 300,
    status,
    payload: JSON.parse(body),
  }
}

function buildOutputPath(dataDir, provider, endpoint, startedAt) {
  const datePart = startedAt.toISOString().slice(0, 10)
  const timestampPart = startedAt.toISOString().replace(/[:.]/g, '-')
  return resolve(dataDir, provider, datePart, `${endpoint.name}-${timestampPart}.jsonl`)
}

function hasProxyEnv() {
  return Boolean(process.env.https_proxy || process.env.HTTPS_PROXY || process.env.http_proxy || process.env.HTTP_PROXY)
}

function printHelp() {
  console.log(`Usage: npm run crypto:rest-capture -- [options]

Options:
  --provider=<name>        Provider to capture: all, binance, okx. Default: all.
  --event-type=<type>      Event type: derivatives_state, open_interest, funding_rate, all. Default: derivatives_state.
  --market=<id>            Market id from config/markets.json. Default: btc-usdt.
  --config=<path>          Market config path.
  --data-dir=<path>        Output data directory.
  --report=<path>          Output summary report path.
`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
