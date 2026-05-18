# MiniQMT State Boundary

这个目录只说明 MiniQMT 本地状态和录制文件的边界。

未来真实运行时产生的文件不应提交到 git，包括：

- health probe 输出
- quote / order-flow JSONL
- sqlite3 录制库
- account / order / trade 回报
- 本地 session id 与客户端路径
- 任何账号、密码、交易密码、token 或券商私有配置

建议未来输出位置：

```text
miniqmt-workspace/state/local/
miniqmt-workspace/state/reports/
miniqmt-workspace/state/replay-fixtures/
```

这些路径如果开始写入真实数据，应加入 `.gitignore`。

