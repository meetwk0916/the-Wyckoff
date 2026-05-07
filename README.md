# Wyckoff Radar MVP

这是一个独立的 Wyckoff 雷达原型工作区，使用 Vite + React 构建。

当前目标已经分成两个互相隔离的工作面：

- 前端仍保留 Wyckoff Radar MVP 控制台原型。
- ptrade 策略暂时隔离到 `ptrade-workspace/`，用于回测、模拟盘和真实数据指标接入。

前端冲刺 1 的最小可交付物：

- 监控矩阵
- 阶段 / 信号过滤
- 风险收益展示
- 人工预警确认
- 文档与测试用例先行

ptrade 当前首要功能清单：

- 在 `ptrade-workspace/strategy/ptrade_wyckoff_trader.py` 内运行 ptrade 原生回测和模拟盘。
- 在 ptrade 内实际复制和运行时，只以 `ptrade-workspace/strategy/ptrade_wyckoff_trader.py` 为准；策略说明集中保留在 `docs/wyckoff-mvp/PTRADE-TRADING.md`。
- 接入 L2 深度盘口、逐笔成交流、长周期量价、RS / Beta、静态标的池和状态记忆。
- 继续验证真实 ptrade 环境中的 L2 / 逐笔成交权限与回测可用性。

## 当前阶段状态

截至 2026-05-07：

- 已完成 canonical ptrade 脚本的一轮真实参数回测，确认交易报告、状态记忆、试仓升级和 runner 管理主路径可运行。
- 当前默认仍允许在无 L2 / 逐笔成交的环境下降级运行；这不阻塞 Phase 1 回测，但会直接限制 Phase 2 微观确认质量和 Phase 3 自动化交易可信度。
- 当前最短路径不再是继续堆前端，而是先补模拟盘里的订单 / 成交 / 持仓 / 报告闭环，再补交易时段 L2 / 逐笔权限验证。
- ptrade 仍是把这套策略推进到受控自动化交易阶段的主试验场，但自动化执行必须建立在撤单重试、次日对账、审批和风控闸门完成之后。

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
- 本地 `ptrade bridge` 服务骨架
- L2 订单流样例接口与录制能力
- 前端中的 bridge 健康状态和 L2 样例联调面板

当前尚未完成的部分：

- ptrade 模拟盘里的订单、成交、持仓与报告闭环验证
- 真实 ptrade 上游连接
- 真实 ptrade 环境中 L2 / 逐笔成交的稳定授权与回测覆盖
- 基于 `cancel_order` 的超时撤单 / 重报价与次日对账
- 研究接口、自动交易闭环和完整绩效平台

## 文档入口

- [docs/wyckoff-mvp/PRD.md](docs/wyckoff-mvp/PRD.md)
- [docs/wyckoff-mvp/IMPLEMENTATION-PATH.md](docs/wyckoff-mvp/IMPLEMENTATION-PATH.md)
- [docs/wyckoff-mvp/SPRINTS.md](docs/wyckoff-mvp/SPRINTS.md)
- [docs/wyckoff-mvp/MVP.md](docs/wyckoff-mvp/MVP.md)
- [docs/wyckoff-mvp/BROKER-INTEGRATION-EXPERIMENTS.md](docs/wyckoff-mvp/BROKER-INTEGRATION-EXPERIMENTS.md)
- [docs/wyckoff-mvp/PTRADE-INTEGRATION.md](docs/wyckoff-mvp/PTRADE-INTEGRATION.md)
- [docs/wyckoff-mvp/PTRADE-TRADING.md](docs/wyckoff-mvp/PTRADE-TRADING.md)
- [docs/wyckoff-mvp/QMT-INTEGRATION.md](docs/wyckoff-mvp/QMT-INTEGRATION.md)
- [docs/wyckoff-mvp/PTRADE-VALIDATION.md](docs/wyckoff-mvp/PTRADE-VALIDATION.md)
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

默认会以 `mock` 模式启动本地 bridge，用于联调 L2 数据契约与前端面板。

如果你已经有可访问的 ptrade 上游 bridge，可以这样切换到真实连接模式：

```bash
PTRADE_MODE=upstream PTRADE_UPSTREAM_URL=http://127.0.0.1:19090 npm run ptrade:bridge
```

说明：当前这台 WSL 环境里没有检测到现成的 ptrade 安装或连接配置，所以仓库内只能先做到本地 bridge 联调，真实连接仍依赖外部上游服务。

如果你要先在官方 PTrade 环境里验证账号绑定、Level2 权限和出站 HTTP 连通性，可直接使用：

- `docs/wyckoff-mvp/ptrade_phase1_validation.py`
- `docs/wyckoff-mvp/PTRADE-VALIDATION.md`

## 可用脚本

- `npm run dev`：启动 Vite 开发服务器
- `npm run build`：构建生产产物
- `npm run lint`：运行 ESLint
- `npm run preview`：本地预览构建结果
- `npm run ptrade:bridge`：启动 ptrade Phase 1 本地 bridge
