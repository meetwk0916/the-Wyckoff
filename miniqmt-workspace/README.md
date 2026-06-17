# MiniQMT Wyckoff 工作区

这个目录是 MiniQMT / QMT 专用工作区，目标是把当前 Wyckoff 方法迁移到 Windows 本地客户端 + XtQuant 外部 Python 适配器模式下验证。

它不是 ptrade 策略目录，也不是实盘交易系统。

## 当前阶段状态

截至 2026-06-17：

- 已建立独立分支与 `docs/miniqmt-wyckoff/`、`miniqmt-workspace/`。
- **轨道 A（离线可验证管线，已跑通）**：`src/` 纯 Node 实现 evidence → classify → outcome → verify，3 个 A 股 seed fixture，内置前瞻证伪契约与 dumb baseline 对照。
- **轨道 B（Windows 适配器脚本，已就绪待跑）**：`adapter/` Python 脚本覆盖 Phase 0 health、Phase 1 行情/L2、Phase 3 模拟盘探针、录制导出，全部带 `--mock`。
- 尚未连接真实 Windows MiniQMT / QMT 客户端；尚未实现/开启真实交易。

## 命令

离线管线（本机即可，无第三方依赖）：

```bash
npm run miniqmt:check        # contract:validate -> evidence -> classify -> outcome -> verify
# 或单步：miniqmt:contract:validate / miniqmt:evidence / miniqmt:classify / miniqmt:outcome / miniqmt:verify
# 若 npm 受限，可直接：node miniqmt-workspace/src/runEvidence.mjs 等
```

Windows 适配器（在装有 MiniQMT/QMT + XtQuant 的 Windows 上）：

```bash
python adapter/health_check.py --mock
python adapter/health_check.py --userdata "C:/path/userdata_mini" --account <id>
python adapter/quote_capture.py --mock --symbols 600570.SH
python adapter/order_flow_capture.py --mock --symbols 600570.SH
python adapter/paper_trade_probe.py --mock --symbol 600570.SH
python adapter/replay_export.py --recording state/order_flow.jsonl --symbol 600570.SH --out fixtures/ashare-live-600570.json
```

## 文件

- `src/`：离线 Node 管线（`lib/` + `run*.mjs`）。
- `fixtures/`：A 股 seed 窗口与 `recordings/` 契约样例。
- `reports/`：管线输出（git 忽略，运行时生成）。
- `adapter/`：Windows 侧 XtQuant 外部 Python 适配器。
- `config/miniqmt-wyckoff-policy-pool.json`：A 股策略候选池样例。
- `state/README.md`：本地状态、日志、录制文件边界。
- `miniqmt.code-workspace`：只打开本工作区与 MiniQMT 文档的 VS Code 工作区文件。

## 推荐实现形态

```text
MiniQMT / QMT client
  -> XtQuant external Python adapter
  -> normalized health / quote / order_flow / account / order events
  -> local append-only store
  -> replay / evidence report
  -> bridge / frontend
```

## Wyckoff 输入层迁移

优先复用 ptrade 路线已经沉淀的 A 股输入层：

1. 静态标的池：政策预期、基本面困境反转或行业主题。
2. 长周期量价：确认积累背景、支撑阻力和供给枯竭。
3. RS / Beta：过滤弱于市场或系统风险过高的标的。
4. L2 订单簿：计算买卖盘失衡和盘口恢复。
5. 逐笔成交：计算 CVD 和主动买卖压力。
6. 状态记忆：保存阶段、关键位、确认状态和交易报告。

## 使用边界

- Windows 侧真实客户端验证前，不写交易执行逻辑。
- L2 / 逐笔权限未验证前，不把微观结构作为强入场条件。
- 模拟盘订单 / 成交 / 撤单 / 持仓闭环未验证前，不进入实盘。
- 不在仓库内保存真实账号、密码、交易密码、柜台地址或 token。
- MiniQMT 文档统一从 `../docs/miniqmt-wyckoff/README.md` 进入。

