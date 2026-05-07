import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const REQUEST_TIMEOUT_MS = 8000
const execFileAsync = promisify(execFile)

function createEndpoint(name, eventType, url, expectedFields = []) {
  return { name, eventType, url, expectedFields }
}

function buildBinanceEndpoints(instruments) {
  const spot = instruments.find((instrument) => instrument.instrumentType === 'spot')
  const perp = instruments.find((instrument) => instrument.instrumentType === 'perp')
  const spotSymbol = spot?.providerSymbols?.binance
  const perpSymbol = perp?.providerSymbols?.binance

  return [
    createEndpoint(
      'spot_book_snapshot',
      'book_snapshot',
      `https://api.binance.com/api/v3/depth?symbol=${spotSymbol}&limit=100`,
      ['lastUpdateId', 'bids', 'asks'],
    ),
    createEndpoint(
      'spot_recent_trades',
      'trade',
      `https://api.binance.com/api/v3/trades?symbol=${spotSymbol}&limit=100`,
      ['id', 'price', 'qty', 'time'],
    ),
    createEndpoint(
      'perp_book_snapshot',
      'book_snapshot',
      `https://fapi.binance.com/fapi/v1/depth?symbol=${perpSymbol}&limit=100`,
      ['lastUpdateId', 'bids', 'asks'],
    ),
    createEndpoint(
      'perp_recent_trades',
      'trade',
      `https://fapi.binance.com/fapi/v1/trades?symbol=${perpSymbol}&limit=100`,
      ['id', 'price', 'qty', 'time'],
    ),
    createEndpoint(
      'perp_open_interest',
      'open_interest',
      `https://fapi.binance.com/fapi/v1/openInterest?symbol=${perpSymbol}`,
      ['symbol', 'openInterest', 'time'],
    ),
    createEndpoint(
      'perp_funding_rate',
      'funding_rate',
      `https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${perpSymbol}`,
      ['symbol', 'lastFundingRate', 'nextFundingTime'],
    ),
  ]
}

function buildOkxEndpoints(instruments) {
  const spot = instruments.find((instrument) => instrument.instrumentType === 'spot')
  const perp = instruments.find((instrument) => instrument.instrumentType === 'perp')
  const spotSymbol = spot?.providerSymbols?.okx
  const perpSymbol = perp?.providerSymbols?.okx

  return [
    createEndpoint(
      'spot_book_snapshot',
      'book_snapshot',
      `https://www.okx.com/api/v5/market/books?instId=${spotSymbol}&sz=50`,
      ['code', 'data'],
    ),
    createEndpoint(
      'spot_recent_trades',
      'trade',
      `https://www.okx.com/api/v5/market/trades?instId=${spotSymbol}&limit=100`,
      ['code', 'data'],
    ),
    createEndpoint(
      'perp_book_snapshot',
      'book_snapshot',
      `https://www.okx.com/api/v5/market/books?instId=${perpSymbol}&sz=50`,
      ['code', 'data'],
    ),
    createEndpoint(
      'perp_recent_trades',
      'trade',
      `https://www.okx.com/api/v5/market/trades?instId=${perpSymbol}&limit=100`,
      ['code', 'data'],
    ),
    createEndpoint(
      'perp_open_interest',
      'open_interest',
      `https://www.okx.com/api/v5/public/open-interest?instType=SWAP&instId=${perpSymbol}`,
      ['code', 'data'],
    ),
    createEndpoint(
      'perp_funding_rate',
      'funding_rate',
      `https://www.okx.com/api/v5/public/funding-rate?instId=${perpSymbol}`,
      ['code', 'data'],
    ),
  ]
}

export function buildProviderPlans(market) {
  return {
    binance: {
      provider: 'binance',
      venue: 'binance',
      coverageNotes: [
        'REST probe covers spot/perp trades, order book snapshots, open interest, and funding.',
        'Liquidation evidence requires futures forceOrder WebSocket or a derivatives data provider.',
      ],
      endpoints: buildBinanceEndpoints(market.instruments),
    },
    okx: {
      provider: 'okx',
      venue: 'okx',
      coverageNotes: [
        'REST probe covers spot/perp trades, order book snapshots, open interest, and funding.',
        'Liquidation evidence should be validated through OKX liquidation-orders channel or a derivatives data provider.',
      ],
      endpoints: buildOkxEndpoints(market.instruments),
    },
  }
}

export async function runProviderPlan(plan, { live = false } = {}) {
  const startedAt = new Date().toISOString()
  const endpointResults = []

  for (const endpoint of plan.endpoints) {
    if (!live) {
      endpointResults.push({
        name: endpoint.name,
        eventType: endpoint.eventType,
        status: 'planned',
        url: endpoint.url,
        expectedFields: endpoint.expectedFields,
      })
      continue
    }

    endpointResults.push(await probeEndpoint(endpoint))
  }

  return {
    provider: plan.provider,
    venue: plan.venue,
    mode: live ? 'live' : 'dry_run',
    startedAt,
    finishedAt: new Date().toISOString(),
    coverageNotes: plan.coverageNotes,
    endpoints: endpointResults,
    missingPhase0EventTypes: findMissingPhase0EventTypes(endpointResults),
  }
}

async function probeEndpoint(endpoint) {
  const requestedAt = Date.now()
  const transport = hasProxyEnv() ? 'curl' : 'fetch'

  try {
    const response = transport === 'curl' ? await curlJson(endpoint.url) : await fetchJson(endpoint.url)
    const payloadSample = Array.isArray(response.payload) ? response.payload[0] : response.payload

    return {
      name: endpoint.name,
      eventType: endpoint.eventType,
      status: response.ok ? 'ok' : 'http_error',
      transport,
      httpStatus: response.status,
      latencyMs: Date.now() - requestedAt,
      expectedFields: endpoint.expectedFields,
      fieldCoverage: buildFieldCoverage(payloadSample, endpoint.expectedFields),
      sampleShape: describeShape(payloadSample),
    }
  } catch (error) {
    return {
      name: endpoint.name,
      eventType: endpoint.eventType,
      status: 'error',
      transport,
      latencyMs: Date.now() - requestedAt,
      expectedFields: endpoint.expectedFields,
      error: error instanceof Error ? error.message : 'unknown error',
    }
  }
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

function buildFieldCoverage(payload, expectedFields) {
  return expectedFields.map((field) => ({
    field,
    present: hasOwn(payload, field),
  }))
}

function describeShape(value) {
  if (Array.isArray(value)) {
    return { type: 'array', length: value.length }
  }

  if (value && typeof value === 'object') {
    return {
      type: 'object',
      keys: Object.keys(value).slice(0, 20),
    }
  }

  return { type: typeof value }
}

function findMissingPhase0EventTypes(endpointResults) {
  const covered = new Set(
    endpointResults
      .filter((result) => ['planned', 'ok'].includes(result.status))
      .map((result) => result.eventType),
  )

  return ['trade', 'book_snapshot', 'book_delta', 'open_interest', 'funding_rate', 'liquidation'].filter(
    (eventType) => !covered.has(eventType),
  )
}

function hasOwn(value, field) {
  return Boolean(value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, field))
}

function hasProxyEnv() {
  return Boolean(process.env.https_proxy || process.env.HTTPS_PROXY || process.env.http_proxy || process.env.HTTP_PROXY)
}
