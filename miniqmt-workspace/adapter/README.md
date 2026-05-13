# MiniQMT Adapter

这里预留 Windows 侧 XtQuant 外部 Python 适配器代码。

当前阶段只定义边界，不提交真实账号配置或可下单脚本。

## 第一版 adapter 目标

1. 检查 Python 环境和 XtQuant 包是否可导入。
2. 连接 MiniQMT / QMT userdata 路径。
3. 查询账号状态。
4. 输出标准化 `health` 事件。
5. 不下单，不撤单，不保存凭据。

## 后续 adapter 模块建议

- `health_check.py`：环境、客户端、账号和权限预检查。
- `quote_capture.py`：基础行情订阅与落盘。
- `order_flow_capture.py`：L2 / 逐笔委托 / 逐笔成交订阅与落盘。
- `paper_trade_probe.py`：模拟盘委托、撤单、成交和持仓回报验证。
- `replay_export.py`：把本地录制转换为当前仓库可回放格式。

## 输出契约

以 `../../docs/miniqmt-wyckoff/ADAPTER-CONTRACT.md` 为准。

