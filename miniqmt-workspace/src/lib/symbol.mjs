// A-share symbol normalization between broker raw form (600570.SH) and
// canonical exchange form (600570.XSHG). Kept dependency-free and reversible.

const RAW_TO_CANONICAL = { SH: 'XSHG', SZ: 'XSHE', BJ: 'BJSE' }
const CANONICAL_TO_RAW = { XSHG: 'SH', XSHE: 'SZ', BJSE: 'BJ' }

export function normalizeSymbol(symbol) {
  if (typeof symbol !== 'string' || symbol.length === 0) {
    return ''
  }
  const value = symbol.trim().toUpperCase()
  const dot = value.lastIndexOf('.')
  if (dot === -1) {
    return inferCanonicalFromBareCode(value)
  }
  const code = value.slice(0, dot)
  const suffix = value.slice(dot + 1)
  if (RAW_TO_CANONICAL[suffix]) {
    return `${code}.${RAW_TO_CANONICAL[suffix]}`
  }
  if (CANONICAL_TO_RAW[suffix]) {
    return `${code}.${suffix}`
  }
  return value
}

export function toRawSymbol(symbol) {
  const canonical = normalizeSymbol(symbol)
  const dot = canonical.lastIndexOf('.')
  if (dot === -1) {
    return canonical
  }
  const code = canonical.slice(0, dot)
  const suffix = canonical.slice(dot + 1)
  if (CANONICAL_TO_RAW[suffix]) {
    return `${code}.${CANONICAL_TO_RAW[suffix]}`
  }
  return canonical
}

function inferCanonicalFromBareCode(code) {
  if (/^6/.test(code)) {
    return `${code}.XSHG`
  }
  if (/^(0|3)/.test(code)) {
    return `${code}.XSHE`
  }
  if (/^(8|4|9)/.test(code)) {
    return `${code}.BJSE`
  }
  return code
}
