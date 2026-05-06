# Wyckoff Radar Implementation Path

## 1. 当前状态

项目当前是一个独立的 Vite + React 前端工作区，已经完成：

- 单页 Dashboard
- Watchlist / Alerts / Metrics 展示
- 过滤与 session 持久化
- Selected symbol inspection panel
- 本地 contract fixture 抽离到 `src/data/wyckoffMockData.js`
- 手工验收文档与 Sprint 规划

当前不是生产系统，也不依赖任何后端。

## 2. 当前代码结构

- `src/App.jsx`: 当前主页面容器与 UI 行为
- `src/data/wyckoffMockData.js`: watchlist / alerts / system status contract fixture
- `src/app.css`: 当前界面样式
- `docs/wyckoff-mvp/PRD.md`: 产品需求文档
- `docs/wyckoff-mvp/MVP.md`: MVP 边界
- `docs/wyckoff-mvp/SPRINTS.md`: Sprint 路线图
- `docs/wyckoff-mvp/TEST-CASES.md`: 验收与回归检查

## 3. 推荐实施顺序

### 阶段 1：稳定数据边界

目标：把前端从“直接依赖 JS 常量”推进到“依赖可替换的数据源”。

建议任务：

1. 把 fixture 下沉为 `public/mock/` JSON 或本地 mock API。
2. 在 `src` 中新增 data access 层，例如 `src/lib/contracts.js` 或 `src/lib/loadDashboardSnapshot.js`。
3. 保持 UI 对 contract 的消费接口稳定，不让组件知道数据来自本地还是远端。

完成标准：

- `App.jsx` 不再直接 import 大块 fixture 常量。
- watchlist / alerts / system status 可以整体替换。

### 阶段 2：自动化验证

目标：避免每次 agent 改动都靠人工点页面回归。

建议任务：

1. 引入 Vitest + Testing Library。
2. 为以下行为补测试：
   - phase filter
   - status filter
   - alert acknowledgement
   - selected symbol inspection fallback
3. 保留现有 `TEST-CASES.md` 作为人工回归基线。

完成标准：

- 至少覆盖当前 Dashboard 的关键交互路径。
- `npm run test` 可作为后续 agent 的第一道回归门。

### 阶段 3：组件解耦

目标：把 `App.jsx` 从页面总装函数拆成更清晰的领域组件。

建议任务：

1. 抽出 `DashboardHeader`
2. 抽出 `WatchlistTable`
3. 抽出 `InspectionPanel`
4. 抽出 `AlertStream`
5. 抽出 `ScopeNotes`

完成标准：

- 页面逻辑与展示逻辑分离。
- 组件 props 以 contract 为中心，而不是依赖全局常量。

### 阶段 4：接入本地服务接口

目标：为未来策略服务接入打桩，而不是直接碰实盘。

建议任务：

1. 提供 `/api/dashboard-snapshot` 或等价 mock endpoint。
2. 提供 `/api/alerts` 或同类接口。
3. 提供 `system status` 的健康状态返回。
4. 页面端改为加载异步数据并处理 loading/error/degraded 状态。

完成标准：

- UI 可以在不 reload 的情况下处理数据刷新。
- 失败状态对用户可见，而不是静默失败。

### 阶段 5：策略语义增强

目标：逐步把“结构展示”推进到“策略检查工作台”。

建议任务：

1. 引入更明确的 phase transition timeline。
2. 展示风险 veto 原因对象化结果。
3. 为 L2 验证状态预留更细粒度字段。
4. 增加 symbol-level audit notes。

完成标准：

- inspection panel 不只是展示数字，而是能解释状态变化与阻断原因。

## 4. 当前最优下一步

如果只选一个切口，优先做：

1. 本地 JSON / mock API 化 fixture
2. 自动化测试

原因：

- 这两步能显著提高后续 agent 接手的稳定性。
- 先碰数据边界和测试，比先大拆组件更不容易返工。

## 5. 变更原则

- 不要把新的业务字段重新塞回 `App.jsx` 顶部常量。
- 不要在没有 contract 的情况下直接为远端接口写死字段名。
- 不要把“监控原型”误包装成“可执行交易产品”。
- 每次新增交互，都要同步更新 `TEST-CASES.md`。

## 6. 后续 Agent 进入方式

建议任何接手 agent 先按这个顺序读取：

1. `README.md`
2. `AGENTS.md`
3. `docs/wyckoff-mvp/PRD.md`
4. `docs/wyckoff-mvp/IMPLEMENTATION-PATH.md`
5. `docs/wyckoff-mvp/TEST-CASES.md`
6. `src/data/wyckoffMockData.js`
7. `src/App.jsx`

## 7. 发布前最低检查

- `npm run lint`
- `npm run build`
- 文档链接有效
- README 中能找到 PRD 与实施路径
