# AGENTS

## 项目意图

这个仓库是一个独立的 Wyckoff Radar MVP 工作区。它不是聊天项目，也不是实盘交易系统。

当前产品目标是先把 Wyckoff 策略监控流程做成可见的操作台，再逐步接入真实数据与执行链路。

当前对接优先级已经明确：ptrade 相关能力按 Phase 0 环境预检查、Phase 1 回测 / 模拟盘 / 交易报告闭环、Phase 2 L2 / 逐笔增强与统一契约、Phase 3 实盘执行与风控闸门推进；当前主线是 Phase 1，真实 L2 / 逐笔权限验证属于紧随其后的 Phase 2 入口条件。

## 优先阅读

1. `README.md`
2. `docs/wyckoff-mvp/PRD.md`
3. `docs/wyckoff-mvp/IMPLEMENTATION-PATH.md`
4. `docs/wyckoff-mvp/MVP.md`
5. `docs/wyckoff-mvp/TEST-CASES.md`
6. `docs/wyckoff-mvp/PTRADE-INTEGRATION.md`
7. `docs/wyckoff-mvp/PTRADE-TRADING.md`

## 当前状态

- 基于 Vite + React 的单页控制台
- 已包含监控列表、过滤器、预警流、指标卡片、检查面板
- 仪表盘数据快照位于 `public/mock/wyckoff-dashboard.json`，通过 `src/lib/loadDashboardSnapshot.js` 接入
- 已包含本地 `ptrade bridge`、L2 订单流样例接口和前端联调面板
- 已新增 `ptrade-workspace/`，作为 ptrade 回测 / 模拟盘策略的临时隔离工作区
- ptrade 内唯一应复制和运行的主脚本为 `ptrade-workspace/strategy/ptrade_wyckoff_trader.py`
- ptrade 策略侧已接入静态标的池、长周期量价、RS / Beta、L2 订单簿失衡、逐笔 CVD 和 pickle 状态记忆
- 已完成 canonical ptrade 脚本的一轮真实参数回测，已验证报告 / 状态记忆 / 试仓升级 / runner 重锚主路径
- 当前默认以 soft gate 方式允许无 L2 / 逐笔环境下降级回测；真实交易时段权限验证仍未完成
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

1. 在 ptrade 模拟盘验证 `ptrade-workspace/strategy/ptrade_wyckoff_trader.py` 的订单、成交、持仓、报告和状态记忆闭环。
2. 在真实 ptrade 交易时段验证 L2 / 逐笔成交权限，并决定何时把 `require_l2_for_entry` / `require_trade_stream_for_entry` 切为强制闸门。
3. 增加基于 `cancel_order` 的超时撤单 / 重报价，以及基于 `get_deliver()` / `get_fundjour()` 的次日对账。
4. 继续完善 cause count、失败结构识别和严格微观确认，把 ptrade 作为自动化交易前的主试验场推进。
5. 将本地 `ptrade bridge` 从 `mock` 模式切到真实上游连接，并统一前端与策略侧的数据契约。
6. 为过滤、预警确认、标的选择和 ptrade bridge 状态补自动化 UI 测试。
