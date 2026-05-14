# ptrade Wyckoff 工作区

这个目录是当前项目临时隔离出来的 ptrade 专用工作区，目标是把前端原型与 ptrade 回测 / 模拟盘策略分开管理。

## 当前阶段状态

截至 2026-05-14：

- 已完成 canonical 脚本的一轮真实参数回测，确认报告、状态记忆、试仓升级和 runner 管理主路径可运行。
- 已在实际 ptrade 环境验证 `ptrade_phase1_validation.py` 的 JSON / sqlite3 无 HTTP 默认落盘链路可用。
- 已补 `on_order_response` / `on_trade_response` 主推事件记录，以及 `get_all_orders` / `get_all_positions` 账户级巡检报告。
- 当前待现场验证的是模拟盘里的主推 / 轮询 / 账户级巡检、订单 / 成交 / 持仓 / 报告闭环、交易时段 L2 / 逐笔权限验证、`cancel_order` 重报价与次日对账。
- ptrade 仍是把这套策略推进到受控自动化交易阶段的主试验场，但自动化执行尚未启用。

## 当前分支边界

- 建议从当前整理后的基线切 ptrade 专用分支，后续优先聚焦 `strategy/`、`config/`、`state/` 和 `../docs/ptrade-wyckoff/`。
- `main` 保留共享文档、共享前端和多工作线共用的稳定入口；不要把仅限 ptrade 实验的临时结论直接混回前端主线叙事。

## 文件

- `strategy/ptrade_wyckoff_trader.py`：复制到 ptrade 股票策略中的唯一主策略文件。
- `config/ptrade-wyckoff-policy-pool.json`：政策面 / 基本面前置标的池样例。
- `state/`：说明 ptrade 运行时状态记忆文件的边界。
- `ptrade.code-workspace`：只打开本目录的 VS Code 工作区文件。

## 当前策略输入

策略已经把 Wyckoff 判断拆成以下输入层：

1. 静态标的池：先过滤政策预期支撑或基本面困境反转标的。
2. 长周期量价：用 120 日均线和背景跌幅确认是否具备积累阶段前提。
3. RS / Beta：用沪深 300 对比个股相对强度与系统风险暴露。
4. L2 深度盘口：读取买卖档位并计算订单簿失衡度。
5. 逐笔成交：读取成交方向并计算 CVD。
6. 状态记忆：用 `ptrade-wyckoff-state.pkl` 保存阶段、支撑阻力和 P&F 横向栏数近似值。

## ptrade 使用方式

1. 在 ptrade 中新建股票策略。
2. 粘贴 `strategy/ptrade_wyckoff_trader.py` 的内容。
	ptrade 路线文档统一从 `../docs/ptrade-wyckoff/README.md` 进入；当前操作说明见 `../docs/wyckoff-mvp/PTRADE-TRADING.md`。
3. 如果要使用静态标的池文件，把 `config/ptrade-wyckoff-policy-pool.json` 放到 ptrade 的 `get_research_path()` 返回目录。
4. 先用回测运行，确认日志里能看到 `Wyckoff ptrade report => ...`。
5. 再进入模拟盘验证订单、成交、持仓和状态文件。

## 重要限制

- 当前默认会尝试读取 L2 和逐笔成交，但不会强制阻塞回测入场；如需严格依赖微观结构，把 `g.require_l2_for_entry` 和 `g.require_trade_stream_for_entry` 改为 `True`。
- 如果回测环境不支持 `get_snapshot()` 或逐笔成交接口，策略会在首次失败后把该能力缓存为不可用，避免后续每天重复探测并刷 warning。
- 日终报告里 `l2DataAvailable` / `tradeStreamDataAvailable` 表示数据是否真的拿到，`l2Confirmed` / `tradeStreamConfirmed` 表示是否通过微观确认，`l2GateReady` / `tradeStreamGateReady` 表示这一层当前是否参与阻塞入场。
- 日终报告里的 `orderResponseEvents` / `tradeResponseEvents`、`accountAudit` 和 `executionReconciliation` 用于模拟盘核对主推、轮询、账户级委托 / 持仓和策略状态是否一致。
- 本地可用 `npm run ptrade:paper-report:check -- --report=<report-path>` 先检查模拟盘日终报告字段和对账摘要。
- ptrade 回测环境是否返回真实 L2 / 逐笔数据取决于账号权限、数据订阅和回测能力。
- Phase 0 当前默认先走 `get_research_path()` 下的 JSON / sqlite3 持久化；HTTP relay 只作为本地联调或额外能力探测，不是默认主路径。
- 当前仍不是无人工闸门的实盘系统。
