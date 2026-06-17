"""Phase 0 environment pre-check for the MiniQMT / QMT adapter.

Goal: emit a contract-compliant `health` event that distinguishes between
"client not started", "account not logged in", "SDK missing", "userdata path
wrong" and "insufficient permission". It NEVER places an order and NEVER stores
credentials.

Usage (on the Windows client):
    python health_check.py --userdata "C:/path/to/userdata_mini" --account 1234567890
    python health_check.py --mock            # offline: emit a contract sample, no SDK needed

Notes:
- --account is only used to print a masked id (****7890); the raw id is never stored.
- Real connection details depend on your broker build (e.g. 国金) and entitlement.
"""

import argparse
import json
import os
import sys

import lib_contract as contract


def parse_args(argv):
    parser = argparse.ArgumentParser(description="MiniQMT health pre-check")
    parser.add_argument("--userdata", default=os.environ.get("MINIQMT_USERDATA", ""),
                        help="Path to MiniQMT userdata_mini directory")
    parser.add_argument("--account", default=os.environ.get("MINIQMT_ACCOUNT", ""),
                        help="Account id (used only for masked display)")
    parser.add_argument("--session", default="paper-001", help="Session id label")
    parser.add_argument("--session-type", default="STOCK", help="XtQuantTrader session/account type")
    parser.add_argument("--out", default="", help="Optional JSONL store path to append the event")
    parser.add_argument("--mock", action="store_true", help="Offline mode: emit a contract sample")
    return parser.parse_args(argv)


def run_mock(args):
    return contract.build_health(
        session_id=args.session,
        client={"running": True, "loggedIn": True, "version": "mock"},
        xtquant={"available": True, "userdataPath": args.userdata or "C:/mock/userdata_mini", "connected": True},
        account={"accountIdMasked": contract.mask_account(args.account or "0000001234"),
                 "accountType": "stock", "status": "connected"},
        capabilities={"quote": "unknown", "level2": "unknown", "transactions": "unknown", "trading": "disabled"},
        errors=[],
    )


def run_real(args):
    errors = []
    modules, import_errors = contract.try_import_xtquant()
    errors.extend(import_errors)

    xtquant_available = "xtdata" in modules
    userdata_ok = bool(args.userdata) and os.path.isdir(args.userdata)
    if args.userdata and not userdata_ok:
        errors.append({"stage": "userdata", "error": "userdata path not found: %s" % args.userdata})

    connected = False
    logged_in = False
    account_status = "unknown"
    trader = None

    if xtquant_available and userdata_ok and "XtQuantTrader" in modules:
        try:
            session_id = int.from_bytes(os.urandom(2), "big")  # ephemeral, not persisted
            trader = modules["XtQuantTrader"](args.userdata, session_id)
            trader.start()
            connect_result = trader.connect()
            connected = connect_result == 0
            if not connected:
                errors.append({"stage": "connect", "error": "connect() returned %s" % connect_result})
        except Exception as exc:  # pragma: no cover - depends on Windows client
            errors.append({"stage": "trader_start", "error": str(exc)})

    # Account status query is intentionally best-effort and broker-build dependent.
    if connected and args.account:
        try:
            from xtquant.xttype import StockAccount  # noqa: WPS433
            account_obj = StockAccount(args.account, args.session_type)
            subscribe_result = trader.subscribe(account_obj)
            logged_in = subscribe_result == 0
            account_status = "connected" if logged_in else "subscribe_failed"
            if not logged_in:
                errors.append({"stage": "subscribe", "error": "subscribe() returned %s" % subscribe_result})
        except Exception as exc:  # pragma: no cover
            errors.append({"stage": "account", "error": str(exc)})

    capabilities = {
        "quote": "available" if xtquant_available else "unavailable",
        "level2": "unknown",
        "transactions": "unknown",
        "trading": "disabled",  # always disabled in pre-check
    }

    health = contract.build_health(
        session_id=args.session,
        client={"running": connected, "loggedIn": logged_in, "version": "unknown"},
        xtquant={"available": xtquant_available, "userdataPath": args.userdata, "connected": connected},
        account={"accountIdMasked": contract.mask_account(args.account), "accountType": "stock",
                 "status": account_status},
        capabilities=capabilities,
        errors=errors,
    )

    if trader is not None:
        try:
            trader.stop()
        except Exception:  # pragma: no cover
            pass
    return health


def main(argv):
    args = parse_args(argv)
    health = run_mock(args) if args.mock else run_real(args)
    contract.assert_no_credentials(health)
    print(json.dumps(health, ensure_ascii=False, indent=2))
    if args.out:
        contract.JsonlStore(args.out).append(health)
    # Exit non-zero only in real mode when nothing connected, so CI/scripts can branch.
    if not args.mock and not health["xtquant"]["connected"]:
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
