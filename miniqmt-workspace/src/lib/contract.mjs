// Validates normalized MiniQMT adapter events (JSONL recordings) against the
// minimum contract in docs/miniqmt-wyckoff/ADAPTER-CONTRACT.md, and enforces
// the hard rule that credentials must never be persisted.

const EVENT_TYPES = ['health', 'quote', 'order_flow', 'account_snapshot', 'order_event']

const FORBIDDEN_KEYS = [
  'password',
  'passwd',
  'pwd',
  'tradepassword',
  'trade_password',
  'tradepwd',
  'token',
  'accesstoken',
  'access_token',
  'secret',
  'apisecret',
  'api_secret',
  'apikey',
  'api_key',
  'accountid', // raw, unmasked account id is forbidden; use accountIdMasked
]

const REQUIRED_FIELDS = {
  health: ['eventType', 'provider', 'eventTime', 'client', 'xtquant', 'account', 'capabilities'],
  quote: ['eventType', 'provider', 'symbol', 'eventTime', 'price', 'volume'],
  order_flow: ['eventType', 'provider', 'symbol', 'eventTime', 'sourceType'],
  account_snapshot: ['eventType', 'provider', 'eventTime', 'accountIdMasked', 'cash', 'totalAsset'],
  order_event: ['eventType', 'provider', 'eventTime', 'symbol', 'side', 'orderId', 'status'],
}

export function validateEvent(event, index) {
  const errors = []
  if (typeof event !== 'object' || event === null) {
    return [{ index, error: 'event_not_object' }]
  }
  const type = event.eventType
  if (!EVENT_TYPES.includes(type)) {
    errors.push({ index, error: `unknown_event_type:${type}` })
    return errors
  }
  for (const field of REQUIRED_FIELDS[type]) {
    if (!(field in event)) {
      errors.push({ index, error: `missing_field:${field}`, eventType: type })
    }
  }
  if (event.provider && event.provider !== 'miniqmt') {
    errors.push({ index, error: `unexpected_provider:${event.provider}`, eventType: type })
  }
  for (const key of collectKeysDeep(event)) {
    if (FORBIDDEN_KEYS.includes(key.toLowerCase())) {
      errors.push({ index, error: `forbidden_credential_field:${key}`, eventType: type })
    }
  }
  return errors
}

export function validateRecording(events) {
  const allErrors = []
  const counts = Object.fromEntries(EVENT_TYPES.map((type) => [type, 0]))
  events.forEach((event, index) => {
    if (event && EVENT_TYPES.includes(event.eventType)) {
      counts[event.eventType] += 1
    }
    allErrors.push(...validateEvent(event, index))
  })
  return { ok: allErrors.length === 0, total: events.length, counts, errors: allErrors }
}

export function parseJsonl(text) {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line))
}

function collectKeysDeep(value, acc = []) {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectKeysDeep(item, acc)
    }
  } else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      acc.push(key)
      collectKeysDeep(child, acc)
    }
  }
  return acc
}
