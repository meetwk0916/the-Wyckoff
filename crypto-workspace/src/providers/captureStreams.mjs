function createStream(provider, venue, name, eventType, url, options = {}) {
  return { provider, venue, name, eventType, url, ...options }
}

export function buildCaptureStreams(market) {
  return {
    binance: buildBinanceStreams(market.instruments),
    okx: buildOkxStreams(market.instruments),
  }
}

function buildBinanceStreams(instruments) {
  const spot = instruments.find((instrument) => instrument.instrumentType === 'spot')
  const perp = instruments.find((instrument) => instrument.instrumentType === 'perp')
  const spotSymbol = spot?.providerSymbols?.binance?.toLowerCase()
  const perpSymbol = perp?.providerSymbols?.binance?.toLowerCase()

  return [
    createStream('binance', 'binance', 'spot_trades', 'trade', `wss://stream.binance.com:9443/ws/${spotSymbol}@trade`, {
      symbol: spot?.canonicalSymbol,
      providerSymbol: spot?.providerSymbols?.binance,
    }),
    createStream('binance', 'binance', 'perp_trades', 'trade', `wss://fstream.binance.com/ws/${perpSymbol}@trade`, {
      symbol: perp?.canonicalSymbol,
      providerSymbol: perp?.providerSymbols?.binance,
    }),
    createStream('binance', 'binance', 'spot_depth_delta', 'book_delta', `wss://stream.binance.com:9443/ws/${spotSymbol}@depth@100ms`, {
      symbol: spot?.canonicalSymbol,
      providerSymbol: spot?.providerSymbols?.binance,
    }),
    createStream('binance', 'binance', 'perp_depth_delta', 'book_delta', `wss://fstream.binance.com/ws/${perpSymbol}@depth@100ms`, {
      symbol: perp?.canonicalSymbol,
      providerSymbol: perp?.providerSymbols?.binance,
    }),
    createStream('binance', 'binance', 'perp_force_order', 'liquidation', `wss://fstream.binance.com/ws/${perpSymbol}@forceOrder`, {
      symbol: perp?.canonicalSymbol,
      providerSymbol: perp?.providerSymbols?.binance,
    }),
  ]
}

function buildOkxStreams(instruments) {
  const spot = instruments.find((instrument) => instrument.instrumentType === 'spot')
  const perp = instruments.find((instrument) => instrument.instrumentType === 'perp')
  const spotSymbol = spot?.providerSymbols?.okx
  const perpSymbol = perp?.providerSymbols?.okx

  return [
    createStream('okx', 'okx', 'spot_trades', 'trade', 'wss://ws.okx.com:8443/ws/v5/public', {
      symbol: spot?.canonicalSymbol,
      providerSymbol: spotSymbol,
      subscribe: { op: 'subscribe', args: [{ channel: 'trades', instId: spotSymbol }] },
      ignoreSubscriptionAck: true,
    }),
    createStream('okx', 'okx', 'perp_trades', 'trade', 'wss://ws.okx.com:8443/ws/v5/public', {
      symbol: perp?.canonicalSymbol,
      providerSymbol: perpSymbol,
      subscribe: { op: 'subscribe', args: [{ channel: 'trades', instId: perpSymbol }] },
      ignoreSubscriptionAck: true,
    }),
    createStream('okx', 'okx', 'spot_books_delta', 'book_delta', 'wss://ws.okx.com:8443/ws/v5/public', {
      symbol: spot?.canonicalSymbol,
      providerSymbol: spotSymbol,
      subscribe: { op: 'subscribe', args: [{ channel: 'books', instId: spotSymbol }] },
      ignoreSubscriptionAck: true,
    }),
    createStream('okx', 'okx', 'perp_books_delta', 'book_delta', 'wss://ws.okx.com:8443/ws/v5/public', {
      symbol: perp?.canonicalSymbol,
      providerSymbol: perpSymbol,
      subscribe: { op: 'subscribe', args: [{ channel: 'books', instId: perpSymbol }] },
      ignoreSubscriptionAck: true,
    }),
    createStream('okx', 'okx', 'swap_liquidation_orders', 'liquidation', 'wss://ws.okx.com:8443/ws/v5/public', {
      symbol: perp?.canonicalSymbol,
      providerSymbol: perpSymbol,
      subscribe: { op: 'subscribe', args: [{ channel: 'liquidation-orders', instType: 'SWAP' }] },
      ignoreSubscriptionAck: true,
    }),
  ]
}
