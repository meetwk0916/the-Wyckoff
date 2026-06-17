# MiniQMT Wyckoff 实施路径

## 当前阶段

离线可验证管线（轨道 A）已跑通，Windows 适配器脚本（轨道 B）已就绪但尚未在真实
客户端验证。详见 `VALIDATION-LOG.md`（2026-06-17）与 `docs/REVIEW-AND-MINIQMT-PLAN.md`。

Phase 0/1/3 的真实连接部分仍待在 Windows + 账号权限下执行；Phase 2 的离线证据/分类/
回放/fixture 已在本机实现并可重复验证。

## Phase 0：MiniQMT 环境预检查

目标：确认真实 Windows 客户端环境是否能跑通 XtQuant 外部 Python 适配器。

工作项：

- [ ] 确认 Windows 侧已安装 MiniQMT / QMT 客户端。
- [ ] 确认目标账号可登录。
- [ ] 确认 XtQuant Python 包、Python 版本和 userdata 路径。
- [ ] 查询账号列表、账号状态和连接状态。
- [ ] 输出 `health` 标准 JSON。
- [ ] 把错误、权限缺口和客户端版本写入 `VALIDATION-LOG.md`。

退出条件：

- 能稳定输出 health JSON。
- 能明确区分客户端未启动、账号未登录、SDK 不存在、userdata 路径错误和权限不足。

## Phase 1：行情与微观结构输入

目标：把 Wyckoff 输入层从 ptrade 路线迁移到 MiniQMT 数据源。

工作项：

- [ ] 拉取目标标的基础行情和历史 K 线。
- [ ] 验证 Level2 权益是否可见。
- [ ] 验证十档盘口、委托队列、逐笔委托、逐笔成交可读性。
- [ ] 统一 symbol、exchange、timestamp、price、volume、side 字段。
- [ ] 生成 order-flow snapshot / transaction 事件样例。

退出条件：

- 至少一个 A 股标的能输出基础行情。
- 如果账号有 L2 权限，至少一个标的能输出 L2 / 逐笔样例。
- 如果账号无 L2 权限，文档必须明确 fallback 到基础行情，不允许伪造微观确认。

## Phase 2：录制、回放与证据报告

目标：复用 crypto 路线已经验证过的 evidence-first 方法，但改成 A 股语境。

工作项：

- [x] 将 MiniQMT 原始事件落盘为 JSONL（`adapter/lib_contract.py` 的 `JsonlStore`）。
- [x] 设计 replay window：按标的、时间、事件类型回放（`src/lib/wyckoff.mjs` + fixtures）。
- [x] 生成 Wyckoff evidence report：长周期量价、RS / Beta、支撑阻力、订单簿失衡、逐笔 CVD、风险闸门（`src/runEvidence.mjs`）。
- [x] 建立 seed fixture，防止后续规则漂移（`fixtures/*.json` + `src/runVerify.mjs`）。
- [x] 内置前瞻证伪契约 + dumb baseline 对照（`src/runOutcome.mjs`，落实方法论审查建议）。

退出条件（已满足，离线轨道）：

- 至少一个历史窗口可回放。
- evidence report 不输出交易动作，只输出证据和分类。
- 固定 fixture 的分类结果可重复。

## Phase 3：模拟盘闭环

目标：验证交易链路，而不是追求收益。

工作项：

- [ ] 连接 MiniQMT 模拟交易。
- [ ] 查询资金、持仓、委托、成交。
- [ ] 下发最小安全委托并接收回报。
- [ ] 验证撤单、超时重试和异常恢复。
- [ ] 输出交易报告和状态记忆。

退出条件：

- 订单、成交、持仓、资金、撤单和报告闭环可复核。
- 所有交易事件可本地重放。
- 实盘开关仍保持关闭。

## Phase 4：受控实盘评估

目标：只有在前面阶段通过后，才评估是否进入真实资金。

工作项：

- [ ] 定义人工审批流程。
- [ ] 定义单票、组合、日内和总风险上限。
- [ ] 定义 kill switch。
- [ ] 定义次日对账与异常处理。

退出条件：

- 所有风控闸门有可执行检查。
- 所有执行动作有日志、回报和对账记录。
- 用户明确批准后才进入实盘评估。

## 当前最优下一步

1. 在 Windows 侧运行 `python miniqmt-workspace/adapter/health_check.py --mock` 确认契约输出，再用 `--userdata/--account` 连真实客户端，输出 Phase 0 health 并回填 `VALIDATION-LOG.md`。
2. 用 `quote_capture.py` / `order_flow_capture.py` 验证基础行情与 L2/逐笔权限；无 L2 时如实降级。
3. 用 `replay_export.py` 把真实录制导出为 `fixtures/ashare-live-*.json`，喂入轨道 A（`miniqmt:check`）做人工复核。
4. 累计 ≥20 个复核窗口后，再用 `paper_trade_probe.py` 推进 Phase 3 模拟盘闭环。

