# ptrade 原生回测与模拟盘策略说明

## 目的

这份说明对应 `ptrade-workspace/strategy/ptrade_wyckoff_trader.py`。

它的目标是在官方 ptrade 运行时内部承载一套更接近真实 Wyckoff 交易体系的可回测策略，同时继续保留三个基础能力：

1. 可运行的回测。
2. 可运行的模拟盘下单。
3. 可复核的日终交易报告。

这样做的意义是把“静态标的池 -> 宏观过滤 -> 微观确认 -> 结构信号 -> 决策 -> 下单 -> 成交 -> 报告 -> 状态记忆”的闭环放进 ptrade 内验证。

## 对应文件

- `ptrade-workspace/strategy/ptrade_wyckoff_trader.py`
- `ptrade-workspace/config/ptrade-wyckoff-policy-pool.json`
- `ptrade-workspace/README.md`

其中真正应复制到 ptrade 的主脚本只有 `ptrade-workspace/strategy/ptrade_wyckoff_trader.py`。
文档不再维护镜像策略代码文件，避免 canonical 脚本和 docs 副本分叉。

## 当前阶段状态

截至 2026-05-07：

- 已完成 canonical 脚本的一轮真实参数回测，当前已经验证 JSON 报告、pickle 状态记忆、试仓升级、runner 重锚和关键风控主路径可运行。
- 当前默认把 L2 / 逐笔成交缺失视为可降级输入，而不是硬闸门；这不阻塞 Phase 1 回测，但会直接影响 Spring 真伪、UTAD 假突破和后续自动化交易前的微观确认质量。
- 当前下一阶段主线是：模拟盘闭环 -> 真实交易时段 L2 / 逐笔权限验证 -> `cancel_order` 超时撤单 / 次日对账 -> 再推进带审批与风控闸门的自动化交易。

当前已知环境补充：

- 当前券商为国金。
- 按官方 reference，国金属于较早升级到 `python3.11` 的 ptrade 环境，因此本项目默认优先按 `python3.11` 返回格式做验证与兼容。
- 这只代表默认优先路径，不代表可以跳过现场确认；测试版 / 实盘版客户端、L2 权限和 API 返回细节仍需在当前账户上逐项验证。

## 当前策略做了什么

### 1. 统一回测和模拟盘入口

- 使用 `handle_data()` 作为主决策入口。
- 使用 `after_trading_end()` 输出日终报告。
- 同一份代码同时兼容回测和交易环境。

### 2. 使用官方已确认的最小执行接口

当前策略优先使用这些接口：

- `order(security, amount, limit_price=None)`
- `get_open_orders(security=None)`
- `get_orders(security=None)`
- `get_trades()`
- `get_position(security)`
- `get_positions(security=None)`

说明：

- 官方文档虽然也提供 `order_target`、`order_target_value`，但明确提示交易场景可能因为持仓同步滞后导致重复下单。
- 因此当前策略优先用 `order` 做 delta 下单，并在下单前先检查 `get_open_orders()`。
- 如果后续在国金环境中确认 `python3.11` 路径稳定，可优先按 DataFrame / dict 返回格式做联调，不再围绕老的 Panel 返回结构设计主路径。

### 3. 输出日终交易报告

每个交易日结束后，策略会把以下信息写入本地 JSON：

- 组合资金快照
- 每个标的的信号判定
- 当前决策结果
- 执行结果
- 策略内订单
- 未完成订单
- 当日成交
- 当前持仓
- 策略状态记忆

默认输出文件：

```text
/home/fly/notebook/ptrade-wyckoff-trade-report-last.json
```

## 初始化时需要先改的参数

`initialize()` 里最关键的几个参数如下：

```python
g.execution_mode = 'paper'
g.live_order_armed = False
g.enable_l2_confirmation = True
g.enable_trade_stream_confirmation = True
g.require_l2_for_entry = False
g.require_trade_stream_for_entry = False
g.max_position_ratio = 0.25
g.scale_position_cap_to_universe = True
g.enable_open_order_recovery = True
g.open_order_timeout_bars = 3
g.stop_loss_pct = 0.03
g.trend_stop_loss_pct = 0.06
g.utad_close_position_threshold = 0.75
g.utad_min_volume_ratio = 1.00
```

建议这样理解：

- `g.symbols`：当前不再建议在代码里写死；策略会优先尝试从 ptrade 交易端 / 运行时 context 里读取当前股票池或标的变量。
- 如果 ptrade 回测界面实际只把“基准”之类字段注入运行时，策略现在也会尝试从 `benchmark`、`benchmark_symbol`、`get_parameters()`、`get_parameter()` 这类入口解析目标标的。
- 如果运行时只给了 6 位代码，例如 `002353` 或 `600570`，策略也会自动归一化成 `002353.XSHE` / `600570.XSHG`。
- 如果当前运行时没有注入可读的 universe，策略会回退到 `ptrade-wyckoff-policy-pool.json` 里的 `symbols`。
- `symbolUniverse.source`：回测报告里会显示当前标的是来自 `runtime` 还是 `policy_pool_config`。
- 初始化时如果发现 state 文件里还残留上一次回测的其他标的，策略会先把内存中的 state 收敛到当前 active symbols，避免报告里继续混入旧标的状态。
- `g.max_position_ratio = 0.25`：这是多标的场景下的单票基线仓位上限。
- `g.scale_position_cap_to_universe = True`：会按当前 `activeSymbols` 数量自动放大或回落单票仓位上限。单票回测时可用仓位会上升到 `1 - g.min_cash_reserve_ratio`，2 票 / 3 票时按可用资金均分，4 票及以上仍以 25% 为基线。
- `g.stop_loss_pct = 0.03`：普通成本止损仍默认按 3% 控制。
- `g.trend_stop_loss_pct = 0.06`：当持仓已经进入 `full`，且短趋势或更长周期的 `longCycleReady` / `macroReady` 仍成立时，成本止损会继续放宽到 6%，避免主升段里的中途震荡只因为短均线走弱就被 3% 成本止损过早打掉。
- `runner_lost_trend`：runner 仓位不再因为 `trendReady = false` 就直接清掉；默认还要先确认价格已经重新跌回旧箱体内部，避免像强趋势回撤后重新站回阻力上方的场景被过早退出。
- `g.utad_close_position_threshold = 0.75`：`UTAD` 不再因为“冲高回落到旧阻力下方”就立刻触发，默认要先明显跌回箱体上沿以下，避免把强趋势里的浅回撤误判成分配。
- `g.utad_min_volume_ratio = 1.00`：`UTAD` 还要求回落时至少出现一次可见的供给放量；如果只是缩量或常规回踩，策略会继续按趋势内整理观察，而不是直接触发 `RISK_OFF`。
- `g.execution_mode = 'paper'`：用于回测和模拟盘。
- `g.execution_mode = 'live'`：只在你明确要迁移到实盘时才改。
- `g.live_order_armed = False`：即使以后切到 `live`，也先保持 `False`，确认风控流程后再手动打开。
- `g.enable_l2_confirmation = True`：策略会尝试读取深度盘口并计算订单簿失衡；如果当前运行环境不支持该接口，会在首次失败后把能力标记为不可用，避免后续每天重复探测。
- `g.enable_trade_stream_confirmation = True`：策略会尝试读取逐笔成交并计算 CVD；如果当前运行环境不支持该接口，也会在首次失败后自动降级。
- `g.require_l2_for_entry = False`：默认不让 L2 缺失阻塞回测入场，真实环境确认权限后可改成 `True`。
- `g.require_trade_stream_for_entry = False`：默认不让逐笔成交缺失阻塞回测入场，真实环境确认权限后可改成 `True`。
- `g.enable_open_order_recovery = True`：默认允许对连续多个决策周期仍未消失的 open orders 进入恢复流程，而不是无限期 `blocked`。
- `g.open_order_timeout_bars = 3`：同一批 open orders 连续出现多少个 `handle_data()` 周期后，策略开始尝试调用 `cancel_order()`；这是当前版本对“挂单超时”的最小近似语义。

## 回测步骤

1. 在 ptrade 中新建一个股票策略。
2. 粘贴 `ptrade-workspace/strategy/ptrade_wyckoff_trader.py` 的内容。
3. 先确认 `g.execution_mode = 'paper'`。
4. 优先在 ptrade 交易端或回测配置里设置当前股票池；如果当前运行时没有把它注入给策略，再去改 `ptrade-wyckoff-policy-pool.json` 的 `symbols`。
5. 新建回测，设置开始时间、结束时间、资金规模和频率。
6. 运行回测。
7. 在日志里查看 `Wyckoff ptrade report => ...`。

回测日志里和微观确认最相关的新字段可以这样看：

- `l2DataAvailable` / `tradeStreamDataAvailable`：当前运行环境是否真的返回了 L2 / 逐笔数据。
- `l2Confirmed` / `tradeStreamConfirmed`：当前这次数据是否通过了订单簿失衡或 CVD 的确认条件。
- `l2GateReady` / `tradeStreamGateReady`：在当前参数配置下，这一层是否会阻塞入场。
- `l2Error` / `tradeStreamError`：当前不可用是临时空数据，还是接口能力本身不可用。
- `symbolUniverse.activeSymbols` / `symbolUniverse.source`：当前这次回测实际跑了哪些标的，以及这些标的是从 ptrade runtime 还是配置文件拿到的。
- `entryStage`：当前是纯观察、试仓还是正式执行；`pilot` 表示允许轻仓试仓，`full` 表示允许正式执行。
- `pilotReady` / `formalEntryReady`：分别表示“可试仓”和“可正式执行”是否成立。
- `positionStage` / `promotionReady`：分别表示当前持仓仍处于试仓还是已进入正式仓，以及当前试仓是否满足升级到正式仓位的条件。
- `execution.recovery`：当同一批 open orders 连续出现时，报告会记录 `seenBars`、`timeoutBars` 和撤单尝试结果，用来区分“继续观察中的挂单”和“已进入恢复流程的挂单”。

建议第一轮优先使用：

- 日线频率：先确认逻辑是否能稳定跑通。
- 分钟频率：再看信号和交易节奏是否合理。

## 模拟盘步骤

1. 保持同一份策略代码不变。
2. 在 ptrade 里新建交易，并选择模拟盘模式。
3. 绑定正确的资金账号。
4. 启动交易。
5. 在交易日志里查看下单、成交和报告输出。
6. 到 `/home/fly/notebook/ptrade-wyckoff-trade-report-last.json` 检查日终结果。

## 当前信号逻辑的定位

当前文件中的信号逻辑已经从日线启发式升级为“宏观过滤 + 微观确认 + 状态记忆”的 ptrade 版本，但仍然不是最终版人工 Wyckoff 读盘能力的完全替代。

它当前已经覆盖这些结构化判断：

- Phase A / B / C / D 的基础阶段识别
- Spring 收复、LPS 回踩缩量、BUEC 二次确认的第一版结构判定
- ST / 早期 Spring 的试仓层，用 `PILOT_ACTION` 把“可观察”与“可轻仓验证”区分开
- support / resistance / entryZone / stopLoss / targetPrice / riskReward / confidence 的结构化输出
- L2 买卖档位聚合与订单簿失衡度
- 逐笔成交流 CVD，用于确认主动买卖方向
- 120 日长周期量价过滤
- 宏观过滤分成两类：Phase A / B / C 仍优先看长周期回落或背景跌幅，Phase D 的 SOS / LPS / BUEC 则允许在 120 日线上方按趋势延续方式通过，报告里可直接查看 `longCycleReady` 与 `trendCycleReady`
- 个股相对沪深 300 的 RS / Beta 过滤
- 政策面 / 基本面静态标的池过滤
- pickle 状态记忆，保存阶段、支撑阻力和 P&F 横向栏数近似值，并在 `Phase E` 风险释放后避免状态机过早回滚到普通观察态

交易管理当前采用三段式：

- ST 或早期 Spring 达到试仓条件时，先开轻仓验证，而不是只能空等 Phase D。
- 如果当前持仓仍是 `pilot`，后续出现正式执行信号且目标仓位明显高于当前试仓，策略会自动把试仓升级成正式仓位，并在决策原因里标记为 `pilot_promoted_*`。
- 到达 targetPrice 后优先锁定部分利润，保留 runner 继续跟踪
- runner 的目标仓位会锚定在上一次建仓 / 加仓决策上，不会因为后续信号临时回落到 `MONITORING` 或 `BLOCKED` 就被清零。
- 如果 runner 目标仓位在 A 股最小 100 股手数下无法落成可执行的剩余仓位，策略会优先保留一手 runner，而不是把本来想保留的尾仓误算成清仓。
- 普通趋势转弱先减仓，而不是仅因跌破慢线就直接清仓
- runner 在退化为非执行型结构且趋势不再成立时退出，避免长时间回吐已兑现利润
- 成本止损或结构止损触发时再执行离场；其中 `full` 趋势仓位在趋势未破坏前会使用更宽的 `g.trend_stop_loss_pct`。
- 当同一批 open orders 连续多个决策周期仍未消失时，执行层会先记录 `executionRecovery` 状态；达到 `g.open_order_timeout_bars` 后，会优先尝试 `cancel_order()`，本周期不再继续提交新单，避免在模拟盘里永久卡死在 `open_orders_present`。

试仓开关当前也保留为参数：

- `g.enable_pilot_entries = True`：保留 staged entry，允许 ST / 早期 Spring 先开轻仓试仓。
- `g.enable_pilot_entries = False`：关闭试仓，只保留“观察 -> 正式执行”两档，便于做回测对比。
- `g.enable_pilot_promotion = True`：保留“试仓 -> 正式仓”的自动升级规则；默认开启。

执行状态当前可以这样理解：

- `MONITORING`：继续观察，`suggestedPositionRatio` 保持 0。
- `PILOT_ACTION`：允许轻仓试仓，典型场景是高质量 ST 或尚未完全确认的 Spring。
- `ACTION_REQUIRED`：允许正式执行，典型场景是确认后的 Spring、SOS、LPS、BUEC。

这意味着它已经不再只是“执行和报告框架”，而是“可回测、可模拟、可报告、带真实数据输入边界的第一版 Wyckoff 交易体系”。
但它仍未实现完整 Footprint Charts、Volume Profile、严格 cause count 和人工级别的全阶段状态机。

## 这份策略适合解决什么问题

- 在 ptrade 原生回测和模拟盘中验证 Wyckoff 策略骨架。
- 先形成交易报告，供后续实盘跟踪和人工复盘。
- 先把订单、成交和持仓的查询链路打通。
- 在真实权限允许时，把 L2 / 逐笔成交作为 Spring 真伪和假动作识别的确认层。

## 这份策略暂时不解决什么问题

- 不解决最终版 Spring / BUEC / LPS 细粒度判定与 cause count。
- 不解决完整 Footprint Charts 和 Volume Profile 形态重建。
- 不解决多账户、多券商统一执行。
- 不解决自动实盘和风控审批。
- 不解决完整绩效归因平台。

## 推荐的下一步增强

1. 用同一份 canonical 脚本在 ptrade 模拟盘验证订单、成交、持仓、报告和状态记忆闭环。
2. 在真实 ptrade 交易时段验证 `get_snapshot()`、逐笔成交接口和 L2 权限。
3. 在权限确认后，把 `g.require_l2_for_entry` 和 `g.require_trade_stream_for_entry` 切到 `True` 做严格微观确认回测。
4. 继续细化 Spring / LPS / BUEC 的触发条件，引入更真实的 cause count、次级测试和失败结构识别。
5. 增加 `cancel_order()` 超时撤单与重新报价逻辑。
6. 增加次日对账逻辑，结合 `get_deliver()` 与 `get_fundjour()` 做报告校验。
7. 在上述能力都稳定后，再把 ptrade 推进到带审批、风控和恢复策略的自动化交易阶段。