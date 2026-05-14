# ptrade Phase 1 最小验证脚本

## 目的

这份脚本现在按 Phase 0 环境预检查理解：它用于给 `ptrade-workspace/strategy/ptrade_wyckoff_trader.py` 上线前做账号、L2 和网络边界确认，不再作为最终交易 / 回测方案本身。

这份脚本用于在官方 PTrade 交易环境里一次性验证四件事：

1. 当前策略是否绑定到了预期账号。
2. 当前标的是否能拿到可用的 Level2 线索。
3. 当前运行环境是否能把结果稳定落到本地 JSON 文件。
4. 当前运行环境是否允许向外发送 HTTP 请求。

对应脚本文件：`ptrade_phase1_validation.py`

## 最短用法

如果你只想知道“现在该怎么跑”，按下面做，不用先读完整篇。

### 白天交易时段验证

适用时间：`09:30-14:59`

1. 在 PTrade 新建一个股票交易策略。
2. 粘贴 `ptrade_phase1_validation.py`。
3. 默认只需要改一个值；如果你要额外验证网络出口，再配置 `g.validation_target` 或 `g.validation_targets`：

```python
g.symbol = '你要验证的股票代码'
g.validation_target = ''
g.validation_targets = []
```

4. 保持：

```python
g.smoke_test_enabled = False
```

5. 启动交易。
6. 看日志里的 `Wyckoff ptrade validation => ...`。
7. 重点先看四个字段：
	- `account.status`
	- `l2.status`
	- `localResultPath`
	- `outbound.status`

判定标准：

- `account.status` 不是空，说明账号绑定链路能读到。
- `l2.status = confirmed`，说明 L2 / 逐笔线索可继续联调。
- `localResultPath` 有值，说明最基本的本地文件落盘路径可用。
- `outbound.status = skipped` 在默认配置下是正常结果，不代表失败。

### 晚上或非交易时段验证

适用时间：收盘后、开盘前、午间休市。

1. 在 PTrade 新建一个股票交易策略。
2. 粘贴 `ptrade_phase1_validation.py`。
3. 第一轮改成：

```python
g.symbol = '你要验证的股票代码'
g.validation_target = ''
g.smoke_test_enabled = True
```

4. 启动交易。
5. 这一轮只看：
	- `phase = smoke`
	- `account.status`

6. 如果你还要额外验证网络出口，第二轮只把 `g.validation_target` 改成：

```python
g.validation_target = 'http://你确认可达的内网relay或中转地址/ptrade'
```

7. 再启动一次。
8. 第二轮只看：
	- `phase = smoke`
	- `outbound.status`

说明：

- 非交易时段不要对 `l2.status` 下结论。
- `smoke` 模式本来就会把 `l2.status` 写成 `skipped`。

## 一步一步怎么验证

如果你要按完整顺序走一遍，建议固定按下面四步，不要跳。

### 第一步：确认脚本配置

只看 `initialize()` 里的这几个参数：

```python
g.symbol = '600570.XSHG'
g.validation_target = ''
g.smoke_test_enabled = False
```

你只需要改：

- `g.symbol`：换成你实际要验证的标的。
- `g.validation_target`：默认留空；只有你明确要验证网络出口时才填地址。
- `g.validation_targets`：如果你要一次顺序验证多个地址，就把多个目标按列表填进去；脚本会按顺序逐个尝试，遇到第一个成功目标就停止。
- `g.smoke_test_enabled`：白天交易时段用 `False`，晚上先用 `True`。
- `g.validation_sqlite_enabled`：默认 `True`，会把每次验证结果追加写进 sqlite。

### 第二步：运行脚本

- 白天：直接启动交易，脚本会自动做 live 验证。
- 晚上：先用 smoke 模式跑账号和 HTTP，不做 L2 结论。

### 第三步：看日志，不要先纠结输出文件

先看日志里的：

```text
Wyckoff ptrade validation => ...
```

第一次验证时，日志比文件更重要，因为：

- 日志能立刻看到结果。
- 文件路径 `/home/fly/notebook/...` 是 ptrade 运行环境目录，不是当前 Git 工作区目录。

### 第四步：按固定顺序解读结果

不要一次看全部 JSON，只按下面顺序看：

1. `account`
2. `l2`
3. `localResultPath` / `localSqlitePath`
4. `outbound`

最小判定表：

- `account.status = ok/partial`：先说明账号接口能不能读。
- `l2.status = confirmed`：说明当前账户和时段下能看到足够的 L2 线索。
- `l2.status = market_not_live`：说明时段不对，不要误判成没权限。
- `l2.status = not_detected`：优先怀疑 L2 权限、订阅或标的不合适。
- `localResultPath` 有值：说明 JSON 文件已经尝试写到研究目录。
- `localSqliteStatus = persisted`：说明 sqlite 已经记录本次结果，可作为 Phase 0 默认持久化路径。
- `outbound.status = skipped`：说明你没有配置网络目标；这是 Phase 0 默认行为。
- `outbound.status = success`：说明这个环境存在可用的 HTTP 出口；是否要继续用 relay，仍应晚于 JSON / sqlite3 主路径判断。
- `outbound.status = error`：先看 `outbound.failureStage`，再决定是改目标地址、改 relay 部署位置，还是直接走本地落盘。

## 适用场景

- `交易` 场景。
- 股票业务优先。
- 希望先确认 Phase 1 可行性，并把账号、L2、本地落盘这三类前置条件先收口。

不建议在研究或纯回测中使用这份脚本做最终判断，因为逐笔委托、逐笔成交和快照权限判断都依赖交易环境。

## 脚本做了什么

### 1. 账号绑定检查

脚本会读取：

- `get_user_name(True)`：登录终端资金账号。
- `get_user_name(False)`：当前策略绑定账号。
- `get_trade_name()`：当前交易名称。

### 2. Level2 检查

脚本会优先直接调用官方推荐的实时接口：

- `get_snapshot(symbol)`
- `get_individual_entrust([symbol], is_dict=True)`
- `get_individual_transaction([symbol], is_dict=True)`

验证结果会记录：

- `tradeStatus`
- 快照时间戳
- 买一 / 卖一档位
- 委托笔数
- 是否看到第一档委托队列
- 逐笔委托 / 逐笔成交是否有数据

### 3. 本地持久化

脚本默认会做两层本地持久化：

1. 把最近一次结果写成 JSON 文件。
2. 把每次结果追加写入 sqlite3。

默认配置：

```python
g.validation_file = 'ptrade-phase1-validation-last.json'
g.validation_sqlite_enabled = True
g.validation_sqlite_file = 'ptrade-phase1-validation.sqlite3'
g.validation_sqlite_table = 'phase1_validation_runs'
```

结果里会返回这些字段：

- `localResultPath`：JSON 文件路径。
- `localSqlitePath`：sqlite 文件路径。
- `localSqliteTable`：写入的数据表。
- `localSqliteStatus`：`persisted` / `disabled` / `unavailable` / `error`。
- `localSqliteRowId`：本次写入的行号；仅在成功时返回。

### 4. 出站 HTTP 检查

这一步现在是可选检查。只有你填写了 `g.validation_target` 或 `g.validation_targets` 时，脚本才会去做网络探测。

脚本会按三层顺序检查目标地址：

1. URL 是否可解析。
2. DNS 与 TCP 是否能打通。
3. `requests.post()` 是否真正发出并拿到响应。

如果你明确要验证网络出口，可以这样写：

```python
g.validation_target = 'http://你确认可达的内网relay或中转地址/ptrade'
```

如果你不填，脚本会把 `outbound.status` 记成 `skipped`，同时继续完成 JSON / sqlite 持久化。

如果你要一次验证多个出口，可以再配置：

```python
g.validation_targets = [
	'http://你的内网relay地址:19090/ptrade',
	'http://broker-reachable-ip-or-host:19090/ptrade',
	'https://httpbin.org/post',
]
```

当前这台开发机可直接参考的本机 relay 示例是：

```python
g.validation_target = ''
g.validation_targets = [
	'http://127.0.0.1:19090/ptrade',
]
```

这组地址只适用于“策略运行环境和 relay 在同一台机器”这一前提。

当前已确认：ptrade 实际运行在券商服务器上，Windows 这边只是客户端。因此 `127.0.0.1` 指向的是券商服务器自己的 localhost，不是你当前 Windows 客户端，也不是当前 WSL。

所以：

- `http://127.0.0.1:19090/ptrade`
- `http://127.0.0.1:19092/ptrade`

都不能再作为 ptrade 真实出站目标的默认项，只能作为客户端本地 relay 自检地址。

某台 WSL 实例的内网 IPv4 只建议在下面两种情况下使用：

- 访问 relay 的进程真的与某台 WSL 实例处于同一网络
- 或者你已经明确验证券商服务器对那台 WSL 实例的 IP 可达

如果你只是为了验证“Windows 客户端本机 relay 能否工作”，而不再依赖 WSL 网络转发，可直接使用：

- `ptrade-workspace/windows-relay/ptrade_relay_server.py`
- `ptrade-workspace/windows-relay/ptrade_relay_server.ps1`
- `ptrade-workspace/windows-relay/start_ptrade_relay.bat`

这条路线只用于验证 Windows 客户端本地 relay 能否正常工作，不再默认等同于 ptrade 真实运行环境。更详细的本地 relay 说明统一收口在 `ptrade-workspace/windows-relay/README.md`。它的本机测试地址是：

```python
g.validation_target = ''
g.validation_targets = [
	'http://127.0.0.1:19090/ptrade',
]
```

如果这台 Windows 机器没有稳定可用的 Python，或者本机策略限制直接执行 `.ps1` 文件，可改用已经实测通过的 PowerShell 内存执行方式：

```powershell
Copy-Item '\\wsl.localhost\Ubuntu\home\meetwk0916\projects\the-Wyckoff\ptrade-workspace\windows-relay\ptrade_relay_server.ps1' "$env:TEMP\ptrade_relay_server_test.ps1" -Force
$Port = 19092
Invoke-Expression (Get-Content -Raw "$env:TEMP\ptrade_relay_server_test.ps1")
```

注意：

- UNC 路径必须是 `\\wsl.localhost\...`，不能少掉开头那个反斜杠。
- 如果你已经在 Windows PowerShell 提示符里，不要再额外套 `powershell -Command "..."`，否则 `$Port` 和 `$env:TEMP` 很容易被外层提前展开。

如果你走的是这条 PowerShell 版路径，本机测试地址改成：

```python
g.validation_target = ''
g.validation_targets = [
	'http://127.0.0.1:19092/ptrade',
]
```

当前这台机器已经实测通过下面这个顺序，但这只证明 Windows 客户端本地 relay 可用，不证明券商服务器上的 ptrade 可以访问这些地址：

1. `GET http://127.0.0.1:19092/health`
2. `POST http://127.0.0.1:19092/ptrade/validation`
3. `GET http://127.0.0.1:19092/payload/latest`
4. `GET http://127.0.0.1:19092/l2-order-flow?symbol=600570.XSHG`

如果你想同时比较“域名 relay”和“纯 IP relay”，可以这样写：

```python
g.validation_target = ''
g.validation_targets = [
	'http://ptrade-relay.intra:19090/ptrade',
	'http://broker-reachable-ip-or-host:19090/ptrade',
	'http://wsl-instance-ip:19090/ptrade',
]
```

脚本会按列表顺序逐个尝试，遇到第一个成功目标就停止；如果全部失败，会保留每一次尝试的详细结果。

如果你当前并不打算专门验证 HTTP 出口，可以直接跳过本节后半段的 relay 示例，只保留 `g.validation_target = ''` 的默认配置即可。

结果里会额外记录这些字段，方便定位失败层级：

- `outbound.targets`：本次准备依次验证的全部目标。
- `outbound.targetCount`：本次目标数量。
- `outbound.successfulTarget`：第一个成功目标；全部失败时为空。
- `outbound.attempts`：每个目标的一次完整探测结果。
- `outbound.failureStage`：失败发生在哪一层。
- `outbound.targetInfo`：目标地址拆解后的 `scheme` / `host` / `port` / `path`。
- `outbound.dnsStatus`：DNS 解析是否成功。
- `outbound.resolvedAddresses`：实际解析出的 IP 列表。
- `outbound.tcpStatus`：到目标端口的 TCP 连接是否成功。
- `outbound.tcpConnectedAddress`：实际连通的目标 IP。
- `outbound.requestStatus`：真正 HTTP 请求阶段是否成功。

## 运行前要改的配置

在 `initialize()` 中至少确认两个值：

```python
g.symbol = '600570.XSHG'
g.validation_target = ''
```

如果你要在非交易时段先做一轮 smoke test，再额外打开这个开关：

```python
g.smoke_test_enabled = True
```

建议：

- `g.symbol` 换成你实际打算联调的股票。
- Phase 0 默认先不要填公网目标，先确认本地文件和 sqlite 落盘稳定。
- 如果你怀疑公网被限制，把 `g.validation_target` 换成你能控制的内网 relay。
- 如果你同时想验证“公网域名 / 内网域名 / 纯 IP 地址”三种出口，把它们都放进 `g.validation_targets`，按你希望的优先级排序。
- 夜间 smoke test 的第一轮建议先把 `g.validation_target` 设为空，只验证账号绑定。

## 运行步骤

1. 在 PTrade 中新建一个股票交易策略。
2. 粘贴 `ptrade_phase1_validation.py` 的内容。
3. 把 `g.symbol` 改成你要验证的标的。
4. 按需要修改 `g.validation_target`。
5. 启动交易。
6. 在交易日志里查看 `Wyckoff ptrade validation => ...`。

## 夜间 smoke test

如果当前已经收盘，先不要做 Level2 结论，按下面步骤做一轮轻量验证：

1. 把 `g.smoke_test_enabled = True`。
2. 第一轮把 `g.validation_target = ''`。
3. 启动策略。
4. 在日志里查看 `phase = smoke` 的结果。
5. 这一轮重点只看 `account` 是否有值。
6. 第二轮把 `g.validation_target` 改成你确认可达的 relay 地址；如果你只是额外验证公网 HTTP，再单独改成 `https://httpbin.org/post` 这类公共测试地址。
7. 第二轮重点只看 `outbound.status`。

说明：

- `smoke` 模式会明确把 `l2.status` 标记为 `skipped`。
- 真正的 Level2 判断仍然要在交易时段查看 `phase = live` 的结果。
- 做完 smoke test 后，建议把 `g.smoke_test_enabled` 改回 `False`，避免影响白天的正常验证习惯。

## 输出位置

脚本会把验证结果覆盖写到：

```text
/home/fly/notebook/ptrade-phase1-validation-last.json
```

这意味着即使 HTTP 不通，你仍然可以先拿到本地验证结果。

## 结果解释

### 账号部分

- `loginAccount` 有值：说明当前终端登录态可见。
- `boundAccount` 有值：说明当前策略绑定账号可见。
- `loginAccount` 与 `boundAccount` 不一致：不一定是错误，信用账号或不同业务类型下可能本来就不同。

### Level2 部分

- `status = confirmed`：已经拿到足够的 L2 线索，可以继续做 exporter。
- `status = market_not_live`：当前不是适合确认 L2 的交易时段，结果暂不下结论。
- `status = not_detected`：快照有了，但逐笔和委托笔数没确认出来，优先检查 Level2 权限、标的订阅和市场时段。
- `status = snapshot_unavailable`：先检查标的代码、行情权限和交易环境本身。
- `status = skipped`：当前执行的是 smoke test，只做账号和网络验证，不做 Level2 结论。
- `status = error`：优先看日志里的异常信息。

### 出站 HTTP 部分

- `status = skipped`：默认配置下的正常结果，说明你没有要求脚本做网络探测。
- `status = success`：策略侧向外推送可行，后续优先走 exporter -> relay 路线。
- `status = error`：继续看 `failureStage`，不要只看一条总错误信息。

### 本地持久化部分

- `localPersistError` 为空：说明 JSON 文件写入没有报错。
- `localSqliteStatus = persisted`：说明 sqlite 追加写入成功。
- `localSqliteStatus = unavailable`：说明当前环境没有 `sqlite3`，可以先只用 JSON。
- `localSqliteStatus = error`：说明 sqlite 文件或表写入失败，优先检查研究目录权限和文件锁。

多目标模式下再多看两层：

- 先看 `successfulTarget`：如果有值，说明脚本已经找到第一个可用出口。
- 再看 `attempts`：它会按顺序保留每个目标的探测结果，方便比较“公网域名失败，但内网 relay 成功”这类情况。

常见 `failureStage` 解读：

- `target`：`validation_target` 格式不对，先修 URL。
- `requests_import`：运行环境没有 `requests`，这时只能先走本地落盘或改用环境内可用库。
- `dns`：域名无法解析，通常说明公网 DNS 不通，或该环境根本不能解析这个域名。
- `tcp`：DNS 已成功，但目标端口连不上；优先怀疑防火墙、白名单、出口策略或 relay 没开。
- `http`：TCP 已打通，但真正请求失败；优先怀疑 TLS、代理、证书、SNI 或上游服务策略。
- `http_status`：服务端收到了请求，但返回了 `4xx/5xx`；这时去查 relay 或目标服务日志。

## 验证后的推荐决策

### 全部通过

直接进入下一步：

`PTrade exporter -> relay -> 当前 Node bridge -> 前端`

### 账号和 L2 通过，但 HTTP 不通

优先改成：

`PTrade exporter -> /home/fly/notebook 本地落盘 -> relay 读取 -> 当前 Node bridge`

### 账号通过，但 L2 不通过

先不要做 exporter，先和券商确认：

- 是否开通 Level2。
- 当前标的是否允许拿逐笔。
- 当前交易时段与订阅状态是否正常。

## 说明

这份脚本刻意保持为最小验证版本，只做连通性与权限确认，不承担正式生产 relay 的职责。

正式 exporter 的下一步建议是：

- 保留 `run_interval` 调度方式。
- 继续使用 `get_snapshot()` 和 `is_dict=True` 的逐笔接口。
- 只把必要字段标准化后推给外部 relay。