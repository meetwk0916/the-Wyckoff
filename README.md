# Wyckoff Radar MVP

这是一个独立的 Wyckoff 雷达原型工作区，使用 Vite + React 构建。

当前目标已经分成两个互相隔离的工作面：

- 前端仍保留 Wyckoff Radar MVP 控制台原型。
- ptrade 策略暂时隔离到 `ptrade-workspace/`，用于回测、模拟盘和真实数据指标接入。
- ptrade 文档主入口迁移到 `docs/ptrade-wyckoff/`，与 `ptrade-workspace/` 对齐。
- BTC / crypto 方向以 `docs/crypto-wyckoff/` 记录目标、统一数据源研究和后续 `crypto-workspace/` 的实施边界。

前端冲刺 1 的最小可交付物：

- 监控矩阵
- 阶段 / 信号过滤
- 风险收益展示
- 人工预警确认
- 文档与测试用例先行

ptrade 当前首要功能清单：

- 在 `ptrade-workspace/strategy/ptrade_wyckoff_trader.py` 内运行 ptrade 原生回测和模拟盘。
- 在 ptrade 内实际复制和运行时，只以 `ptrade-workspace/strategy/ptrade_wyckoff_trader.py` 为准；ptrade 路线文档统一从 `docs/ptrade-wyckoff/README.md` 进入。
- 以 `docs/ptrade-wyckoff/GOALS.md` 约束当前阶段的成功准则、硬闸门和执行顺序。
- 以 `get_research_path()` + JSON + sqlite3 作为 Phase 0 默认数据交换基线；HTTP relay 只作为可选增强或本地联调工具。
- 接入 L2 深度盘口、逐笔成交流、长周期量价、RS / Beta、静态标的池和状态记忆。
- 当前主线是模拟盘订单 / 成交 / 持仓 / 报告闭环，其后再补真实交易时段 L2 / 逐笔权限验证。

## 当前阶段状态

截至 2026-05-08：

- 已完成 canonical ptrade 脚本的一轮真实参数回测，确认交易报告、状态记忆、试仓升级和 runner 管理主路径可运行。
- 已在实际 ptrade 环境完成 Phase 0 无 HTTP 预检查，确认 `get_research_path()` 下的 JSON 与 sqlite3 默认落盘链路可用。
- 当前默认仍允许在无 L2 / 逐笔成交的环境下降级运行；这不阻塞 Phase 1 回测，但会直接限制 Phase 2 微观确认质量和 Phase 3 自动化交易可信度。
- Windows relay 已收窄为客户端本地联调工具，不再默认等同于 ptrade 策略运行环境的真实目标地址。
- 当前最短路径不再是继续堆前端，也不是继续扩写 HTTP relay，而是先补模拟盘里的订单 / 成交 / 持仓 / 报告闭环，再补交易时段 L2 / 逐笔权限验证。
- ptrade 仍是把这套策略推进到受控自动化交易阶段的主试验场，但自动化执行必须建立在撤单重试、次日对账、审批和风控闸门完成之后。
- BTC / crypto 方向已明确第一阶段不做实盘、不做左侧抄底机器人；先验证统一数据源、标准化事件契约和 Phase C 洗盘过滤器。

## 项目定位

这个项目独立于现有聊天项目，只承载 Wyckoff Radar MVP 的前端原型与后续迭代。

前端原型本身仍然不包含：

- ptrade / QMT 接入
- 实时行情
- 自动下单
- 持久化后端

当前已具备的 ptrade 能力：

- 独立 `ptrade-workspace/` 子工作区
- ptrade 原生策略 `ptrade-workspace/strategy/ptrade_wyckoff_trader.py`
- L2 订单簿失衡、逐笔 CVD、长周期量价、RS / Beta、静态标的池、状态记忆的策略侧输入
- 基于 `get_research_path()` 的 JSON / sqlite3 Phase 0 预检查与默认落盘基线
- 前端侧保留一套本地 bridge / relay 联调骨架，但它只用于 UI 契约调试，不代表 ptrade 当前默认交换路径

当前尚未完成的部分：

- ptrade 模拟盘里的订单、成交、持仓与报告闭环验证
- 基于研究目录 JSON / sqlite3 的 bridge 读取路径
- 真实 ptrade 环境中 L2 / 逐笔成交的稳定授权与回测覆盖
- 基于 `cancel_order` 的超时撤单 / 重报价与次日对账
- 研究接口、自动交易闭环和完整绩效平台

## 文档入口

- [docs/wyckoff-mvp/README.md](docs/wyckoff-mvp/README.md)
- [docs/wyckoff-mvp/PRD.md](docs/wyckoff-mvp/PRD.md)
- [docs/wyckoff-mvp/IMPLEMENTATION-PATH.md](docs/wyckoff-mvp/IMPLEMENTATION-PATH.md)
- [docs/wyckoff-mvp/SPRINTS.md](docs/wyckoff-mvp/SPRINTS.md)
- [docs/wyckoff-mvp/MVP.md](docs/wyckoff-mvp/MVP.md)
- [docs/wyckoff-mvp/BROKER-INTEGRATION-EXPERIMENTS.md](docs/wyckoff-mvp/BROKER-INTEGRATION-EXPERIMENTS.md)
- [docs/ptrade-wyckoff/README.md](docs/ptrade-wyckoff/README.md)
- [docs/ptrade-wyckoff/GOALS.md](docs/ptrade-wyckoff/GOALS.md)
- [docs/ptrade-wyckoff/IMPLEMENTATION-PATH.md](docs/ptrade-wyckoff/IMPLEMENTATION-PATH.md)
- [docs/wyckoff-mvp/QMT-INTEGRATION.md](docs/wyckoff-mvp/QMT-INTEGRATION.md)
- [docs/crypto-wyckoff/README.md](docs/crypto-wyckoff/README.md)
- [docs/crypto-wyckoff/GOALS.md](docs/crypto-wyckoff/GOALS.md)
- [docs/crypto-wyckoff/DATA-SOURCES.md](docs/crypto-wyckoff/DATA-SOURCES.md)
- [docs/crypto-wyckoff/IMPLEMENTATION-PATH.md](docs/crypto-wyckoff/IMPLEMENTATION-PATH.md)
- [docs/crypto-wyckoff/VALIDATION-LOG.md](docs/crypto-wyckoff/VALIDATION-LOG.md)
- [ptrade-workspace/README.md](ptrade-workspace/README.md)
- [docs/wyckoff-mvp/TEST-CASES.md](docs/wyckoff-mvp/TEST-CASES.md)
- [docs/reference/qmt/迅投QMT极速策略交易系统说明文档.pdf](docs/reference/qmt/迅投QMT极速策略交易系统说明文档.pdf)
- [AGENTS.md](AGENTS.md)

## 本地运行

### 1. 安装依赖

```bash
npm install
```

### 2. 启动开发环境

```bash
npm run dev
```

默认访问地址：

```bash
http://localhost:5173
```

### 3. 构建验证

```bash
npm run build
```

### 4. 启动 ptrade Phase 1 bridge

```bash
npm run ptrade:bridge
```

默认会以 `mock` 模式启动本地 bridge，用于联调 L2 数据契约与前端面板。它不代表 ptrade 当前主数据交换路径；当前主路径仍是研究目录 JSON / sqlite3。

如果你已经有一个明确可达的上游 HTTP bridge，可以这样切换到连接模式：

```bash
PTRADE_MODE=upstream PTRADE_UPSTREAM_URL=http://127.0.0.1:19090 npm run ptrade:bridge
```

如果你只是需要本地 UI 契约调试，再看下面这些可选工具：

- `npm run ptrade:relay`
- `ptrade-workspace/windows-relay/README.md`

如果你要显式走某个内网 IP，也可以这样配：

```bash
PTRADE_MODE=upstream PTRADE_UPSTREAM_URL=http://<broker-reachable-ip-or-host>:19090 npm run ptrade:bridge
```

说明：当前仓库内还没有把 bridge 改成直接读取研究目录 JSON / sqlite3；在这个 reader 路径补齐前，bridge 仍只是一层前端联调工具。

如果你要先在官方 PTrade 环境里验证账号绑定、研究目录 JSON / sqlite3 落盘，以及可选的出站 HTTP 探测，可直接使用：

- `docs/wyckoff-mvp/ptrade_phase1_validation.py`
- `docs/wyckoff-mvp/PTRADE-VALIDATION.md`
- `docs/ptrade-wyckoff/README.md`

## 可用脚本

- `npm run dev`：启动 Vite 开发服务器
- `npm run build`：构建生产产物
- `npm run lint`：运行 ESLint
- `npm run preview`：本地预览构建结果
- `npm run ptrade:bridge`：启动 ptrade Phase 1 本地 bridge，仅用于当前前端联调
- `npm run ptrade:relay`：启动最小 ptrade relay，仅用于本地 UI 契约调试
