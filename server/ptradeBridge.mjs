import { mkdir, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { URL } from 'node:url'
import { buildMockOrderFlow, DEFAULT_SYMBOL } from './ptradeFixtures.mjs'

const BRIDGE_PORT = Number(process.env.PTRADE_BRIDGE_PORT || 8787)
const BRIDGE_MODE = process.env.PTRADE_MODE || 'mock'
const UPSTREAM_URL = process.env.PTRADE_UPSTREAM_URL || ''
const HEALTH_PATH = process.env.PTRADE_UPSTREAM_HEALTH_PATH || '/health'
const L2_PATH = process.env.PTRADE_UPSTREAM_L2_PATH || '/l2-order-flow'
const RECORDINGS_DIR = process.env.PTRADE_RECORDINGS_DIR || new URL('./recordings/', import.meta.url)

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json; charset=utf-8',
  })
  response.end(JSON.stringify(payload, null, 2))
}

function createCapabilities(isConnected) {
  return {
    l2OrderFlow: isConnected,
    recorder: true,
    replay: true,
  }
}

async function writeRecording(orderFlow) {
  const targetDir = RECORDINGS_DIR instanceof URL ? RECORDINGS_DIR : new URL(`file://${RECORDINGS_DIR}`)
  await mkdir(targetDir, { recursive: true })

  const safeSymbol = orderFlow.symbol.replace(/[^a-zA-Z0-9._-]/g, '_')
  const timestamp = orderFlow.capturedAt.replace(/[:.]/g, '-')
  const fileUrl = new URL(`${safeSymbol}-${timestamp}.json`, targetDir)

  await writeFile(fileUrl, JSON.stringify(orderFlow, null, 2))
}

async function fetchUpstreamJson(pathname, searchParams = {}) {
  const url = new URL(pathname, UPSTREAM_URL)

  for (const [key, value] of Object.entries(searchParams)) {
    if (value) {
      url.searchParams.set(key, value)
    }
  }

  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(3000),
  })

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`)
  }

  return response.json()
}

async function getBridgeHealth() {
  if (BRIDGE_MODE === 'mock') {
    return {
      mode: BRIDGE_MODE,
      status: 'mock_ready',
      transport: 'mock',
      message: '当前使用本地 mock bridge，可用于联调 L2 数据契约与回放。',
      capabilities: createCapabilities(true),
      lastCheckedAt: new Date().toISOString(),
    }
  }

  if (!UPSTREAM_URL) {
    return {
      mode: BRIDGE_MODE,
      status: 'not_configured',
      transport: 'http',
      message: '未配置 PTRADE_UPSTREAM_URL，无法连接真实 ptrade bridge。',
      capabilities: createCapabilities(false),
      lastCheckedAt: new Date().toISOString(),
    }
  }

  try {
    const upstreamHealth = await fetchUpstreamJson(HEALTH_PATH)
    return {
      mode: BRIDGE_MODE,
      status: 'connected',
      transport: 'http',
      message: '已连接到上游 ptrade bridge。',
      capabilities: createCapabilities(true),
      upstreamHealth,
      lastCheckedAt: new Date().toISOString(),
    }
  } catch (error) {
    return {
      mode: BRIDGE_MODE,
      status: 'error',
      transport: 'http',
      message: `连接上游 ptrade bridge 失败：${error instanceof Error ? error.message : 'unknown error'}`,
      capabilities: createCapabilities(false),
      lastCheckedAt: new Date().toISOString(),
    }
  }
}

async function getL2OrderFlow(symbol = DEFAULT_SYMBOL) {
  if (BRIDGE_MODE === 'mock') {
    const orderFlow = buildMockOrderFlow(symbol)
    await writeRecording(orderFlow)
    return orderFlow
  }

  if (!UPSTREAM_URL) {
    throw new Error('PTRADE_UPSTREAM_URL is not configured')
  }

  const orderFlow = await fetchUpstreamJson(L2_PATH, { symbol })
  await writeRecording(orderFlow)
  return orderFlow
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
    if (request.method === 'GET' && requestUrl.pathname === '/api/ptrade/health') {
      const payload = await getBridgeHealth()
      sendJson(response, 200, payload)
      return
    }

    if (request.method === 'GET' && requestUrl.pathname === '/api/ptrade/l2-order-flow') {
      const symbol = requestUrl.searchParams.get('symbol') || DEFAULT_SYMBOL
      const payload = await getL2OrderFlow(symbol)
      sendJson(response, 200, payload)
      return
    }

    sendJson(response, 404, { error: 'Not found' })
  } catch (error) {
    sendJson(response, 500, {
      error: error instanceof Error ? error.message : 'Unknown bridge error',
      mode: BRIDGE_MODE,
    })
  }
})

server.listen(BRIDGE_PORT, () => {
  console.log(`[ptrade-bridge] listening on http://127.0.0.1:${BRIDGE_PORT}`)
  console.log(`[ptrade-bridge] mode=${BRIDGE_MODE}`)
  if (UPSTREAM_URL) {
    console.log(`[ptrade-bridge] upstream=${UPSTREAM_URL}`)
  }
})