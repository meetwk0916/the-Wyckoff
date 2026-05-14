# ptrade Wyckoff 文档说明

这个目录对应 `ptrade-workspace/` 这条独立工作线。

它只负责 A 股 ptrade 运行时下的目标定义、阶段推进和执行边界，不再和前端 MVP 控制台文档混放。

## 文档入口

- `GOALS.md`：ptrade 路线的最终目标、非目标、成功准则和硬闸门。
- `IMPLEMENTATION-PATH.md`：ptrade 路线的阶段拆解、退出条件和当前最优下一步。
- `PAPER-TRADE-ACCEPTANCE.md`：模拟盘主推 / 轮询 / 账户级巡检、报告和状态记忆闭环验收清单。
- `RISK-REGISTER.md`：ptrade 路线的核心风险、可行性边界和暂停 / 降级条件。
- `NO-HTTP-DATA-EXCHANGE.md`：基于官方文档整理的研究目录 / 文件 / sqlite3 无 HTTP 数据交换方案。
- `../wyckoff-mvp/PTRADE-TRADING.md`：canonical 策略脚本的回测 / 模拟盘操作说明。
- `../wyckoff-mvp/PTRADE-INTEGRATION.md`：bridge、环境约束和对接边界说明。
- `../wyckoff-mvp/PTRADE-VALIDATION.md`：Phase 0 环境验证说明。

## 与工作区的关系

- `ptrade-workspace/`：实际策略脚本、配置和状态边界。
- `docs/ptrade-wyckoff/`：目标、路线和硬闸门。
- `docs/wyckoff-mvp/`：前端控制台 MVP 文档，不再承担 ptrade 主路线说明。
- `docs/crypto-wyckoff/`：BTC / crypto 独立路线文档。

## 当前状态

截至 2026-05-14：

- 已完成 Phase 0 无 HTTP 基线验证，`ptrade_phase1_validation.py` 默认先写研究目录 JSON 与 sqlite3。
- Windows relay 只保留为客户端本地联调工具，不再默认作为 ptrade 真实出站目标。
- 已补 canonical 策略里的委托 / 成交主推事件记录，以及账户级订单 / 持仓巡检报告。
- 当前主线是用模拟盘验证主推、轮询、账户级巡检、订单 / 成交 / 持仓 / 报告闭环；其后再补交易时段 L2 / 逐笔权限验证和 JSON / sqlite3 reader 路径。
- 当前风险登记已收敛到 `RISK-REGISTER.md`；在模拟盘闭环、L2 / 逐笔权限、订单状态机、A 股样本复核完成前，不应把当前版本描述为可实盘模型。

## 分支边界

- `main` 保留共享前端、共享文档和多工作线的稳定基线。
- ptrade 后续实现建议从当前整理后的基线切独立分支，优先聚焦 `ptrade-workspace/` 与 `docs/ptrade-wyckoff/`。

## 当前结论

- ptrade 仍然是把这套 Wyckoff 策略推进到受控自动化交易前的主试验场。
- 当前第一优先级仍是模拟盘主推 / 轮询 / 账户级巡检、订单 / 成交 / 持仓 / 报告闭环，而不是继续堆新启发式。
- 真实交易时段的 L2 / 逐笔权限验证、撤单恢复和次日对账，是进入自动化执行评估前的硬前置条件。
- 当前更准确的定位是 Wyckoff 研究与模拟盘验证框架，而不是已经证明有效的自动交易模型。
