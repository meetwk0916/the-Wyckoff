# ptrade 原生回测与模拟盘策略骨架

## 目的

这份说明对应 `ptrade_wyckoff_trader.py`。

它的目标不是直接把 Wyckoff 方法论一次性写完，而是先在官方 ptrade 运行时内部打通三个能力：

1. 可运行的回测。
2. 可运行的模拟盘下单。
3. 可复核的日终交易报告。

这样做的意义是先把“信号 -> 决策 -> 下单 -> 成交 -> 报告”的最小闭环跑通，再继续补更细的 L2 盘口确认和真实 Wyckoff 结构规则。

## 对应文件

- `ptrade_wyckoff_trader.py`

## 当前策略骨架做了什么

### 1. 统一回测和模拟盘入口

- 使用 `handle_data()` 作为主决策入口。
- 使用 `after_trading_end()` 输出日终报告。
- 同一份代码同时兼容回测和交易环境。

### 2. 使用官方已确认的最小执行接口

策略骨架当前优先使用这些接口：

- `order(security, amount, limit_price=None)`
- `get_open_orders(security=None)`
- `get_orders(security=None)`
- `get_trades()`
- `get_position(security)`
- `get_positions(security=None)`

说明：

- 官方文档虽然也提供 `order_target`、`order_target_value`，但明确提示交易场景可能因为持仓同步滞后导致重复下单。
- 因此当前骨架优先用 `order` 做 delta 下单，并在下单前先检查 `get_open_orders()`。

### 3. 输出日终交易报告

每个交易日结束后，策略会把以下信息写入本地 JSON：

- 组合资金快照
- 每个标的的信号判定
- 当前决策结果
- 执行结果
- 策略内订单
- 未完成订单
- 当日成交
- 当前持仓

默认输出文件：

```text
/home/fly/notebook/ptrade-wyckoff-trade-report-last.json
```

## 初始化时需要先改的参数

`initialize()` 里最关键的几个参数如下：

```python
g.symbols = ['600570.XSHG']
g.execution_mode = 'paper'
g.live_order_armed = False
g.enable_l2_confirmation = False
g.max_position_ratio = 0.25
g.stop_loss_pct = 0.03
```

建议这样理解：

- `g.symbols`：先只放 1 到 3 个你真正要验证的标的。
- `g.execution_mode = 'paper'`：用于回测和模拟盘。
- `g.execution_mode = 'live'`：只在你明确要迁移到实盘时才改。
- `g.live_order_armed = False`：即使以后切到 `live`，也先保持 `False`，确认风控流程后再手动打开。
- `g.enable_l2_confirmation = False`：第一轮先不要让 L2 结果阻塞回测和模拟盘闭环。

## 回测步骤

1. 在 ptrade 中新建一个股票策略。
2. 粘贴 `ptrade_wyckoff_trader.py` 的内容。
3. 先确认 `g.execution_mode = 'paper'`。
4. 把 `g.symbols` 改成你要验证的股票。
5. 新建回测，设置开始时间、结束时间、资金规模和频率。
6. 运行回测。
7. 在日志里查看 `Wyckoff ptrade report => ...`。

建议第一轮优先使用：

- 日线频率：先确认逻辑是否能稳定跑通。
- 分钟频率：再看信号和交易节奏是否合理。

## 模拟盘步骤

1. 保持同一份策略代码不变。
2. 在 ptrade 里新建交易，并选择模拟盘模式。
3. 绑定正确的资金账号。
4. 启动交易。
5. 在交易日志里查看下单、成交和报告输出。
6. 到 `/home/fly/notebook/ptrade-wyckoff-trade-report-last.json` 检查日终结果。

## 当前信号逻辑的定位

当前文件中的信号逻辑只是策略骨架，不是最终版 Wyckoff 方法论。

它现在只做了四类最小判断：

- 近端区间突破
- 快慢均线相对位置
- 近期量能是否放大
- 可选的 L2 买一 / 卖一强弱确认

退出逻辑当前也只保留了最小版本：

- 跌破慢线离场
- 成本止损离场

这意味着它现在更像“执行和报告框架”，而不是“最终信号模型”。

## 这份策略适合解决什么问题

- 先证明 ptrade 原生回测和模拟盘可以承载 Wyckoff 策略骨架。
- 先形成交易报告，供后续实盘跟踪和人工复盘。
- 先把订单、成交和持仓的查询链路打通。

## 这份策略暂时不解决什么问题

- 不解决最终版 spring / BUEC / LPS 结构判定。
- 不解决多账户、多券商统一执行。
- 不解决自动实盘和风控审批。
- 不解决完整绩效归因平台。

## 推荐的下一步增强

1. 把当前占位信号替换为真实的 Wyckoff 结构规则。
2. 增加 `cancel_order()` 超时撤单与重新报价逻辑。
3. 在 Phase 2 中把 L2 订单流确认接回 `entry` 判断。
4. 增加次日对账逻辑，结合 `get_deliver()` 与 `get_fundjour()` 做报告校验。