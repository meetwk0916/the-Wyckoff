# AGENTS

## 项目意图

这个仓库是一个独立的 Wyckoff Radar MVP 工作区。它不是聊天项目，也不是实盘交易系统。

当前产品目标是先把 Wyckoff 策略监控流程做成可见的操作台，再逐步接入真实数据与执行链路。

当前对接优先级已经明确：ptrade 相关能力按 Phase 0 环境预检查、Phase 1 回测 / 模拟盘 / 交易报告闭环、Phase 2 L2 / 逐笔增强与统一契约、Phase 3 实盘执行与风控闸门推进；当前主线是 Phase 1，真实 L2 / 逐笔权限验证属于紧随其后的 Phase 2 入口条件。

BTC / crypto 方向是独立工作面，先阅读 `docs/crypto-wyckoff/README.md`、`GOALS.md`、`DATA-SOURCES.md`、`IMPLEMENTATION-PATH.md` 和 `VALIDATION-LOG.md`，再看 `crypto-workspace/README.md`。它当前只做数据采集、事件契约、历史回放、Phase C 证据聚合、候选分类和 paper trade 路线设计，不接真实交易所资金账户。

## 优先阅读

1. `README.md`
2. `docs/wyckoff-mvp/PRD.md`
3. `docs/wyckoff-mvp/IMPLEMENTATION-PATH.md`
4. `docs/wyckoff-mvp/MVP.md`
5. `docs/wyckoff-mvp/TEST-CASES.md`
6. 如处理 ptrade 路线，先读 `docs/ptrade-wyckoff/README.md`、`GOALS.md`、`IMPLEMENTATION-PATH.md` 和 `NO-HTTP-DATA-EXCHANGE.md`
7. 如需要 ptrade 操作细节，再读 `docs/wyckoff-mvp/PTRADE-TRADING.md`、`PTRADE-INTEGRATION.md` 和 `PTRADE-VALIDATION.md`
8. 如处理 BTC / crypto 路线，再读 `docs/crypto-wyckoff/README.md` 和 `crypto-workspace/README.md`

## 当前状态

- 基于 Vite + React 的单页控制台
- 已包含监控列表、过滤器、预警流、指标卡片、检查面板
- 仪表盘数据快照位于 `public/mock/wyckoff-dashboard.json`，通过 `src/lib/loadDashboardSnapshot.js` 接入
- 已包含本地 `ptrade bridge`、L2 订单流样例接口和前端联调面板
- 已新增 `ptrade-workspace/`，作为 ptrade 回测 / 模拟盘策略的临时隔离工作区
- ptrade 内唯一应复制和运行的主脚本为 `ptrade-workspace/strategy/ptrade_wyckoff_trader.py`
- ptrade 策略侧已接入静态标的池、长周期量价、RS / Beta、L2 订单簿失衡、逐笔 CVD 和 pickle 状态记忆
- 已完成 canonical ptrade 脚本的一轮真实参数回测，已验证报告 / 状态记忆 / 试仓升级 / runner 重锚主路径
- 已在实际 ptrade 环境验证 `get_research_path()` + JSON + sqlite3 的 Phase 0 无 HTTP 基线，`ptrade_phase1_validation.py` 默认先走本地持久化
- Windows relay 仅保留为客户端本地联调工具，不再默认视为 ptrade 真正运行环境的目标地址
- 当前默认以 soft gate 方式允许无 L2 / 逐笔环境下降级回测；真实交易时段权限验证仍未完成
- 当前没有生产后端，也没有真实券商上游接入；仓库内已有本地 ptrade bridge / relay 联调工具
- BTC / crypto 方向已有 `crypto-workspace/`，包含 REST / WebSocket 探测、capture、replay、fixture、Phase C evidence 和 Phase C classification 工具
- 当前 BTC 固定 fixture 中，真实清算窗口被分类为 `short_squeeze_only`，无清算对照窗口被分类为 `insufficient_evidence`；当前还没有 `spring_candidate` 样本
- 手工验收用例已整理完毕

## 常用命令

- `npm install`
- `npm run dev`
- `npm run lint`
- `npm run build`
- `npm run ptrade:relay`
- `npm run ptrade:bridge`
- `npm run crypto:fixtures`
- `npm run crypto:phase-c:evidence`
- `npm run crypto:phase-c:classify`
- `npm run crypto:phase-c:review`
- `npm run crypto:phase-c:verify`
- `npm run crypto:phase-c:check`
- `npm run crypto:capture:status -- --screen=wyckoff_bybit_liq_capture_24h_heartbeat`

## 工作规则

- 保持项目独立，不与其他工作区混用。
- 不要把当前产品表述成可直接执行交易的系统。
- 优先继续抽离数据契约和数据访问层，而不是继续膨胀 `src/App.jsx`。
- 只要 UI 行为变化，就同步更新 `docs/wyckoff-mvp/TEST-CASES.md`。
- BTC / crypto 方向不得混入 `ptrade-workspace/`；新增实现时应使用独立 `crypto-workspace/`。
- BTC / crypto 第一阶段只允许做数据源验证、落盘、回放、洗盘过滤和 paper trade 设计，不要接真实资金账户或保存交易所 API key。
- 进行实质性改动后，运行 `npm run lint` 和 `npm run build`。

## 推荐下一步

1. BTC 路线：扩充 Phase C 样本集，优先寻找 `long liquidation + 价格收回 + 盘口恢复` 的窗口。
2. BTC 路线：当前不走 OKX 手工数据导入；CoinGlass 真实 API 因付费先跳过。优先恢复 Bybit 免费实时清算长跑采集，继续用 Binance Vision 补 trade / kline 上下文。
3. BTC 路线：补结构支撑 / 阻力识别和正式 spot/perp CVD 判据，再做 20 个历史窗口人工复核。
4. ptrade 路线：在模拟盘验证 `ptrade-workspace/strategy/ptrade_wyckoff_trader.py` 的订单、成交、持仓、报告和状态记忆闭环。
5. ptrade 路线：在真实 ptrade 交易时段验证 L2 / 逐笔成交权限，并决定何时把 `require_l2_for_entry` / `require_trade_stream_for_entry` 切为强制闸门。
