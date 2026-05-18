# MiniQMT Wyckoff 工作区

这个目录是 MiniQMT / QMT 专用工作区，目标是把当前 Wyckoff 方法迁移到 Windows 本地客户端 + XtQuant 外部 Python 适配器模式下验证。

它不是 ptrade 策略目录，也不是实盘交易系统。

## 当前阶段状态

截至 2026-05-13：

- 已建立独立分支 `feature/miniqmt-wyckoff-workspace`。
- 已建立 `docs/miniqmt-wyckoff/` 和 `miniqmt-workspace/`。
- 当前只定义目标、契约、配置边界和验证顺序。
- 尚未连接真实 Windows MiniQMT / QMT 客户端。
- 尚未实现下单、撤单或实盘交易。

## 文件

- `adapter/README.md`：Windows 侧 XtQuant 适配器边界。
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

