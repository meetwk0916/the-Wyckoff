# Wyckoff Radar PRD

## 1. 背景

该项目用于把基于 Wyckoff 结构分析的选股与交易监控流程，先产品化为一个可视、可检查、可交付的前端工作台，再逐步接入状态服务、验证服务与执行链路。

当前阶段不是做自动交易系统，而是先把研究和执行前的人机协同界面做对。产品需要让策略 owner、研究员和后续工程 agent 能快速回答同一组问题：

1. 当前在监控哪些标的。
2. 哪些标的接近可操作状态。
3. 哪些标的被风险收益或确认缺失阻断。
4. 当前需要人工关注的信号是什么。

## 2. 产品目标

### 2.1 核心目标

- 把 Wyckoff 候选标的的状态从“脑内逻辑”变成“可见对象”。
- 让阶段、风险收益、L2 验证状态和人工复核优先级在一个界面中完成对齐。
- 为后续 agent 提供稳定的数据契约和实施路线，而不是让每一轮都从零理解业务。

### 2.2 非目标

- 当前版本不接入 ptrade、QMT 或任何真实交易执行。
- 当前版本不接入实时行情、L2 实盘数据或消息推送服务。
- 当前版本不覆盖用户权限、审计合规、回测基础设施和生产部署。

## 3. 目标用户

### 3.1 策略 Owner

- 关注产品是否忠实表达策略流程。
- 需要快速审阅候选标的、阶段判断和阻断原因。

### 3.2 研究 / 交易操作员

- 关注哪些标的可以进入人工复核。
- 需要从时间线、入场区间、止损和验证状态判断是否继续跟进。

### 3.3 后续工程 Agent

- 关注当前数据契约、功能边界和下一步最合适的工程切口。
- 需要明确哪些模块是 fixture、哪些是未来服务替换点。

## 4. 产品范围

### 4.1 当前已实现范围

- Dashboard 单页入口
- Watchlist matrix
- Phase / Signal filters
- Derived metrics
- Alert acknowledgement
- Selected symbol inspection panel
- Seeded contract fixture
- 文档先行：MVP、PRD、Sprint 规划、测试用例、实施路径

### 4.2 下一阶段范围

- 将 fixture 替换为本地 JSON 或 mock API
- 引入 watchlist snapshot / alerts / system status 的统一 contract
- 增加 symbol detail timeline 的数据来源边界
- 补自动化测试

### 4.3 明确排除范围

- 实盘下单
- 券商适配
- 用户体系
- 生产环境后端
- 消息通知中心

## 5. 关键使用场景

### 场景 A：开盘后快速巡检

用户打开控制台，查看当前所有标的的结构阶段、风险收益与信号状态，并优先筛出可复核标的。

### 场景 B：对单一标的做结构检查

用户点击 watchlist 中某个标的，在 inspection panel 里检查 thesis、入场区间、止损、信心分数、L2 状态与时间线，判断是否继续跟进。

### 场景 C：对阻断原因做快速解释

用户在被拦截标的上看到当前不是“没有机会”，而是“当前点位或验证条件不满足”。

## 6. 功能需求

### FR-1 Watchlist 可视化

- 展示 symbol、phase、subPhase、support、resistance、currentPrice、volumeState、riskReward、targetPrice、status。

### FR-2 过滤能力

- 支持按 phase 过滤。
- 支持按 signal status 过滤。

### FR-3 指标汇总

- 页面顶部指标必须来自当前过滤后的 watchlist，而不是写死值。

### FR-4 Alert 队列

- 展示 alert 时间、类型、标的和摘要。
- 支持在当前 session 内标记已确认。

### FR-5 Symbol Inspection

- 点击标的后展示该 symbol 的 thesis、entry zone、hard stop、target、confidence、next check 和 timeline。
- 若当前选中标的被过滤移除，inspection panel 自动回退到当前可见列表中的首个标的。

### FR-6 文档与交接

- 项目根目录必须能让新 agent 快速定位 PRD、MVP、实施路径和当前状态。

## 7. 成功标准

### 7.1 产品层

- 首次打开页面的人可以在 1 分钟内理解这不是聊天页，而是交易监控台。
- 可以明确区分可复核、待验证、被拦截、构建中四类状态。
- 可以对任一标的做最小闭环检查，不需要读代码。

### 7.2 工程层

- `npm run build` 通过。
- `npm run lint` 通过。
- 关键状态对象已从 UI 组件中拆出，便于后续替换为服务数据。

## 8. 约束与风险

- 策略本体远比 MVP 当前表达复杂，不能误导为“接近实盘”。
- L2 验证是高价值模块，但也是高耦合模块，必须延后接入。
- 如果没有清晰的 contract，后续 agent 很容易重新把状态塞回组件内部，造成可维护性退化。

## 9. 文档导航

- `MVP.md`: 当前最小可交付物边界
- `SPRINTS.md`: 迭代节奏和分阶段目标
- `TEST-CASES.md`: 手工验收与回归检查
- `IMPLEMENTATION-PATH.md`: 工程实施顺序和下一步切口
