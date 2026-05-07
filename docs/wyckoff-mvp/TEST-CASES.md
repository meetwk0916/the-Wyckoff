# Wyckoff 控制台测试用例

## 测试策略

当前这组用例分成两部分：

- 前端控制台行为基线。
- ptrade Phase 1 / Phase 2 的策略回归与待执行验收。

后续可以补自动化覆盖，但现在这份文档就是当前版本的行为基线。

## 验收用例

### TC-001 控制台渲染

前置条件：开发服务已经启动。

步骤：

1. 打开应用根路径。
2. 查看页面骨架和主要内容。

预期：

- Wyckoff MVP 控制台正确显示。
- 控制台数据来自本地快照加载，而不是组件内硬编码数据。
- 页面包含指标卡片、监控矩阵、预警流、ptrade Phase 1 联调面板和 MVP 范围说明。

### TC-002 阶段过滤

前置条件：控制台已打开。

步骤：

1. 将阶段过滤切换到 `Phase D`。
2. 查看表格内容。
3. 再切回 `All phases`。

预期：

- 过滤生效时，只显示 `Phase D` 行。
- 重置后恢复完整列表。

### TC-003 状态过滤

前置条件：控制台已打开。

步骤：

1. 将信号过滤切换到可复核候选。
2. 查看表格内容。

预期：

- 只保留可复核行。
- 被拦截和仅监控的行被排除。

### TC-004 预警确认

前置条件：控制台已打开，且至少存在一条未确认预警。

步骤：

1. 点击某条预警的确认动作。

预期：

- 该预警切换为已确认状态。
- 同一条预警不再出现可点击的确认动作。

### TC-005 指标一致性

前置条件：控制台已打开。

步骤：

1. 统计当前过滤结果中的可复核行数。
2. 与顶部汇总指标进行比对。

预期：

- 汇总指标与当前可见状态一致。

### TC-006 模拟刷新

前置条件：控制台已打开。

步骤：

1. 触发刷新动作。

预期：

- 最后更新时间戳发生变化。
- 刷新动作会重新读取本地快照数据，刷新期间按钮不会重复触发。
- 页面不会崩溃。

### TC-007 标的检查面板

前置条件：控制台已打开。

步骤：

1. 点击监控矩阵中的某个可见标的。
2. 查看右侧检查面板。
3. 再调整过滤条件，使另一个标的成为当前主要可见候选。

预期：

- 检查面板切换到当前选中标的。
- 面板展示判断依据、入场区间、止损、信心分数和状态时间线。
- 如果当前选中标的被过滤掉，面板自动回退到下一个可见候选。

### TC-008 MVP 范围保护

前置条件：控制台已打开。

步骤：

1. 查看页面中的交付说明或范围说明区域。

预期：

- UI 明确说明当前只是监控型 MVP。
- UI 明确标注实时 ptrade 接入和自动交易仍然延期。

### TC-009 ptrade Bridge 联调状态

前置条件：已启动 `npm run ptrade:bridge`。

步骤：

1. 打开控制台页面。
2. 查看右侧 `ptrade Phase 1` 面板。
3. 观察状态标签、Bridge mode 和 L2 样例数据。

预期：

- 面板能显示 ptrade bridge 当前状态。
- `mock` 模式必须显示为联调就绪，而不是误报为真实已连接。
- 面板可以展示当前选中标的的 L2 样例数据。

## ptrade 策略回归与后续验收

### TC-010 ptrade 首轮回测报告闭环

当前状态：已通过回测验证。

前置条件：将 canonical 脚本部署到 ptrade 回测，使用真实策略参数和已验证样本区间（例如 2026-01 至 2026-04）。

步骤：

1. 启动日线或分钟级回测。
2. 观察日志与 `/home/fly/notebook/` 输出。

预期：

- 回测可以跑完，不因 L2 / 逐笔接口缺失直接中断。
- 生成 `ptrade-wyckoff-trade-report-last.json`。
- 报告包含 `symbols`、`execution`、`strategyState`、`symbolUniverse` 等关键字段。

### TC-011 flat-start 状态回收

当前状态：已通过回测验证。

前置条件：上一轮回测留下了 state 文件，但当前运行开始时实际持仓为 0 或 active symbols 已变化。

步骤：

1. 保留上一轮状态文件。
2. 用同一脚本重新发起 flat start 回测，或切换当前标的池后重跑。
3. 检查新报告里的 `strategyState`。

预期：

- 策略会在开盘前按 live position 与 active symbols 收敛 state memory。
- flat 标的的 `positionStage` 回到 `none`，`managedTargetRatio` / `runnerTargetRatio` 回到 0。
- 报告不会继承上一轮 full position 的旧元数据。

### TC-012 试仓升级与 runner 重锚

当前状态：已通过回测验证。

前置条件：所选样本区间中包含先试仓、后正式执行或 LPS 加仓的场景。

步骤：

1. 运行已验证样本区间回测。
2. 检查 promotion / add 当天的 `decision` 与 `strategyState`。

预期：

- `pilot` 持仓可以在正式执行信号出现后升级为 `full`。
- 加仓后 `managedTargetRatio` 与 `runnerTargetRatio` 会一起更新，而不是停留在旧 runner 值。
- `lastReason` 能反映 `pilot_promoted_*` 或对应的加仓原因。

### TC-013 UTAD 与趋势 runner 非回归

当前状态：已通过回测验证。

前置条件：样本区间中同时包含强趋势浅回撤和真正的上冲回落场景。

步骤：

1. 对比检查强趋势浅回撤和真实 UTAD 类场景。
2. 观察信号状态与仓位决策。

预期：

- 浅回撤不会仅因冲高回落就被误判成 `UTAD`。
- 趋势 runner 不会仅因 `trendReady = false` 就直接清仓；只有重新跌回旧箱体并失去趋势支撑时才退出。
- 已知误杀场景不应重新出现。

### TC-014 微观数据降级语义

当前状态：已通过回测验证。

前置条件：回测或运行环境不提供 `get_snapshot()` / 逐笔成交能力，且默认参数保持 `require_l2_for_entry = False`、`require_trade_stream_for_entry = False`。

步骤：

1. 启动回测。
2. 检查报告中的微观确认字段与错误字段。

预期：

- `l2DataAvailable` / `tradeStreamDataAvailable` 能真实反映当前能力是否可用。
- `l2Error` / `tradeStreamError` 能区分“能力不可用”和“当前无数据”。
- 默认 soft gate 下回测仍可继续，且不会每天重复刷相同能力探测 warning。

### TC-015 模拟盘订单与报告闭环

当前状态：待执行。

前置条件：同一份 canonical 脚本已部署到 ptrade 模拟盘，且已绑定正确资金账号。

步骤：

1. 在模拟交易时段启动策略。
2. 观察订单、成交、持仓与日终报告。

预期：

- `get_open_orders` 能阻止重复叠单。
- 报告里的订单、成交、持仓与模拟盘实际结果一致。
- state 文件与 JSON 报告会在日终被正确更新。

### TC-016 交易时段 L2 / 逐笔权限验证

当前状态：待执行。

前置条件：真实交易时段，目标账号具备候选标的的行情与逐笔权限。

步骤：

1. 运行 `ptrade_phase1_validation.py` 或 canonical 策略。
2. 检查 snapshot、trade stream 与确认字段。

预期：

- 能区分 `confirmed`、`market_not_live`、`unavailable`、`capability_unavailable`、未授权等状态。
- 验证完成后，可以明确判断是否把 `require_l2_for_entry` / `require_trade_stream_for_entry` 切为 `True`。

## 后续每轮迭代的回归检查

- 应用根路径仍然渲染控制台。
- `npm run build` 仍然通过。
- 标的检查面板始终与当前监控列表选择保持同步。
- 新增过滤器或面板时，不得隐藏风险拦截信息。
- 只要修改 `ptrade-workspace/strategy/ptrade_wyckoff_trader.py`，至少复跑 TC-010 到 TC-014。
- 进入模拟盘和交易时段联调后，把 TC-015 与 TC-016 变成每次实质性策略改动后的必跑项。
