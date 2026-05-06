# ptrade Phase 1 最小验证脚本

## 目的

这份脚本现在按 Phase 0 环境预检查理解：它用于给 `ptrade_wyckoff_trader.py` 上线前做账号、L2 和网络边界确认，不再作为最终交易 / 回测方案本身。

这份脚本用于在官方 PTrade 交易环境里一次性验证三件事：

1. 当前策略是否绑定到了预期账号。
2. 当前标的是否能拿到可用的 Level2 线索。
3. 当前运行环境是否允许向外发送 HTTP 请求。

对应脚本文件：`ptrade_phase1_validation.py`

## 适用场景

- `交易` 场景。
- 股票业务优先。
- 希望先确认 Phase 1 可行性，再继续做 exporter / relay。

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
- 最近逐笔委托 / 逐笔成交是否有数据

### 3. 出站 HTTP 检查

脚本会使用 `requests.post()` 向 `g.validation_target` 发送一份小型 JSON。

默认目标是：

```python
g.validation_target = 'https://httpbin.org/post'
```

如果你已经有自己的 relay，可以直接改成你自己的地址。

## 运行前要改的配置

在 `initialize()` 中至少确认两个值：

```python
g.symbol = '600570.XSHG'
g.validation_target = 'https://httpbin.org/post'
```

如果你要在非交易时段先做一轮 smoke test，再额外打开这个开关：

```python
g.smoke_test_enabled = True
```

建议：

- `g.symbol` 换成你实际打算联调的股票。
- 如果你怀疑公网被限制，把 `g.validation_target` 换成你能控制的内网 relay。
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
6. 第二轮把 `g.validation_target` 改成 `https://httpbin.org/post` 或你的 relay 地址，再启动一次。
7. 第二轮重点只看 `outbound.status`。

说明：

- `smoke` 模式会明确把 `l2.status` 标记为 `skipped`。
- 真正的 Level2 判断仍然要在交易时段查看 `phase = live` 的结果。
- 做完 smoke test 后，建议把 `g.smoke_test_enabled` 改回 `False`，避免影响白天的正常验证习惯。

## 输出位置

脚本会把最近一次结果写到：

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

- `status = success`：策略侧向外推送可行，后续优先走 exporter -> relay 路线。
- `status = error`：大概率是网络策略、DNS、证书或目标地址不可达；这时优先考虑内网 relay 或文件落盘方案。
- `status = skipped`：说明你把 `validation_target` 留空了。

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