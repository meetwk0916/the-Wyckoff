"""Shared helpers for the MiniQMT / QMT XtQuant adapter.

This module never stores credentials and never sends orders by itself. It only
builds contract-compliant events (see docs/miniqmt-wyckoff/ADAPTER-CONTRACT.md),
masks account ids, and appends events to a local JSONL store.

Runs on the Windows client with XtQuant installed. No third-party deps required;
standard library only.
"""

import json
import os
from datetime import datetime, timezone

PROVIDER = "miniqmt"
EVENT_TYPES = ("health", "quote", "order_flow", "account_snapshot", "order_event")

FORBIDDEN_KEYS = {
    "password", "passwd", "pwd", "tradepassword", "trade_password", "tradepwd",
    "token", "accesstoken", "access_token", "secret", "apisecret", "api_secret",
    "apikey", "api_key", "accountid",
}


def iso_now():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def mask_account(account_id):
    if not account_id:
        return "****"
    text = str(account_id)
    return "****" + text[-4:] if len(text) > 4 else "****"


def normalize_symbol(symbol):
    """600570.SH -> 600570.XSHG ; 000001.SZ -> 000001.XSHE."""
    if not symbol:
        return ""
    value = str(symbol).strip().upper()
    if "." not in value:
        return value
    code, suffix = value.rsplit(".", 1)
    mapping = {"SH": "XSHG", "SZ": "XSHE", "BJ": "BJSE"}
    return code + "." + mapping.get(suffix, suffix)


def assert_no_credentials(payload):
    """Raise if any forbidden credential-like key is present (defense in depth)."""
    for key in _iter_keys(payload):
        if key.lower() in FORBIDDEN_KEYS:
            raise ValueError("refusing to persist credential-like field: %s" % key)


def _iter_keys(value):
    if isinstance(value, dict):
        for key, child in value.items():
            yield key
            yield from _iter_keys(child)
    elif isinstance(value, list):
        for item in value:
            yield from _iter_keys(item)


def build_health(session_id, client, xtquant, account, capabilities, errors=None):
    return {
        "eventType": "health",
        "provider": PROVIDER,
        "sessionId": session_id,
        "eventTime": iso_now(),
        "client": client,
        "xtquant": xtquant,
        "account": account,
        "capabilities": capabilities,
        "errors": errors or [],
    }


def build_quote(symbol, price, volume, amount=0, payload=None):
    return {
        "eventType": "quote",
        "provider": PROVIDER,
        "symbol": normalize_symbol(symbol),
        "rawSymbol": symbol,
        "eventTime": iso_now(),
        "receivedAt": iso_now(),
        "price": price,
        "volume": volume,
        "amount": amount,
        "payload": payload or {},
    }


def build_order_flow(symbol, source_type, bid_levels=None, ask_levels=None,
                     transactions=None, orders=None, payload=None):
    return {
        "eventType": "order_flow",
        "provider": PROVIDER,
        "symbol": normalize_symbol(symbol),
        "eventTime": iso_now(),
        "sourceType": source_type,
        "bidLevels": bid_levels or [],
        "askLevels": ask_levels or [],
        "transactions": transactions or [],
        "orders": orders or [],
        "payload": payload or {},
    }


def build_account_snapshot(session_id, account_id, cash, market_value, total_asset, payload=None):
    return {
        "eventType": "account_snapshot",
        "provider": PROVIDER,
        "sessionId": session_id,
        "eventTime": iso_now(),
        "accountIdMasked": mask_account(account_id),
        "cash": cash,
        "marketValue": market_value,
        "totalAsset": total_asset,
        "payload": payload or {},
    }


def build_order_event(session_id, symbol, side, order_id, status,
                      price=0, quantity=0, payload=None):
    return {
        "eventType": "order_event",
        "provider": PROVIDER,
        "sessionId": session_id,
        "eventTime": iso_now(),
        "symbol": normalize_symbol(symbol),
        "side": side,
        "orderId": order_id,
        "status": status,
        "price": price,
        "quantity": quantity,
        "payload": payload or {},
    }


class JsonlStore:
    """Append-only local store. Validates against the credential guard on write."""

    def __init__(self, path):
        self.path = path
        directory = os.path.dirname(os.path.abspath(path))
        if directory:
            os.makedirs(directory, exist_ok=True)

    def append(self, event):
        assert_no_credentials(event)
        with open(self.path, "a", encoding="utf-8") as handle:
            handle.write(json.dumps(event, ensure_ascii=False) + "\n")
        return event


def try_import_xtquant():
    """Return (modules_dict, errors). Never raises; missing SDK is a structured gap."""
    modules = {}
    errors = []
    try:
        from xtquant import xtdata  # noqa: WPS433 (runtime import is intentional)
        modules["xtdata"] = xtdata
    except Exception as exc:  # pragma: no cover - depends on Windows client
        errors.append({"module": "xtquant.xtdata", "error": str(exc)})
    try:
        from xtquant.xttrader import XtQuantTrader  # noqa: WPS433
        modules["XtQuantTrader"] = XtQuantTrader
    except Exception as exc:  # pragma: no cover
        errors.append({"module": "xtquant.xttrader.XtQuantTrader", "error": str(exc)})
    return modules, errors
