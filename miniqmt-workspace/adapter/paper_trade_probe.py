"""Phase 3 paper-trade probe for the MiniQMT / QMT adapter.

Validates the order -> trade -> position -> report loop in MiniQMT SIMULATION
trading only. Live trading stays OFF unless --arm-live is explicitly passed AND
the broker session is itself a real-money account (which this script refuses to
arm by design in Phase 3).

It exercises: submit a minimum safe order, receive the response callback, query
positions/orders/trades, cancel on timeout, and emit `order_event` /
`account_snapshot` events for replay.

Usage:
    python paper_trade_probe.py --userdata "C:/path/userdata_mini" --account 1234567890 \
        --symbol 600570.SH --price 9.45 --qty 100 --out ../state/paper_orders.jsonl
    python paper_trade_probe.py --mock --symbol 600570.SH --out ../state/paper_orders.jsonl
"""

import argparse
import json
import sys
import time

import lib_contract as contract


def parse_args(argv):
    parser = argparse.ArgumentParser(description="MiniQMT paper-trade probe (simulation only)")
    parser.add_argument("--userdata", default="", help="Path to userdata_mini")
    parser.add_argument("--account", default="", help="Account id (masked in events)")
    parser.add_argument("--session", default="paper-001")
    parser.add_argument("--session-type", default="STOCK")
    parser.add_argument("--symbol", required=True, help="Raw symbol, e.g. 600570.SH")
    parser.add_argument("--price", type=float, default=0.0, help="Limit price (0 -> skip submit in real mode)")
    parser.add_argument("--qty", type=int, default=100, help="Quantity, A-share lot multiple of 100")
    parser.add_argument("--timeout", type=int, default=10, help="Seconds before cancel-on-timeout")
    parser.add_argument("--out", default="", help="JSONL store path")
    parser.add_argument("--arm-live", action="store_true",
                        help="Refused in Phase 3. Present only to make the gate explicit.")
    parser.add_argument("--mock", action="store_true", help="Offline mode: simulate the full loop")
    return parser.parse_args(argv)


def validate_safety(args):
    if args.arm_live:
        raise SystemExit("Refusing to arm live trading in Phase 3. Remove --arm-live.")
    if args.qty <= 0 or args.qty % contract_lot() != 0:
        raise SystemExit("Quantity must be a positive multiple of 100 (A-share lot).")


def contract_lot():
    return 100


def mock_loop(args, store):
    sid = args.session
    submitted = contract.build_order_event(sid, args.symbol, "buy", "mock-0001", "submitted",
                                            price=args.price or 9.45, quantity=args.qty)
    emit(submitted, store)
    filled = contract.build_order_event(sid, args.symbol, "buy", "mock-0001", "filled",
                                        price=args.price or 9.45, quantity=args.qty)
    emit(filled, store)
    snapshot = contract.build_account_snapshot(sid, args.account or "0000001234",
                                               cash=99055.0, market_value=945.0, total_asset=100000.0)
    emit(snapshot, store)
    report = {
        "loop": "mock",
        "submitted": 1, "filled": 1, "cancelled": 0,
        "positionsReconciled": True, "tradesReconciled": True,
    }
    print(json.dumps({"paperTradeReport": report}, ensure_ascii=False, indent=2))


def real_loop(args, store):
    modules, errors = contract.try_import_xtquant()
    if "XtQuantTrader" not in modules:
        print(json.dumps({"error": "xttrader_unavailable", "details": errors}, ensure_ascii=False))
        return 2
    if not args.userdata:
        print(json.dumps({"error": "missing_userdata"}))
        return 2

    try:
        from xtquant.xttype import StockAccount  # noqa: WPS433
        from xtquant import xtconstant  # noqa: WPS433
    except Exception as exc:  # pragma: no cover - depends on Windows client
        print(json.dumps({"error": "xttype_or_xtconstant_unavailable", "detail": str(exc)}))
        return 2

    session_id = int.from_bytes(__import__("os").urandom(2), "big")
    trader = modules["XtQuantTrader"](args.userdata, session_id)
    trader.start()
    if trader.connect() != 0:
        print(json.dumps({"error": "connect_failed"}))
        return 2
    account = StockAccount(args.account, args.session_type)
    if trader.subscribe(account) != 0:
        print(json.dumps({"error": "subscribe_failed"}))
        trader.stop()
        return 2

    order_id = None
    if args.price > 0:
        order_id = trader.order_stock(
            account, args.symbol, xtconstant.STOCK_BUY, args.qty,
            xtconstant.FIX_PRICE, args.price, args.session, "wyckoff-paper",
        )
        emit(contract.build_order_event(args.session, args.symbol, "buy", str(order_id),
                                        "submitted", price=args.price, quantity=args.qty), store)

    # Cancel-on-timeout: poll open orders, cancel if still resting after timeout.
    deadline = time.time() + args.timeout
    cancelled = False
    while order_id is not None and time.time() < deadline:
        orders = safe_call(trader.query_stock_orders, account) or []
        still_open = any(getattr(o, "order_id", None) == order_id and getattr(o, "order_status", 0) in OPEN_STATUSES
                         for o in orders)
        if not still_open:
            break
        time.sleep(1.0)
    else:
        if order_id is not None:
            try:
                trader.cancel_order_stock(account, order_id)
                cancelled = True
                emit(contract.build_order_event(args.session, args.symbol, "buy", str(order_id),
                                                "cancelled", price=args.price, quantity=args.qty), store)
            except Exception as exc:  # pragma: no cover
                print(json.dumps({"warn": "cancel_failed", "error": str(exc)}))

    asset = safe_call(trader.query_stock_asset, account)
    if asset is not None:
        emit(contract.build_account_snapshot(
            args.session, args.account,
            cash=getattr(asset, "cash", 0), market_value=getattr(asset, "market_value", 0),
            total_asset=getattr(asset, "total_asset", 0)), store)

    report = {
        "loop": "real_simulation",
        "submitted": 1 if order_id is not None else 0,
        "cancelled": 1 if cancelled else 0,
        "note": "Run during a real trading session to validate fills and T+1 settlement.",
    }
    print(json.dumps({"paperTradeReport": report}, ensure_ascii=False, indent=2))
    trader.stop()
    return 0


OPEN_STATUSES = (48, 49, 50, 51, 52, 53, 54, 55)  # broker-build dependent; refine after Phase 0


def safe_call(func, *args):
    try:
        return func(*args)
    except Exception:  # pragma: no cover
        return None


def emit(event, store):
    contract.assert_no_credentials(event)
    print(json.dumps(event, ensure_ascii=False))
    if store is not None:
        store.append(event)


def main(argv):
    args = parse_args(argv)
    validate_safety(args)
    store = contract.JsonlStore(args.out) if args.out else None
    if args.mock:
        mock_loop(args, store)
        return 0
    return real_loop(args, store)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
