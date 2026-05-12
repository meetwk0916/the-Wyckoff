import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const REQUEST_TIMEOUT_SEC = 12
const execFileAsync = promisify(execFile)

export function buildFreeHistoricalPlans({ symbol = 'BTCUSDT', date = '2026-05-09', interval = '1m' } = {}) {
  const upperSymbol = symbol.toUpperCase()

  return [
    {
      provider: 'binance_vision',
      sourceType: 'exchange_public_download',
      access: 'free_public',
      mode: 'predictable_url',
      notes: [
        'Useful for low-cost Binance spot / futures trade and kline history.',
        'USDT-M liquidationSnapshot availability is not guaranteed for recent dates and must be probed.',
        'Files are ZIP archives and should be converted to normalized events before replay.',
      ],
      resources: [
        buildBinanceResource('spot_agg_trades_daily', 'trade', `https://data.binance.vision/data/spot/daily/aggTrades/${upperSymbol}/${upperSymbol}-aggTrades-${date}.zip`),
        buildBinanceResource('spot_klines_daily', 'kline', `https://data.binance.vision/data/spot/daily/klines/${upperSymbol}/${interval}/${upperSymbol}-${interval}-${date}.zip`),
        buildBinanceResource('um_futures_agg_trades_daily', 'trade', `https://data.binance.vision/data/futures/um/daily/aggTrades/${upperSymbol}/${upperSymbol}-aggTrades-${date}.zip`),
        buildBinanceResource('um_futures_klines_daily', 'kline', `https://data.binance.vision/data/futures/um/daily/klines/${upperSymbol}/${interval}/${upperSymbol}-${interval}-${date}.zip`),
        buildBinanceResource(
          'um_futures_liquidation_snapshot_daily',
          'liquidation',
          `https://data.binance.vision/data/futures/um/daily/liquidationSnapshot/${upperSymbol}/${upperSymbol}-liquidationSnapshot-${date}.zip`,
        ),
      ],
    },
    {
      provider: 'okx_historical_data',
      sourceType: 'exchange_public_download',
      access: 'free_public_manual_download',
      mode: 'manual_portal',
      portalUrl: 'https://www.okx.com/en-us/historical-data',
      notes: [
        'Official OKX historical portal lists trade history, candlestick, funding rate, and high-resolution L2 order book downloads.',
        'Use this first for OKX BTC-USDT / BTC-USDT-SWAP trade, book, and funding windows.',
        'Liquidation history must still be verified separately before treating it as Phase C evidence.',
      ],
      resources: [
        createManualResource('okx_trade_history', 'trade'),
        createManualResource('okx_funding_rate', 'funding_rate'),
        createManualResource('okx_l2_order_book', 'book_snapshot_or_delta'),
      ],
    },
    {
      provider: 'coinglass',
      sourceType: 'third_party_derivatives_api',
      access: 'api_key_required',
      mode: 'authenticated_api',
      portalUrl: 'https://docs.coinglass.com/reference/liquidation-history',
      notes: [
        'Use Pair Liquidation History for BTCUSDT minute-level long / short liquidation context.',
        'Map outputs as aggregate_liquidation_context, not exchange-native raw liquidation events.',
        'Use OI drops, CVD, and book recovery to validate any Phase C candidate because exchange liquidation feeds can be underreported.',
      ],
      resources: [
        createApiResource('coinglass_pair_liquidation_history', 'liquidation', 'crypto:history:coinglass'),
      ],
    },
    {
      provider: 'cryptohftdata',
      sourceType: 'third_party_public_dataset',
      access: 'free_account_or_api_key_likely_required',
      mode: 'manual_or_api',
      portalUrl: 'https://www.cryptohftdata.com/',
      notes: [
        'Public material claims free high-frequency crypto data across trades, order books, funding, and liquidations.',
        'Before use, verify license, API-key requirements, coverage start date, field definitions, and missing-data behavior.',
        'Only import a small BTCUSDT window first, then run candidate scan and evidence classification.',
      ],
      resources: [
        createManualResource('cryptohftdata_trades', 'trade'),
        createManualResource('cryptohftdata_order_book', 'book_delta'),
        createManualResource('cryptohftdata_funding', 'funding_rate'),
        createManualResource('cryptohftdata_liquidations', 'liquidation'),
      ],
    },
  ]
}

function createApiResource(name, eventType, importCommand) {
  return {
    name,
    eventType,
    importStatus: 'implemented_requires_api_key',
    importCommand,
    normalizedEventTarget: mapEventType(eventType),
  }
}

export async function probeFreeHistoricalPlans(plans, { live = false } = {}) {
  const results = []

  for (const plan of plans) {
    results.push(await probePlan(plan, { live }))
  }

  return results
}

function buildBinanceResource(name, eventType, url) {
  return {
    name,
    eventType,
    url,
    importStatus: isImplementedBinanceVisionImport(name) ? 'implemented' : 'not_implemented',
    normalizedEventTarget: mapEventType(eventType),
  }
}

function isImplementedBinanceVisionImport(name) {
  return [
    'spot_agg_trades_daily',
    'spot_klines_daily',
    'um_futures_agg_trades_daily',
    'um_futures_klines_daily',
  ].includes(name)
}

function createManualResource(name, eventType) {
  return {
    name,
    eventType,
    importStatus: 'manual_download_required',
    normalizedEventTarget: mapEventType(eventType),
  }
}

async function probePlan(plan, { live }) {
  const resources = []

  for (const resource of plan.resources) {
    if (!live || !resource.url) {
      resources.push({
        ...resource,
        status: resource.url ? 'planned' : 'manual_check_required',
      })
      continue
    }

    resources.push(await probeUrl(resource))
  }

  return {
    ...plan,
    checkedAt: new Date().toISOString(),
    mode: live ? 'live_head' : 'dry_run',
    resources,
    coverageSummary: summarizeCoverage(resources),
  }
}

async function probeUrl(resource) {
  const startedAt = Date.now()

  try {
    const { stdout } = await execFileAsync('curl', [
      '--silent',
      '--show-error',
      '--location',
      '--head',
      '--max-time',
      String(REQUEST_TIMEOUT_SEC),
      '--write-out',
      '%{http_code} %{size_download} %{content_type}',
      '--output',
      '/dev/null',
      resource.url,
    ])
    const [statusText, sizeText, ...contentTypeParts] = stdout.trim().split(/\s+/)
    const httpStatus = Number(statusText)

    return {
      ...resource,
      status: httpStatus >= 200 && httpStatus < 300 ? 'available' : 'unavailable',
      httpStatus,
      contentLength: Number(sizeText),
      contentType: contentTypeParts.join(' '),
      latencyMs: Date.now() - startedAt,
    }
  } catch (error) {
    return {
      ...resource,
      status: 'error',
      latencyMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : 'unknown error',
    }
  }
}

function summarizeCoverage(resources) {
  const availableOrPlanned = resources.filter((resource) => ['available', 'planned', 'manual_check_required'].includes(resource.status))
  const eventTypes = Array.from(new Set(availableOrPlanned.map((resource) => resource.normalizedEventTarget).filter(Boolean))).sort()

  return {
    eventTypes,
    hasTrade: eventTypes.includes('trade'),
    hasBook: eventTypes.includes('book_delta') || eventTypes.includes('book_snapshot'),
    hasFunding: eventTypes.includes('funding_rate'),
    hasLiquidation: eventTypes.includes('liquidation'),
  }
}

function mapEventType(eventType) {
  if (eventType === 'book_snapshot_or_delta') {
    return 'book_snapshot'
  }
  if (eventType === 'kline') {
    return 'kline'
  }
  return eventType
}
