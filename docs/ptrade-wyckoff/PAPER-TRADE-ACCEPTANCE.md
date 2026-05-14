# ptrade 模拟盘闭环验收

## 目的

这份清单用于验证 canonical ptrade 策略是否真正跑通模拟盘闭环。

当前验收目标不是盈利，也不是证明 Wyckoff 模型有效，而是证明执行链路可信：

- 主推事件可记录。
- 轮询结果可对齐。
- 账户级订单 / 持仓巡检可解释。
- 日终报告和状态记忆能复盘当日行为。

如果这一步没有通过，不应继续推进 live armed。

## 前置条件

- 使用 `ptrade-workspace/strategy/ptrade_wyckoff_trader.py` 作为唯一策略脚本。
- `g.execution_mode = 'paper'`。
- `g.live_order_armed = False` 保持不动。
- `g.enable_account_level_audit = True`。
- `g.enable_open_order_recovery = True`。
- 当前模拟盘账号、交易名称、标的池和资金账号要记录在验收备注中。

## 验收步骤

1. 在 ptrade 中新建或更新模拟盘交易。
2. 粘贴 canonical 策略脚本。
3. 启动模拟盘交易，至少覆盖一个完整交易日。
4. 日终取回 `ptrade-wyckoff-trade-report-last.json`。
5. 如有状态文件，同时取回 `ptrade-wyckoff-state.pkl` 的存在性和更新时间。
6. 在本地运行：

```bash
npm run ptrade:paper-report:check -- --report=/path/to/ptrade-wyckoff-trade-report-last.json
```

如果报告已放在仓库根目录，也可以直接运行：

```bash
npm run ptrade:paper-report:check -- --report=ptrade-wyckoff-trade-report-last.json
```

## 必须核对的报告字段

- `executionMode` 必须是 `paper`。
- `liveOrderArmed` 必须是 `false`。
- `symbolUniverse.activeSymbols` 必须等于本次模拟盘目标标的池。
- `symbols[].signal` 必须能解释每个标的的结构阶段和状态。
- `symbols[].decision` 必须能解释目标仓位、当前仓位和动作原因。
- `symbols[].execution` 必须能解释下单、阻塞、恢复或跳过原因。
- `orders`、`openOrders`、`trades`、`positions` 必须能和 ptrade 交易界面互相解释。
- `orderResponseEvents` 和 `tradeResponseEvents` 必须记录模拟盘主推事件；如果为空，需要说明当天是否没有真实委托 / 成交。
- `accountAudit.allOrders` 必须能解释账户级委托。
- `accountAudit.unmatchedAccountOrders` 如果非空，必须判断是手工单、其他策略单、启动前残留单，还是本策略订单识别失败。
- `accountAudit.allPositions` 必须能解释账户级持仓。
- `accountAudit.unmanagedPositions` 如果非空，必须判断是否来自非本策略持仓。
- `executionReconciliation` 必须汇总主推事件、已知订单标识、未匹配账户委托和非策略持仓数量。
- `strategyState` 必须能解释每个活跃标的的阶段、持仓阶段、支撑阻力和执行恢复状态。

## 通过标准

- 日终报告能成功生成并通过本地核对脚本。
- 报告没有 `ERROR` 级校验失败。
- 所有 `WARNING` 都能用交易界面或运行日志解释。
- 模拟盘界面的实际委托、成交和持仓能与报告字段对齐。
- 如果存在 open orders，报告能说明是观察中、撤单已请求，还是撤单失败。
- 如果存在 unmatched account orders，能确认它们不是本策略漏识别的订单。
- 如果存在 unmanaged positions，能确认它们不是本策略未记录的持仓。

## 不通过标准

出现任一情况即不通过：

- 报告无法生成。
- `executionMode` 不是 `paper`。
- `liveOrderArmed` 为 `true`。
- 模拟盘发生委托 / 成交，但 `orderResponseEvents`、`tradeResponseEvents`、`orders`、`trades` 全部无法解释。
- 报告持仓与 ptrade 账户持仓不一致，且无法解释差异。
- 本策略订单被持续标记为 `unmatchedAccountOrders`。
- open orders 达到超时后没有恢复路径。
- 状态记忆与实际持仓阶段冲突。

## 验收产物

每次模拟盘验收至少保留：

- 日终 JSON 报告路径。
- 校验脚本输出。
- ptrade 交易界面中的订单、成交、持仓截图或文字摘录。
- 如果不通过，记录失败字段、原因判断和下一步修复项。

这些产物可以先本地保存，不要求把真实账户截图或敏感账号信息提交到仓库。
