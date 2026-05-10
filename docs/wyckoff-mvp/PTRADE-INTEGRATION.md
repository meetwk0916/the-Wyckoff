# ptrade 对接分阶段说明

## 背景

当前产品路线已经调整：ptrade 不是一个最后才补的边缘适配器，而是 Wyckoff 2.0 后续能力里的关键基础设施。

但当前优先级已经进一步收口：先把 ptrade 策略隔离到专用工作区，在官方运行时内部打通“标的池 -> 宏观过滤 -> 微观确认 -> 回测 -> 模拟盘 -> 交易报告 -> 状态记忆”的闭环。

这意味着此前的 L2 验证仍然重要，但它现在要进入策略侧的真实数据输入边界；是否强制阻塞入场由策略参数控制。

ptrade 的完整目标、成功准则和硬闸门已迁移到 `../ptrade-wyckoff/`；本文件只保留对接边界、bridge 角色和消费路径说明。

## 当前仓库状态

- 已落地本地 `ptrade bridge` 服务骨架
- 已提供 L2 订单流样例接口和前端联调面板
- 已验证 ptrade 运行时账号绑定、本地落盘和基础网络边界
- 已补充最小环境验证脚本 `ptrade_phase1_validation.py`
- 已新增 ptrade 原生策略主脚本 `ptrade-workspace/strategy/ptrade_wyckoff_trader.py`
- 已新增回测 / 模拟盘操作说明 `PTRADE-TRADING.md`
- 已新增隔离目录 `ptrade-workspace/`
- 策略侧已接入 L2 订单簿失衡、逐笔 CVD、长周期量价、RS / Beta、静态标的池和 pickle 状态记忆
- 当前前端默认仍是 `mock` 模式，不代表真实 ptrade 已接通

说明：ptrade 内实际复制和运行时以 `ptrade-workspace/strategy/ptrade_wyckoff_trader.py` 为准；脚本说明集中保留在 `PTRADE-TRADING.md`，不再维护 docs 目录下的镜像策略文件。

## 当前阶段状态

截至 2026-05-08：

- Phase 0 的账号 / 落盘 / 网络边界预检查已经成形，且已在实际 ptrade 环境验证研究目录 JSON / sqlite3 默认落盘可用。
- Phase 1 已完成 canonical 脚本的一轮真实参数回测，当前缺口不再是“能不能跑”，而是“模拟盘订单闭环、交易时段微观权限、执行恢复与对账”。
- Phase 2 现在的关键阻塞不是前端面板，而是真实交易时段的 L2 / 逐笔可用性与统一数据契约。
- Windows relay 只保留为客户端本地联调工具，不再默认代表 ptrade 运行环境中的真实 HTTP 目标。
- ptrade 仍是把这套策略推进到完整自动化交易阶段的主试验场，但进入 Phase 3 前必须先补齐模拟盘、强制微观确认、撤单重试、次日对账与风险闸门。

## 官方文档确认后的推荐路径

结合官方帮助中心、策略示例、现货接口和业务公共接口，当前更推荐的实现方式是：

1. 先用 `ptrade_phase1_validation.py` 做 Phase 0 环境预检查，默认优先写研究目录 JSON 与 sqlite3。
2. 再用 `ptrade-workspace/strategy/ptrade_wyckoff_trader.py` 直接在 ptrade 内跑回测和模拟盘。
3. 策略内优先使用官方已经明确支持回测 / 交易的接口：
	- `order`
	- `cancel_order`
	- `get_open_orders`
	- `get_orders`
	- `get_trades`
	- `get_position`
	- `get_positions`
4. 每个交易日结束把策略状态、订单、成交和持仓汇总为 JSON 报告，并在需要共享或检索时追加写入 sqlite3。
5. 只有在券商环境明确支持、且现场验证可达时，才把 HTTP / relay 加回增强链路；否则默认沿用文件 / sqlite3 / 回放路径。
6. 在真实交易时段验证 L2 与逐笔成交权限，再把严格微观确认开关切为必需。

这样做的原因是：

- 官方客户端本身已经把“新建回测”和“新建交易”作为一等能力。
- 现货接口里的 `order(...)` 明确支持回测和交易。
- `order_target` / `order_target_value` 虽然也支持回测和交易，但官方文档明确提示交易场景可能因为持仓同步滞后导致重复下单，因此当前骨架优先使用 `order` 做 delta 下单。
- 官方 FAQ 已明确 ptrade 默认运行环境封闭、无法假设外网，且内置 `sqlite3`，因此 JSON / sqlite3 比 HTTP relay 更适合作为默认交换层。
- 交易详情界面天然就有评价指标、交易明细、持仓明细和交易日志，适合先把最小闭环跑通。
- L2 和逐笔成交已经进入策略输入层，但默认不阻塞回测；真实权限验证后再切为强制闸门。

当前仓库中与这条路径直接相关的文件有：

- `ptrade_phase1_validation.py`
- `PTRADE-VALIDATION.md`
- `ptrade-workspace/strategy/ptrade_wyckoff_trader.py`
- `ptrade-workspace/config/ptrade-wyckoff-policy-pool.json`
- `PTRADE-TRADING.md`

## Phase 0：环境预检查

当前定位：已具备最小可用脚本，应当继续作为上线前检查。

### 目标

- 验证账号绑定是否正确。
- 验证本地落盘是否可用。
- 验证 L2 权限和网络边界是否满足下一步联调。

### 关键交付物

- `ptrade_phase1_validation.py`
- `PTRADE-VALIDATION.md`

### 完成标准

- 能拿到登录账号和绑定账号。
- 能把结果写到 `/home/fly/notebook/` 下的 JSON 和 sqlite3。
- 能区分 L2 未授权、非交易时段和网络不可达这几种情况。

## Phase 1：ptrade 原生回测 + 模拟盘 + 交易报告 + 状态记忆

当前定位：已完成首轮真实参数回测，当前从正确性验证转向模拟盘闭环与执行恢复。

### 目标

- 在 ptrade 内使用同一份策略骨架同时支撑回测和模拟盘。
- 形成可复核的日终交易报告，用于后续实盘跟踪。
- 在不引入自动实盘的前提下，把信号、仓位、订单、成交和状态记忆放进同一条闭环里。

### 关键交付物

- `ptrade-workspace/strategy/ptrade_wyckoff_trader.py`
- `PTRADE-TRADING.md`
- 基于 `order` / `get_open_orders` / `get_trades` / `get_positions` 的最小执行闭环
- 落盘到 `/home/fly/notebook/ptrade-wyckoff-trade-report-last.json` 的交易报告
- 落盘到 `/home/fly/notebook/ptrade-wyckoff-state.pkl` 的状态机记忆

### 明确不做

- 无人工闸门的实盘执行
- 多券商统一执行抽象层
- 完整绩效平台
- 无真实权限验证的强制 L2 / 逐笔阻塞
- 最终版 Wyckoff 信号模型

### 完成标准

- 同一份策略代码可以在回测中运行。
- 同一份策略代码可以在模拟盘中运行并提交订单。
- 日终可以拿到包含信号、决策、订单、成交和持仓的 JSON 报告。
- 通过 `get_open_orders` 避免同一标的重复叠单。
- 能读取或写入阶段、支撑阻力和 P&F 横向栏数近似值。

## Phase 2：L2 / 逐笔订单流增强与统一契约

当前定位：在 Phase 1 稳定后推进。

### 目标

- 把 L2 与逐笔订单流从“策略内可选输入”提升为“强制微观确认与可回放研究数据”。
- 让 ptrade 内信号判断和外部 bridge / 前端面板消费同一类标准化结果。

### 关键交付物

- L2 订单流统一数据契约
- 逐笔成交 / CVD 统一数据契约
- 订单流录制与回放能力
- 策略内强制 L2 / 逐笔确认参数
- bridge 真实上游连接与状态展示

### 完成标准

- L2 和逐笔成交数据不再只是单次验证脚本输出。
- L2、CVD、订单簿失衡可以被策略侧和前端侧一致消费。
- 可以清楚地区分 mock、validation、live ptrade 三类状态。

## Phase 3：实盘执行与风控闸门

当前定位：最后阶段。

### 目标

- 在回测、模拟盘和 L2 增强都稳定后，再进入受控的自动化交易与实盘执行。
- 把审批、风控、失败恢复和审计放在下单之前，而不是之后补救。

### 关键交付物

- 实盘模式显式开关
- 下单、撤单、查单与执行反馈闭环
- 人工审批与风控闸门
- 可审计的执行日志与失败恢复策略

### 完成标准

- 策略不会因为“只是把模拟盘切成实盘”就直接进入危险状态。
- 风控和审批是显式配置，而不是隐含约定。
- 实盘路径建立在回测 / 模拟盘 / L2 都已验证过的基础之上。

## 当前结论

1. `ptrade_phase1_validation.py` 现在应视为 Phase 0 预检查脚本，而不是最终策略方案。
2. 当前最优先要完成的是 ptrade 原生的“模拟盘 + 交易报告 + 状态记忆 + 订单 / 成交 / 持仓验证”闭环；首轮真实参数回测已经完成。
3. L2 / 逐笔订单流已经进入策略输入层；Phase 2 的重点是权限验证、强制闸门、录制回放和统一契约。
4. ptrade 继续作为推进完整自动化交易的主试验场，但进入 Phase 3 前必须先补齐撤单重试、次日对账、审批和风险闸门。