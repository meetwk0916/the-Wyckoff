# AGENTS

## 项目意图

这个仓库是一个独立的 Wyckoff Radar MVP 工作区。它不是聊天项目，也不是实盘交易系统。

当前产品目标是先把 Wyckoff 策略监控流程做成可见的操作台，再逐步接入真实数据与执行链路。

当前对接优先级已经明确：ptrade 相关能力按三阶段推进，其中 Phase 1 获取 L2 订单流是后续首要功能。

## 优先阅读

1. `README.md`
2. `docs/wyckoff-mvp/PRD.md`
3. `docs/wyckoff-mvp/IMPLEMENTATION-PATH.md`
4. `docs/wyckoff-mvp/MVP.md`
5. `docs/wyckoff-mvp/TEST-CASES.md`
6. `docs/wyckoff-mvp/PTRADE-INTEGRATION.md`

## 当前状态

- 基于 Vite + React 的单页控制台
- 已包含监控列表、过滤器、预警流、指标卡片、检查面板
- 仪表盘数据快照位于 `public/mock/wyckoff-dashboard.json`，通过 `src/lib/loadDashboardSnapshot.js` 接入
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

1. 启动 ptrade Phase 1：打通 L2 订单流获取、标准化、录制与回放。
2. 将本地 JSON 快照继续演进为 mock API 层，并拆分 `watchlist`、`alerts`、`system status` 的加载边界。
3. 为过滤、预警确认和标的选择补自动化 UI 测试。
