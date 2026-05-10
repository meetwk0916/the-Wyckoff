import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { networkInterfaces } from 'node:os'
import { URL } from 'node:url'
import { buildMockOrderFlow, DEFAULT_SYMBOL } from './ptradeFixtures.mjs'

const RELAY_HOST = process.env.PTRADE_RELAY_HOST || '0.0.0.0'
const RELAY_PORT = Number(process.env.PTRADE_RELAY_PORT || 19090)
const RELAY_RECORDINGS_DIR = process.env.PTRADE_RELAY_RECORDINGS_DIR || new URL('./recordings/', import.meta.url)
const RELAY_STATE_FILE = process.env.PTRADE_RELAY_STATE_FILE || 'ptrade-relay-latest.json'
const RELAY_EXPECTED_INGEST_PATH = process.env.PTRADE_RELAY_INGEST_PATH || '/ptrade'
const RELAY_VALIDATION_INGEST_PATH = process.env.PTRADE_RELAY_VALIDATION_PATH || '/ptrade/validation'
const RELAY_HEALTH_PATH = process.env.PTRADE_RELAY_HEALTH_PATH || '/health'
const RELAY_L2_PATH = process.env.PTRADE_RELAY_L2_PATH || '/l2-order-flow'
const RELAY_PAYLOAD_PATH = process.env.PTRADE_RELAY_PAYLOAD_PATH || '/payload/latest'
const STALE_AFTER_MS = Number(process.env.PTRADE_RELAY_STALE_AFTER_MS || 120000)

const relayState = {
  lastIngestAt: '',
  lastPayload: null,
  lastOrderFlowsBySymbol: {},
}

function buildWindowsLoopbackUrl() {
  return `http://127.0.0.1:${RELAY_PORT}`
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json; charset=utf-8',
  })
  response.end(JSON.stringify(payload, null, 2))
}

function getRecordingsDirUrl() {
  return RELAY_RECORDINGS_DIR instanceof URL
    ? RELAY_RECORDINGS_DIR
    : new URL(`file://${RELAY_RECORDINGS_DIR}`)
}

async function writeRelayState() {
  const targetDir = getRecordingsDirUrl()
  await mkdir(targetDir, { recursive: true })

  const fileUrl = new URL(RELAY_STATE_FILE, targetDir)
  await writeFile(fileUrl, JSON.stringify(relayState, null, 2))
}

async function loadRelayState() {
  const targetDir = getRecordingsDirUrl()
  const fileUrl = new URL(RELAY_STATE_FILE, targetDir)

  try {
    const raw = await readFile(fileUrl, 'utf8')
    const parsed = JSON.parse(raw)

    relayState.lastIngestAt = parsed?.lastIngestAt || ''
    relayState.lastPayload = parsed?.lastPayload || null
    relayState.lastOrderFlowsBySymbol = parsed?.lastOrderFlowsBySymbol || {}
  } catch (_error) {
    // Ignore missing or malformed local state and start fresh.
  }
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = []

    request.on('data', (chunk) => {
      chunks.push(chunk)
    })

    request.on('end', () => {
      resolve(Buffer.concat(chunks).toString('utf8'))
    })

    request.on('error', reject)
  })
}

function toIsoString(value) {
  if (!value) {
    return new Date().toISOString()
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return new Date().toISOString()
  }

  return date.toISOString()
}

function normalizeSymbol(symbol) {
  if (!symbol) {
    return DEFAULT_SYMBOL
  }

  return String(symbol).trim() || DEFAULT_SYMBOL
}

function normalizeSide(rawValue) {
  if (rawValue === 0 || rawValue === '0') {
    return 'BUY'
  }

  if (rawValue === 1 || rawValue === '1') {
    return 'SELL'
  }

  return 'UNKNOWN'
}

function normalizeTradeTime(rawValue) {
  if (rawValue == null) {
    return '--'
  }

  const digits = String(rawValue).replace(/\D/g, '')
  if (digits.length < 9) {
    return String(rawValue)
  }

  const timeDigits = digits.slice(-9)
  const hh = timeDigits.slice(0, 2)
  const mm = timeDigits.slice(2, 4)
  const ss = timeDigits.slice(4, 6)
  const ms = timeDigits.slice(6, 9)
  return `${hh}:${mm}:${ss}.${ms}`
}

function toNumber(value) {
  const normalized = Number(value)
  return Number.isFinite(normalized) ? normalized : 0
}

function buildLevelsFromValidation(validationL2) {
  const topBid = validationL2?.topBid || {}
  const topAsk = validationL2?.topAsk || {}
  const bids = []
  const asks = []

  if (topBid.price) {
    bids.push({
      price: toNumber(topBid.price),
      volume: toNumber(topBid.volume),
      orders: toNumber(topBid.orders),
    })
  }

  if (topAsk.price) {
    asks.push({
      price: toNumber(topAsk.price),
      volume: toNumber(topAsk.volume),
      orders: toNumber(topAsk.orders),
    })
  }

  return { bids, asks }
}

function buildTapeFromValidation(validationL2) {
  const sample = validationL2?.transactionSample
  if (!Array.isArray(sample) || sample.length < 3) {
    return []
  }

  return [{
    time: normalizeTradeTime(sample[0]),
    side: normalizeSide(sample[4]),
    price: toNumber(sample[1]),
    volume: toNumber(sample[2]),
  }]
}

function calculateSpreadBps(orderFlow) {
  const bestBid = orderFlow.bids?.[0]?.price || 0
  const bestAsk = orderFlow.asks?.[0]?.price || 0

  if (!bestBid || !bestAsk) {
    return 0
  }

  const mid = (bestBid + bestAsk) / 2
  if (!mid) {
    return 0
  }

  return Number((((bestAsk - bestBid) / mid) * 10000).toFixed(2))
}

function calculateImbalance(orderFlow) {
  const bidVolume = (orderFlow.bids || []).reduce((sum, level) => sum + toNumber(level.volume), 0)
  const askVolume = (orderFlow.asks || []).reduce((sum, level) => sum + toNumber(level.volume), 0)
  const totalVolume = bidVolume + askVolume

  if (!totalVolume) {
    return 0
  }

  return Number((bidVolume / totalVolume).toFixed(4))
}

function normalizeValidationPayload(payload) {
  const symbol = normalizeSymbol(payload?.symbol)
  const validationL2 = payload?.l2 || {}
  const levels = buildLevelsFromValidation(validationL2)
  const tape = buildTapeFromValidation(validationL2)

  return {
    symbol,
    capturedAt: toIsoString(payload?.generatedAt),
    source: 'ptrade-validation-relay',
    venue: payload?.businessType || 'stock',
    depthLevels: Math.max(levels.bids.length, levels.asks.length),
    bids: levels.bids,
    asks: levels.asks,
    tape,
    spreadBps: 0,
    imbalance: 0,
    validation: {
      kind: payload?.kind || '',
      phase: payload?.phase || '',
      l2Status: validationL2?.status || 'unknown',
      l2Message: validationL2?.message || '',
      outboundStatus: payload?.outbound?.status || 'unknown',
      accountStatus: payload?.account?.status || 'unknown',
    },
  }
}

function normalizeOrderFlowPayload(payload) {
  const symbol = normalizeSymbol(payload?.symbol)
  return {
    ...buildMockOrderFlow(symbol),
    ...payload,
    symbol,
    capturedAt: toIsoString(payload?.capturedAt),
    source: payload?.source || 'ptrade-relay',
    venue: payload?.venue || 'stock',
    depthLevels: toNumber(payload?.depthLevels) || Math.max(payload?.bids?.length || 0, payload?.asks?.length || 0),
    bids: Array.isArray(payload?.bids) ? payload.bids : [],
    asks: Array.isArray(payload?.asks) ? payload.asks : [],
    tape: Array.isArray(payload?.tape) ? payload.tape : [],
    spreadBps: toNumber(payload?.spreadBps),
    imbalance: toNumber(payload?.imbalance),
  }
}

function normalizeIncomingPayload(payload) {
  if (payload?.kind === 'ptrade-phase1-validation') {
    const orderFlow = normalizeValidationPayload(payload)
    orderFlow.spreadBps = calculateSpreadBps(orderFlow)
    orderFlow.imbalance = calculateImbalance(orderFlow)
    return orderFlow
  }

  const orderFlow = normalizeOrderFlowPayload(payload)
  orderFlow.spreadBps = orderFlow.spreadBps || calculateSpreadBps(orderFlow)
  orderFlow.imbalance = orderFlow.imbalance || calculateImbalance(orderFlow)
  return orderFlow
}

function isRelayHealthy() {
  if (!relayState.lastIngestAt) {
    return false
  }

  const ageMs = Date.now() - new Date(relayState.lastIngestAt).getTime()
  return Number.isFinite(ageMs) && ageMs <= STALE_AFTER_MS
}

function detectLocalIpv4() {
  const interfaces = networkInterfaces()

  for (const entries of Object.values(interfaces)) {
    for (const entry of entries || []) {
      if (entry?.family === 'IPv4' && !entry.internal) {
        return entry.address
      }
    }
  }

  return ''
}

function buildAdvertiseUrls() {
  const urls = [buildWindowsLoopbackUrl()]
  const detectedIp = detectLocalIpv4()
  if (detectedIp && detectedIp !== '127.0.0.1') {
    urls.push(`http://${detectedIp}:${RELAY_PORT}`)
  }
  return urls
}

function buildHealthPayload() {
  const healthy = isRelayHealthy()

  return {
    mode: 'relay',
    status: healthy ? 'ready' : relayState.lastIngestAt ? 'stale' : 'waiting_for_ingest',
    transport: 'http-ingest',
    message: healthy
      ? 'ptrade relay 已收到最近数据，可供上游 bridge 拉取。'
      : relayState.lastIngestAt
        ? 'ptrade relay 已收到数据，但最新数据已过期。'
        : 'ptrade relay 尚未收到 ptrade 运行时推送。',
    capabilities: {
      l2OrderFlow: Boolean(Object.keys(relayState.lastOrderFlowsBySymbol).length),
      recorder: true,
      replay: false,
    },
    listen: {
      host: RELAY_HOST,
      port: RELAY_PORT,
      ingestPath: RELAY_EXPECTED_INGEST_PATH,
      validationIngestPath: RELAY_VALIDATION_INGEST_PATH,
    },
    windowsLoopbackUrl: buildWindowsLoopbackUrl(),
    advertiseUrls: buildAdvertiseUrls(),
    lastIngestAt: relayState.lastIngestAt,
    symbols: Object.keys(relayState.lastOrderFlowsBySymbol),
    lastKind: relayState.lastPayload?.kind || '',
  }
}

async function ingestPayload(request, response) {
  const rawBody = await readBody(request)
  const payload = JSON.parse(rawBody || '{}')
  const normalizedOrderFlow = normalizeIncomingPayload(payload)
  const symbol = normalizeSymbol(normalizedOrderFlow.symbol)

  relayState.lastIngestAt = new Date().toISOString()
  relayState.lastPayload = payload
  relayState.lastOrderFlowsBySymbol[symbol] = normalizedOrderFlow
  await writeRelayState()

  sendJson(response, 202, {
    status: 'accepted',
    symbol,
    relayUrl: `http://${detectLocalIpv4() || '127.0.0.1'}:${RELAY_PORT}`,
    windowsLoopbackUrl: buildWindowsLoopbackUrl(),
    ingestPath: RELAY_EXPECTED_INGEST_PATH,
    validationIngestPath: RELAY_VALIDATION_INGEST_PATH,
    healthPath: RELAY_HEALTH_PATH,
    l2Path: `${RELAY_L2_PATH}?symbol=${encodeURIComponent(symbol)}`,
    payloadPath: RELAY_PAYLOAD_PATH,
    lastIngestAt: relayState.lastIngestAt,
  })
}

function getRequestedOrderFlow(requestUrl) {
  const symbol = normalizeSymbol(requestUrl.searchParams.get('symbol') || DEFAULT_SYMBOL)
  return relayState.lastOrderFlowsBySymbol[symbol] || relayState.lastOrderFlowsBySymbol[DEFAULT_SYMBOL] || null
}

const server = createServer(async (request, response) => {
  if (!request.url) {
    sendJson(response, 400, { error: 'Missing request URL' })
    return
  }

  if (request.method === 'OPTIONS') {
    sendJson(response, 204, {})
    return
  }

  const requestUrl = new URL(request.url, `http://${request.headers.host}`)

  try {
    if (
      request.method === 'POST'
      && [RELAY_EXPECTED_INGEST_PATH, RELAY_VALIDATION_INGEST_PATH].includes(requestUrl.pathname)
    ) {
      await ingestPayload(request, response)
      return
    }

    if (request.method === 'GET' && requestUrl.pathname === RELAY_HEALTH_PATH) {
      sendJson(response, 200, buildHealthPayload())
      return
    }

    if (request.method === 'GET' && requestUrl.pathname === RELAY_L2_PATH) {
      const orderFlow = getRequestedOrderFlow(requestUrl)
      if (!orderFlow) {
        sendJson(response, 404, {
          error: 'No ptrade order-flow has been ingested yet',
          symbol: normalizeSymbol(requestUrl.searchParams.get('symbol') || DEFAULT_SYMBOL),
        })
        return
      }

      sendJson(response, 200, orderFlow)
      return
    }

    if (request.method === 'GET' && requestUrl.pathname === RELAY_PAYLOAD_PATH) {
      sendJson(response, 200, {
        lastIngestAt: relayState.lastIngestAt,
        lastPayload: relayState.lastPayload,
      })
      return
    }

    sendJson(response, 404, { error: 'Not found' })
  } catch (error) {
    sendJson(response, 500, {
      error: error instanceof Error ? error.message : 'Unknown relay error',
    })
  }
})

await loadRelayState()

server.listen(RELAY_PORT, RELAY_HOST, () => {
  const advertiseUrls = buildAdvertiseUrls()
  console.log(`[ptrade-relay] listening on ${RELAY_HOST}:${RELAY_PORT}`)
  console.log(`[ptrade-relay] windows-ptrade-target=${buildWindowsLoopbackUrl()}${RELAY_EXPECTED_INGEST_PATH}`)
  for (const url of advertiseUrls) {
    console.log(`[ptrade-relay] url=${url}`)
  }
  console.log(`[ptrade-relay] ingest=${RELAY_EXPECTED_INGEST_PATH}`)
  console.log(`[ptrade-relay] validation-ingest=${RELAY_VALIDATION_INGEST_PATH}`)
  console.log(`[ptrade-relay] health=${RELAY_HEALTH_PATH}`)
  console.log(`[ptrade-relay] l2=${RELAY_L2_PATH}`)
  console.log(`[ptrade-relay] payload=${RELAY_PAYLOAD_PATH}`)
})