# ptrade Wyckoff 实施路径

## 路线原则

ptrade 路线按下面顺序推进：

1. 运行时能力基线
2. 模拟盘订单 / 成交 / 持仓 / 报告闭环
3. L2 / 逐笔权限验证与统一数据契约
4. 结构候选过滤器与失败结构识别
5. paper trade 纪律、撤单恢复与次日对账
6. 审批、风控和受控自动化执行评估

如果前一层没有收口，不应直接跳到后一层。

当前核心风险和暂停 / 降级条件记录在 `RISK-REGISTER.md`。如果风险登记中的高等级风险没有收敛，不应把当前版本推进到 live armed。

当前下一步审查口径已拆成两层，详见 `TWO-LAYER-REVIEW.md`：

1. 回测结构审查：先确认历史回测输出的候选是否符合 Wyckoff 结构语义。
2. 模拟盘执行审查：再确认 ptrade 主推、轮询、账户级巡检、订单、成交、持仓、报告和状态记忆能否闭环。

## 结合官方 reference 的校正

基于 `https://ptradeapi.com/` 当前公开文档，路线有四个需要明确写入的约束和增量：

- 继续坚持用 `order` 做 delta 下单是对的；官方明确提示 `order_target` / `order_target_value` 在交易场景容易因持仓同步延迟造成重复下单。
- 仅靠 `get_open_orders` / `get_orders` / `get_trades` 轮询还不够，交易闭环还应补 `on_order_response` / `on_trade_response` 这类更快的主推回调。
- 仅看策略内订单还不够，模拟盘和后续自动化需要补 `get_all_orders` / `cancel_order_ex` / `get_all_positions` 这一层账户级偏差检测，识别人工单或其他策略干扰。
- ptrade 环境默认应按“券商机房内网、外网能力不稳定、第三方库受限、Python 版本和返回格式随券商差异显著”设计，不能把外部 HTTP 因子或单一返回格式当成前提。

当前已知券商信息：

- 当前券商为国金。
- 按官方 reference，国金是少数已升级到 `python3.11` 的 ptrade 环境之一，因此 Phase 0 默认优先按 `python3.11 + pandas DataFrame` 路径验证。
- 但这仍不是可以跳过验证的理由；测试版 / 实盘版客户端、账户权限和具体 API 返回格式仍需现场确认。

## Phase 0：环境预检查

当前定位：已具备最小可用脚本，用于回测 / 模拟盘上线前检查；默认优先走研究目录 JSON + sqlite3 持久化，HTTP 仅作为可选增强探测。

- [x] 已补充 `ptrade_phase1_validation.py`
- [x] 已补充 `PTRADE-VALIDATION.md`
- [x] 已验证账号绑定与本地落盘能力
- [x] 已把 Phase 0 默认路径切到 JSON / sqlite3 本地持久化优先
- [ ] 记录国金当前实际客户端的 Python 版本、关键 API 返回格式和可用三方库边界
- [ ] 验证当前券商是否允许外网 / HTTP 出站；若不允许，外部增强仅能走 bridge / 落盘回放
- [ ] 在真实交易时段补齐一轮 L2 权限和订阅验证

## Phase 1：原生回测 + 模拟盘 + 交易报告

当前定位：截至 2026-05-14，已完成首轮真实参数回测，当前从“策略能否跑通”转向“两层审查”：先审查回测结构识别是否符合 Wyckoff，再审查模拟盘执行闭环、交易时段微观确认、执行恢复与对账。

- [x] 已新增 `ptrade-workspace/strategy/ptrade_wyckoff_trader.py` 策略主脚本
- [x] 已新增 `PTRADE-TRADING.md` 操作说明
- [x] 已在策略内接入 `order`、`get_open_orders`、`get_trades`、`get_positions` 等最小闭环接口
- [x] 已支持日终 JSON 报告落盘
- [x] 已新增 `ptrade-workspace/` 隔离目录
- [x] 已接入静态标的池、长周期量价、RS / Beta、L2 订单簿失衡、逐笔 CVD 和 pickle 状态记忆
- [x] 用真实策略参数跑第一轮回测
- [x] 已验证 flat-start 状态回收、pilot promotion、runner re-anchor、UTAD 收紧与趋势 runner 管理等关键非回归路径
- [x] 已为模拟盘补 `on_order_response` / `on_trade_response` 主推路径，报告会同时保留主推事件、轮询结果和对齐摘要
- [ ] 按 `TWO-LAYER-REVIEW.md` 建立 20 个 A 股历史结构窗口，审查回测候选是否符合 Wyckoff 结构语义
- [ ] 用模拟盘验证订单、成交、持仓和报告闭环
- [x] 已增加 `get_all_orders` / `get_all_positions` 账户级巡检，并在报告中标记 `cancel_order_ex` 可用性、可撤账户委托、疑似非本策略委托和非策略持仓
- [ ] 在真实交易时段验证 L2 / 逐笔成交接口可用性
- [ ] 增加基于 `cancel_order` 的超时撤单与重试策略
- [ ] 增加基于 `get_deliver()` / `get_fundjour()` 的次日对账
- [ ] 把当前启发式信号推进到可复核的结构候选对象、cause count 与失败结构识别

## Phase 2：L2 / 逐笔订单流增强与统一契约

当前定位：在 Phase 1 稳定后再推进。

- [x] 已提供本地 `ptrade bridge` 服务骨架与 `/api/ptrade/health` 接口
- [x] 已提供 `/api/ptrade/l2-order-flow` L2 订单流样例接口
- [x] 已支持本地录制样例订单流，便于后续回放
- [x] 已在前端界面展示 bridge 健康状态和 L2 联调面板
- [ ] 明确 ptrade 环境中的 L2 数据来源、权限要求和标的订阅方式
- [ ] 若转向 `tick_data` / `run_interval`，先验证线程与数据接口限制，避免与 `get_history` / `get_price` 并发调用
- [ ] 定义统一的 L2 订单流数据契约，避免 UI 或策略侧直接耦合原始返回
- [ ] 对逐笔委托 / 逐笔成交优先沉淀稳定返回格式，必要时在大股票池下使用 `is_dict=True`
- [ ] 定义逐笔成交 / CVD 数据契约
- [ ] 建立 L2 订单流录制与回放能力，服务 Wyckoff 2.0 研究与验证
- [ ] 在界面或系统状态中展示 L2 连接、延迟和数据新鲜度
- [ ] 将 bridge 从 `mock` 模式切换到真实 ptrade 上游连接

## Phase 3 前硬闸门

- [ ] 模拟盘订单、成交、持仓、报告和状态记忆闭环已完成
- [ ] 已明确真实交易时段 L2 / 逐笔权限结论
- [ ] 已补齐 `cancel_order` 超时撤单 / 重报价
- [ ] 已补齐 `get_deliver()` / `get_fundjour()` 次日对账
- [ ] 已具备审批、风控和审计日志最小闭环

## Phase 3：实盘执行与风控闭环

当前定位：最后阶段。

- [ ] 在 Phase 1 与 Phase 2 稳定后，再进入实盘下单、撤单和执行反馈闭环
- [ ] 先落人工审批与风控闸门，再考虑半自动与自动交易
- [ ] 建立可审计的交易执行日志与失败恢复策略

## 当前最优下一步

优先顺序建议如下：

1. ptrade 结构层：按 `TWO-LAYER-REVIEW.md` 建立至少 20 个 A 股历史结构窗口，先审查回测候选是否符合 Wyckoff 结构语义
2. ptrade 结构层：把候选、拒绝原因、cause count、数据缺口和失败结构识别沉淀为可复核证据对象
3. ptrade Phase 0：补券商 Python 版本、关键 API 返回格式、可用三方库和外网边界确认
4. ptrade Phase 1：按 `PAPER-TRADE-ACCEPTANCE.md` 用模拟盘验证 `on_order_response` / `on_trade_response`、轮询结果、账户级巡检、订单、成交、持仓、报告和状态记忆是否一致
5. ptrade Phase 1：补 `cancel_order` 超时撤单后的重报价策略；`cancel_order_ex` 当前仅做账户级可用性和可撤委托巡检，不自动撤非本策略委托
6. ptrade Phase 1：补 `get_deliver()` / `get_fundjour()` 次日对账，并在真实交易时段验证 L2 / 逐笔成交权限
7. ptrade Phase 2：统一 L2 / 逐笔订单流契约、录制回放与 bridge 真上游

原因：

- 官方文档已经明确给出主推回调、账户级查单 / 撤单和重启参数，这些能力比继续堆新信号更能降低执行侧不确定性。
- 首轮回测已经完成，但还需要先审查回测输出是否真能识别 Wyckoff 结构；否则直接跑模拟盘会把结构错误和执行错误混在一起。
- 模拟盘闭环、账户级偏差检测与执行恢复仍是执行层最短板，但应放在结构审查之后作为第二层验收。
- 无 L2 / 逐笔不阻塞 Phase 1 跑通，但会显著削弱 Phase 2 研究质量和 Phase 3 自动化交易可信度。
- 虽然当前券商是国金，官方 reference 也提示其常见环境更接近 `python3.11`，但不先确认当前客户端的 Python 版本、返回格式和外网边界，后续实现仍会返工。
