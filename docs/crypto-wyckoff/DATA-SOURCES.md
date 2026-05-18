# BTC 数据源统一研究

更新日期：2026-05-11

## 结论

有机会把 BTC 数据统一到同一个平台或提供方上，但要分清两类目标：

1. **研究 / 历史回放 / 回测**：优先找统一数据商，因为历史 tick、order book、OI、Funding 和 liquidation 的时间对齐比低成本更重要。
2. **低延迟实盘 / paper trade**：即使使用统一数据商，也要保留交易所原生 WebSocket 作为延迟和心跳对照。

当前建议：

- 第一候选：`Tardis.dev` 或同等级历史 tick / order book 数据商，用于研究、历史回放和统一数据落盘验证。
- 第二候选：`CoinGlass`，用于 OI、Funding、清算和市场情绪类指标；但截至 2026-05-12，核心 API 属于付费路径，当前先跳过真实拉取，只保留 dry-run 导入器。
- 第三候选：`Kaiko`，更偏机构级全市场数据；适合作为预算允许时的统一源候选。
- 低门槛补充：优先验证 `Binance public data / exchange-native history`、Bybit 实时 liquidation 和其他可程序化免费源。当前不走需要手工下载文件的 OKX Historical Data 路径；若以后使用，必须先有可自动化下载或稳定文件 schema。
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
| CoinGlass | 中高 | 强在 OI、Funding、清算、热力图和衍生品情绪 | 核心 API 付费；当前不作为近期执行依赖 | 已有 dry-run 导入器，暂跳过真实拉取 |
| Kaiko | 高 | 机构级市场数据，适合统一数据治理和多交易所覆盖 | 费用和接入流程可能重 | 预算允许时的统一源候选 |
| Velo | 中 | 衍生品指标、CVD、OI / Funding 聚合研究体验好 | 不适合作为 tick 级订单簿唯一来源的风险较高 | 研究参考与指标校验 |
| OKX Historical Data | 中 | 官方可下载 tick trade、K 线、Funding 和 L2 order book 历史数据 | 需要手工下载或先确认稳定自动化入口；不符合当前执行偏好 | 暂不推进，除非后续可自动化 |
| Binance public / native history | 中 | 交易所原生，适合免费或低成本补 Binance spot / futures trades、K 线和部分历史数据 | 历史 liquidation 可得性和格式需要实测；book delta 历史重建成本高 | 低门槛 venue 对照源 |
| CryptoHFTData | 中 | 宣称免费提供多交易所 tick、order book、funding、liquidation 等高频数据 | 新平台，覆盖起始时间、许可、稳定性和数据质量必须实测 | 值得小样本验证的免费候选 |
| Binance 原生 API | 中 | 免费、低延迟、BTC 现货和永续数据直接 | 不是跨平台统一源，历史回放和长期落盘需要自建 | 实时 fallback / 对照源 |
| OKX 原生 API | 中 | 现货 / 永续 / OI / Funding / 订单簿接口完整 | 高档深度和 tick-by-tick 频道可能有权限门槛 | 实时 fallback / 对照源 |
| Bybit 原生 API | 中 | 免费公共 WebSocket 提供 BTCUSDT all liquidation 频道，适合补 BTC 清算正样本 | 当前只作为 liquidation 补充源，不承担 spot/perp trade、book、OI、Funding 全链路 | 实时 liquidation fallback |

## 爆仓证据分层与低报风险

爆仓数据不能作为单一 Spring 判据。交易所公开 liquidation 流可能存在限流、合并或低报；热力图只表示潜在清算区，不等于已发生清算。因此 Phase C 证据按三层处理：

1. `raw_exchange_liquidation`：Binance / OKX / Bybit 等交易所推送的强平事件，可作为窗口锚点，但需要用 OI、CVD 和盘口恢复交叉验证。
2. `aggregate_liquidation_context`：CoinGlass 这类聚合 long / short liquidation history，可用于补历史窗口和方向上下文，但不能伪装成逐笔强平。
3. `liquidation_level_heatmap`：清算热力图 / liquidation map 只用于预筛潜在扫损区，不能进入 Phase C 硬闸门。

当前 Phase C 的 Spring 候选必须继续满足：多头强平主导、结构支撑跌破后收回、spot / perp CVD 支持、盘口恢复，以及 OI 明显下降所代表的去杠杆确认。

## 免费 / 低门槛历史数据源分层

当前目标不是一次性买最贵的数据源，而是尽快补出可复核的 `long liquidation + 价格收回 + 盘口恢复 + CVD 支持` 样本。因此历史源按“能否直接补 Phase C 正样本”分层。

### L0：交易所官方 / 公共历史数据

优先级最高，因为接入成本低，且与当前 Binance / OKX live fallback 概念一致。

- OKX Historical Data：官方页面显示可下载 trade history、candlestick、funding rate 和 high-resolution L2 order book 历史数据。但当前不计划走手工下载 / 手工导入路线；只有在确认可程序化下载或拿到稳定文件 schema 后才重新评估。
- Binance public / native history：适合补 Binance BTC spot / futures trades、K 线和 venue 对照。Binance liquidation 历史需要单独确认，不能假设 WebSocket `forceOrder` 的实时能力等于历史 API 可下载。
- Bybit native WebSocket：`allLiquidation.BTCUSDT` 可作为免费实时 BTC 清算补充源。它不解决历史样本缺口，但能提高后续长跑采集碰到 long liquidation 的概率。

恢复验证时的目标：

- 先选 3 到 5 个已知 BTC 插针日期，优先使用可自动化下载的 Binance / 其他公开源窗口；OKX 只在可程序化下载或 schema 稳定后纳入。
- 转换成 normalized event：`trade`、`book_delta` 或 `book_snapshot`、`funding_rate`、可用时补 `liquidation`。
- 跑 `crypto:phase-c:evidence`、`crypto:phase-c:classify`、`crypto:phase-c:review`。

### L1：聚合衍生品 API

适合补清算、OI、Funding 和情绪上下文，不一定适合承担 tick / book 主源。

- CoinGlass：可作为清算 / OI / Funding 验证入口；官方 API 文档包含 pair liquidation history endpoint。但截至 2026-05-12，API 付费，当前先跳过真实下载。已有 `crypto:history:coinglass` dry-run 入口，未来有预算或 key 时再恢复验证。
- Velo / 类似指标平台：适合指标校验或人工研究，不应作为 tick 级 replay 主源。

恢复验证时的目标：

- 用 CoinGlass 拉 1m / 5m BTCUSDT liquidation history。
- 只把它映射为 aggregate `liquidation` context，不和交易所逐笔 liquidation 混淆。
- 报告标记 `coverage = aggregate_derivatives_only` 或 `coverage = coinglass_liquidation_context`。

### L2：免费新平台 / 社区数据集

适合快速试错，但进入策略验证前必须做数据质量审计。

- CryptoHFTData：公开资料宣称有免费多交易所高频数据、order book、trades、funding 和 liquidation。它值得试下载一个 BTCUSDT 小窗口，但需要验证起始日期、许可、字段定义、时区、延迟戳和缺口。
- CCXT：适合统一抓取交易所公开历史 OHLCV、recent trades、funding / OI 等能力，但它不是历史 tick 数据仓库；不能解决深度 order book 历史和稀疏 liquidation 样本问题。

验证目标：

- 只导入一个 10 到 30 分钟窗口，不先大规模下载。
- 检查字段是否能无损映射到 normalized event。
- 用 `crypto:phase-c:candidates` 验证能否扫出 long liquidation 候选。

### L3：付费研究主源

如果免费 / 低门槛源不能在 72 小时到 7 天内补出正样本，再考虑。

- Tardis.dev：覆盖 tick-level trades、L2 order book、funding、OI、liquidation 等，适合作 research primary，但价格明显高于“先免费的跑跑”。
- Kaiko / Amberdata / CoinAPI：更偏机构或商业 API，适合预算允许后的统一治理，不作为当前第一步。

## 当前低门槛推荐路径

1. 每日先跑 `npm run crypto:daily-check`，一次性确认 Bybit 7d 心跳版 liquidation 长跑 screen、最新 provider heartbeat、BTC long / short liquidation 计数和 Phase C candidate 数。
2. 如需单独排查，再用 `npm run crypto:capture:status -- --screen=wyckoff_bybit_liq_capture_7d_heartbeat`、`npm run crypto:capture:status -- --screen=wyckoff_okx_liq_capture_72h_heartbeat` 和 `npm run crypto:phase-c:candidates` 拆开看原始输出。当前 capture health 仍按最新 provider status 汇总，不能完全等同于按 provider / screen 切分后的健康结论。
3. 每次改 Phase C evidence / classify / review 规则后，用 `npm run crypto:phase-c:check` 跑完整守门链路，避免固定对照样本标签漂移。
4. 继续使用 Binance Vision 的 trade / kline 历史补价格和 CVD 上下文。
5. 暂跳过 OKX 手工下载和 CoinGlass 付费 API；它们的影响是短期内更难快速补出历史 long liquidation 正样本，但不会削弱当前分类器的防误判能力。
6. 如果免费实时采集仍拿不到 long liquidation 样本，再评估可程序化免费源或 Tardis.dev / Kaiko 级别的付费研究主源。

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
- 历史覆盖能否覆盖验证日向前至少 6 个月。

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

当前免费源已经能覆盖 BTC Wyckoff Sensor 的基础层，并已产出可回放的 OKX BTC fixture：

- Binance / OKX REST：`trade`、`book_snapshot`、`open_interest`、`funding_rate`
- Binance / OKX WebSocket：`book_delta`
- Binance / OKX liquidation WebSocket：频道可连通；OKX 已捕获 1 条 BTC 清算样本，当前样本属于短仓强平主导，分类为 `short_squeeze_only`

剩余缺口按优先级排序如下。

### P0：Liquidation 样本可得性

影响：

- 直接影响 Phase C 洗盘过滤器。
- 没有 liquidation 样本时，系统仍可通过价格收回、CVD、OI、Funding 和盘口恢复判断 Spring 候选，但置信度必须下调。
- 对 BTC 这种杠杆市场，liquidation 是区分“真实卖盘崩坏”和“扫损后仓位重置”的关键证据。

当前免费来源：

- Binance futures `forceOrder` WebSocket。
- OKX `liquidation-orders` WebSocket。2026-05-17 已捕获 7 条 BTC long liquidation，并固化 1 个 `breakdown_risk` 负样本。

限制：

- 清算事件不是持续流，普通行情窗口可能没有样本。
- Binance forceOrder 是交易所自身 USDT-M futures 的强平快照，不代表全网清算。
- OKX liquidation-orders 是 OKX 自身清算订单频道，也不代表全网。

下一步：

- 继续扩充 replay fixture，优先寻找多头强平主导、价格收回、盘口恢复的窗口。
- 在高波动窗口复跑 capture。
- 把已有空头强平样本保留为 `short_squeeze_only` 对照，避免把空头挤压误判为 Spring。

低成本补充：

- CoinGlass：API 付费，当前先跳过真实验证；已有 dry-run 导入器留作未来可选路径。
- Velo：验证是否能提供清算聚合或派生指标，作为研究校验，不作为 tick 级主源。

### P1：全网清算与跨交易所聚合

影响：

- 影响 Spring 置信度和宏观清算背景，不直接阻塞第一版 Sensor。
- 单一交易所清算只能说明该交易所的杠杆重置，不能代表全市场流动性猎杀完成。
- 对“插针是否已经扫完主要流动性池”的判断，全网聚合明显优于单交易所流。

可选来源：

- CoinGlass：清算、OI、Funding、热力图和市场情绪聚合能力强，但当前因 API 付费暂不作为执行依赖。
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

- CoinGlass liquidation heatmap；当前因付费暂不作为执行依赖。
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

1. **P0 liquidation 长窗口采集**：优先恢复 Bybit / Binance / OKX 免费 WebSocket 24h 到 72h 采集，确认样本结构。
2. **P2 自建历史 replay**：落盘 trades、book_delta、OI、Funding 和 liquidation，先攒自己的 BTC 样本库。
3. **P1 付费聚合源评估**：CoinGlass / Tardis.dev / Kaiko 暂不作为当前执行依赖，等免费实时采集确认为瓶颈后再评估预算。
4. **P4 本地 CVD / Volume Profile**：用免费 trades 先算局部指标。
5. **P3 热力图**：暂缓，不作为第一阶段硬依赖。

## 对 Wyckoff 状态机的降级策略

数据缺口不应让系统停止工作，而应影响置信度：

- 缺 liquidation：输出 `insufficient_evidence`，不允许输出 `spring_candidate`。
- 清算样本为空头强平主导：输出 `short_squeeze_only`，不允许输出 `spring_candidate`。
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
