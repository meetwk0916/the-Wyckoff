# ptrade 无 HTTP 数据交换方案

## 结论

基于官方文档与 FAQ，ptrade 的默认运行前提应当是：

- 策略运行在券商机房。
- 运行环境通常处于内网。
- 默认不能假设可以访问外网或主动向外做 HTTP 推送。

因此，Phase 0 和 Phase 1 的默认数据交换路径，不应设计成 `ptrade -> HTTP relay`，而应优先使用官方明确支持的本地持久化与内置能力。

## 官方依据

### 1. 运行环境与网络边界

官方首页与 FAQ 都强调：

- ptrade 运行在券商机房，属于托管模式。
- ptrade 处于内网环境，无法连接到互联网。
- FAQ 明确写到：`ptrade 的运行环境是封闭的，无法连接外网。国盛证券除外。`

这意味着：

- 不能默认依赖公网 HTTP。
- 不能把 Windows 客户端本机地址当成 ptrade 运行环境可达地址。
- 即便少数券商支持 HTTP，也只能算例外增强，不应作为主路径。

### 2. 研究目录是官方文件根路径

官方 `get_research_path()` 文档明确写到：

- 该接口用于获取研究根目录路径。
- 返回路径为 `/home/fly/notebook/`。
- 部分券商会限制代码里直接写死 `/home/fly/notebook/`，应改为调用 `get_research_path()`。

因此，所有本地文件落盘路径都应通过 `get_research_path()` 生成，而不要把绝对路径硬编码在策略里。

### 3. 官方支持文件读写与目录创建

官方文档明确给出了：

- 使用 `pickle` + `open()` + `get_research_path()` 做策略状态持久化的示例。
- `create_dir(user_path=...)` 用于在 `/home/fly/notebook/` 下创建子目录。
- `get_trades_file(save_path='')` 可以把回测对账数据导出为 CSV 文件到 notebook 根目录或指定子目录。
- `convert_position_from_csv(path)` 可以从研究目录中的 CSV 文件读取底仓配置。

这说明官方是明确支持“研究目录文件交换”这条路径的，而不是只允许框架内存态。

### 4. 官方支持 sqlite3

FAQ 明确写到：

- ptrade 内置了 `sqlite3`。
- 可以直接 `import sqlite3` 使用。
- 可以作为自己的持久化数据库。
- 不同策略可以共同访问全局数据。

这意味着 sqlite3 不是权宜之计，而是官方明确给出的共享持久化手段。

### 5. 框架内建持久化仍然存在，但不能替代文件数据库

官方“关于持久化”说明里还明确写到：

- 框架会在 `before_trading_start`、`handle_data`、`after_trading_end` 后保存可持久化的 `g` 变量。
- 服务器重启拉起交易时，会先执行 `initialize`，再恢复持久化信息。
- `g` 中不能被序列化的对象不会被保存。
- 涉及 IO、打开的文件、类实例等对象不能被序列化。
- 以 `__` 开头的 `g.__private` 不会被保存。

因此框架持久化适合保存轻量状态，不适合充当结构化交换层或审计数据库。

## 官方可行的无 HTTP 交换层

### 方案 A：研究目录 JSON / CSV / pickle

适用场景：

- 最近一次验证结果快照
- 策略日终报告
- 中间状态恢复
- 下游人工查看或后处理脚本消费

建议做法：

1. 所有路径都从 `get_research_path()` 拼接。
2. 如需分目录，先调用 `create_dir()`。
3. 最近一次结果使用固定文件名覆盖写，如 `ptrade-phase1-validation-last.json`。
4. 时序记录可追加写 CSV 或按日期拆文件。

优点：

- 官方明确支持。
- 最稳，最少依赖。
- 人工排查最直接。

缺点：

- 多策略共享和查询能力一般。
- 需要自己处理并发覆盖、文件命名和清理。

### 方案 B：sqlite3 作为共享状态库

适用场景：

- 多次验证结果追加记录
- 多策略共享小型状态表
- 事件、信号、报告索引
- 后续 bridge / 离线回放的标准化读取入口

建议做法：

1. sqlite 文件放在 `get_research_path()` 下。
2. 一类对象一张表，例如：
   - `phase1_validation_runs`
   - `signal_events`
   - `daily_reports`
3. 原始 payload 保留一列 `payload_json`，同时抽取少量索引字段。
4. 只把 sqlite 当轻量共享库，不当高并发消息总线。

优点：

- 官方明确支持。
- 比单文件更适合追加写和查询。
- 适合后续做 bridge / replay 的读取层。

缺点：

- 仍要自己处理 schema 演进。
- 并发写入需要保守设计。

### 方案 C：框架持久化的 `g` 变量

适用场景：

- 当日运行状态
- 仓龄、阶段、标记位
- 重启后需恢复的小对象

不适合：

- 长期审计记录
- 跨策略共享数据
- IO 句柄、数据库连接、复杂类实例

结论：

- 它是运行时恢复层，不是正式交换层。

### 方案 D：官方导出接口

适用场景：

- `get_trades_file()`：回测对账 CSV 导出
- `get_deliver()`：交易交割单拉取
- `get_fundjour()`：交易资金流水拉取

结论：

- 这类接口更适合对账和审计，不适合作为盘中主交换层。

## 推荐落地顺序

### Phase 0

默认使用：

1. `get_research_path()` + JSON 最近结果文件
2. `sqlite3` 追加记录验证结果
3. HTTP 只做可选探测，不做主路径

### Phase 1

默认使用：

1. `g` 持久化保存轻量运行状态
2. JSON 输出日终报告
3. sqlite3 作为事件 / 报告索引层
4. `get_deliver()` / `get_fundjour()` 做次日对账

### Phase 2 以后

只有在券商明确支持、且现场验证可达时，才把 HTTP / relay 作为增强层加入；否则继续沿用文件 / sqlite / 回放方案。

## 对当前仓库的直接含义

1. `docs/wyckoff-mvp/ptrade_phase1_validation.py` 默认应优先写 JSON 和 sqlite，而不是默认打公网 HTTP。
2. Windows 本机 relay 只能作为客户端本地联调工具，不能默认当成 ptrade 真正出站目标。
3. 后续如果要做 bridge，优先考虑“从研究目录 JSON / sqlite 读取”这一条内网友好路径，而不是要求 ptrade 主动回调客户端服务。

## 当前推荐基线

- 最近一次结果：JSON 文件
- 历史结果与索引：sqlite3
- 轻量运行态恢复：框架持久化 `g`
- 对账数据：`get_trades_file()` / `get_deliver()` / `get_fundjour()`
- HTTP：仅在券商明确支持并现场验证通过后启用