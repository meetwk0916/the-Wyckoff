# MiniQMT Wyckoff 文档说明

这个目录对应 `miniqmt-workspace/` 这条独立工作线。

它负责把当前 Wyckoff 方法论迁移到 MiniQMT / QMT 的 Windows 本地客户端适配模式下验证。它不替代 `ptrade-workspace/`，也不混入 BTC / crypto 的交易所数据路线。

## 文档入口

- `GOALS.md`：MiniQMT 路线的最终目标、非目标、成功准则和硬闸门。
- `IMPLEMENTATION-PATH.md`：MiniQMT 路线的阶段拆解、退出条件和当前最优下一步。
- `ADAPTER-CONTRACT.md`：Windows 侧 XtQuant 适配器与当前仓库之间的最小事件契约。
- `VALIDATION-LOG.md`：环境、权限、行情、L2、交易回报和桥接验证记录。
- `../wyckoff-mvp/QMT-INTEGRATION.md`：原始 QMT 接入路线研究。
- `../wyckoff-mvp/BROKER-INTEGRATION-EXPERIMENTS.md`：ptrade 与 QMT 两条券商接入实验路线总览。

## 与工作区的关系

- `miniqmt-workspace/`：Windows 侧适配器设计、配置样例、状态边界和后续脚本位置。
- `docs/miniqmt-wyckoff/`：目标、路线、契约和验收记录。
- `docs/wyckoff-mvp/`：共享前端控制台、旧 QMT 研究和 broker 接入总览。
- `ptrade-workspace/`：ptrade 运行时内策略路线，不和 MiniQMT 代码混用。
- `crypto-workspace/`：BTC / crypto 数据采集与回放路线，不和 A 股券商适配混用。

## 当前状态

截至 2026-05-13：

- 已新建 `feature/miniqmt-wyckoff-workspace` 分支。
- 已新建 `miniqmt-workspace/` 作为 MiniQMT 独立工作区。
- 已把 MiniQMT 路线定义为 `MiniQMT / QMT + XtQuant 外部 Python 适配器 -> 本地标准化事件 -> 当前 bridge / 前端`。
- 当前只做环境预检查、行情 / L2 / 逐笔能力验证、标准化事件契约、录制 / 回放和模拟交易闭环设计。
- 当前不启用实盘下单，不保存账号密码，不把 MiniQMT 路线描述成可直接自动交易的系统。

## 当前结论

MiniQMT 路线的价值在于本地客户端 + 外部 Python SDK 的工程可控性。它适合作为 A 股 Wyckoff 方法的第二条券商运行时路线：先复用 ptrade 已沉淀的策略输入层和 crypto 已沉淀的证据 / 回放 / 守门链思路，再决定是否进入模拟盘或实盘闸门。

