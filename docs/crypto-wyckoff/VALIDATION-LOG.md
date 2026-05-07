# BTC 数据源验证记录

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
2. 并行验证 Tardis.dev / CoinGlass / Kaiko 是否能提供历史数据下载或 API 试用。
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
- 如果 24h 仍无样本，等待高波动窗口，或验证 CoinGlass / Velo / Kaiko 的历史清算数据。

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
