# Wyckoff Radar MVP

这是一个独立的 Wyckoff 雷达原型工作区，使用 Vite + React 构建。

当前目标是先完成冲刺 1 的最小可交付物：

- 监控矩阵
- 阶段 / 信号过滤
- 风险收益展示
- 人工预警确认
- 文档与测试用例先行

下一阶段首要功能清单：

- ptrade Phase 1：优先获取 L2 订单流，并沉淀统一数据契约与回放能力
- ptrade Phase 2：在 L2 数据稳定后扩展其他 API 能力，例如回测与研究接口
- ptrade Phase 3：最后再推进自动交易、执行反馈与风控闭环

## 项目定位

这个项目独立于现有聊天项目，只承载 Wyckoff Radar MVP 的前端原型与后续迭代。

当前版本明确不包含：

- ptrade / QMT 接入
- 实时行情
- 自动下单
- 持久化后端

当前已具备的 ptrade Phase 1 能力：

- 本地 `ptrade bridge` 服务骨架
- L2 订单流样例接口与录制能力
- 前端中的 bridge 健康状态和 L2 样例联调面板

当前尚未完成的部分：

- 真实 ptrade 上游连接
- 真实 L2 订单流接入
- 研究接口、回测与自动交易闭环

## 文档入口

- [docs/wyckoff-mvp/PRD.md](docs/wyckoff-mvp/PRD.md)
- [docs/wyckoff-mvp/IMPLEMENTATION-PATH.md](docs/wyckoff-mvp/IMPLEMENTATION-PATH.md)
- [docs/wyckoff-mvp/SPRINTS.md](docs/wyckoff-mvp/SPRINTS.md)
- [docs/wyckoff-mvp/MVP.md](docs/wyckoff-mvp/MVP.md)
- [docs/wyckoff-mvp/BROKER-INTEGRATION-EXPERIMENTS.md](docs/wyckoff-mvp/BROKER-INTEGRATION-EXPERIMENTS.md)
- [docs/wyckoff-mvp/PTRADE-INTEGRATION.md](docs/wyckoff-mvp/PTRADE-INTEGRATION.md)
- [docs/wyckoff-mvp/QMT-INTEGRATION.md](docs/wyckoff-mvp/QMT-INTEGRATION.md)
- [docs/wyckoff-mvp/PTRADE-VALIDATION.md](docs/wyckoff-mvp/PTRADE-VALIDATION.md)
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
