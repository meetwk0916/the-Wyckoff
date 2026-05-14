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

截至 2026-05-10，BTC / crypto 方向已经进入可回放的 Phase C 早期验证：

- `crypto-workspace/` 已实现公开 REST / WebSocket 探测、JSONL 落盘、replay window、固定 fixture、Phase C evidence 聚合和保守分类。
- 当前固定两个 OKX BTC replay fixture：一个真实 BTC 清算窗口，一个无清算对照窗口。
- 当前唯一真实清算窗口被分类为 `short_squeeze_only`，不是 `spring_candidate`；这说明系统已经能挡住“空头挤压误判成 Spring”的第一类风险。
- 当前仍未完成结构支撑 / 阻力识别、正式 spot/perp CVD 判据、20 个历史窗口人工复核、Phase D LPS paper trade、P&F 仓位管理和 sandbox。

## 项目定位

这个项目独立于现有聊天项目，只承载 Wyckoff Radar MVP 的前端原型与后续迭代。

前端原型本身仍然不包含：

- 真实 ptrade / QMT 上游接入
- 实时行情
- 自动下单
- 生产级持久化后端

当前已具备的 ptrade 能力：

- 独立 `ptrade-workspace/` 子工作区
- ptrade 原生策略 `ptrade-workspace/strategy/ptrade_wyckoff_trader.py`
- L2 订单簿失衡、逐笔 CVD、长周期量价、RS / Beta、静态标的池、状态记忆的策略侧输入
- 基于 `get_research_path()` 的 JSON / sqlite3 Phase 0 预检查与默认落盘基线
- 本地 `ptrade bridge` 服务骨架
- L2 订单流样例接口与录制能力
- 前端中的 bridge 健康状态和 L2 样例联调面板

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

### 4. 启动 ptrade Phase 1 relay

说明：这条 relay 只用于本地联调或调试，不是 ptrade 当前默认的数据交换主路径。当前默认基线请先看 `docs/ptrade-wyckoff/NO-HTTP-DATA-EXCHANGE.md`。

如果你要先在本机起一个最小 relay，接收 ptrade 运行时的 `POST` 推送，并向当前 bridge 暴露统一 `GET` 接口，先启动：

```bash
npm run ptrade:relay
```

默认监听：

```bash
http://127.0.0.1:19090
```

如果你只是想在当前机器上验证 relay 自己是否能启动并返回接口，可先看下面这个地址：

```bash
http://127.0.0.1:19090/ptrade
```

但当前已确认：ptrade 实际运行在券商服务器上，Windows 这边只是客户端。因此这个 `127.0.0.1` 只能用于本机自检，不能默认作为 ptrade 策略里的真实出站地址。

当前这台开发机在 WSL 内检测到的本机 IPv4 是：

```bash
http://172.19.46.143:19090
```

对应接口：

- `POST /ptrade`
- `GET /health`
- `GET /l2-order-flow?symbol=600570.XSHG`

说明：

- 本机客户端自检：可用 `http://127.0.0.1:19090/ptrade`
- ptrade 真正出站目标：必须改成券商服务器实际可达的内网 IP、域名或中转地址
- 其他机器访问当前 relay：再考虑 `http://172.19.46.143:19090/ptrade` 或你自己确认可达的内网 IP
- WSL 内网 IP 可能在重启后变化

### 5. 启动 ptrade Phase 1 bridge

```bash
npm run ptrade:bridge
```

默认会以 `mock` 模式启动本地 bridge，用于联调 L2 数据契约与前端面板。

如果你已经有可访问的 ptrade 上游 bridge，可以这样切换到真实连接模式：

```bash
PTRADE_MODE=upstream PTRADE_UPSTREAM_URL=http://127.0.0.1:19090 npm run ptrade:bridge
```

如果 bridge 也跑在当前 WSL 里，连接这个本机 relay 时优先这样配：

```bash
PTRADE_MODE=upstream PTRADE_UPSTREAM_URL=http://127.0.0.1:19090 npm run ptrade:bridge
```

如果你要显式走当前检测到的 WSL IPv4，也可以这样配：

```bash
PTRADE_MODE=upstream PTRADE_UPSTREAM_URL=http://172.19.46.143:19090 npm run ptrade:bridge
```

说明：当前这台 WSL 环境里没有检测到现成的 ptrade 安装或连接配置，所以仓库内只能先做到本地 bridge 联调，真实连接仍依赖外部上游服务。

如果你要先在官方 PTrade 环境里验证账号绑定、研究目录 JSON / sqlite3 落盘，以及可选的出站 HTTP 探测，可直接使用：

- `docs/wyckoff-mvp/ptrade_phase1_validation.py`
- `docs/wyckoff-mvp/PTRADE-VALIDATION.md`
- `docs/ptrade-wyckoff/README.md`

## 可用脚本

- `npm run dev`：启动 Vite 开发服务器
- `npm run build`：构建生产产物
- `npm run lint`：运行 ESLint
- `npm run preview`：本地预览构建结果
- `npm run ptrade:relay`：启动最小 ptrade relay，接收 `POST /ptrade` 并暴露 `GET /health`、`GET /l2-order-flow`
- `npm run ptrade:bridge`：启动 ptrade Phase 1 本地 bridge
- `npm run crypto:fixtures`：运行固定 BTC replay fixture 检查
- `npm run crypto:phase-c:evidence`：从 fixture / 时间窗生成 Phase C 证据报告
- `npm run crypto:phase-c:classify`：把 Phase C 证据保守分类为候选 / 风险 / 空头挤压 / 证据不足
- `npm run crypto:phase-c:review`：运行 Phase C 人工复核索引评分
- `npm run crypto:phase-c:verify`：检查固定 Phase C 对照样本标签和 review agreement
- `npm run crypto:phase-c:check`：按 evidence → classify → review → verify 顺序运行完整 Phase C 守门链路
- `npm run crypto:capture:status -- --screen=wyckoff_bybit_liq_capture_24h_heartbeat`：监控心跳版 Bybit liquidation 长跑采集
- `npm run crypto:daily-check`：每日汇总 Bybit 7d 长跑 screen、最新心跳、BTC long / short liquidation 和 Phase C candidate 状态
