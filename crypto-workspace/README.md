# Crypto Wyckoff Workspace

This workspace is the isolated BTC / crypto research lane.

Its current job is Phase 0 provider validation:

- define the normalized event contract
- keep market symbols and provider symbols in one config
- probe public data endpoints without API keys
- write provider validation reports

It is not a trading bot. It must not store exchange API keys or connect to funded accounts.

## Files

- `config/markets.json`: BTC market definitions and provider symbol mappings.
- `src/schema/normalizedEvent.schema.json`: canonical event contract for raw provider data.
- `src/providers/probeProviders.mjs`: public REST provider probes.
- `src/runProviderProbe.mjs`: CLI entrypoint for dry-run and live probes.
- `src/runWsProbe.mjs`: CLI entrypoint for WebSocket channel probes.
- `src/runLiveCapture.mjs`: CLI entrypoint for short or long live JSONL captures.
- `src/runReplayWindow.mjs`: CLI entrypoint for local JSONL replay windows.
- `src/runReplayFixtures.mjs`: CLI entrypoint for pinned replay fixture checks.
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
```

Reports are written to `crypto-workspace/reports/provider-probe-last.json`.
WebSocket reports are written to `crypto-workspace/reports/ws-provider-probe-last.json`.

Short liquidation capture smoke test:

```bash
npm run crypto:capture -- --duration-sec=60
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
```

Capture data is written under `crypto-workspace/data/raw/` and is ignored by git.
For aggregate liquidation feeds such as OKX `liquidation-orders`, the capture step filters provider payloads to the configured BTC instrument before writing JSONL. Non-BTC liquidation messages are counted as `filteredMessages` in the capture report and are not treated as replay samples.

Check active capture status:

```bash
npm run crypto:capture:status
```

This scans raw JSONL files, counts liquidation events, counts BTC-related events, separates true BTC liquidation events, and checks the `wyckoff_liq_capture_24h` screen session.

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

## Phase 0 Exit Criteria

- One research primary candidate can cover trades, order book, open interest, funding, and liquidation evidence.
- One live fallback exchange source is verified for delay and heartbeat behavior.
- Any missing field is explicit in the report.
- No strategy logic depends on provider-specific payload fields.
