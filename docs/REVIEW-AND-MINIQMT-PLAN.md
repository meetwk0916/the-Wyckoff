# 项目审查见解与 MiniQMT 可验证落地计划

> 审查基线：commit `404ce5b`（2026-05-20）。本文件汇总对整个 the-Wyckoff 项目的评估、对 Wyckoff 方法论的建设性观点，以及把 MiniQMT 方向推进到「可验证阶段」的具体落地方案与验收口径。

## 1. 项目进度评估

项目分三个物理隔离的工作面，纪律性强，但整体仍处于「验证阶段早期」。

| 工作面 | 阶段 | 实质进度 |
|---|---|---|
| ptrade（A股） | Phase 1 中段 | canonical 策略脚本跑通一轮真实参数回测；报告/状态记忆/试仓升级/runner 主路径可用。20 个历史结构窗口复核、模拟盘订单闭环、L2/逐笔权限验证未完成 |
| crypto（BTC） | Phase C 早期 | 采集/回放/fixture/证据聚合/保守分类链完整，前端巡检页已接入。仅 4 个固定 fixture，0 个 `spring_candidate` 正样本，20 窗口复核未做 |
| miniqmt（A股券商） | 仅初始化 | 只有目录骨架、adapter contract、验证顺序文档，**本计划开始前无任何可执行代码** |

### 工程亮点（少见的成熟度）

- 三套工作面物理隔离 + `AGENTS.md` 强约束，避免互相污染。
- 文档/代码/测试用例同步更新的硬规则。
- 反过度宣称：反复声明「不是实盘系统」「降级运行 ≠ 微观确认完成」「不做左侧抄底」。
- 硬闸门（hard gate）清单明确：没有撤单恢复/次日对账/审批就不进自动执行。
- 分类器显式标注 `emitsTradeAction:false / requiresHumanReview:true`，结构判断与执行判断分离。

## 2. 主要风险与建议

1. **北极星指标尚未被触碰（最大风险）。** GOALS 明确第一阶段只看一个指标：能否稳定区分「真实收回」与「破位反抽/UTAD/证据不足」。但 crypto 侧 0 正样本、ptrade 侧 0 复核窗口。所有工具链都建在一个尚未验证的假设上。
2. **`ptrade_wyckoff_trader.py` 已 106KB 单文件、无单元测试、50+ 手调阈值。** 切 strict gate 时会很脆。建议拆分（信号/执行/状态/报告四层）并补纯函数单测。
3. **参数过拟合未被治理。** 缺 out-of-sample / walk-forward 框架。建议建立 train/validation/test 时间切分与参数敏感度记录。
4. **crypto 分类器偏二元脆弱。** 一串 `&&` 硬条件，样本少时系统性产出 0 正样本。建议改为加权证据分 + 阈值，保留 `confidence`。
5. **样本量不足以声称统计 edge。** 落地前需明确胜率/盈亏比置信区间、最小样本数、regime 分层。

## 3. 对 Wyckoff 方法论的建设性观点

Wyckoff 是一套「叙事化、事后可解释」的判读体系，而本项目在试图把它「算子化」。三个内在难点需要在方法论层面正面应对：

1. **事后偏误是 Wyckoff 的原罪。** Spring/UTAD/LPS 事后清晰、事前模糊。对策：**强制每个候选在判定时刻冻结一个前瞻证伪契约**（「若接下来 N 根 K 线发生 X 则证伪」），并自动统计该契约命中率，把「我能解释」变成「我能提前证伪」。
2. **量价确认不可跨市场移植。** A股 T+1/涨跌停/最小手数 与 BTC 永续/清算/资金费率，Wyckoff 原意（成交量代表 composite operator）在两边含义不同。对策：显式写下每个代理变量替代了原意中的哪个概念、在什么 regime 下失效。
3. **缺零假设对照。** 当前体系全是 Wyckoff 内部自洽判读。对策：**加一个 dumb baseline**（如「无脑反弹做多」），若精心搭建的证据链跑不赢 baseline，则复杂度不产生 alpha——这是检验方法论是否值得继续的最便宜试金石。

> 一句话总结：工程纪律与风控架构已达机构水准，真正瓶颈不在代码，而在于**还没用足够标注样本（含对照基线）证明 Wyckoff 信号本身有可重复的统计优势**。

## 4. MiniQMT「可验证阶段」定义与方案

真实连券商必须在装有 MiniQMT/QMT 客户端、且有账号权限的 Windows 机器上完成（Phase 1/3）。因此把「可验证阶段」拆成两条可独立验收的轨道：

### 轨道 A — 离线可验证管线（不依赖券商，本机即可跑、可重复、不发交易动作）

复刻 crypto-workspace 已验证的 evidence-first 方法，迁移到 A 股语境，并**直接内置上面三条方法论建议**：

- `miniqmt:evidence` — 从 A 股窗口 fixture 计算 Wyckoff 证据（长周期背景、结构支撑/阻力、spring 穿刺与收回、RS/Beta、订单簿失衡、逐笔 CVD、宏观过滤）。只输出证据，不输出交易动作。
- `miniqmt:classify` — 保守分类为 `spring_candidate` / `upthrust_risk` / `reaction_failure` / `insufficient_evidence`，输出 `confidence` 与拒绝原因，并对每个候选冻结**前瞻证伪契约**（`invalidation` + `target`）。
- `miniqmt:outcome` — 在 fixture 的 **held-out（决策时刻之后）** K 线上评估证伪契约是否触发、目标是否命中（落实方法论建议 #1）。
- `miniqmt:baseline` 内嵌于 outcome — 计算 dumb baseline（无脑反弹做多）在同一批 held-out 上的表现，与证据链对照（落实方法论建议 #3）。
- `miniqmt:contract:validate` — 校验录制事件 JSONL 是否符合 `ADAPTER-CONTRACT.md`，并保证不含凭据字段。
- `miniqmt:verify` — 钉死固定 fixture 的分类与 outcome，防止规则漂移（复刻 crypto pinned-fixture 纪律：正样本误报必须可控）。
- `miniqmt:check` — 顺序跑通 contract→evidence→classify→outcome→verify。

### 轨道 B — Windows 真实客户端脚本（你之后在 Windows + XtQuant 上跑）

按 `IMPLEMENTATION-PATH.md` Phase 0→3 提供可直接运行的 Python 适配器，全部带 `--mock` 离线模式（无 XtQuant 时输出契约样例，便于离线连调），真实模式在你机器上连客户端：

- `adapter/health_check.py` — 环境/客户端/账号/权限预检查，输出标准 `health` JSON（Phase 0）。
- `adapter/quote_capture.py` — 基础行情订阅与 JSONL 落盘（Phase 1）。
- `adapter/order_flow_capture.py` — L2 十档/逐笔委托/逐笔成交落盘；无权限时如实降级、不伪造（Phase 1）。
- `adapter/paper_trade_probe.py` — 模拟盘委托/撤单/成交/持仓/回报闭环，`--arm-live` 默认关闭（Phase 3）。
- `adapter/replay_export.py` — 把 Windows 录制转换为轨道 A 可回放/可评证据的窗口格式，打通 A 与 B。
- `adapter/lib_contract.py` — 共享事件构造、symbol 归一、账号脱敏、append-only 落盘。

### 验收口径（Definition of Done）

「可验证阶段」达成 = 同时满足：

1. 轨道 A：`npm run miniqmt:check` 在干净环境下可重复通过；固定 fixture 的分类、证伪命中与 baseline 对照结果稳定。
2. 轨道 A：至少 1 个 `spring_candidate` 正样本 + 1 个 `reaction_failure` 负样本 + 1 个 `insufficient_evidence` 对照，且证据链在 held-out 上的表现可与 dumb baseline 对照（产出「是否产生增量」的结论）。
3. 轨道 B：`python adapter/health_check.py --mock` 等所有适配器在无 XtQuant 时输出契约合规样例；真实模式步骤、退出条件与权限边界在 `VALIDATION-LOG.md` 有可执行清单。
4. 仓库内不含任何真实账号、密码、交易密码、柜台地址或 token；实盘开关默认关闭。

### 硬约束（继承自现有 GOALS / AGENTS，不放宽）

- 环境未验证不写交易逻辑；L2/逐笔权限未验证不把微观结构作为强制入场依据。
- 无回报闭环不启用模拟盘外执行；无 replay fixture 不调高置信度；无审批/风控不进实盘。
- 缺 L2 权限的基础行情**不得**伪装成 L2 微观确认（分类器对此必须落 `insufficient_evidence`）。

## 5. 里程碑顺序

1. 轨道 A 离线管线 + 3 个 seed fixture + verify 跑通（本机可验证）。← 本次交付
2. Windows 适配器脚本（mock 可跑，真实步骤就绪）。← 本次交付
3. 你在 Windows 跑 Phase 0 health，回填 `VALIDATION-LOG.md`。
4. 你在 Windows 跑 Phase 1 行情/L2 探测，用 `replay_export.py` 产出真实 A 股窗口，喂入轨道 A。
5. 累计到 ≥20 个复核窗口后，再评估 Phase 3 模拟盘闭环。
