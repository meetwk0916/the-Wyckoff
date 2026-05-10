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

目标：维护 `crypto-workspace/`，实现 BTC 数据采集、标准化和落盘。

已实现：

- `crypto-workspace/README.md`
- `crypto-workspace/config/markets.json`
- `crypto-workspace/data/README.md`
- REST / WebSocket provider probe
- live capture / REST derivatives capture
- replay window / fixture runner
- Phase C evidence / classification runner

待实现：

- 更完整的 normalized transform 层
- 结构支撑 / 阻力识别
- spot CVD / perp CVD 正式判据
- replay 样本库扩充和人工复核索引

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

已实现：

- append-only 本地事件存储
- symbol / venue / event type 过滤
- 数据质量报告
- 固定 replay fixture 检查
- Phase C evidence 聚合入口

待实现：

- 更正式的 replay cursor
- 多流时间窗口 join 对象
- 历史窗口索引与人工复核清单

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

截至 2026-05-10，REST / WebSocket 探测、落盘、replay、fixture、Phase C evidence 和保守分类入口已经可用。当前下一步不再是继续做基础 probe，而是扩充可复核样本和结构上下文：

1. 扩充 Phase C 样本集，优先寻找 `long liquidation + 价格收回 + 盘口恢复` 的 BTC 窗口。
2. 把结构支撑 / 阻力识别接入 evidence 对象，避免只凭微观流判断 Spring。
3. 将当前 trade flow 升级为正式 spot CVD / perp CVD 判据。
4. 保留 `short_squeeze_only` 保护，防止把空头挤压误判成 Spring。
5. 至少做 20 个历史窗口人工复核，再进入 Phase D LPS paper trade。
6. 当本地样本不足成为真实瓶颈时，再重新评估 Tardis.dev / Kaiko / CoinGlass 的历史数据。

## 当前已新增的 Phase 2 入口

本地 JSONL 回放入口已经可用：

```bash
npm run crypto:replay -- --event-type=liquidation --symbol=BTC
npm run crypto:replay -- --start=2026-05-07T14:30:00Z --end=2026-05-07T14:40:00Z --event-type=liquidation --symbol=BTC
```

当前它只做时间窗、provider、event type 和 symbol 过滤，并输出可复核的样本报告；还不承担 Phase C 结构判断。这样可以先确认 capture 数据是否足够形成 BTC 插针窗口，再决定是否补洗盘过滤器。

采集侧也已对 OKX 这类全市场清算频道做 BTC instrument 过滤：非 BTC liquidation 消息只计入 capture report 的 `filteredMessages`，不再写入本地 JSONL 作为 BTC 回放样本。

回放报告会输出 instrument 覆盖、延迟摘要和 `evidence.minimumPhaseCReady`。其中 `minimumPhaseCReady` 只表示窗口内同时存在 `book_delta` 和 `liquidation` 两类 BTC 证据；它不是 Spring 信号。当前 capture 已支持 BTC spot/perp trade 流，作为后续 CVD 的原始输入；`crypto:rest-capture` 已支持 OI / Funding 快照落盘。真正进入 Phase C 洗盘过滤器前，还需要拿到真实 BTC liquidation 样本，并把这些窗口做成可复核 fixture。

当前已固定两个 replay fixture：

- `okx-btc-liquidation-2026-05-09T12-14Z`：包含 trade、book_delta、OI、Funding 和 1 条 BTC liquidation，用于后续 Phase C evidence 聚合。
- `okx-btc-no-liquidation-2026-05-09T12-33Z`：包含 trade、book_delta、OI 和 Funding，但无 BTC liquidation，用作对照窗口。

Phase C evidence 聚合入口已经可用：

```bash
npm run crypto:phase-c:evidence
npm run crypto:phase-c:evidence -- --fixture=okx-btc-liquidation-2026-05-09T12-14Z
```

当前阶段只输出 price action、trade flow、book recovery、liquidation spike、OI 和 Funding 上下文；它不把窗口判定为 Spring，也不输出交易动作。

Phase C 候选分类入口已经可用：

```bash
npm run crypto:phase-c:classify
```

当前分类标签限制为 `spring_candidate`、`breakdown_risk`、`short_squeeze_only` 和 `insufficient_evidence`。短仓强平主导的窗口会先归为 `short_squeeze_only`，避免把单纯空头挤压误判成 Spring；缺少 liquidation 的窗口继续归为 `insufficient_evidence`。
