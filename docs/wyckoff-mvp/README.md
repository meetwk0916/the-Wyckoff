# Wyckoff MVP 交付文档说明

这个目录定义了 Wyckoff 雷达 MVP 的“文档先行”交付方案。

文档包括：

- `PRD.md`：产品背景、目标用户、目标和范围
- `IMPLEMENTATION-PATH.md`：工程实施顺序与建议的下一步切口
- `SPRINTS.md`：按冲刺划分的交付物与退出标准
- `MVP.md`：冲刺 1 的产品与工程范围
- `PTRADE-INTEGRATION.md`：ptrade 对接的三阶段规划与能力边界
- `PTRADE-TRADING.md`：ptrade canonical 策略脚本的回测 / 模拟盘操作说明
- `TEST-CASES.md`：冲刺 1 的验收与回归测试用例

基本原则：

- 功能开发前先落文档和测试用例。
- 冲刺 1 是前端监控型 MVP，目标是可见性，不是交易执行。
- 实时行情、ptrade 接入和自动执行明确延后。
- ptrade 对接按 Phase 0 环境预检查、Phase 1 回测 / 模拟盘 / 交易报告闭环、Phase 2 L2 / 逐笔增强与统一契约、Phase 3 实盘执行与风控闸门推进；当前主线是 Phase 1 闭环，真实 L2 / 逐笔权限验证是 Phase 2 的前置条件。
