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

Long liquidation capture:

```bash
npm run crypto:capture -- --duration-sec=86400 --event-type=liquidation
```

Capture data is written under `crypto-workspace/data/raw/` and is ignored by git.

Check active capture status:

```bash
npm run crypto:capture:status
```

This scans raw JSONL files, counts liquidation events, counts BTC-related events, and checks the `wyckoff_liq_capture_24h` screen session.

## Phase 0 Exit Criteria

- One research primary candidate can cover trades, order book, open interest, funding, and liquidation evidence.
- One live fallback exchange source is verified for delay and heartbeat behavior.
- Any missing field is explicit in the report.
- No strategy logic depends on provider-specific payload fields.
