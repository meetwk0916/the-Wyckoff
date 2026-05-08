# Windows PTrade Relay

这个目录提供两份可直接带到 Windows 机器上运行的最小 relay，用于验证：

`Windows 客户端本地调试 -> 本机 relay -> 标准化 HTTP 接口`

其中：

- `ptrade_relay_server.py` 只使用 Python 标准库。
- `ptrade_relay_server.ps1` 使用 PowerShell 自带的 `HttpListener`，适合 Windows 已有限制、没法直接运行 Python 或 `.ps1` 文件时做宿主机本地验证。

## 定位

这套 relay 的定位要明确收窄：

- 它验证的是 Windows 客户端本机能否启动一个兼容契约的 relay。
- 它适合做本地接口联调、bridge 联调和 payload 归一化验证。
- 它不等于 ptrade 策略运行环境本身。
- 如果 ptrade 实际运行在券商服务器上，那么策略里的 `127.0.0.1` 指向的是券商服务器，不是你本机 Windows 客户端。

因此，本目录里的 `127.0.0.1:19090` / `127.0.0.1:19092` 不能默认作为 ptrade 策略的真实 HTTP 目标，只能作为客户端本地验证地址。

## 目标

- 在 Windows 本机监听 `127.0.0.1:19090`
- 接收 ptrade 运行时发出的 `POST` JSON
- 暴露统一健康检查和 L2 订单流接口
- 让后续 bridge / frontend 可以继续使用同一契约

## 文件

- `ptrade_relay_server.py`：Python relay 主脚本
- `ptrade_relay_server.ps1`：PowerShell relay 主脚本
- `start_ptrade_relay.bat`：Windows 启动脚本

## 运行前提

- 建议在你当前使用的 Windows 客户端机器上运行
- 如果走 Python 版，Windows 本机需要 Python 3
- 如果走 PowerShell 版，不需要额外安装 Python

## 启动

推荐优先级：

1. 先试 Python 版
2. 如果 Windows 机器策略限制拦截 `.ps1` 文件执行、或者没有可用 Python，再试下面的 PowerShell 内存执行方式

### 方案 A：Python relay

在 Windows 命令行进入本目录后执行：

```bat
python ptrade_relay_server.py
```

或直接双击：

```bat
start_ptrade_relay.bat
```

默认监听：

```text
http://127.0.0.1:19090
```

启动成功后会打印：

```text
[ptrade-relay-win] windows-ptrade-target=http://127.0.0.1:19090/ptrade
```

### 方案 B：PowerShell relay

如果你已经把仓库放到 Windows 本地目录，可直接在 PowerShell 里执行：

```powershell
$Port = 19092
Invoke-Expression (Get-Content -Raw '.\ptrade_relay_server.ps1')
```

如果仓库还在 WSL 路径下，先复制到 Windows 本地临时目录，再执行：

```powershell
Copy-Item '\\wsl.localhost\Ubuntu\home\meetwk0916\projects\the-Wyckoff\ptrade-workspace\windows-relay\ptrade_relay_server.ps1' "$env:TEMP\ptrade_relay_server_test.ps1" -Force
$Port = 19092
Invoke-Expression (Get-Content -Raw "$env:TEMP\ptrade_relay_server_test.ps1")
```

注意两点：

- UNC 路径必须以 `\\wsl.localhost\...` 开头，不能写成 `\wsl.localhost\...` 或 `\wsl.localhost` 前少一个反斜杠。
- 如果你已经在 PowerShell 里，就不要再额外套一层 `powershell -Command "..."`；直接先设 `$Port`，再执行 `Invoke-Expression`，最不容易被引号和变量展开干扰。

这条方式已经在当前机器的 Windows 宿主机实测通过。启动成功后会打印：

```text
[ptrade-relay-win-ps] listening on http://127.0.0.1:19092
[ptrade-relay-win-ps] target=http://127.0.0.1:19092/ptrade
```

## 给 ptrade 填地址前先判断

只有在“策略代码真的运行在这台 Windows 机器本地”时，下面这些 `127.0.0.1` 地址才可以直接填进 ptrade。

如果 ptrade 实际运行在券商服务器上，而 Windows 只是客户端，那么下面这些地址只能用于本机自检，不能直接作为 ptrade 的出站目标；你需要改成券商服务器真正可达的内网地址、域名或中转地址。

## 本机验证地址

如果你只是验证 Windows 本机 relay 本身，可用：

```python
g.validation_target = ''
g.validation_targets = [
    'http://127.0.0.1:19090/ptrade',
]
```

如果你用的是 PowerShell 版默认端口，则改成：

```python
g.validation_target = ''
g.validation_targets = [
    'http://127.0.0.1:19092/ptrade',
]
```

## 可用接口

- `POST /ptrade`
- `POST /ptrade/validation`
- `GET /health`
- `GET /l2-order-flow?symbol=600570.XSHG`
- `GET /payload/latest`

## 最小自检

Windows 机器上启动 relay 后，可先在浏览器或命令行访问：

```text
http://127.0.0.1:19090/health
```

如果返回 JSON，说明 relay 已经在本机监听。

然后再决定是否把某个“券商服务器可达地址”填回 ptrade 验证脚本。

如果 ptrade 推送成功，`GET /health` 里的：

- `status` 会从 `waiting_for_ingest` 变为 `stale`
- `lastIngestAt` 应更新为新时间

如果需要看最近一次原始推送内容，访问：

```text
http://127.0.0.1:19090/payload/latest
```

如果你走的是 PowerShell 版，把上面的端口替换成 `19092`。