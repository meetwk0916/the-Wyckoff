import { mkdir, readFile, writeFile, appendFile } from 'node:fs/promises'
import { createWriteStream } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildCaptureStreams } from './providers/captureStreams.mjs'
import { encodeFrame, isSubscriptionAck, openWebSocket, readFrame, safeJsonParse } from './utils/webSocketProbe.mjs'

const workspaceDir = dirname(dirname(fileURLToPath(import.meta.url)))
const defaultConfigPath = resolve(workspaceDir, 'config/markets.json')
const defaultDataDir = resolve(workspaceDir, 'data/raw')
const defaultReportPath = resolve(workspaceDir, 'reports/live-capture-last.json')
const DEFAULT_DURATION_MS = 60_000
const FRAME_TIMEOUT_MS = 10_000

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const config = JSON.parse(await readFile(options.configPath, 'utf8'))
  const market = config.markets.find((item) => item.id === options.marketId)

  if (!market) {
    throw new Error(`Unknown market id: ${options.marketId}`)
  }

  const streamPlans = buildCaptureStreams(market)
  const streams = selectStreams(streamPlans, options)

  if (streams.length === 0) {
    throw new Error('No streams selected for capture.')
  }

  await mkdir(options.dataDir, { recursive: true })
  await mkdir(dirname(options.reportPath), { recursive: true })

  const startedAt = new Date()
  const results = await Promise.all(streams.map((stream) => captureStream(stream, options, startedAt)))
  const report = {
    reportType: 'crypto_live_capture',
    schemaVersion: 1,
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    durationMs: options.durationMs,
    marketId: market.id,
    eventType: options.eventType,
    providers: options.provider,
    streams: results,
  }

  await writeFile(options.reportPath, `${JSON.stringify(report, null, 2)}\n`)
  console.log(`Crypto live capture report written to ${options.reportPath}`)
}

async function captureStream(stream, options, startedAt) {
  const streamStartedAt = Date.now()
  const outputPath = buildOutputPath(options.dataDir, stream, startedAt)
  await mkdir(dirname(outputPath), { recursive: true })
  const writer = createWriteStream(outputPath, { flags: 'a' })
  let socket
  let receivedMessages = 0
  let filteredMessages = 0
  let writtenEvents = 0
  let subscriptionAck = false
  let lastEventAt = ''
  let error = ''
  let nextKeepAliveAt = stream.keepAlive ? Date.now() + stream.keepAlive.intervalMs : 0

  try {
    socket = await openWebSocket(stream.url, { timeoutMs: FRAME_TIMEOUT_MS })

    if (stream.subscribe) {
      socket.write(encodeFrame(JSON.stringify(stream.subscribe)))
    }

    while (Date.now() - streamStartedAt < options.durationMs) {
      if (stream.keepAlive && Date.now() >= nextKeepAliveAt) {
        socket.write(encodeFrame(JSON.stringify(stream.keepAlive.payload)))
        nextKeepAliveAt = Date.now() + stream.keepAlive.intervalMs
      }

      const remainingMs = options.durationMs - (Date.now() - streamStartedAt)
      const frame = await readFrame(socket, Math.min(FRAME_TIMEOUT_MS, remainingMs))

      if (!frame) {
        continue
      }

      if (frame.opcode === 0x9) {
        socket.write(encodeFrame(frame.payload, 0xA))
        continue
      }

      if (frame.opcode !== 0x1) {
        continue
      }

      const payload = safeJsonParse(frame.payload.toString('utf8'))
      receivedMessages += 1

      if (isSubscriptionAck(payload)) {
        subscriptionAck = true

        if (stream.ignoreSubscriptionAck) {
          continue
        }
      }

      const filteredPayload = filterPayloadForStream(stream, payload)
      if (!filteredPayload) {
        filteredMessages += 1
        continue
      }

      const event = buildCaptureEvent(stream, filteredPayload)
      writer.write(`${JSON.stringify(event)}\n`)
      writtenEvents += 1
      lastEventAt = event.receivedAt
    }
  } catch (captureError) {
    error = captureError instanceof Error ? captureError.message : 'unknown capture error'
    await appendFile(outputPath, `${JSON.stringify(buildStatusEvent(stream, 'capture_error', error))}\n`)
  } finally {
    if (socket) {
      socket.end()
    }
    writer.end()
  }

  return {
    provider: stream.provider,
    venue: stream.venue,
    name: stream.name,
    eventType: stream.eventType,
    symbol: stream.symbol,
    providerSymbol: stream.providerSymbol,
    outputPath,
    durationMs: Date.now() - streamStartedAt,
    receivedMessages,
    filteredMessages,
    writtenEvents,
    subscriptionAck,
    lastEventAt,
    status: error ? 'error' : writtenEvents > 0 ? 'captured' : 'connected_no_sample',
    error,
  }
}

function filterPayloadForStream(stream, payload) {
  if (stream.eventType !== 'liquidation') {
    return payload
  }

  const targetSymbols = buildTargetSymbols(stream)
  if (targetSymbols.length === 0) {
    return payload
  }

  if (Array.isArray(payload?.data)) {
    const filteredData = payload.data.filter((item) => itemMatchesTargetSymbols(item, targetSymbols))
    if (filteredData.length === 0) {
      return null
    }
    return { ...payload, data: filteredData }
  }

  if (itemMatchesTargetSymbols(payload, targetSymbols)) {
    return payload
  }

  return null
}

function buildTargetSymbols(stream) {
  const targets = new Set()
  addTargetSymbol(targets, stream.symbol)
  addTargetSymbol(targets, stream.providerSymbol)

  if (typeof stream.providerSymbol === 'string' && stream.providerSymbol.endsWith('-SWAP')) {
    addTargetSymbol(targets, stream.providerSymbol.replace('-SWAP', ''))
  }

  return Array.from(targets)
}

function addTargetSymbol(targets, symbol) {
  if (typeof symbol === 'string' && symbol) {
    targets.add(normalizeSymbolText(symbol))
  }
}

function itemMatchesTargetSymbols(item, targetSymbols) {
  const symbols = [
    item?.s,
    item?.o?.s,
    item?.symbol,
    item?.instId,
    item?.instFamily,
    item?.uly,
  ].map(normalizeSymbolText).filter(Boolean)

  return symbols.some((symbol) => targetSymbols.includes(symbol))
}

function normalizeSymbolText(symbol) {
  if (typeof symbol !== 'string') {
    return ''
  }
  return symbol.toUpperCase().replace(/[^A-Z0-9]/g, '')
}

function buildCaptureEvent(stream, payload) {
  return {
    provider: stream.provider,
    venue: stream.venue,
    instrumentType: inferInstrumentType(stream),
    symbol: stream.symbol,
    providerSymbol: stream.providerSymbol,
    eventType: stream.eventType,
    eventTime: inferEventTime(payload),
    receivedAt: new Date().toISOString(),
    source: 'websocket',
    stream: stream.name,
    payload,
  }
}

function buildStatusEvent(stream, status, message) {
  return {
    provider: stream.provider,
    venue: stream.venue,
    instrumentType: inferInstrumentType(stream),
    symbol: stream.symbol,
    providerSymbol: stream.providerSymbol,
    eventType: 'provider_status',
    eventTime: new Date().toISOString(),
    receivedAt: new Date().toISOString(),
    source: 'websocket',
    stream: stream.name,
    payload: { status, message },
  }
}

function selectStreams(streamPlans, options) {
  const providers = options.provider === 'all' ? Object.keys(streamPlans) : [options.provider]
  const streams = []

  for (const provider of providers) {
    if (!streamPlans[provider]) {
      throw new Error(`Unknown provider: ${provider}`)
    }

    streams.push(...streamPlans[provider])
  }

  if (options.eventType === 'all') {
    return streams
  }

  return streams.filter((stream) => stream.eventType === options.eventType)
}

function parseArgs(args) {
  const options = {
    provider: 'all',
    eventType: 'liquidation',
    marketId: 'btc-usdt',
    durationMs: DEFAULT_DURATION_MS,
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
    } else if (arg.startsWith('--duration-ms=')) {
      options.durationMs = Number(arg.slice('--duration-ms='.length))
    } else if (arg.startsWith('--duration-sec=')) {
      options.durationMs = Number(arg.slice('--duration-sec='.length)) * 1000
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

  if (!Number.isFinite(options.durationMs) || options.durationMs <= 0) {
    throw new Error('duration must be a positive number')
  }

  return options
}

function buildOutputPath(dataDir, stream, startedAt) {
  const datePart = startedAt.toISOString().slice(0, 10)
  const timestampPart = startedAt.toISOString().replace(/[:.]/g, '-')
  return resolve(dataDir, stream.provider, datePart, `${stream.name}-${timestampPart}.jsonl`)
}

function inferInstrumentType(stream) {
  if (stream.eventType === 'liquidation') {
    return 'perp'
  }

  if (stream.symbol?.includes('PERP')) {
    return 'perp'
  }

  if (stream.symbol?.includes('SPOT')) {
    return 'spot'
  }

  return 'aggregate'
}

function inferEventTime(payload) {
  const timestamp = payload?.E || payload?.T || payload?.ts || payload?.data?.[0]?.T || payload?.data?.[0]?.ts
  const asNumber = Number(timestamp)

  if (Number.isFinite(asNumber) && asNumber > 0) {
    return new Date(asNumber).toISOString()
  }

  return new Date().toISOString()
}

function printHelp() {
  console.log(`Usage: npm run crypto:capture -- [options]

Options:
  --provider=<name>        Provider to capture: all, binance, okx, bybit. Default: all.
  --event-type=<type>      Event type: liquidation, book_delta, all. Default: liquidation.
  --duration-sec=<number>  Capture duration in seconds. Default: 60.
  --duration-ms=<number>   Capture duration in milliseconds.
  --market=<id>            Market id from config/markets.json. Default: btc-usdt.
  --data-dir=<path>        Output data directory.
  --report=<path>          Output summary report path.
`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
