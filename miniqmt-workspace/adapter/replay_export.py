"""Bridge Phase B (Windows capture) -> Phase A (offline Node pipeline).

Converts a captured adapter JSONL recording into a fixture window JSON that the
Node evidence/classify/outcome pipeline can consume. Order-flow events are mapped
into the fixture `orderFlow` shape; daily bars and benchmark bars are taken from
optional kline JSON files exported via xtdata.get_market_data on the client.

Usage:
    python replay_export.py --recording ../state/order_flow.jsonl \
        --kline ../state/600570_daily.json --benchmark ../state/000300_daily.json \
        --symbol 600570.SH --anchor-index 21 \
        --out ../fixtures/ashare-live-600570.json

If --kline is omitted, a skeleton fixture is written with empty dailyBars for you
to fill in. The script never invents price data.
"""

import argparse
import json
import os
import sys

import lib_contract as contract


def parse_args(argv):
    parser = argparse.ArgumentParser(description="Export capture recording to a Node fixture window")
    parser.add_argument("--recording", required=True, help="Adapter JSONL recording path")
    parser.add_argument("--symbol", required=True, help="Raw symbol, e.g. 600570.SH")
    parser.add_argument("--kline", default="", help="Optional daily kline JSON: [{date,o,h,l,c,v}]")
    parser.add_argument("--benchmark", default="", help="Optional benchmark daily JSON: [{date,c}]")
    parser.add_argument("--heldout", default="", help="Optional held-out daily JSON: [{date,o,h,l,c,v}]")
    parser.add_argument("--anchor-index", type=int, default=-1, help="Index of the decision bar in --kline")
    parser.add_argument("--out", required=True, help="Output fixture JSON path")
    return parser.parse_args(argv)


def read_jsonl(path):
    events = []
    with open(path, "r", encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if line:
                events.append(json.loads(line))
    return events


def read_json_array(path):
    if not path:
        return []
    with open(path, "r", encoding="utf-8") as handle:
        return json.load(handle)


def map_order_flow(events):
    """Map order_flow adapter events into the fixture orderFlow snapshot shape."""
    snapshots = []
    has_l2 = False
    for event in events:
        if event.get("eventType") != "order_flow":
            continue
        if event.get("sourceType") == "l2quote":
            has_l2 = True
        snapshots.append({
            "t": event.get("eventTime"),
            "bid": [{"p": lvl.get("p"), "sz": lvl.get("sz")} for lvl in event.get("bidLevels", [])],
            "ask": [{"p": lvl.get("p"), "sz": lvl.get("sz")} for lvl in event.get("askLevels", [])],
            "transactions": [
                {"price": tx.get("price"), "sz": tx.get("sz"), "side": tx.get("side")}
                for tx in event.get("transactions", [])
            ],
        })
    return snapshots, has_l2


def main(argv):
    args = parse_args(argv)
    events = read_jsonl(args.recording)
    order_flow, has_l2 = map_order_flow(events)
    daily = read_json_array(args.kline)
    benchmark = read_json_array(args.benchmark)
    held_out = read_json_array(args.heldout)

    anchor_index = args.anchor_index if args.anchor_index >= 0 else max(len(daily) - 1, 0)
    canonical = contract.normalize_symbol(args.symbol)

    fixture = {
        "id": "ashare-live-" + canonical.split(".")[0],
        "schemaVersion": 1,
        "symbol": canonical,
        "rawSymbol": args.symbol,
        "description": "Exported from live MiniQMT capture. Review before pinning in verify.",
        "filters": {"regime": "unreviewed", "session": "day"},
        "anchorIndex": anchor_index,
        "l2Available": has_l2,
        "params": {},
        "dailyBars": daily,
        "benchmarkBars": benchmark,
        "orderFlow": order_flow,
        "heldOut": held_out,
    }

    if not daily:
        fixture["_todo"] = "dailyBars empty: export via xtdata.get_market_data and re-run, or fill manually."

    directory = os.path.dirname(os.path.abspath(args.out))
    if directory:
        os.makedirs(directory, exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as handle:
        json.dump(fixture, handle, ensure_ascii=False, indent=2)
        handle.write("\n")

    print(json.dumps({
        "wrote": args.out,
        "orderFlowSnapshots": len(order_flow),
        "l2Available": has_l2,
        "dailyBars": len(daily),
        "anchorIndex": anchor_index,
    }, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
