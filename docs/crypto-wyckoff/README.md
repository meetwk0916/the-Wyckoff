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

## 与现有工作区的关系

- 前端 Radar Console 可以复用为 crypto 监控面板。
- 数据契约应独立命名，避免把 `ptrade`、A 股交易时段、T+1 和券商接口假设带入 BTC。
- `crypto-workspace/` 承担采集、落盘、回放、Phase C evidence、候选分类、后续 paper trade 和交易所 sandbox 验证。

## 当前硬边界

- 不接真实交易所资金账户。
- 不存交易所 API key。
- 不把任何 crypto 面板描述成可直接实盘执行系统。
- 在没有历史回放和 paper trade 结果前，不实现自动下单。
