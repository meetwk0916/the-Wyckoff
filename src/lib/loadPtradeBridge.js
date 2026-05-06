export const EMPTY_PTRADE_HEALTH = {
  mode: 'unknown',
  status: 'loading',
  transport: 'pending',
  message: '正在检查 ptrade bridge。',
  capabilities: {
    l2OrderFlow: false,
    recorder: false,
    replay: false,
  },
  lastCheckedAt: '',
}

const PTRADE_HEALTH_URL = '/api/ptrade/health'
const PTRADE_ORDER_FLOW_URL = '/api/ptrade/l2-order-flow'

function normalizeCapabilities(payload) {
  return {
    l2OrderFlow: Boolean(payload?.l2OrderFlow),
    recorder: Boolean(payload?.recorder),
    replay: Boolean(payload?.replay),
  }
}

function normalizeLevels(levels) {
  if (!Array.isArray(levels)) {
    return []
  }

  return levels.map((level) => ({
    price: Number(level?.price || 0),
    volume: Number(level?.volume || 0),
    orders: Number(level?.orders || 0),
  }))
}

function normalizeTape(tape) {
  if (!Array.isArray(tape)) {
    return []
  }

  return tape.map((item) => ({
    time: item?.time || '--',
    side: item?.side || 'UNKNOWN',
    price: Number(item?.price || 0),
    volume: Number(item?.volume || 0),
  }))
}

export async function loadPtradeHealth() {
  const response = await fetch(PTRADE_HEALTH_URL, {
    cache: 'no-store',
    headers: {
      Accept: 'application/json',
    },
  })

  if (!response.ok) {
    throw new Error(`ptrade bridge 健康检查失败（HTTP ${response.status}）`)
  }

  const payload = await response.json()

  return {
    ...EMPTY_PTRADE_HEALTH,
    mode: payload?.mode || EMPTY_PTRADE_HEALTH.mode,
    status: payload?.status || EMPTY_PTRADE_HEALTH.status,
    transport: payload?.transport || EMPTY_PTRADE_HEALTH.transport,
    message: payload?.message || EMPTY_PTRADE_HEALTH.message,
    capabilities: normalizeCapabilities(payload?.capabilities),
    lastCheckedAt: payload?.lastCheckedAt || '',
  }
}

export async function loadPtradeOrderFlow(symbol) {
  const url = new URL(PTRADE_ORDER_FLOW_URL, window.location.origin)
  url.searchParams.set('symbol', symbol)

  const response = await fetch(url, {
    cache: 'no-store',
    headers: {
      Accept: 'application/json',
    },
  })

  if (!response.ok) {
    throw new Error(`L2 订单流加载失败（HTTP ${response.status}）`)
  }

  const payload = await response.json()

  return {
    symbol: payload?.symbol || symbol,
    capturedAt: payload?.capturedAt || '',
    source: payload?.source || 'unknown',
    venue: payload?.venue || 'unknown',
    depthLevels: Number(payload?.depthLevels || 0),
    spreadBps: Number(payload?.spreadBps || 0),
    imbalance: Number(payload?.imbalance || 0),
    bids: normalizeLevels(payload?.bids),
    asks: normalizeLevels(payload?.asks),
    tape: normalizeTape(payload?.tape),
  }
}