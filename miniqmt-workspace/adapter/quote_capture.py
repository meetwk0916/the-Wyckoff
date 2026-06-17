"""Phase 1 basic quote capture for the MiniQMT / QMT adapter.

Subscribes to (or polls) basic quotes for the configured symbols and appends
contract-compliant `quote` events to a local JSONL store. Falls back cleanly to
`--mock` when XtQuant is not importable, so the field mapping can be validated
offline against the Node pipeline.

Usage:
    python quote_capture.py --symbols 600570.SH 000001.SZ --out ../state/quotes.jsonl --seconds 60
    python quote_capture.py --mock --symbols 600570.SH --out ../state/quotes.jsonl
"""

import argparse
import json
import os
import sys
import time

import lib_contract as contract


def parse_args(argv):
    parser = argparse.ArgumentParser(description="MiniQMT basic quote capture")
    parser.add_argument("--symbols", nargs="+", required=True, help="Raw symbols, e.g. 600570.SH")
    parser.add_argument("--out", default="", help="JSONL store path to append events")
    parser.add_argument("--seconds", type=int, default=30, help="Capture duration (real mode)")
    parser.add_argument("--interval", type=float, default=3.0, help="Poll interval seconds")
    parser.add_argument("--mock", action="store_true", help="Offline mode: emit one sample quote per symbol")
    return parser.parse_args(argv)


def mock_quotes(args, store):
    for symbol in args.symbols:
        event = contract.build_quote(symbol, price=9.45, volume=3200, amount=30240,
                                     payload={"source": "mock"})
        emit(event, store)


def real_quotes(args, store):
    modules, errors = contract.try_import_xtquant()
    if "xtdata" not in modules:
        print(json.dumps({"error": "xtdata_unavailable", "details": errors}, ensure_ascii=False))
        return 2
    xtdata = modules["xtdata"]
    canonical = [contract.normalize_symbol(s) for s in args.symbols]

    # xtdata expects broker-native codes; keep the raw user input for subscription.
    for symbol in args.symbols:
        try:
            xtdata.subscribe_quote(symbol, period="tick", count=0)
        except Exception as exc:  # pragma: no cover - depends on Windows client
            print(json.dumps({"warn": "subscribe_failed", "symbol": symbol, "error": str(exc)}))

    deadline = time.time() + args.seconds
    while time.time() < deadline:
        for raw, canon in zip(args.symbols, canonical):
            try:
                ticks = xtdata.get_full_tick([raw])
                payload = ticks.get(raw, {}) if isinstance(ticks, dict) else {}
                price = payload.get("lastPrice", 0)
                volume = payload.get("volume", 0)
                amount = payload.get("amount", 0)
                event = contract.build_quote(raw, price=price, volume=volume, amount=amount, payload=payload)
                event["symbol"] = canon
                emit(event, store)
            except Exception as exc:  # pragma: no cover
                print(json.dumps({"warn": "tick_read_failed", "symbol": raw, "error": str(exc)}))
        time.sleep(args.interval)
    return 0


def emit(event, store):
    contract.assert_no_credentials(event)
    print(json.dumps(event, ensure_ascii=False))
    if store is not None:
        store.append(event)


def main(argv):
    args = parse_args(argv)
    store = contract.JsonlStore(args.out) if args.out else None
    if args.mock:
        mock_quotes(args, store)
        return 0
    return real_quotes(args, store)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
