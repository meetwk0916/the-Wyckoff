# Crypto Wyckoff Workspace

This workspace is the isolated BTC / crypto research lane.

Its current job is the early BTC replay and Phase C classification lane:

- keep the normalized event contract and market symbol mappings stable
- probe and capture public exchange data without API keys
- write append-only local JSONL data for replay
- run pinned replay fixtures
- aggregate Phase C evidence
- conservatively classify candidates before any paper trade work
- derive spot / perp CVD context for rule calibration

It is not a trading bot. It must not store exchange API keys or connect to funded accounts.

## Files

- `config/markets.json`: BTC market definitions and provider symbol mappings.
- `src/schema/normalizedEvent.schema.json`: canonical event contract for raw provider data.
- `src/providers/probeProviders.mjs`: public REST provider probes.
- `src/runProviderProbe.mjs`: CLI entrypoint for dry-run and live probes.
- `src/runWsProbe.mjs`: CLI entrypoint for WebSocket channel probes.
- `src/runLiveCapture.mjs`: CLI entrypoint for short or long live JSONL captures.
- `src/runFreeHistoricalSourceProbe.mjs`: CLI entrypoint for free historical source manifests and availability checks.
- `src/runBinanceVisionImport.mjs`: CLI entrypoint for downloading Binance Vision aggTrades / klines ZIP files into normalized JSONL events.
- `src/runCoinGlassLiquidationImport.mjs`: CLI entrypoint for importing CoinGlass pair liquidation history as aggregate liquidation context.
- `src/runReplayWindow.mjs`: CLI entrypoint for local JSONL replay windows.
- `src/runReplayFixtures.mjs`: CLI entrypoint for pinned replay fixture checks.
- `src/runPhaseCEvidence.mjs`: CLI entrypoint for Phase C evidence aggregation without Spring classification.
- `src/runPhaseCClassify.mjs`: CLI entrypoint for conservative Phase C candidate classification.
- `src/runPhaseCReview.mjs`: CLI entrypoint for review-index scoring and rule-calibration summaries.
- `src/runPhaseCVerify.mjs`: CLI guardrail for pinned Phase C labels and review agreement.
- `src/runPhaseCCandidateScan.mjs`: CLI entrypoint for scanning raw JSONL into Phase C liquidation candidate windows and fixture drafts.
- `src/utils/liquidations.mjs`: shared liquidation detail extraction and long / short direction semantics for status and candidate scans.
- `reviews/phase-c-review-index.json`: machine-readable human review labels for pinned Phase C windows.
- `data/README.md`: local market data boundary.
- `reports/README.md`: generated provider probe report boundary.

## Usage

Dry run. This does not call any provider:

```bash
npm run crypto:probe
```

Live public endpoint probe:

```bash
npm run crypto:probe -- --live
```

Probe only one provider:

```bash
npm run crypto:probe -- --live --provider=binance
npm run crypto:probe -- --live --provider=okx
```

Dry run WebSocket channel probe:

```bash
npm run crypto:ws-probe
```

Live WebSocket channel probe:

```bash
npm run crypto:ws-probe -- --live --provider=binance
npm run crypto:ws-probe -- --live --provider=okx
npm run crypto:ws-probe -- --live --provider=bybit
```

Reports are written to `crypto-workspace/reports/provider-probe-last.json`.
WebSocket reports are written to `crypto-workspace/reports/ws-provider-probe-last.json`.

Check free historical source availability:

```bash
npm run crypto:history:free-sources
npm run crypto:history:free-sources -- --provider=binance_vision --date=2026-05-09 --live
```

The report is written to `crypto-workspace/reports/free-historical-sources-last.json`. Dry run mode emits expected public download URLs and manual source checks. Live mode uses HEAD checks for predictable public URLs such as Binance Vision. It does not download ZIP payloads or import data.

Download and import Binance Vision aggTrades / kline samples:

```bash
npm run crypto:history:binance-vision -- --date=2026-05-09
npm run crypto:history:binance-vision -- --date=2026-05-09 --limit-rows=1000 --download
```

Dry run mode only writes an import plan. `--download` downloads Binance Vision ZIP files under `crypto-workspace/data/free-sources/` and writes normalized JSONL under `crypto-workspace/data/raw/binance_vision/`. Both locations are ignored by git. This importer currently supports spot and USDT-M futures `aggTrades` as `trade` events plus 1m klines as `kline` events; it does not import liquidation evidence.

Plan and import CoinGlass aggregate liquidation context:

```bash
npm run crypto:history:coinglass -- --date=2026-05-09
COINGLASS_API_KEY=<key> npm run crypto:history:coinglass -- --date=2026-05-09 --download
```

CoinGlass imports are written under `crypto-workspace/data/raw/coinglass/` as normalized `liquidation` events with `aggregate_liquidation_context` quality warnings. They can help find historical long / short liquidation windows, but they are not exchange-native raw liquidation evidence.

As of 2026-05-12, real CoinGlass API downloads are skipped because the needed API path is paid. Keep this command as a future optional import path, not as a current required step.

Short liquidation capture smoke test:

```bash
npm run crypto:capture -- --duration-sec=60
npm run crypto:capture -- --provider=bybit --duration-sec=60 --event-type=liquidation
```

Capture trade streams:

```bash
npm run crypto:capture -- --duration-sec=60 --event-type=trade
```

Capture REST derivatives state snapshots:

```bash
npm run crypto:rest-capture
npm run crypto:rest-capture -- --provider=okx --event-type=derivatives_state
```

Long liquidation capture:

```bash
npm run crypto:capture -- --duration-sec=86400 --event-type=liquidation
npm run crypto:capture -- --provider=bybit --duration-sec=86400 --event-type=liquidation
```

Capture data is written under `crypto-workspace/data/raw/` and is ignored by git.
For aggregate liquidation feeds such as OKX `liquidation-orders`, the capture step filters provider payloads to the configured BTC instrument before writing JSONL. Non-BTC liquidation messages are counted as `filteredMessages` in the capture report and are not treated as replay samples.
Bybit `allLiquidation.BTCUSDT` is BTCUSDT-filtered by topic and maps `S=Buy` to long liquidation and `S=Sell` to short liquidation. It is a liquidation-only supplement; trades, book, OI, and Funding still come from Binance / OKX or historical imports.

Check active capture status:

```bash
npm run crypto:capture:status
npm run crypto:capture:status -- --screen=wyckoff_bybit_liq_capture_24h
npm run crypto:capture:status -- --screen=wyckoff_bybit_liq_capture_24h_heartbeat
npm run crypto:capture:status -- --screen=wyckoff_bybit_liq_capture_7d_heartbeat
npm run crypto:daily-check
```

This scans raw JSONL files, counts liquidation events, counts BTC-related events, separates true BTC liquidation events, reports BTC long / short liquidation direction counts, reports provider status heartbeat counts and latest source files, and checks the `wyckoff_liq_capture_24h` screen session.
Use the `--screen` override for provider-specific long-running captures. Screen matching is exact, so `wyckoff_bybit_liq_capture_24h` no longer matches `wyckoff_bybit_liq_capture_24h_heartbeat` by prefix. The heartbeat-enabled Bybit session uses `wyckoff_bybit_liq_capture_24h_heartbeat`.
For daily monitoring, prefer the 7d session name `wyckoff_bybit_liq_capture_7d_heartbeat`.
`crypto:daily-check` defaults to that 7d session, runs capture status and Phase C candidate scan together, writes `reports/daily-capture-check-last.json`, and prints the daily fields to inspect: screen status, latest provider heartbeat, BTC long / short liquidation counts, candidate counts, and parse errors.

Scan raw JSONL into Phase C candidate windows:

```bash
npm run crypto:phase-c:candidates
npm run crypto:phase-c:candidates -- --before-min=10 --after-min=10
```

The candidate scan report is written to `crypto-workspace/reports/phase-c-candidates-last.json`. It finds BTC liquidation events, builds review windows around them, checks trade / book / OI / Funding / liquidation coverage, and emits fixture drafts. It does not classify Spring or approve trades.

Replay a local JSONL window:

```bash
npm run crypto:replay -- --event-type=liquidation --symbol=BTC
npm run crypto:replay -- --start=2026-05-07T14:30:00Z --end=2026-05-07T14:40:00Z --event-type=liquidation --symbol=BTC
```

Replay reports are written to `crypto-workspace/reports/replay-window-last.json`. When provider payloads contain their own instrument symbols, replay filtering uses those payload symbols first; this avoids treating OKX full-market liquidation messages as BTC events just because the stream itself is aggregate.
The replay report also includes instrument coverage, latency summary, and an `evidence` block. `minimumPhaseCReady` only means the selected window has both `book_delta` and `liquidation`; it is still not a Spring signal. Trade coverage is the base layer for later spot/perp CVD, and REST derivatives snapshots provide OI/Funding context, but CVD and Phase C classification are intentionally not part of this capture step.

Run pinned replay fixture checks:

```bash
npm run crypto:fixtures
npm run crypto:fixtures -- --fixture=okx-btc-liquidation-2026-05-09T12-14Z
```

Fixture definitions live in `crypto-workspace/config/replay-fixtures.json`. Reports are written under `crypto-workspace/reports/fixtures/` and summarized in `crypto-workspace/reports/replay-fixtures-last.json`.

Aggregate Phase C evidence from pinned fixtures:

```bash
npm run crypto:phase-c:evidence
npm run crypto:phase-c:evidence -- --fixture=okx-btc-liquidation-2026-05-09T12-14Z
```

The evidence report is written to `crypto-workspace/reports/phase-c-evidence-last.json`. It reports observable price action, trade flow, spot / perp CVD context, book recovery, liquidation, OI, OI shock, and Funding context. Funding is reported as crowding context (`crowded_long`, `crowded_short`, or neutral), not as a standalone Spring trigger. Order book recovery now also includes anchor-relative pre / post 1m / post 3m buckets for bid depth, ask depth, and imbalance changes. It does not classify Spring, LPS, or trade actions.
The evidence report also includes a conservative `structureContext` block. It estimates a local support / resistance band from spot and perp price observations around the window anchor, then records whether support was broken and recovered. This is review evidence, not a trade trigger.

Classify Phase C candidates from an evidence report:

```bash
npm run crypto:phase-c:classify
```

The classification report is written to `crypto-workspace/reports/phase-c-classification-last.json`. Labels are limited to `spring_candidate`, `breakdown_risk`, `short_squeeze_only`, and `insufficient_evidence`. A future Spring candidate must pass liquidation direction, structure recovery, book recovery, Phase C CVD support, and OI deleveraging checks. Funding crowding and 1m / 3m order book bucket changes are included as explanatory context and confidence inputs, not as permission to skip the core Spring checks. This report still does not emit entries, exits, position sizing, or trade actions.

Run the Phase C review index and scoring report:

```bash
npm run crypto:phase-c:review
```

The review index lives at `crypto-workspace/reviews/phase-c-review-index.json`. It records fixed human labels, rationales, and machine-readable factors for each reviewed window. The generated review report is written to `crypto-workspace/reports/phase-c-review-last.json` and summarizes rule scores, reviewed / pending counts, and system-vs-review agreement. Review scoring now includes funding crowding and post-3m order book retreat / imbalance components as calibration evidence. This is research calibration only; it does not approve live or paper trades.

Verify pinned Phase C guardrails:

```bash
npm run crypto:phase-c:check
npm run crypto:phase-c:verify
```

`crypto:phase-c:check` runs evidence, classification, review, and verification in the required order. `crypto:phase-c:verify` only reads the latest classification, review, and candidate reports. It fails if the pinned short-squeeze and insufficient-evidence fixtures change labels unexpectedly or if review disagreement appears. Candidate long / short liquidation counts are printed as status only, so future positive long-liquidation samples do not break the guardrail.

## Phase 0 Exit Criteria

- One research primary candidate can cover trades, order book, open interest, funding, and liquidation evidence.
- One live fallback exchange source is verified for delay and heartbeat behavior.
- Any missing field is explicit in the report.
- No strategy logic depends on provider-specific payload fields.

## Current Status

As of 2026-05-13:

- Two pinned OKX BTC replay fixtures exist in `config/replay-fixtures.json`.
- `npm run crypto:fixtures` passes both fixtures.
- `npm run crypto:phase-c:evidence` emits one Phase C-ready evidence window and one insufficient-evidence control window, including local structure support / recovery context.
- `npm run crypto:phase-c:evidence` also emits first-pass spot / perp CVD context with notional delta, delta ratio, demand / supply bias, divergence, and Phase C flow support.
- Funding crowding and post-anchor 1m / 3m order book changes are now captured as calibration context; they do not replace the hard Spring gates.
- `npm run crypto:phase-c:classify` classifies the current BTC liquidation window as `short_squeeze_only`, not `spring_candidate`; future Spring candidates must still pass long liquidation direction, structure recovery, book recovery, Phase C CVD support, and OI deleveraging.
- `npm run crypto:phase-c:review` reads the seed review index, scores both windows, and reports 2 reviewed / 0 pending with system-review agreement.
- `npm run crypto:phase-c:check` is the preferred local guardrail because it runs evidence, classify, review, and verify in order.
- `npm run crypto:phase-c:candidates` currently finds 1 BTC liquidation candidate in local raw data: 0 long liquidation candidates and 1 short liquidation control window. This means no `spring_candidate` sample has been captured yet, which is expected for sparse liquidation streams.
- `npm run crypto:history:free-sources -- --provider=binance_vision --date=2026-05-09 --live` confirms Binance Vision spot/perp aggTrades and 1m klines are available for that date, while USDT-M `liquidationSnapshot` is unavailable.
- `npm run crypto:history:binance-vision -- --date=2026-05-09 --limit-rows=1000 --download` imports 1,000 spot and 1,000 USDT-M futures aggTrade rows as normalized trade events. Candidate scan sees them as additional BTC events but still finds 0 long liquidation candidates.
- Bybit public WebSocket support is now wired as an additional free realtime liquidation source. The heartbeat-enabled long-running session name is `wyckoff_bybit_liq_capture_24h_heartbeat`, and its status command is `npm run crypto:capture:status -- --screen=wyckoff_bybit_liq_capture_24h_heartbeat`.
- Capture status now reports provider heartbeat counts and BTC long / short liquidation direction counts using the shared liquidation utility in `src/utils/liquidations.mjs`.
- The next BTC work is sample expansion, CVD threshold calibration, and broader review-index coverage, not trade execution.
