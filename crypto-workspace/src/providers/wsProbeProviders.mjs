import { probeWebSocket } from '../utils/webSocketProbe.mjs'

const WS_TIMEOUT_MS = 12000
const defaultRequiredEventTypes = ['trade', 'book_delta', 'liquidation']

function createWsEndpoint(name, eventType, url, expectedFields = [], options = {}) {
  return { name, eventType, url, expectedFields, ...options }
}

function buildBinanceWsEndpoints(instruments) {
  const spot = instruments.find((instrument) => instrument.instrumentType === 'spot')
  const perp = instruments.find((instrument) => instrument.instrumentType === 'perp')
  const spotSymbol = spot?.providerSymbols?.binance?.toLowerCase()
  const perpSymbol = perp?.providerSymbols?.binance?.toLowerCase()

  return [
    createWsEndpoint(
      'spot_trades',
      'trade',
      `wss://stream.binance.com:9443/ws/${spotSymbol}@trade`,
      ['e', 'E', 's', 'p', 'q', 'T', 'm'],
    ),
    createWsEndpoint(
      'perp_trades',
      'trade',
      `wss://fstream.binance.com/ws/${perpSymbol}@trade`,
      ['e', 'E', 'T', 's', 'p', 'q', 'm'],
    ),
    createWsEndpoint(
      'spot_depth_delta',
      'book_delta',
      `wss://stream.binance.com:9443/ws/${spotSymbol}@depth@100ms`,
      ['e', 'E', 'U', 'u', 'b', 'a'],
    ),
    createWsEndpoint(
      'perp_depth_delta',
      'book_delta',
      `wss://fstream.binance.com/ws/${perpSymbol}@depth@100ms`,
      ['e', 'E', 'T', 'U', 'u', 'b', 'a'],
    ),
    createWsEndpoint(
      'perp_force_order',
      'liquidation',
      `wss://fstream.binance.com/ws/${perpSymbol}@forceOrder`,
      ['e', 'E', 'o'],
      { allowNoSample: true },
    ),
  ]
}

function buildOkxWsEndpoints(instruments) {
  const spot = instruments.find((instrument) => instrument.instrumentType === 'spot')
  const perp = instruments.find((instrument) => instrument.instrumentType === 'perp')
  const spotSymbol = spot?.providerSymbols?.okx
  const perpSymbol = perp?.providerSymbols?.okx

  return [
    createWsEndpoint(
      'spot_trades',
      'trade',
      'wss://ws.okx.com:8443/ws/v5/public',
      ['arg', 'data'],
      {
        subscribe: { op: 'subscribe', args: [{ channel: 'trades', instId: spotSymbol }] },
        ignoreSubscriptionAck: true,
      },
    ),
    createWsEndpoint(
      'perp_trades',
      'trade',
      'wss://ws.okx.com:8443/ws/v5/public',
      ['arg', 'data'],
      {
        subscribe: { op: 'subscribe', args: [{ channel: 'trades', instId: perpSymbol }] },
        ignoreSubscriptionAck: true,
      },
    ),
    createWsEndpoint(
      'spot_books_delta',
      'book_delta',
      'wss://ws.okx.com:8443/ws/v5/public',
      ['arg', 'action', 'data'],
      {
        subscribe: { op: 'subscribe', args: [{ channel: 'books', instId: spotSymbol }] },
        ignoreSubscriptionAck: true,
      },
    ),
    createWsEndpoint(
      'perp_books_delta',
      'book_delta',
      'wss://ws.okx.com:8443/ws/v5/public',
      ['arg', 'action', 'data'],
      {
        subscribe: { op: 'subscribe', args: [{ channel: 'books', instId: perpSymbol }] },
        ignoreSubscriptionAck: true,
      },
    ),
    createWsEndpoint(
      'liquidation_orders',
      'liquidation',
      'wss://ws.okx.com:8443/ws/v5/public',
      ['arg', 'data'],
      {
        subscribe: { op: 'subscribe', args: [{ channel: 'liquidation-orders', instType: 'SWAP' }] },
        ignoreSubscriptionAck: true,
        allowNoSample: true,
      },
    ),
  ]
}

function buildBybitWsEndpoints(instruments) {
  const perp = instruments.find((instrument) => instrument.instrumentType === 'perp')
  const perpSymbol = perp?.providerSymbols?.bybit

  return [
    createWsEndpoint(
      'linear_all_liquidation',
      'liquidation',
      'wss://stream.bybit.com/v5/public/linear',
      ['topic', 'type', 'ts', 'data', 'T', 's', 'S', 'v', 'p'],
      {
        subscribe: { op: 'subscribe', args: [`allLiquidation.${perpSymbol}`] },
        ignoreSubscriptionAck: true,
        allowNoSample: true,
      },
    ),
  ]
}

export function buildWsProviderPlans(market) {
  return {
    binance: {
      provider: 'binance',
      venue: 'binance',
      requiredEventTypes: defaultRequiredEventTypes,
      coverageNotes: [
        'WebSocket probe covers trades, depth delta, and futures forceOrder liquidation stream reachability.',
        'Liquidation streams can connect without emitting a sample during quiet windows.',
      ],
      endpoints: buildBinanceWsEndpoints(market.instruments),
    },
    okx: {
      provider: 'okx',
      venue: 'okx',
      requiredEventTypes: defaultRequiredEventTypes,
      coverageNotes: [
        'WebSocket probe covers trades, books delta, and liquidation-orders public channel reachability.',
        'Liquidation streams can acknowledge subscription without emitting liquidation data during quiet windows.',
      ],
      endpoints: buildOkxWsEndpoints(market.instruments),
    },
    bybit: {
      provider: 'bybit',
      venue: 'bybit',
      requiredEventTypes: ['liquidation'],
      coverageNotes: [
        'WebSocket probe covers Bybit public allLiquidation linear stream reachability.',
        'The stream is BTCUSDT-filtered by topic and can connect without emitting a sample during quiet windows.',
      ],
      endpoints: buildBybitWsEndpoints(market.instruments),
    },
  }
}

export async function runWsProviderPlan(plan, { live = false } = {}) {
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
        subscribe: endpoint.subscribe ?? null,
      })
      continue
    }

    endpointResults.push(await probeWsEndpoint(endpoint))
  }

  return {
    provider: plan.provider,
    venue: plan.venue,
    mode: live ? 'live' : 'dry_run',
    startedAt,
    finishedAt: new Date().toISOString(),
    coverageNotes: plan.coverageNotes,
    endpoints: endpointResults,
    requiredEventTypes: plan.requiredEventTypes || defaultRequiredEventTypes,
    missingPhase0EventTypes: findMissingPhase0EventTypes(
      endpointResults,
      plan.requiredEventTypes || defaultRequiredEventTypes,
    ),
  }
}

async function probeWsEndpoint(endpoint) {
  try {
    const result = await probeWebSocket(endpoint, { timeoutMs: WS_TIMEOUT_MS })
    const effectiveStatus =
      result.status === 'connected_no_sample' && endpoint.allowNoSample ? 'connected_no_sample' : result.status

    return {
      name: endpoint.name,
      eventType: endpoint.eventType,
      status: effectiveStatus,
      url: endpoint.url,
      expectedFields: endpoint.expectedFields,
      ...result,
    }
  } catch (error) {
    return {
      name: endpoint.name,
      eventType: endpoint.eventType,
      status: 'error',
      url: endpoint.url,
      expectedFields: endpoint.expectedFields,
      error: error instanceof Error ? error.message : 'unknown error',
    }
  }
}

function findMissingPhase0EventTypes(endpointResults, requiredEventTypes) {
  const covered = new Set(
    endpointResults
      .filter((result) => ['planned', 'ok', 'connected_no_sample'].includes(result.status))
      .map((result) => result.eventType),
  )

  return requiredEventTypes.filter((eventType) => !covered.has(eventType))
}
