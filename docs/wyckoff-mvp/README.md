# Wyckoff MVP 交付文档说明

这个目录定义了 Wyckoff 雷达 MVP 的“文档先行”交付方案。

它现在只承载前端控制台 MVP 这一条文档线；ptrade 专项文档已经迁移到 `../ptrade-wyckoff/`。

文档包括：

- `PRD.md`：产品背景、目标用户、目标和范围
- `IMPLEMENTATION-PATH.md`：工程实施顺序与建议的下一步切口
- `SPRINTS.md`：按冲刺划分的交付物与退出标准
- `MVP.md`：冲刺 1 的产品与工程范围
- `TEST-CASES.md`：冲刺 1 的验收与回归测试用例

ptrade 文档入口：

- `../ptrade-wyckoff/README.md`
- `../ptrade-wyckoff/GOALS.md`
- `../ptrade-wyckoff/IMPLEMENTATION-PATH.md`

基本原则：

- 功能开发前先落文档和测试用例。
- 冲刺 1 是前端监控型 MVP，目标是可见性，不是交易执行。
- 真实行情上游、真实 ptrade 上游接入和自动执行明确延后；本地 ptrade bridge / relay 只用于联调和调试。
