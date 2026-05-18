# BTC 数据源验证记录

## 2026-05-18 market payload 停滞检测

背景：

- 5 个长跑 screen 仍为 running，provider heartbeat 仍在刷新。
- 但人工检查 tail 发现 OKX / Binance / Bybit 最近写入多为 `provider_status / capture_heartbeat`，真实 market payload 停在更早时间。
- 仅看 `screen running` 和 `Last provider status at` 会误判为数据仍有效。

新增内容：

- `crypto:capture:status` 新增 `lastDataPayloadAt`、`lastDataPayloadPath`、`lastDataPayloadEventType` 和 `lastDataPayloadAgeMinutes`。
- 默认 15 分钟没有真实非 `provider_status` payload 时，`captureHealth.status` 标记为 `market_payload_stale`。
- `crypto:daily-check` 输出 latest market payload 并把 `market_payload_stale` 纳入 attention reasons。

验证结果：

```bash
npm run crypto:capture:status -- --screen=wyckoff_bybit_liq_capture_7d_heartbeat
npm run crypto:daily-check
```

- Capture screen：running。
- Provider heartbeat age：约 1.5 分钟。
- Capture health：`market_payload_stale`。
- Last data payload at：`2026-05-17T14:58:25.384Z`。
- Last data payload age：约 1365.7 分钟。
- Last data payload type：`book_delta`。
- Attention reasons：`market_payload_stale`、`long_liquidation_candidate_available`。

结论：

- 当前长跑 screen 仍活着，但真实可复核行情 payload 已停滞。
- 这轮新增检测后，不需要人工 tail 文件即可区分“heartbeat 新鲜”和“market payload 新鲜”。
- 下一步应重启 OKX / Binance 对照采集，或继续把 capture health 做成 provider / screen 维度的分源状态表。

## 2026-05-17 收尾审计与文档同步

审计命令：

```bash
npm run crypto:daily-check
npm run crypto:capture:status -- --screen=wyckoff_okx_liq_capture_72h_heartbeat
npm run crypto:phase-c:check
screen -ls
```

当前状态：

- 后台 screen 仍有 5 个：Bybit 7d、Binance liquidation 72h、OKX liquidation 72h、OKX trade 72h、OKX book 72h。
- `crypto:daily-check`：BTC events 71,108；BTC liquidation events 8；BTC long liquidation events 7；BTC short liquidation events 1；full sensor ready candidates 8；parse errors 0。
- `crypto:daily-check` 同时输出 `capture_connected_no_payload` 和 `long_liquidation_candidate_available`。这表示 Bybit / 最新 provider status 仍可能静默，但本地 raw 数据已有可复核 long liquidation 候选。
- `crypto:capture:status -- --screen=wyckoff_okx_liq_capture_72h_heartbeat`：screen running，data payload events 70,556，latest event 来自 OKX `spot_books_delta`；但 capture health 仍显示 `connected_no_payload`，因为最新 provider status file 指向 Binance `perp_force_order` heartbeat。
- `crypto:phase-c:check`：3 个固定窗口，0 个 `spring_candidate`，1 个 `breakdown_risk`，1 个 `short_squeeze_only`，1 个 `insufficient_evidence`，review agreement 3 / 3。

风险与后续：

- 监控层风险：capture health 仍是全局摘要，不是严格 provider / screen 分源健康判断；下一步应把 provider / screen 维度纳入 status report。
- 样本层风险：已经有 long liquidation 候选，但第一个复核窗口是 `breakdown_risk`，仍没有满足 CVD、盘口恢复和 OI 去杠杆的 `spring_candidate`。
- 工程方向：继续保留长跑采集，把每个候选窗口跑 evidence / classify / review，并把有代表性的正负样本固化到 fixture。

## 2026-05-17 Bybit 长跑 payload 有效性闸门

背景：

- `wyckoff_bybit_liq_capture_7d_heartbeat` 仍在运行，且 provider heartbeat 新鲜。
- 但最新 Bybit 输出文件长时间只有 `provider_status / capture_heartbeat`，没有真实 liquidation payload。
- 单看 screen running 和 heartbeat 会把“连接活着”误判为“数据源有效”。

新增内容：

- `crypto:capture:status` 新增 `captureHealth`。
- 最新 provider status 文件如果没有真实 data payload，并且 heartbeat 中 `receivedMessages` 不增长、`writtenEvents=0`，会标记为 `connected_no_payload`。
- `crypto:daily-check` 会输出 capture health，并在该状态下把 `Needs attention` 置为 `true`，reason 为 `capture_connected_no_payload`。

验证结果：

```bash
npm run crypto:capture:status -- --screen=wyckoff_bybit_liq_capture_7d_heartbeat
npm run crypto:daily-check
```

- screen：running。
- latest heartbeat：新鲜。
- capture health：`connected_no_payload`。
- health reasons：`latest_status_file_has_no_data_payload`、`heartbeat_received_messages_not_increasing`、`heartbeat_written_events_zero`。
- BTC liquidation events：1。
- BTC long liquidation events：0。
- BTC short liquidation events：1。
- long liquidation candidates：0。
- daily check attention：`capture_connected_no_payload`。

结论：

- Bybit 长跑可以继续挂着，但当前不能再被视为充分有效的 liquidation 数据源。
- 当前只能说明 Bybit 公共流在本采集方式下连接存活、没有给出有效 BTC liquidation payload；不能说明市场没有 long liquidation。
- 下一步应并行恢复 Binance `forceOrder` / OKX `liquidation-orders` 对照采集，并继续把 `long liquidation + 价格收回 + 盘口恢复` 作为目标样本。

后续处理：

```bash
screen -dmS wyckoff_binance_liq_capture_72h_heartbeat npm run crypto:capture -- --provider=binance --duration-sec=259200 --event-type=liquidation
screen -dmS wyckoff_okx_liq_capture_72h_heartbeat npm run crypto:capture -- --provider=okx --duration-sec=259200 --event-type=liquidation
screen -dmS wyckoff_okx_trade_capture_72h_heartbeat npm run crypto:capture -- --provider=okx --duration-sec=259200 --event-type=trade
screen -dmS wyckoff_okx_book_capture_72h_heartbeat npm run crypto:capture -- --provider=okx --duration-sec=259200 --event-type=book_delta
npm run crypto:rest-capture -- --provider=okx --event-type=derivatives_state
npm run crypto:daily-check
```

结果：

- 后台 screen：Bybit 7d、Binance liquidation 72h、OKX liquidation 72h、OKX trade 72h、OKX book 72h 均为 running。
- OKX `liquidation-orders` 很快写入 BTC long liquidation payload；说明“几天没有样本”的主要问题是 Bybit 公共流沉默，而不是市场没有 long liquidation。
- 补 OKX trade、book_delta、open_interest、funding_rate 后，`crypto:daily-check` 输出：
  - BTC events：43,251
  - BTC liquidation events：8
  - BTC long liquidation events：7
  - BTC short liquidation events：1
  - Long liquidation candidates：7
  - Short liquidation candidates：1
  - Full sensor ready candidates：8
  - Attention reasons：`long_liquidation_candidate_available`

下一步：

- 从 7 个 OKX long liquidation 候选中挑选窗口，跑 Phase C evidence / classification。
- 优先检查是否满足价格收回、盘口恢复、CVD 支持和 OI 去杠杆。
- 若候选只满足 liquidation 但不满足结构恢复，继续作为失败 / breakdown 对照样本进入 review index。

### OKX long liquidation 负样本固化

窗口：

```bash
npm run crypto:phase-c:evidence -- --start=2026-05-17T14:02:04.577Z --end=2026-05-17T14:12:04.577Z --provider=all --report=crypto-workspace/reports/phase-c-evidence-okx-long-2026-05-17T1407Z.json
npm run crypto:phase-c:classify -- --evidence=crypto-workspace/reports/phase-c-evidence-okx-long-2026-05-17T1407Z.json --report=crypto-workspace/reports/phase-c-classification-okx-long-2026-05-17T1407Z.json
```

结果：

- 7 条 BTC long liquidation，最大 raw size 12.74。
- spot / perp 均出现支撑跌破后收回，结构判据为 `strong_support_reclaim`。
- spot CVD 与 perp CVD 均为 `supply`，flow verdict 为 `broad_selling_pressure`。
- post-3m 盘口没有恢复：top depth 未改善、ask depth 未回落、imbalance 未改善。
- OI 只有 1 个样本，无法确认去杠杆。
- 分类结果：`breakdown_risk`，confidence `medium`。

结论：

- 这是一个高价值负样本：它满足“long liquidation + 价格收回”的表层形态，但缺少需求回流、盘口恢复和 OI 去杠杆确认。
- 已固化为 `okx-btc-long-liquidation-2026-05-17T14-07Z` fixture，并在 review index 中标记为 `breakdown_risk`。
- 这个样本用于防止 Phase C 算法把所有长清算后的结构收回都误判为 Spring。

## 2026-05-14 长跑监控与 Phase C 判据增强

新增内容：

- `crypto:capture:status` 改为精确匹配 screen session 名称，避免 `wyckoff_bybit_liq_capture_24h` 被 `wyckoff_bybit_liq_capture_24h_heartbeat` 前缀误判为 running。
- 新增 `npm run crypto:daily-check`，一次性刷新 capture status 和 Phase C candidate scan，输出 screen、最新 heartbeat、BTC long / short liquidation、candidate 和 parse error 摘要，并写入 `crypto-workspace/reports/daily-capture-check-last.json`；默认监控 7d screen `wyckoff_bybit_liq_capture_7d_heartbeat`。
- `structureContext` 新增结构 verdict：汇总 spot / perp 支撑跌破、收回、收回距离和 `phaseCStructureSupport`。
- `cvdContext` 新增 CVD verdict：输出 `demandConfirmation`、`distributionRisk` 和判据理由；当前 demand / supply 仍使用 5% delta ratio 阈值。

验证结果：

```bash
npm run crypto:daily-check
npm run crypto:capture:status -- --screen=wyckoff_bybit_liq_capture_24h
npm run crypto:phase-c:check
```

- `crypto:daily-check`：screen `wyckoff_bybit_liq_capture_24h_heartbeat` 为 running，最新 provider heartbeat 为 `2026-05-14T13:39:08.612Z`，BTC long liquidation events 为 0，BTC short liquidation events 为 1，long liquidation candidates 为 0，parse errors 为 0。
- 旧 screen 名 `wyckoff_bybit_liq_capture_24h` 现在返回 `Capture screen: not_found`，精确匹配修复生效。
- Phase C verification：passed。
- 当前固定窗口仍为 0 个 `spring_candidate`、1 个 `short_squeeze_only`、1 个 `insufficient_evidence`，review agreement 仍为 2 / 2。

结论：

- 长跑监控现在有单命令日报入口，旧 / 新 screen 名状态不会再混淆。
- 24h 心跳 session 接近自然结束时，应改用 `wyckoff_bybit_liq_capture_7d_heartbeat` 作为每日检查目标。
- Phase C 结构与 CVD 判据从原始上下文升级为显式 verdict，但没有放宽 Spring 判定：未来 `spring_candidate` 仍必须满足 long liquidation、结构支持、CVD 支持、盘口恢复和 OI 去杠杆确认。
- 当前仍未新增 BTC long liquidation 正样本，继续保留 Bybit 心跳版长跑采集。

## 2026-05-13 Bybit 24h liquidation capture 重启

### Phase C evidence / classification 增强

新增内容：

- `derivativesContext.fundingContext`：把 Funding 从“是否有样本”升级为拥挤度上下文，输出 `crowded_long`、`crowded_short`、`neutral` 和 `extremeCrowding`。它不是 Spring 硬条件，也不会替代 liquidation / structure / CVD / OI。
- `orderBookRecovery.*.buckets`：围绕 first liquidation 或窗口中点输出 pre-anchor、post-1m 和 post-3m 分桶，记录 bid depth、ask depth、imbalance 的均值与变化。
- `phase-c:classify` 会把 funding context 和盘口分桶带入 `context`；盘口 3 分钟 ask depth retreat / imbalance improvement 只影响解释和信心，不绕过核心 Spring 条件。
- `phase-c:review` 的规则评分新增 funding 组件，并把 post-3m ask depth retreat / imbalance improvement 纳入 order book 评分，用于人工复核后的阈值校准。

验证结果：

```bash
npm run crypto:phase-c:check
npm run crypto:phase-c:evidence
npm run crypto:phase-c:classify
npm run crypto:phase-c:review
npm run crypto:phase-c:verify
```

- `okx-btc-liquidation-2026-05-09T12-14Z`：仍为 `short_squeeze_only`。
- `okx-btc-no-liquidation-2026-05-09T12-33Z`：仍为 `insufficient_evidence`。
- Review agreement：2 / 2。
- Phase C verification：passed。
- 当前 short liquidation 对照窗口 funding 为 `neutral`；perp post-3m bucket 出现 ask depth retreat 和 imbalance improvement，但不会被误判为 Spring，因为清算方向仍是 short。

结论：

- Funding 和盘口时间分桶已进入证据对象，但当前不会放宽 `spring_candidate` 判定。
- 下一步仍是扩充 `long liquidation + 价格收回 + 盘口恢复` 正样本，再校准 funding / CVD / order book 阈值。

### Bybit 24h liquidation capture 重启

当前本地 raw 数据扫描结果：

```bash
npm run crypto:phase-c:candidates
```

结果：

- BTC events：40,505
- BTC liquidation events：1
- long liquidation candidates：0
- short liquidation candidates：1
- full sensor ready candidates：1

Bybit 5 秒 smoke test：

```bash
npm run crypto:capture -- --provider=bybit --duration-sec=5 --event-type=liquidation
```

结果：

- 普通沙箱执行会被本机代理连接限制拦截：`connect EPERM 127.0.0.1:7890`。
- 提权网络执行后 Bybit public WebSocket 可连接。
- `subscriptionAck`：`true`
- `status`：`connected_no_sample`
- `receivedMessages`：1
- `writtenEvents`：0

24h 长跑采集已重新启动：

```bash
screen -dmS wyckoff_bybit_liq_capture_24h npm run crypto:capture -- --provider=bybit --duration-sec=86400 --event-type=liquidation
npm run crypto:capture:status -- --screen=wyckoff_bybit_liq_capture_24h
screen -dmS wyckoff_bybit_liq_capture_24h_heartbeat npm run crypto:capture -- --provider=bybit --duration-sec=86400 --event-type=liquidation
npm run crypto:capture:status -- --screen=wyckoff_bybit_liq_capture_24h_heartbeat
```

启动后状态：

- screen：`15996.wyckoff_bybit_liq_capture_24h` detached / running。
- screen：`18014.wyckoff_bybit_liq_capture_24h_heartbeat` detached / running。
- status：`Capture screen: running`。
- raw 扫描：Files 163，Events 40,521，BTC events 40,507，BTC liquidation events 1，BTC long liquidation events 0，BTC short liquidation events 1，Liquidation events 14，Provider status events 17，parse errors 0。
- 最新 provider status 文件：`crypto-workspace/data/raw/bybit/2026-05-13/linear_all_liquidation-2026-05-13T14-03-15-597Z.jsonl`，来自新心跳版 24h Bybit capture；已写入 `capture_connected` 和 `subscription_ack`，后续应每 5 分钟写入 `capture_heartbeat`。
- 旧的 `wyckoff_bybit_liq_capture_24h` 仍在运行，但它启动于心跳落盘逻辑之前；后续优先监控 `wyckoff_bybit_liq_capture_24h_heartbeat`。
- 新增 Bybit 输出文件：`crypto-workspace/data/raw/bybit/2026-05-13/linear_all_liquidation-2026-05-13T13-16-56-705Z.jsonl`。
- 新增心跳版 Bybit 输出文件：`crypto-workspace/data/raw/bybit/2026-05-13/linear_all_liquidation-2026-05-13T14-03-15-597Z.jsonl`。

结论：

- 2026-05-12 的 Bybit DNS / 沙箱网络失败不是当前最终状态；在可用代理 / 提权网络下 Bybit liquidation stream 已恢复可连接。
- 当前仍未新增 BTC long liquidation 正样本；下一步应持续监控 24h 到 72h Bybit 采集，再用 candidate scan 查找 `long liquidation + 价格收回 + 盘口恢复` 窗口。
- 固定复核命令：`npm run crypto:capture:status -- --screen=wyckoff_bybit_liq_capture_24h_heartbeat` 和 `npm run crypto:phase-c:candidates`。前者现在会直接输出 BTC long / short liquidation 方向计数、provider status 计数和最新来源文件。

## 2026-05-11 低门槛历史数据源复查

当前本地 raw 数据扫描结果：

```bash
npm run crypto:phase-c:candidates
```

结果：

- BTC events：38,501
- BTC liquidation events：1
- long liquidation candidates：0
- short liquidation candidates：1
- full sensor ready candidates：1

结论：

- 本地自建 capture 当前只有一个 short liquidation 对照窗口，仍缺 Phase C 正样本。
- 下一步不应等待短窗口实时采集自然碰到正样本，而应验证低门槛历史源。

低门槛历史源复查结论：

- OKX Historical Data：可作为 OKX BTC trade / L2 order book / funding 历史窗口入口，但当前不走手工下载 / 手工导入路线。
- CoinGlass：pair liquidation history 适合作为分钟级 long / short 清算聚合上下文，但截至 2026-05-12 API 付费，当前先跳过真实下载。
- CryptoHFTData：值得小窗口验证，但作为新数据源必须先审计字段、许可、覆盖起点和缺口。
- Tardis.dev / Kaiko：仍是更完整的 research primary 候选，但不作为“先免费的跑跑”的第一选择。

新增免费历史源探测入口：

```bash
npm run crypto:history:free-sources
npm run crypto:history:free-sources -- --provider=binance_vision --date=2026-05-09 --live
```

Binance Vision live HEAD 结果：

- `spot_agg_trades_daily`：available
- `spot_klines_daily`：available
- `um_futures_agg_trades_daily`：available
- `um_futures_klines_daily`：available
- `um_futures_liquidation_snapshot_daily`：unavailable / 404

结论：

- Binance Vision 免费源可以补 BTC spot / perp trade 和 K 线历史窗口。
- 当前日期的 USDT-M liquidationSnapshot 不可用，不能解决 Phase C 正样本的清算证据缺口。
- 下一步仍需要清算正样本；当前不推进 OKX 手工文件验证，CoinGlass 真实 API 因付费先跳过。

新增 Binance Vision aggTrades / kline 导入入口：

```bash
npm run crypto:history:binance-vision -- --date=2026-05-09
npm run crypto:history:binance-vision -- --date=2026-05-09 --limit-rows=1000 --download
```

导入结果：

- `spot_agg_trades_daily`：写入 1,000 条 normalized `trade` 事件。
- `um_futures_agg_trades_daily`：写入 1,000 条 normalized `trade` 事件。
- 输出目录：`crypto-workspace/data/raw/binance_vision/2026-05-09/`，已被 git ignore。
- replay 验证：`provider=binance_vision`、`event-type=trade` 可匹配 2,000 条事件。
- candidate scan 验证：BTC events 从 38,501 增加到 40,501；BTC liquidation events 仍为 1，long liquidation candidates 仍为 0。

2026-05-12 补充：

- 事件契约新增 normalized `kline` 类型。
- Binance Vision 导入器 dry-run 已扩展到 `spot_klines_daily` 和 `um_futures_klines_daily`。
- 免费历史源 manifest 中，上述四个 Binance Vision trade / kline 资源标记为 `implemented`；`liquidationSnapshot` 仍未实现为可靠输入。

结论：

- Binance Vision 导入链路可用，能补 spot / perp CVD 所需 trade 历史和 1m K 线价格上下文。
- 它不补 liquidation，不能单独构成 Phase C 正样本。

2026-05-12 爆仓数据 research 后补充：

- 已把爆仓证据分为 `raw_exchange_liquidation`、`aggregate_liquidation_context` 和 `liquidation_level_heatmap` 三层。
- Phase C evidence 新增 `derivativesContext.openInterestShock`，用 OI 明显下降交叉验证清算去杠杆，因为公开 liquidation feed 可能低报。
- Phase C classification 已把 OI 去杠杆确认纳入未来 `spring_candidate` 硬条件。
- 新增 CoinGlass pair liquidation history 导入入口，默认 dry-run；只有提供 `COINGLASS_API_KEY` 并显式 `--download` 才拉取 API。
- 用户确认当前不打算手工导入数据；CoinGlass API 当前付费，因此真实下载暂跳过。

```bash
npm run crypto:history:coinglass -- --date=2026-05-09
COINGLASS_API_KEY=<key> npm run crypto:history:coinglass -- --date=2026-05-09 --download
```

2026-05-12 Bybit 长跑复核：

```bash
npm run crypto:capture:status -- --screen=wyckoff_bybit_liq_capture_24h
npm run crypto:capture -- --provider=bybit --duration-sec=5 --event-type=liquidation
```

结果：

- `screen` 当前为 `not_found`，没有 24h Bybit capture 在后台运行。
- 前台 5 秒 Bybit capture 退出，错误为 `getaddrinfo ENOTFOUND stream.bybit.com`。
- 提权网络重试请求超时，未能验证非沙箱网络是否可连。

结论：

- 当前本机沙箱网络无法启动 Bybit 长跑采集。
- 下一步在代理 / 外网权限可用后，先复跑 5 秒 smoke，再用 `screen -dmS wyckoff_bybit_liq_capture_24h npm run crypto:capture -- --provider=bybit --duration-sec=86400 --event-type=liquidation` 启动 24h 采集。由于不走 OKX 手工导入且 CoinGlass 付费先跳过，Bybit 免费实时采集是当前最现实的清算正样本来源。

下一次验证目标：

1. 解决本机 Bybit WebSocket DNS / 代理连通性。
2. 启动并监控 24h 到 72h Bybit `allLiquidation.BTCUSDT` 采集。
3. 用 Binance Vision 继续补 trade / kline 历史上下文。
4. 如果仍长期没有 long liquidation 样本，再评估可程序化免费源或付费研究主源；不要走手工下载数据路线。

## 2026-05-07 Phase 0 初始探测

### 本地 dry-run

命令：

```bash
npm run crypto:probe
```

结果：

- 成功生成 `crypto-workspace/reports/provider-probe-last.json`。
- Binance / OKX 的公开 REST 探测计划均可生成。
- dry-run 明确标出 `book_delta` 和 `liquidation` 不在当前 REST 探测范围内，后续需要 WebSocket 或统一数据商验证。

结论：

- `crypto-workspace` 的 Phase 0 骨架可用。
- 当前脚本适合先做 provider reachability 和字段覆盖报告，不承担策略逻辑。

### Binance live public REST probe

命令：

```bash
npm run crypto:probe -- --live --provider=binance
```

结果：

- `spot_book_snapshot`：8 秒超时。
- `spot_recent_trades`：8 秒超时。
- `perp_book_snapshot`：8 秒超时。
- `perp_recent_trades`：8 秒超时。
- `perp_open_interest`：8 秒超时。
- `perp_funding_rate`：8 秒超时。

结论：

- 当前本机网络路径无法稳定访问 Binance public REST。
- 这不是 Binance 能力结论，只是当前运行环境的可达性结论。
- Binance 暂不能直接作为当前机器上的 live fallback，除非后续切换网络、代理、VPS 或 relay。

### OKX live public REST probe

命令：

```bash
npm run crypto:probe -- --live --provider=okx --report=crypto-workspace/reports/okx-provider-probe-last.json
```

结果：

- `spot_book_snapshot`：8 秒超时。
- 其余 spot / perp trades、order book、OI、Funding endpoint 返回 `fetch failed`。

结论：

- 当前本机网络路径也无法稳定访问 OKX public REST。
- OKX 暂不能直接作为当前机器上的 live fallback，除非后续切换网络、代理、VPS 或 relay。

## 当前判断

当前最短路径不是继续写交易逻辑，而是先解决数据入口运行位置：

1. 在真实部署网络或云主机上复跑 Binance / OKX live probe。
2. 如免费实时采集继续受阻，再评估 Tardis.dev / CoinGlass / Kaiko 的历史数据下载、API 试用和预算。
3. 如果本机网络持续不可达，把 live collector 放到可访问交易所 API 的 relay / VPS 上，本地只消费 normalized event 文件或 HTTP relay。

## 下一次验证要回答的问题

- 哪个运行环境可以稳定访问 Binance / OKX public endpoint。
- 是否需要代理或境外 VPS。
- 统一数据商能否覆盖历史 tick、order book、OI、Funding 和 liquidation。
- 数据商是否允许本地落盘和回放。

## 2026-05-07 代理后复测

### 代理环境

shell 中检测到：

```text
http_proxy=http://127.0.0.1:7890
https_proxy=http://127.0.0.1:7890
all_proxy=socks5://127.0.0.1:7890
```

单独使用 `curl` 可以通过代理访问 Binance / OKX 公共接口。Node 内置 `fetch` 不会自动走这些代理环境变量，因此 provider probe 已补充代理环境下的 `curl` transport。

### Binance live public REST probe

命令：

```bash
npm run crypto:probe -- --live --provider=binance --report=crypto-workspace/reports/binance-provider-probe-last.json
```

结果：

- `spot_book_snapshot`：成功，约 1558 ms。
- `spot_recent_trades`：成功，约 1610 ms。
- `perp_book_snapshot`：成功，约 3039 ms。
- `perp_recent_trades`：成功，约 1511 ms。
- `perp_open_interest`：成功，约 3357 ms。
- `perp_funding_rate`：成功，约 2044 ms。
- 当前 REST probe 仍缺 `book_delta` 和 `liquidation`。

结论：

- 代理 + 提升权限后，Binance public REST 可作为 live fallback 候选。
- 延迟在 1.5s 到 3.4s 区间，只适合 Phase 0 探测和低频健康检查，不代表可用于秒级执行。
- 订单簿增量和 liquidation 需要继续通过 WebSocket 或统一数据商验证。

### OKX live public REST probe

命令：

```bash
npm run crypto:probe -- --live --provider=okx --report=crypto-workspace/reports/okx-provider-probe-last.json
```

结果：

- `spot_book_snapshot`：成功，约 1089 ms。
- `spot_recent_trades`：成功，约 1350 ms。
- `perp_book_snapshot`：成功，约 2069 ms。
- `perp_recent_trades`：成功，约 2307 ms。
- `perp_open_interest`：成功，约 1671 ms。
- `perp_funding_rate`：成功，约 1085 ms。
- 当前 REST probe 仍缺 `book_delta` 和 `liquidation`。

结论：

- 代理 + 提升权限后，OKX public REST 也可作为 live fallback 候选。
- 延迟在 1.1s 到 2.3s 区间，比本次 Binance REST 探测略稳定。
- 仍需验证 WebSocket depth / trades / open-interest / funding-rate / liquidation-orders 频道。

## 当前更新判断

- 本机代理可解决 REST 公共接口可达性。
- Phase 0 可以继续推进 live fallback 验证，但执行级数据采集不能依赖 REST 轮询。
- 下一步应新增 WebSocket probe，优先验证 `book_delta` 与 `liquidation`，并把 REST probe 保留为健康检查与字段覆盖检查。

## 2026-05-07 WebSocket probe

### 新增命令

```bash
npm run crypto:ws-probe
npm run crypto:ws-probe -- --live --provider=binance --report=crypto-workspace/reports/binance-ws-probe-last.json
npm run crypto:ws-probe -- --live --provider=okx --report=crypto-workspace/reports/okx-ws-probe-last.json
```

说明：

- 当前 WebSocket probe 使用 HTTP CONNECT 代理后进行标准 WebSocket 握手。
- 不依赖交易所 API key。
- 不保存原始行情数据，只保存字段覆盖、延迟、订阅确认和样本 shape。

### Binance WebSocket live probe

结果：

- `spot_depth_delta`：成功，拿到 BTCUSDT spot depth delta 样本，约 2664 ms。
- `perp_depth_delta`：成功，拿到 BTCUSDT USDT-M futures depth delta 样本，约 1115 ms。
- `perp_force_order`：频道连接成功，但 12 秒窗口内没有 liquidation 样本。

结论：

- Binance 可以作为 `book_delta` live fallback 候选。
- Binance `forceOrder` liquidation 频道可连通，但需要更长窗口、历史数据商或极端行情窗口验证样本结构。

### OKX WebSocket live probe

结果：

- `spot_books_delta`：成功，订阅确认并拿到 BTC-USDT books 样本，约 2112 ms。
- `perp_books_delta`：成功，订阅确认并拿到 BTC-USDT-SWAP books 样本，约 4297 ms。
- `liquidation_orders`：订阅确认成功，但 12 秒窗口内没有 liquidation 样本。

结论：

- OKX 可以作为 `book_delta` live fallback 候选。
- OKX `liquidation-orders` 频道可订阅，但需要更长窗口、历史数据商或极端行情窗口验证样本结构。

## Phase 0 当前结论

本机代理 + 提升权限后，Binance / OKX 的公开 REST 和 WebSocket 均具备初步可达性：

- `trade`：REST 可达。
- `book_snapshot`：REST 可达。
- `book_delta`：WebSocket 可达并拿到样本。
- `open_interest`：REST 可达。
- `funding_rate`：REST 可达。
- `liquidation`：WebSocket 频道可连通，但短窗口无样本。

因此，Binance / OKX 可以继续作为 live fallback 候选。Phase 0 剩余关键点是选择 research primary，并验证 liquidation 历史样本和可回放能力。

## 2026-05-07 Live capture 工具

新增命令：

```bash
npm run crypto:capture -- --duration-sec=60
npm run crypto:capture -- --duration-sec=86400 --event-type=liquidation
npm run crypto:capture:status
```

用途：

- 默认采集 Binance `forceOrder` 和 OKX `liquidation-orders`。
- 写入本地 JSONL：`crypto-workspace/data/raw/<provider>/<date>/...jsonl`。
- 写入 summary report：`crypto-workspace/reports/live-capture-last.json`。
- 原始数据目录已被 `.gitignore` 忽略，不提交。
- `crypto:capture:status` 会扫描 raw JSONL，统计 liquidation events、BTC-related events，并检查 `screen` session 是否仍在。

当前建议：

- 先跑 60 秒 smoke test。
- 再跑 24h 到 72h liquidation capture。
- 如果 24h 仍无样本，等待高波动窗口；付费聚合源只在免费采集确认成为瓶颈后再评估。

### 10 秒 smoke test

命令：

```bash
npm run crypto:capture -- --duration-sec=10 --event-type=liquidation
```

结果：

- Binance `perp_force_order`：连接成功，10 秒内无 liquidation 样本。
- OKX `liquidation_orders`：订阅确认成功，10 秒内无 liquidation 样本。
- 成功写入 `crypto-workspace/reports/live-capture-last.json`。
- 原始 JSONL 写入 `crypto-workspace/data/raw/`，该目录已被 git 忽略。

结论：

- live capture 工具可运行。
- 短窗口无样本符合预期，不代表 liquidation 流不可用。
- 下一步应跑 24h 到 72h capture，或在明显高波动窗口手动复跑。

### 24h capture 初次监控

首次后台启动后，OKX 很快写入 liquidation 样本，但样本包含 `XAG-USDT-SWAP`、`LAB-USDT-SWAP`、`CRCL-USDT-SWAP`、`OP-USDT-SWAP` 等全市场 swap 清算，而不是 BTC 专属清算。

结论：

- OKX `liquidation-orders` 当前订阅参数 `instType=SWAP` 返回全 swap 清算。
- 这对市场压力观测有价值，但不能标成 BTC 专属数据。
- 已将 capture stream metadata 从 `BTC-USDT-LIQUIDATION` 修正为 `ALL-USDT-SWAP-LIQUIDATION`，后续 BTC 专属分析需要按 payload 中的 `instId` / `instFamily` 过滤。

### 24h capture 当前状态

记录时间：2026-05-07 22:42:57 CST

状态：

- 后台 session：`wyckoff_liq_capture_24h`
- screen 状态：running
- raw 文件数：8
- raw 文件总大小：7933 bytes
- 总事件数：15
- liquidation 事件数：13
- BTC 相关 liquidation 事件数：0
- JSON parse errors：0

解读：

- 24h capture 正在运行。
- 已捕获 OKX 全 swap liquidation 样本。
- 当前尚未捕获 BTC 专属 liquidation 样本。
- 后续验证使用 `npm run crypto:capture:status` 作为固定入口。

## 2026-05-10 Replay fixture 与 Phase C 分类验证

### 新增固定入口

```bash
npm run crypto:fixtures
npm run crypto:phase-c:evidence
npm run crypto:phase-c:classify
```

### 当前 fixture

- `okx-btc-liquidation-2026-05-09T12-14Z`：包含 trade、book_delta、OI、Funding 和 1 条 BTC liquidation。
- `okx-btc-no-liquidation-2026-05-09T12-33Z`：包含 trade、book_delta、OI 和 Funding，但无 BTC liquidation。

### 验证结果

- `npm run crypto:fixtures`：2 passed / 0 failed。
- `npm run crypto:phase-c:evidence`：2 个窗口中 1 个满足 Phase C 输入，1 个满足 full sensor 输入。
- `npm run crypto:phase-c:classify`：0 个 `spring_candidate`，0 个 `breakdown_risk`，1 个 `short_squeeze_only`，1 个 `insufficient_evidence`。

### 结论

- 当前唯一真实 BTC 清算窗口是短仓强平主导，不能当成 Spring。
- 分类器已能把空头挤压挡在 `short_squeeze_only`，避免误判为 `spring_candidate`。
- 下一步需要扩充历史窗口，优先寻找多头强平主导、价格收回、盘口恢复的 Phase C 候选样本。

## 2026-05-11 Bybit liquidation 补充源

### 新增入口

```bash
npm run crypto:ws-probe -- --provider=bybit
npm run crypto:capture -- --provider=bybit --duration-sec=86400 --event-type=liquidation
npm run crypto:capture:status -- --screen=wyckoff_bybit_liq_capture_24h
```

### 映射规则

- Bybit public linear WebSocket topic：`allLiquidation.BTCUSDT`。
- `S=Buy` 表示多头被强平，映射为 `posSide=long`、`side=sell`。
- `S=Sell` 表示空头被强平，映射为 `posSide=short`、`side=buy`。

### live probe 结果

```bash
npm run crypto:ws-probe -- --live --provider=bybit
```

- transport：`proxy+wss`
- subscriptionAck：`true`
- status：`connected_no_sample`
- latencyMs：约 12,001 ms

12 秒窗口内未出现 liquidation 样本符合预期；关键验证点是公共频道可连接且订阅确认成功。

### 24h capture 启动状态

命令：

```bash
screen -dmS wyckoff_bybit_liq_capture_24h npm run crypto:capture -- --provider=bybit --duration-sec=86400 --event-type=liquidation
npm run crypto:capture:status -- --screen=wyckoff_bybit_liq_capture_24h
```

结果：

- screen：`20821.wyckoff_bybit_liq_capture_24h` detached / running。
- status：`Capture screen: running`。
- 当前 raw 扫描：BTC events 40,501，BTC liquidation events 1，parse errors 0。
- 启动后短时间内尚未新增 Bybit BTC liquidation 样本；这符合清算流稀疏特性。
- 这是 2026-05-11 的点时状态；2026-05-12 复核时该 screen 已变为 `not_found`，以后以本文顶部 2026-05-12 复核结论为准。

### 结论

- Bybit 当前作为免费实时 liquidation-only 补充源，用于增加后续长跑采集命中 BTC long liquidation 正样本的概率。
- 它不替代 Binance / OKX 的 trade、book、OI、Funding 上下文，也不改变“先复核样本、再 paper trade”的边界。
