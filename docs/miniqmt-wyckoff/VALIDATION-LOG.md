# MiniQMT 验证日志

## 2026-05-13 初始化

本次只做 workspace 初始化，不连接真实 MiniQMT / QMT 客户端。

已完成：

- 新建 `feature/miniqmt-wyckoff-workspace` 分支。
- 新建 `docs/miniqmt-wyckoff/` 文档入口。
- 新建 `miniqmt-workspace/` 独立工作区。
- 明确 MiniQMT 路线优先使用 XtQuant 外部 Python 适配器。
- 明确共享文件 / DBF / CSV 只作为执行 fallback，不作为主行情通道。

当前未验证：

- Windows 侧 MiniQMT / QMT 客户端是否已安装。
- XtQuant Python 包是否可用。
- userdata 路径是否正确。
- 账号状态、行情订阅、L2、逐笔委托、逐笔成交、交易回报是否可读。

下一次验证命令应在 Windows 侧执行，目标不是下单，而是输出 `ADAPTER-CONTRACT.md` 中的 `health` 事件。

