import { randomBytes } from 'node:crypto'
import net from 'node:net'
import tls from 'node:tls'

const DEFAULT_TIMEOUT_MS = 12000

export async function probeWebSocket(endpoint, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const startedAt = Date.now()
  const socket = await openWebSocket(endpoint.url, { timeoutMs })
  const messages = []
  let subscriptionAck = false

  try {
    if (endpoint.subscribe) {
      socket.write(encodeFrame(JSON.stringify(endpoint.subscribe)))
    }

    while (Date.now() - startedAt < timeoutMs) {
      const frame = await readFrame(socket, timeoutMs - (Date.now() - startedAt))

      if (!frame) {
        break
      }

      if (frame.opcode === 0x9) {
        socket.write(encodeFrame(frame.payload, 0xA))
        continue
      }

      if (frame.opcode !== 0x1) {
        continue
      }

      const text = frame.payload.toString('utf8')
      const payload = safeJsonParse(text)

      if (isSubscriptionAck(payload)) {
        subscriptionAck = true
      }

      if (endpoint.ignoreSubscriptionAck && isSubscriptionAck(payload)) {
        continue
      }

      messages.push(payload ?? text)

      if (!endpoint.minMessages || messages.length >= endpoint.minMessages) {
        break
      }
    }

    return {
      status: messages.length > 0 ? 'ok' : 'connected_no_sample',
      transport: describeTransport(endpoint.url),
      latencyMs: Date.now() - startedAt,
      subscriptionAck,
      messageCount: messages.length,
      sampleShape: describeShape(messages[0]),
      fieldCoverage: buildFieldCoverage(messages[0], endpoint.expectedFields),
    }
  } finally {
    socket.end()
  }
}

export async function openWebSocket(urlValue, { timeoutMs }) {
  const url = new URL(urlValue)
  const key = randomBytes(16).toString('base64')
  const socket = await openTlsSocket(url, timeoutMs)

  socket.write(
    [
      `GET ${url.pathname}${url.search} HTTP/1.1`,
      `Host: ${url.host}`,
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Key: ${key}`,
      'Sec-WebSocket-Version: 13',
      'User-Agent: the-wyckoff-crypto-probe/0.1',
      '',
      '',
    ].join('\r\n'),
  )

  const response = await readUntil(socket, Buffer.from('\r\n\r\n'), timeoutMs)
  const headerText = response.toString('utf8')

  if (!headerText.startsWith('HTTP/1.1 101') && !headerText.startsWith('HTTP/1.0 101')) {
    throw new Error(`WebSocket upgrade failed: ${headerText.split('\r\n')[0]}`)
  }

  return socket
}

async function openTlsSocket(url, timeoutMs) {
  const proxy = readHttpProxy()

  if (!proxy) {
    return new Promise((resolve, reject) => {
      const socket = tls.connect(Number(url.port || 443), url.hostname, { servername: url.hostname }, () => resolve(socket))
      socket.setTimeout(timeoutMs, () => {
        socket.destroy()
        reject(new Error('direct TLS connection timeout'))
      })
      socket.once('error', reject)
    })
  }

  const proxySocket = await new Promise((resolve, reject) => {
    const socket = net.connect(proxy.port, proxy.hostname, () => resolve(socket))
    socket.setTimeout(timeoutMs, () => {
      socket.destroy()
      reject(new Error('proxy connection timeout'))
    })
    socket.once('error', reject)
  })

  proxySocket.write(
    [
      `CONNECT ${url.hostname}:${url.port || 443} HTTP/1.1`,
      `Host: ${url.hostname}:${url.port || 443}`,
      '',
      '',
    ].join('\r\n'),
  )

  const response = await readUntil(proxySocket, Buffer.from('\r\n\r\n'), timeoutMs)
  const headerText = response.toString('utf8')

  if (!headerText.startsWith('HTTP/1.1 200') && !headerText.startsWith('HTTP/1.0 200')) {
    proxySocket.destroy()
    throw new Error(`Proxy CONNECT failed: ${headerText.split('\r\n')[0]}`)
  }

  return new Promise((resolve, reject) => {
    const socket = tls.connect({ socket: proxySocket, servername: url.hostname }, () => resolve(socket))
    socket.setTimeout(timeoutMs, () => {
      socket.destroy()
      reject(new Error('proxied TLS connection timeout'))
    })
    socket.once('error', reject)
  })
}

function readUntil(socket, delimiter, timeoutMs) {
  return new Promise((resolve, reject) => {
    let buffer = Buffer.alloc(0)
    const timeout = setTimeout(() => cleanup(new Error('socket read timeout')), timeoutMs)

    function onData(chunk) {
      buffer = Buffer.concat([buffer, chunk])
      const index = buffer.indexOf(delimiter)

      if (index !== -1) {
        cleanup(null, buffer.slice(0, index + delimiter.length))
      }
    }

    function onError(error) {
      cleanup(error)
    }

    function cleanup(error, result) {
      clearTimeout(timeout)
      socket.off('data', onData)
      socket.off('error', onError)

      if (error) {
        reject(error)
      } else {
        resolve(result)
      }
    }

    socket.on('data', onData)
    socket.once('error', onError)
  })
}

export function readFrame(socket, timeoutMs) {
  return new Promise((resolve, reject) => {
    let buffer = Buffer.alloc(0)
    const timeout = setTimeout(() => cleanup(null, null), Math.max(timeoutMs, 1))

    function onData(chunk) {
      buffer = Buffer.concat([buffer, chunk])
      const frame = tryParseFrame(buffer)

      if (frame) {
        cleanup(null, frame)
      }
    }

    function onError(error) {
      cleanup(error)
    }

    function cleanup(error, result) {
      clearTimeout(timeout)
      socket.off('data', onData)
      socket.off('error', onError)

      if (error) {
        reject(error)
      } else {
        resolve(result)
      }
    }

    socket.on('data', onData)
    socket.once('error', onError)
  })
}

function tryParseFrame(buffer) {
  if (buffer.length < 2) {
    return null
  }

  const firstByte = buffer[0]
  const secondByte = buffer[1]
  const opcode = firstByte & 0x0f
  let payloadLength = secondByte & 0x7f
  let offset = 2

  if (payloadLength === 126) {
    if (buffer.length < offset + 2) {
      return null
    }
    payloadLength = buffer.readUInt16BE(offset)
    offset += 2
  } else if (payloadLength === 127) {
    if (buffer.length < offset + 8) {
      return null
    }
    const highBits = buffer.readUInt32BE(offset)
    const lowBits = buffer.readUInt32BE(offset + 4)
    payloadLength = highBits * 2 ** 32 + lowBits
    offset += 8
  }

  const masked = Boolean(secondByte & 0x80)
  let mask

  if (masked) {
    if (buffer.length < offset + 4) {
      return null
    }
    mask = buffer.slice(offset, offset + 4)
    offset += 4
  }

  if (buffer.length < offset + payloadLength) {
    return null
  }

  const payload = Buffer.from(buffer.slice(offset, offset + payloadLength))

  if (masked) {
    for (let index = 0; index < payload.length; index += 1) {
      payload[index] ^= mask[index % 4]
    }
  }

  return { opcode, payload }
}

export function encodeFrame(value, opcode = 0x1) {
  const payload = Buffer.isBuffer(value) ? value : Buffer.from(value)
  const mask = randomBytes(4)
  const header = []

  header.push(0x80 | opcode)

  if (payload.length < 126) {
    header.push(0x80 | payload.length)
  } else if (payload.length < 65536) {
    header.push(0x80 | 126, (payload.length >> 8) & 0xff, payload.length & 0xff)
  } else {
    throw new Error('WebSocket probe payload is too large')
  }

  const maskedPayload = Buffer.from(payload)
  for (let index = 0; index < maskedPayload.length; index += 1) {
    maskedPayload[index] ^= mask[index % 4]
  }

  return Buffer.concat([Buffer.from(header), mask, maskedPayload])
}

function readHttpProxy() {
  const proxyValue = process.env.https_proxy || process.env.HTTPS_PROXY || process.env.http_proxy || process.env.HTTP_PROXY

  if (!proxyValue) {
    return null
  }

  const proxy = new URL(proxyValue)
  return {
    hostname: proxy.hostname,
    port: Number(proxy.port || 8080),
  }
}

function buildFieldCoverage(payload, expectedFields) {
  return expectedFields.map((field) => ({
    field,
    present: hasNestedField(payload, field),
  }))
}

function hasNestedField(value, field) {
  if (!value || typeof value !== 'object') {
    return false
  }

  if (Object.prototype.hasOwnProperty.call(value, field)) {
    return true
  }

  return Object.values(value).some((item) => {
    if (Array.isArray(item)) {
      return item.some((child) => hasNestedField(child, field))
    }

    return hasNestedField(item, field)
  })
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

function describeTransport(urlValue) {
  return `${readHttpProxy() ? 'proxy+' : ''}${new URL(urlValue).protocol.replace(':', '')}`
}

export function safeJsonParse(value) {
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

export function isSubscriptionAck(payload) {
  return Boolean(
    payload &&
      typeof payload === 'object' &&
      (payload.event === 'subscribe' || payload.event === 'login' || payload.op === 'subscribe'),
  )
}
