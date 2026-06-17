# MiniQMT Adapter

Windows 侧 XtQuant 外部 Python 适配器。已实现第一版脚本（标准库 + XtQuant，
全部带 `--mock` 离线模式），不提交真实账号配置，默认不可下单。

## 已实现脚本

- `lib_contract.py`：事件构造、symbol 归一、账号脱敏、append-only 落盘、凭据守卫。
- `health_check.py`：Phase 0 环境/客户端/账号/权限预检查，输出标准 `health` 事件。
- `quote_capture.py`：Phase 1 基础行情订阅与 JSONL 落盘。
- `order_flow_capture.py`：Phase 1 L2 十档/逐笔捕获；无 L2 权限时如实降级为 `basic_quote_fallback`，不伪造微观确认。
- `paper_trade_probe.py`：Phase 3 模拟盘委托/撤单/回报闭环探针；`--arm-live` 被显式拒绝。
- `replay_export.py`：把本地录制导出为离线管线（`../src/`）可消费的 fixture 窗口。

## 离线先行

每个脚本都支持 `--mock`，在没有 XtQuant 的环境下输出契约样例，便于先验证字段映射：

```bash
python health_check.py --mock
```

## 输出契约

以 `../../docs/miniqmt-wyckoff/ADAPTER-CONTRACT.md` 为准。第一阶段禁止保存任何
真实账号、密码、交易密码、柜台地址或 token；默认不开启真实交易。

