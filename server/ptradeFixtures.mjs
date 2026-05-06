export const DEFAULT_SYMBOL = '002594.SZ'

const BASE_ORDER_FLOW = {
  source: 'mock-ptrade-bridge',
  venue: 'simulated-l2',
  depthLevels: 5,
  spreadBps: 6.1,
  imbalance: 0.62,
  bids: [
    { price: 202.08, volume: 12800, orders: 42 },
    { price: 202.07, volume: 11200, orders: 37 },
    { price: 202.06, volume: 9800, orders: 31 },
    { price: 202.05, volume: 8600, orders: 28 },
    { price: 202.04, volume: 7200, orders: 21 },
  ],
  asks: [
    { price: 202.10, volume: 9100, orders: 26 },
    { price: 202.11, volume: 10400, orders: 29 },
    { price: 202.12, volume: 11900, orders: 34 },
    { price: 202.13, volume: 12700, orders: 38 },
    { price: 202.14, volume: 13500, orders: 41 },
  ],
  tape: [
    { time: '09:36:58.112', side: 'BUY', price: 202.1, volume: 1200 },
    { time: '09:36:58.854', side: 'BUY', price: 202.1, volume: 800 },
    { time: '09:36:59.125', side: 'SELL', price: 202.09, volume: 500 },
    { time: '09:36:59.872', side: 'BUY', price: 202.1, volume: 1500 },
    { time: '09:37:00.041', side: 'SELL', price: 202.09, volume: 700 },
  ],
}

export function buildMockOrderFlow(symbol = DEFAULT_SYMBOL) {
  return {
    symbol,
    capturedAt: new Date().toISOString(),
    ...BASE_ORDER_FLOW,
  }
}