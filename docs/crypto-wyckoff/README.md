# Crypto Wyckoff 工作区说明

这个目录记录 BTC / crypto 方向的产品目标、数据源选择和实施顺序。

当前结论：crypto 路线应作为独立工作面推进，已新增 `crypto-workspace/`，并且不要混进 `ptrade-workspace/`。ptrade 仍然服务 A 股券商运行时；crypto 路线服务 BTC 24/7 市场、永续合约、跨交易所订单流和衍生品指标。

## 当前定位

BTC 方向的第一目标不是预测能涨到哪里，也不是直接接实盘交易所下单。

第一目标是建立一套能回答下面问题的数据与回放系统：

1. 当前价格跌破结构支撑时，是真实破位，还是 Phase C 流动性猎杀后的 Spring 候选。
2. 价格收回区间时，现货需求、永续仓位、资金费率、清算和盘口承接是否互相印证。
3. 后续进入 Phase D 后，是否出现供给枯竭的 LPS 右侧击球区。

## 文档入口

- `GOALS.md`：以终为始的最终目标、非目标和成功准则。
- `DATA-SOURCES.md`：统一数据源研究、候选供应商和当前推荐。
- `IMPLEMENTATION-PATH.md`：阶段拆解、退出标准和下一步切口。
- `VALIDATION-LOG.md`：本地数据源探测记录和当前网络可达性结论。

## 当前推荐

先做“洗盘过滤器”，后做 P&F 目标预测引擎。

原因：

- BTC 的最大误判风险不是 target 算错，而是把清算插针误读成 Spring。
- Spring 真伪必须同时看价格结构、现货 / 永续 CVD、OI、Funding、清算和盘口恢复。
- P&F 目标适合在结构确认后做空间测算，不适合作为第一阶段的胜率来源。

截至 2026-05-17，Phase C evidence 已加入启发式结构上下文：从窗口内 spot / perp trade 和 book mid 观测估算局部支撑 / 阻力，并记录跌破后是否收回。该字段只用于候选解释和人工复核，不输出交易动作。

已新增 Phase C review index、规则评分报告和 `crypto:phase-c:check` 守门链路，用来把人工复核沉淀成机器可读标签、理由和因子，并防止固定对照样本标签漂移。它服务规则校准，不是上线后的逐笔人工审批。

已新增第一版窗口级 spot / perp CVD 判据：每个窗口会输出 CVD notional delta、delta ratio、demand / supply bias、spot-perp divergence 和 Phase C flow support。该判据进入候选过滤和规则评分，但阈值仍需要通过更多复核样本校准。

已新增 Funding crowding 与 post-anchor 1m / 3m 盘口变化上下文。它们只作为校准与解释证据，不替代 long liquidation、结构收回、盘口恢复、CVD 支持和 OI 去杠杆这些 Spring 硬闸门。

已新增 Phase C 候选窗口扫描：从本地 raw JSONL 自动寻找 BTC liquidation 窗口并生成 fixture draft。当前固定回归集已有 3 个窗口：`short_squeeze_only`、`breakdown_risk` 和 `insufficient_evidence`。其中 OKX long liquidation 窗口满足“长清算 + 结构收回”的表层形态，但 CVD、盘口恢复和 OI 去杠杆不确认，因此被固化为 `breakdown_risk` 负样本；当前还没有 `spring_candidate` 样本是正常状态。

已把 Bybit `allLiquidation.BTCUSDT` 接入为免费实时 liquidation-only 补充源。当前推荐使用心跳版长跑 session `wyckoff_bybit_liq_capture_7d_heartbeat`，并用 `npm run crypto:daily-check` 或 `npm run crypto:capture:status -- --screen=wyckoff_bybit_liq_capture_7d_heartbeat` 监控；trade、book、OI 和 Funding 上下文仍由 Binance / OKX 或历史导入补齐。若日报同时出现 `capture_connected_no_payload` 和 `long_liquidation_candidate_available`，表示 Bybit / 最新 provider status 可能静默，但本地 OKX/Binance raw 数据里已有可复核候选，需要继续分源审查。

## 与现有工作区的关系

- 前端 Radar Console 可以复用为 crypto 监控面板。
- 数据契约应独立命名，避免把 `ptrade`、A 股交易时段、T+1 和券商接口假设带入 BTC。
- `crypto-workspace/` 承担采集、落盘、回放、Phase C evidence、候选分类、后续 paper trade 和交易所 sandbox 验证。

## 当前硬边界

- 不接真实交易所资金账户。
- 不存交易所 API key。
- 不把任何 crypto 面板描述成可直接实盘执行系统。
- 在没有历史回放和 paper trade 结果前，不实现自动下单。
