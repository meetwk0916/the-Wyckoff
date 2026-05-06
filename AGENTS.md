# AGENTS

## 项目意图

这个仓库是一个独立的 Wyckoff Radar MVP 工作区。它不是聊天项目，也不是实盘交易系统。

当前产品目标是先把 Wyckoff 策略监控流程做成可见的操作台，再逐步接入真实数据与执行链路。

## 优先阅读

1. `README.md`
2. `docs/wyckoff-mvp/PRD.md`
3. `docs/wyckoff-mvp/IMPLEMENTATION-PATH.md`
4. `docs/wyckoff-mvp/MVP.md`
5. `docs/wyckoff-mvp/TEST-CASES.md`

## 当前状态

- 基于 Vite + React 的单页控制台
- 已包含监控列表、过滤器、预警流、指标卡片、检查面板
- 仪表盘数据契约位于 `src/data/wyckoffMockData.js`
- 当前没有后端，也没有券商接入
- 手工验收用例已整理完毕

## 常用命令

- `npm install`
- `npm run dev`
- `npm run lint`
- `npm run build`

## 工作规则

- 保持项目独立，不与其他工作区混用。
- 不要把当前产品表述成可直接执行交易的系统。
- 优先继续抽离数据契约和数据访问层，而不是继续膨胀 `src/App.jsx`。
- 只要 UI 行为变化，就同步更新 `docs/wyckoff-mvp/TEST-CASES.md`。
- 进行实质性改动后，运行 `npm run lint` 和 `npm run build`。

## 推荐下一步

1. 将 JS 模拟数据替换为本地 JSON 或 mock API 层。
2. 为过滤、预警确认和标的选择补自动化 UI 测试。
3. 在测试就位后，把页面拆成更小的控制台组件。
