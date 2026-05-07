# BTC 数据源统一研究

更新日期：2026-05-07

## 结论

有机会把 BTC 数据统一到同一个平台或提供方上，但要分清两类目标：

1. **研究 / 历史回放 / 回测**：优先找统一数据商，因为历史 tick、order book、OI、Funding 和 liquidation 的时间对齐比低成本更重要。
2. **低延迟实盘 / paper trade**：即使使用统一数据商，也要保留交易所原生 WebSocket 作为延迟和心跳对照。

当前建议：

- 第一候选：`Tardis.dev` 或同等级历史 tick / order book 数据商，用于研究、历史回放和统一数据落盘验证。
- 第二候选：`CoinGlass`，用于 OI、Funding、清算和市场情绪类指标；是否可作为唯一主源，需要先验证其订单簿 / tick API 权限和历史深度。
- 第三候选：`Kaiko`，更偏机构级全市场数据；适合作为预算允许时的统一源候选。
- 不建议第一阶段以 `Velo` 作为唯一主源；它适合衍生品指标和 dashboard / aggregate 研究，但未必满足 tick 级订单簿回放。
- 不建议第一阶段只用 `Binance + OKX` 原生接口完成全部研究；它们适合低成本实时采集，但历史回放、跨交易所标准化和数据缺口治理会很快变成主要工程负担。

## 必需数据类型

### 基础流

- Spot trades
- Perp trades
- Order book snapshot
- Order book delta
- Best bid / ask

### 衍生品流

- Open interest
- Funding rate
- Liquidation events
- Mark price / index price
- Perp basis

### 派生研究对象

- Spot CVD
- Perp CVD
- Order book imbalance
- Spread / liquidity depth
- Volume profile
- Liquidation cluster
- Washout candidate

## 候选来源对比

| 来源 | 统一覆盖机会 | 优点 | 主要风险 | 当前用途 |
| --- | --- | --- | --- | --- |
| Tardis.dev | 高 | 偏原始市场数据，适合历史回放、tick / order book 标准化和本地重放 | 成本、覆盖字段和 liquidation / OI 细节需要实测确认 | 第一候选研究主源 |
| CoinGlass | 中高 | 强在 OI、Funding、清算、热力图和衍生品情绪 | 原始 tick / order book 深度、历史 API 权限和付费层级需要验证 | 洗盘过滤器指标源候选 |
| Kaiko | 高 | 机构级市场数据，适合统一数据治理和多交易所覆盖 | 费用和接入流程可能重 | 预算允许时的统一源候选 |
| Velo | 中 | 衍生品指标、CVD、OI / Funding 聚合研究体验好 | 不适合作为 tick 级订单簿唯一来源的风险较高 | 研究参考与指标校验 |
| Binance 原生 API | 中 | 免费、低延迟、BTC 现货和永续数据直接 | 不是跨平台统一源，历史回放和长期落盘需要自建 | 实时 fallback / 对照源 |
| OKX 原生 API | 中 | 现货 / 永续 / OI / Funding / 订单簿接口完整 | 高档深度和 tick-by-tick 频道可能有权限门槛 | 实时 fallback / 对照源 |

## 当前推荐数据架构

第一阶段不要把系统绑定死在某一家供应商上，而是先定义标准化数据契约：

```text
provider -> raw event -> normalized event -> local append-only store -> replay -> signal engine
```

最小统一事件字段：

- `provider`
- `venue`
- `instrumentType`
- `symbol`
- `eventType`
- `eventTime`
- `receivedAt`
- `sequence`
- `payload`

标准化事件类型：

- `trade`
- `book_snapshot`
- `book_delta`
- `open_interest`
- `funding_rate`
- `liquidation`
- `mark_price`
- `index_price`

这样做的原因：

- 如果 Tardis.dev 能覆盖完整需求，可以把它设为 research primary。
- 如果 CoinGlass 的衍生品数据更强，可以让它只负责 `open_interest` / `funding_rate` / `liquidation`。
- 如果数据商延迟或权限不足，可以用 Binance / OKX 原生 WebSocket 做 live fallback。
- 前端和信号引擎只消费 normalized event，不直接耦合供应商字段。

## 第一阶段供应商验证清单

在写采集器之前，先用 1 到 2 天做供应商验证。

### V-1 历史数据验证

- 能否下载 BTC-USDT spot trades。
- 能否下载 BTC-USDT perp trades。
- 能否下载 order book snapshot / delta。
- 能否下载 OI、Funding 和 liquidation events。
- 最小时间粒度是多少。
- 历史覆盖能否覆盖至少最近 6 个月。

### V-2 实时数据验证

- 是否支持 WebSocket 或流式 API。
- 上海网络环境下的平均延迟和 99 分位延迟。
- 是否有心跳、序列号和断线补洞机制。
- 是否能在本地稳定落盘 24 小时。

### V-3 数据对齐验证

- spot / perp / OI / Funding / liquidation 能否按秒级或更细粒度 join。
- 事件时间和接收时间是否都可用。
- 交易所原始 symbol 和标准 symbol 是否可稳定映射。

### V-4 成本与权限验证

- 免费层是否足够做 MVP。
- 付费层是否允许本地落盘和研究回放。
- 是否允许保存 raw data。
- 是否限制转存、回放或派生指标。

## 当前决策

先不直接决定唯一供应商。

第一步文档化数据契约和供应商验证脚本目标；第二步用同一套 normalized schema 分别试接一个统一数据商和一个交易所原生 WebSocket。只有在同一套历史场景上验证数据完整性后，才决定 primary provider。

## 数据缺口优先级

当前免费源已经能覆盖 BTC Wyckoff Sensor 的基础层：

- Binance / OKX REST：`trade`、`book_snapshot`、`open_interest`、`funding_rate`
- Binance / OKX WebSocket：`book_delta`
- Binance / OKX liquidation WebSocket：频道可连通，但短窗口未拿到样本

剩余缺口按优先级排序如下。

### P0：Liquidation 样本可得性

影响：

- 直接影响 Phase C 洗盘过滤器。
- 没有 liquidation 样本时，系统仍可通过价格收回、CVD、OI、Funding 和盘口恢复判断 Spring 候选，但置信度必须下调。
- 对 BTC 这种杠杆市场，liquidation 是区分“真实卖盘崩坏”和“扫损后仓位重置”的关键证据。

当前免费来源：

- Binance futures `forceOrder` WebSocket。
- OKX `liquidation-orders` WebSocket。

限制：

- 清算事件不是持续流，普通行情窗口可能没有样本。
- Binance forceOrder 是交易所自身 USDT-M futures 的强平快照，不代表全网清算。
- OKX liquidation-orders 是 OKX 自身清算订单频道，也不代表全网。

下一步：

- 跑 24h 到 72h liquidation capture。
- 在高波动窗口复跑 probe。
- 把 liquidation 状态拆成 `channel_connected`、`sample_seen`、`sample_absent`，避免把“没样本”误判为“不可用”。

低成本补充：

- CoinGlass：优先验证 liquidation history / aggregate liquidation API 是否在可接受价格层级内。
- Velo：验证是否能提供清算聚合或派生指标，作为研究校验，不作为 tick 级主源。

### P1：全网清算与跨交易所聚合

影响：

- 影响 Spring 置信度和宏观清算背景，不直接阻塞第一版 Sensor。
- 单一交易所清算只能说明该交易所的杠杆重置，不能代表全市场流动性猎杀完成。
- 对“插针是否已经扫完主要流动性池”的判断，全网聚合明显优于单交易所流。

可选来源：

- CoinGlass：清算、OI、Funding、热力图和市场情绪聚合优先看这里。
- Kaiko：机构级聚合数据候选，预算和接入流程更重。
- Tardis.dev：如果能覆盖多交易所 liquidation / trades / book data，则适合作为历史回放主源；价格是主要问题。

免费替代：

- 先采 Binance + OKX 双交易所。
- 用两家 perp trades、OI、Funding 和 liquidation channels 构造“局部全网”近似。
- 明确报告里标记 `coverage = binance_okx_only`。

### P2：历史 tick / order book 大样本

影响：

- 主要影响回测与参数校准，不阻塞实时 Sensor。
- 没有历史 tick 大样本时，不能严肃评估策略胜率，只能做在线观察和逐步积累 replay 样本。

付费来源：

- Tardis.dev：最贴近 tick / order book replay。
- Kaiko：机构级历史数据候选。

免费替代：

- 自建 append-only capture。
- 先积累 7 天、30 天、90 天 BTC spot / perp trades + order book delta。
- 把每次明显插针窗口标成 replay scenario。

### P3：清算热力图 / 未来流动性池

影响：

- 对预判猎杀位置有帮助，但不是 Spring 事后确认的必要条件。
- 热力图通常是模型化或供应商派生数据，不能直接等同真实挂单或未来强平。

可选来源：

- CoinGlass liquidation heatmap。
- Kingfisher / 类似清算地图工具。

免费替代：

- 用近期高低点、成交密集区、OI 变化和价格簇做近似流动性地图。
- 暂时只作为 UI 参考，不进入第一版硬闸门。

### P4：跨交易所 CVD / Volume Profile 聚合

影响：

- 有助于判断“现货需求是否真实恢复”。
- 第一阶段可以先做 Binance / OKX 局部 CVD 和本地 Volume Profile，不必等待全网聚合。

可选来源：

- Velo：聚合 CVD / OI / Funding 研究体验好。
- Kaiko：机构级聚合数据。

免费替代：

- 用本地 trades 流计算 spot CVD、perp CVD。
- 用本地 trades 构造 session volume profile。

## 推荐优先级

当前不买 Tardis.dev 的前提下，推荐顺序是：

1. **P0 liquidation 长窗口采集**：用 Binance / OKX 免费 WebSocket 跑 24h 到 72h，确认样本结构。
2. **P2 自建历史 replay**：落盘 trades、book_delta、OI、Funding 和 liquidation，先攒自己的 BTC 样本库。
3. **P1 CoinGlass 低价层验证**：只看全网清算、OI、Funding、热力图是否能用 API 拿到。
4. **P4 本地 CVD / Volume Profile**：用免费 trades 先算局部指标。
5. **P3 热力图**：暂缓，不作为第一阶段硬依赖。

## 对 Wyckoff 状态机的降级策略

数据缺口不应让系统停止工作，而应影响置信度：

- 缺 liquidation：允许输出 `spring_candidate_low_confidence`，不允许输出 `confirmed_spring`。
- 缺全网聚合：报告标记 `coverage = limited_venues`。
- 缺历史 replay：不输出策略胜率，只输出在线观察结果。
- 缺清算热力图：不影响 Spring 事后确认，只影响猎杀位置预判。
- 缺跨交易所 CVD：用本地 venue CVD 替代，并降低需求确认权重。

## 参考链接

- Binance Spot WebSocket Streams: https://developers.binance.com/docs/binance-spot-api-docs/web-socket-streams
- Binance USD-M Futures Market Data: https://developers.binance.com/docs/derivatives/usds-margined-futures/market-data/rest-api
- Binance USD-M Futures WebSocket Streams: https://developers.binance.com/docs/derivatives/usds-margined-futures/websocket-market-streams
- OKX API documentation: https://www.okx.com/docs-v5/en/
- Tardis.dev documentation: https://docs.tardis.dev/
- CoinGlass API documentation: https://docs.coinglass.com/
- Kaiko documentation: https://docs.kaiko.com/
- Velo Data API documentation: https://docs.velo.xyz/
