export function classifyLiquidationDirection(event) {
  const details = extractLiquidationDetails(event)
  const shortDetails = details.filter((detail) => detail.posSide === 'short' || detail.side === 'buy')
  const longDetails = details.filter((detail) => detail.posSide === 'long' || detail.side === 'sell')
  const buyRawSize = sumLiquidationDetails(details, (detail) => (detail.side === 'buy' ? detail.rawSize : 0))
  const sellRawSize = sumLiquidationDetails(details, (detail) => (detail.side === 'sell' ? detail.rawSize : 0))

  if (buyRawSize > sellRawSize && shortDetails.length >= longDetails.length) {
    return 'short'
  }
  if (sellRawSize > buyRawSize && longDetails.length >= shortDetails.length) {
    return 'long'
  }
  if (shortDetails.length > 0 && longDetails.length === 0) {
    return 'short'
  }
  if (longDetails.length > 0 && shortDetails.length === 0) {
    return 'long'
  }
  return details.length > 0 ? 'mixed_or_unknown' : 'none'
}

export function extractLiquidationDetails(event) {
  const details = []

  if (event.provider === 'binance' && event.payload?.o) {
    const order = event.payload.o
    details.push({
      timestamp: parseProviderTimestamp(order.T || event.payload.E) || event.eventTime,
      instrument: order.s,
      side: normalizeBinanceLiquidationSide(order.S),
      posSide: normalizeBinancePositionSide(order.S),
      rawSize: toNumber(order.q),
      bankruptcyPrice: toNumber(order.ap || order.p),
    })
  }

  if (event.provider === 'bybit') {
    for (const item of event.payload?.data || []) {
      details.push({
        timestamp: parseProviderTimestamp(item.T) || event.eventTime,
        instrument: item.s,
        side: normalizeBybitLiquidationSide(item.S),
        posSide: normalizeBybitPositionSide(item.S),
        rawSize: toNumber(item.v),
        bankruptcyPrice: toNumber(item.p),
      })
    }
  }

  for (const item of event.payload?.data || []) {
    for (const detail of item.details || []) {
      details.push({
        timestamp: parseProviderTimestamp(detail.ts) || event.eventTime,
        instrument: item.instId,
        side: detail.side,
        posSide: detail.posSide,
        rawSize: toNumber(detail.sz),
        bankruptcyPrice: toNumber(detail.bkPx),
      })
    }
  }

  return details
}

export function sumLiquidationDetails(details, getValue) {
  return details.reduce((sum, detail) => {
    const value = getValue(detail)
    return sum + (Number.isFinite(value) ? value : 0)
  }, 0)
}

function parseProviderTimestamp(value) {
  if (!value) {
    return ''
  }
  const parsed = new Date(Number(value))
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString()
}

function normalizeBinanceLiquidationSide(side) {
  if (side === 'BUY') {
    return 'buy'
  }
  if (side === 'SELL') {
    return 'sell'
  }
  return ''
}

function normalizeBinancePositionSide(side) {
  if (side === 'BUY') {
    return 'short'
  }
  if (side === 'SELL') {
    return 'long'
  }
  return ''
}

function normalizeBybitLiquidationSide(side) {
  if (side === 'Buy') {
    return 'sell'
  }
  if (side === 'Sell') {
    return 'buy'
  }
  return ''
}

function normalizeBybitPositionSide(side) {
  if (side === 'Buy') {
    return 'long'
  }
  if (side === 'Sell') {
    return 'short'
  }
  return ''
}

function toNumber(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}
