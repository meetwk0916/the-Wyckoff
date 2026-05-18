# MiniQMT Adapter Contract

## 目标

MiniQMT / QMT 真实运行在 Windows 客户端环境中。当前仓库只定义适配器输出契约，不在初始化阶段假设本机 macOS / WSL 能直接连接券商客户端。

最小链路：

```text
Windows MiniQMT / QMT
  -> XtQuant external Python adapter
  -> local JSONL / sqlite3 / HTTP relay
  -> current bridge / frontend
```

## 事件原则

- 保留原始 provider payload，方便事后核验。
- 所有时间字段使用 ISO 8601 或毫秒 epoch，并明确来源。
- 原始 symbol 与标准 symbol 分开保存。
- 账号、资金、持仓、委托和成交事件必须能关联到同一个 session。
- 不记录账号密码、交易密码、token 或券商私有凭据。

## 最小事件类型

### `health`

```json
{
  "eventType": "health",
  "provider": "miniqmt",
  "sessionId": "paper-001",
  "eventTime": "2026-05-13T14:30:00.000Z",
  "client": {
    "running": true,
    "loggedIn": true,
    "version": "unknown"
  },
  "xtquant": {
    "available": true,
    "userdataPath": "C:/path/to/userdata_mini",
    "connected": true
  },
  "account": {
    "accountIdMasked": "****1234",
    "accountType": "stock",
    "status": "connected"
  },
  "capabilities": {
    "quote": "unknown",
    "level2": "unknown",
    "transactions": "unknown",
    "trading": "disabled"
  },
  "errors": []
}
```

### `quote`

```json
{
  "eventType": "quote",
  "provider": "miniqmt",
  "symbol": "600570.XSHG",
  "rawSymbol": "600570.SH",
  "eventTime": "2026-05-13T14:30:00.000Z",
  "receivedAt": "2026-05-13T14:30:00.120Z",
  "price": 0,
  "volume": 0,
  "amount": 0,
  "payload": {}
}
```

### `order_flow`

```json
{
  "eventType": "order_flow",
  "provider": "miniqmt",
  "symbol": "600570.XSHG",
  "eventTime": "2026-05-13T14:30:00.000Z",
  "sourceType": "l2quote",
  "bidLevels": [],
  "askLevels": [],
  "transactions": [],
  "orders": [],
  "payload": {}
}
```

### `account_snapshot`

```json
{
  "eventType": "account_snapshot",
  "provider": "miniqmt",
  "sessionId": "paper-001",
  "eventTime": "2026-05-13T14:30:00.000Z",
  "accountIdMasked": "****1234",
  "cash": 0,
  "marketValue": 0,
  "totalAsset": 0,
  "payload": {}
}
```

### `order_event`

```json
{
  "eventType": "order_event",
  "provider": "miniqmt",
  "sessionId": "paper-001",
  "eventTime": "2026-05-13T14:30:00.000Z",
  "symbol": "600570.XSHG",
  "side": "buy",
  "orderId": "local-or-broker-order-id",
  "status": "submitted",
  "price": 0,
  "quantity": 0,
  "payload": {}
}
```

## 第一阶段禁止项

- 禁止在仓库内写真实账号、密码、交易密码、券商服务器地址和私有 token。
- 禁止默认开启真实交易。
- 禁止把缺失 L2 权限的基础行情伪装成 L2 微观确认。
- 禁止在没有回报事件的情况下认为委托成功。

