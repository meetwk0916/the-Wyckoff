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
- Phase C evidence 内的启发式结构支撑 / 收回上下文
- Phase C evidence 内的窗口级 spot / perp CVD 判据
- Phase C evidence 内的 funding 拥挤度上下文和 anchor 前后盘口 1m / 3m 分桶
- Phase C review index 与规则评分报告

待实现：

- 更完整的 normalized transform 层
- 更正式的结构支撑 / 阻力识别与人工标注索引
- spot CVD / perp CVD 阈值校准和跨样本复核
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

截至 2026-05-11，REST / WebSocket 探测、落盘、replay、fixture、Phase C evidence、启发式结构上下文、窗口级 CVD、保守分类、review index、规则评分和候选窗口扫描入口已经可用。当前下一步不再是继续做基础 probe，而是扩充可复核样本和结构 / CVD 复核：

1. 扩充 Phase C 样本集，优先寻找 `long liquidation + 价格收回 + 盘口恢复` 的 BTC 窗口。
2. 复核并强化当前 evidence 内的启发式结构支撑 / 阻力上下文，扩展 `reviews/phase-c-review-index.json`，避免只凭微观流判断 Spring。
3. 扩样本校准当前 spot / perp CVD 的 demand / supply 阈值和 divergence 解释。
4. 保留 `short_squeeze_only` 保护，防止把空头挤压误判成 Spring。
5. 至少做 20 个历史窗口人工复核，再进入 Phase D LPS paper trade。
6. 当本地样本不足成为真实瓶颈时，先恢复 Bybit `allLiquidation.BTCUSDT` 长跑采集。当前不走 OKX 手工下载路线，CoinGlass API 因付费先跳过；仍不够时再评估可程序化免费源或 Tardis.dev / Kaiko 等付费研究主源。

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

当前阶段只输出 price action、trade flow、book recovery、liquidation spike、OI 和 Funding 上下文；它不把窗口判定为 Spring，也不输出交易动作。Funding 现在只作为拥挤度上下文输出为 `crowded_long` / `crowded_short` / `neutral`，不单独作为 Spring 硬条件。

当前 evidence 还会输出 `structureContext`：用窗口锚点前后的 spot / perp trade 与 book mid 观测估算局部支撑、阻力、跌破深度、支撑收回、收回距离和 break 后恢复幅度。`structureContext.verdict` 会把 spot / perp 的支撑跌破与收回汇总为 `phaseCStructureSupport`、`supportBrokenCount`、`supportRecoveredCount` 和 `quality`。这个结构对象是人工复核输入，不是自动交易动作；在没有更大样本和人工标注前，它只作为保守过滤条件。

当前 evidence 还会输出 `cvdContext`：按 spot / perp trades 计算买卖 notional、CVD notional delta、delta ratio、demand / supply bias、spot-perp divergence 和 `phaseCFlowSupport`。`cvdContext.verdict` 会显式输出 `demandConfirmation`、`distributionRisk` 和判据理由，用于区分现货承接、永续砸盘或广谱卖压；当前 demand / supply 的 delta ratio 阈值仍是 5%，需要随样本扩充继续校准。

当前 evidence 还会输出 `derivativesContext.openInterestShock`：当窗口内 OI 至少有两个样本且跌幅达到 3% 以上时，标记为 `sharp_decrease` / `isDeleveraging=true`。这是对交易所爆仓流可能低报的交叉验证；未来 `spring_candidate` 必须有 OI 去杠杆确认，否则降为 `breakdown_risk` 或继续收集证据。

当前 `orderBookRecovery` 还会围绕 first liquidation 或窗口中点输出 pre-anchor、post-1m 和 post-3m 盘口分桶，记录 bid depth、ask depth 和 imbalance 的均值与变化。这个对象用于解释洗盘后压单撤退或承接改善，不替代 long liquidation、结构收回、CVD 支持和 OI 去杠杆这些核心条件。

Phase C 候选分类入口已经可用：

```bash
npm run crypto:phase-c:classify
```

当前分类标签限制为 `spring_candidate`、`breakdown_risk`、`short_squeeze_only` 和 `insufficient_evidence`。短仓强平主导的窗口会先归为 `short_squeeze_only`，避免把单纯空头挤压误判成 Spring；缺少 liquidation 的窗口继续归为 `insufficient_evidence`。
未来的 `spring_candidate` 还必须满足结构支撑跌破后收回和 Phase C CVD 支持，不能只依赖清算方向、低点反弹或盘口恢复。

Phase C review index 和规则评分入口已经可用：

```bash
npm run crypto:phase-c:check
npm run crypto:phase-c:review
npm run crypto:phase-c:verify
```

`crypto-workspace/reviews/phase-c-review-index.json` 记录固定人工标签、复核理由和机器可读因子。生成的 review report 会输出规则评分、待复核 / 已复核计数、系统标签与复核标签的一致性。规则评分现在也纳入 funding 拥挤度和 post-3m 盘口 ask depth retreat / imbalance improvement 组件，作为后续阈值校准证据。这个流程用于把人工复核沉淀为可编码规则，不是逐笔交易审批。

`crypto:phase-c:check` 会按顺序运行 evidence、classification、review 和 verify，避免 classification 读取旧 evidence report。`crypto:phase-c:verify` 会读取最新 classification / review / candidate reports，检查固定 short-squeeze 对照窗口和 insufficient-evidence 对照窗口的标签没有意外变化，并确认 review disagreement 仍为 0。候选扫描中的 long / short liquidation 数量只作为状态打印，不作为失败条件，避免未来抓到正样本时误报失败。

Phase C 候选窗口扫描入口已经可用：

```bash
npm run crypto:phase-c:candidates
```

它会扫描本地 raw JSONL，找出 BTC liquidation 事件，围绕清算时间生成候选窗口，检查 trade / book_delta / OI / Funding / liquidation 覆盖，并输出 fixture draft。当前本地 raw 数据扫描结果是 38,501 条 BTC 事件、1 条 BTC liquidation、0 个 long liquidation 候选和 1 个 short liquidation 对照窗口。这意味着当前最大瓶颈仍是缺少 `long liquidation + 价格收回 + 盘口恢复` 的正样本。

当前低门槛历史数据验证顺序：

1. 用 Bybit `allLiquidation.BTCUSDT` 增加免费实时 BTC liquidation 采集源；当前阻塞点是本机 DNS / 网络权限。
2. 继续用 Binance Vision 补 BTCUSDT spot / USDT-M futures trade 和 1m kline 历史上下文。
3. 暂不推进 OKX Historical Data 的手工下载 / 手工导入。
4. 暂不推进 CoinGlass 真实 API 下载；`crypto:history:coinglass` 仅作为未来有 key / 预算时的 dry-run 和导入入口。
5. 如果免费实时采集仍长期没有 long liquidation 样本，再评估可程序化免费源、CryptoHFTData 小窗口，或 Tardis.dev / Kaiko 级别的付费主源。

免费历史源探测入口已经可用：

```bash
npm run crypto:history:free-sources
npm run crypto:history:free-sources -- --provider=binance_vision --date=2026-05-09 --live
```

当前 Binance Vision 检查确认：BTCUSDT spot / USDT-M futures 的 aggTrades 和 1m klines 可用，但 2026-05-09 的 USDT-M `liquidationSnapshot` 404。它能补 trade / kline 历史，不能单独补 Phase C 清算正样本。

Binance Vision aggTrades / kline 导入入口已经可用：

```bash
npm run crypto:history:binance-vision -- --date=2026-05-09 --limit-rows=1000 --download
```

当前它会把 spot / USDT-M futures aggTrades ZIP 转成 normalized `trade` JSONL，用于 spot / perp CVD 计算；也会把 1m klines ZIP 转成 normalized `kline` JSONL，用于历史价格上下文。它仍不包含 liquidation，因此只能补上下文，不能单独构成 Phase C 正样本。

CoinGlass 聚合清算导入入口已经可用：

```bash
npm run crypto:history:coinglass -- --date=2026-05-09
COINGLASS_API_KEY=<key> npm run crypto:history:coinglass -- --date=2026-05-09 --download
```

它会把 BTCUSDT pair liquidation history 转成 normalized `liquidation` JSONL，但质量标记为 `aggregate_liquidation_context`。这类数据可用于寻找历史 long / short liquidation 窗口和构建混合 fixture，不可替代交易所逐笔清算证据。

截至 2026-05-12，CoinGlass API 真实下载因付费先跳过。跳过的影响是：短期无法快速用历史聚合清算补出 long liquidation 正样本；当前分类器仍能继续用 `short_squeeze_only`、结构恢复、CVD 和 OI shock 防止误判，但样本扩充速度会主要依赖免费实时采集或后续付费研究主源。

Bybit 实时 liquidation 补充入口：

```bash
npm run crypto:ws-probe -- --provider=bybit
npm run crypto:capture -- --provider=bybit --duration-sec=86400 --event-type=liquidation
npm run crypto:capture:status -- --screen=wyckoff_bybit_liq_capture_24h
npm run crypto:capture:status -- --screen=wyckoff_bybit_liq_capture_24h_heartbeat
screen -dmS wyckoff_bybit_liq_capture_7d_heartbeat npm run crypto:capture -- --provider=bybit --duration-sec=604800 --event-type=liquidation
npm run crypto:capture:status -- --screen=wyckoff_bybit_liq_capture_7d_heartbeat
npm run crypto:daily-check
```

Bybit `allLiquidation.BTCUSDT` 是 liquidation-only 源：它能提高免费实时 BTC 清算样本命中率，但不能替代 Binance / OKX 的 trade、book、OI、Funding 上下文。心跳版 24h screen 使用 `wyckoff_bybit_liq_capture_24h_heartbeat`；日常监控优先使用 7d screen `wyckoff_bybit_liq_capture_7d_heartbeat`。`capture:status` 会精确匹配 screen 名称，并输出 BTC long / short liquidation 计数、provider status 计数，以及最新事件和最新 provider status 的来源文件。日常复核优先跑 `npm run crypto:daily-check`，它会同时刷新 capture status 和 Phase C candidate scan。
