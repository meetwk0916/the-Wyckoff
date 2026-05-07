# BTC Wyckoff 2.0 实施路径

## 路线原则

以终为始：最终要的是可验证、可回放、可解释的 BTC 结构交易系统，而不是一个能展示很多指标的面板。

因此顺序必须是：

1. 数据源验证
2. 标准化事件契约
3. 本地落盘与回放
4. Phase C 洗盘过滤器
5. Phase D LPS paper trade
6. P&F 目标与仓位管理
7. 交易所 sandbox
8. 受控实盘评估

## Phase 0：目标与数据源验证

目标：确认 BTC 路线能否用统一数据源覆盖核心数据，而不是一开始就陷入多平台拼接。

交付物：

- `GOALS.md`
- `DATA-SOURCES.md`
- 供应商验证清单
- normalized event schema 草案

退出标准：

- 选出 1 个 research primary 数据源候选。
- 选出 1 个 live fallback 交易所源。
- 明确不能由单一来源覆盖的字段。
- 明确是否需要付费 API 才能进入 Phase 1。

## Phase 1：Crypto Sensor

目标：新增 `crypto-workspace/`，实现 BTC 数据采集、标准化和落盘。

待实现：

- `crypto-workspace/README.md`
- `crypto-workspace/config/markets.json`
- `crypto-workspace/src/provider/*`
- `crypto-workspace/src/normalize/*`
- `crypto-workspace/data/README.md`

最小采集对象：

- BTC-USDT spot trades
- BTC-USDT perp trades
- BTC-USDT order book
- BTC-USDT open interest
- BTC-USDT funding rate
- BTC liquidation events

退出标准：

- 能连续采集并落盘 24 小时。
- 每条事件都有 `eventTime` 和 `receivedAt`。
- 断线重连会写入状态报告。
- 采集报告能展示延迟、丢包、重连次数和数据缺口。

## Phase 2：历史回放

目标：把采集到的数据变成可重放的市场录像。

待实现：

- append-only 本地事件存储
- replay cursor
- symbol / venue / event type 过滤
- 时间窗口 join
- 数据质量报告

退出标准：

- 能按指定时间窗口重放 BTC 插针场景。
- spot / perp / OI / Funding / liquidation 能在同一时间轴上对齐。
- 回放结果可重复，不能依赖实时 API 状态。

## Phase 3：Phase C 洗盘过滤器

目标：先识别 Spring 候选真伪，不直接输出交易动作。

输入：

- 结构支撑 / 阻力
- 跌破幅度
- 收回速度
- spot CVD
- perp CVD
- OI 变化
- Funding 拥挤度
- liquidation spike
- order book recovery

输出：

- `spring_candidate`
- `breakdown_risk`
- `short_squeeze_only`
- `insufficient_evidence`

退出标准：

- 每个候选都有证据对象和拒绝原因。
- 系统不会因为单根插针反弹就生成买入动作。
- 至少用 20 个历史窗口做人工复核。

## Phase 4：Phase D LPS Paper Trade

目标：只在 Phase D 的右侧 LPS 回踩点验证交易纪律。

规则：

- Phase C 只能生成候选，不允许下单。
- 价格重新收回区间后，等待 LPS 回踩。
- LPS 必须供给缩量，并且盘口 / CVD 不再恶化。
- 止损锚定 Phase C 洗盘低点下方。
- 盈亏比低于 3:1 的候选直接拒绝。

退出标准：

- paper trade 报告能解释每笔交易的结构背景、微观确认和执行滑点。
- 报告能区分策略错误和执行错误。
- 连续样本通过后，再评估 sandbox。

## Phase 5：P&F 目标与仓位管理

目标：在 Spring / LPS 结构被验证后，再补目标和仓位。

待实现：

- ATR 动态箱体
- P&F 横向计数
- 目标价推演
- 风险收益过滤
- Phase E trailing stop

退出标准：

- P&F 目标只影响候选是否值得交易，不影响 Spring 真伪。
- target、stop、entry 和 slippage 都进入报告。
- 回测报告自动标记盈亏比低于 3:1 的无效候选。

## Phase 6：Sandbox 与受控执行

目标：只有 paper trade 和数据质量通过后，才接交易所 sandbox。

硬闸门：

- 无数据新鲜度，不下单。
- 无心跳，不下单。
- 延迟超过阈值，不下单。
- 结构证据缺失，不下单。
- 人工审批缺失，不接真实资金。

退出标准：

- sandbox 能完成下单、撤单、成交、持仓和报告闭环。
- 所有执行动作都有审计日志。
- 真实资金评估另起文档，不在本阶段默认推进。

## 当前下一步

1. 运行 `npm run crypto:probe` 生成 REST dry-run 供应商探测计划。
2. 运行 `npm run crypto:ws-probe` 生成 WebSocket dry-run 频道探测计划。
3. 在允许联网时运行 `npm run crypto:probe -- --live --provider=binance` 和 `npm run crypto:probe -- --live --provider=okx`。
4. 在允许联网时运行 `npm run crypto:ws-probe -- --live --provider=binance` 和 `npm run crypto:ws-probe -- --live --provider=okx`。
5. 对比 `crypto-workspace/reports/*probe-last.json`，确认公开实时源是否足够做 live fallback。
6. 不购买 Tardis.dev 的当前阶段，运行 `npm run crypto:capture -- --duration-sec=86400 --event-type=liquidation` 做 24h 免费源 capture，验证 liquidation 样本可得性。
7. 并行验证 CoinGlass 低价层是否能补全全网清算 / OI / Funding / 热力图 API。
8. 等本地 replay 样本不足成为真实瓶颈时，再重新评估 Tardis.dev / Kaiko。
