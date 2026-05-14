# MiniQMT Wyckoff 目标

## 最终目标

把 Wyckoff Radar 的 A 股策略方法迁移到 MiniQMT / QMT 本地客户端环境中，形成一条可验证、可录制、可回放、可风控的券商适配路线。

最终形态不是把当前前端塞进 MiniQMT，也不是在第一天就自动下单，而是：

```text
MiniQMT / QMT client
  -> XtQuant external Python adapter
  -> normalized market/account/order events
  -> local append-only store and replay
  -> Wyckoff signal engine
  -> paper / simulation trade gate
  -> supervised execution gate
```

## 非目标

- 不在初始化阶段接实盘资金账户。
- 不保存账号密码、柜台凭据、交易密码或券商私有配置。
- 不绕过 MiniQMT / QMT 客户端和券商风控。
- 不把 MiniQMT 路线与 `ptrade-workspace/` 混成同一个策略脚本。
- 不把 BTC / crypto 的 liquidation / perp / funding 逻辑直接搬到 A 股。
- 不在没有回报闭环、撤单恢复、人工审批和次日对账前启用自动实盘执行。

## 成功准则

### Phase 0：环境预检查

- Windows 侧能启动 MiniQMT / QMT 客户端并登录目标账号。
- 外部 Python 能导入 XtQuant / XtData / XtTrader 相关模块。
- 能连接客户端 userdata 目录并查询账号状态。
- 能输出标准化 health JSON。
- 不能连接或权限不足时，错误能被结构化记录。

### Phase 1：行情与 Wyckoff 输入层

- 能订阅或查询 A 股目标标的的基础行情。
- 能读取历史 K 线或足够支撑长周期量价判断的数据。
- 能验证 L2、逐笔委托、逐笔成交等权限是否真实可用。
- 能把行情、L2、逐笔数据映射为统一 order-flow 事件。
- 能复用 ptrade 路线中的静态标的池、长周期量价、RS / Beta、订单簿失衡和 CVD 思路。

### Phase 2：录制 / 回放 / 证据链

- 能把 MiniQMT 适配器输出写成 append-only JSONL 或 sqlite3。
- 能围绕候选窗口回放行情、L2、逐笔和账户状态。
- 能生成 Wyckoff evidence report，而不是直接输出交易动作。
- 能用固定 fixture 防止信号规则漂移。

### Phase 3：模拟盘与执行闸门

- 能在 MiniQMT 模拟盘中验证委托、成交、撤单、持仓、资金和回报回调。
- 能完成超时撤单、重报价、异常恢复和次日对账。
- 能记录人工审批、风控闸门和交易报告。

### Phase 4：受控实盘评估

- 只有在 Phase 0 到 Phase 3 全部通过后，才评估实盘。
- 实盘必须保留人工确认、仓位上限、撤单恢复和 kill switch。
- 任何自动执行都必须可以从本地日志重放解释。

## 硬闸门

- 环境未验证，不写交易逻辑。
- L2 / 逐笔权限未验证，不把微观结构作为强制入场依据。
- 委托 / 成交 / 撤单 / 持仓回报未闭环，不启用模拟盘之外的执行。
- 没有 replay fixture，不调高策略置信度。
- 没有人工审批和风控闸门，不进入实盘。

