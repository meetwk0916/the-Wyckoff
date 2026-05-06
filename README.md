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

## 文档入口

- [docs/wyckoff-mvp/PRD.md](docs/wyckoff-mvp/PRD.md)
- [docs/wyckoff-mvp/IMPLEMENTATION-PATH.md](docs/wyckoff-mvp/IMPLEMENTATION-PATH.md)
- [docs/wyckoff-mvp/SPRINTS.md](docs/wyckoff-mvp/SPRINTS.md)
- [docs/wyckoff-mvp/MVP.md](docs/wyckoff-mvp/MVP.md)
- [docs/wyckoff-mvp/PTRADE-INTEGRATION.md](docs/wyckoff-mvp/PTRADE-INTEGRATION.md)
- [docs/wyckoff-mvp/TEST-CASES.md](docs/wyckoff-mvp/TEST-CASES.md)
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

## 可用脚本

- `npm run dev`：启动 Vite 开发服务器
- `npm run build`：构建生产产物
- `npm run lint`：运行 ESLint
- `npm run preview`：本地预览构建结果
