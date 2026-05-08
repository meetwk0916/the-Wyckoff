import json
import os
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from socket import gethostbyname, gethostname
from urllib.parse import parse_qs, urlparse


RELAY_HOST = os.environ.get('PTRADE_RELAY_HOST', '0.0.0.0')
RELAY_PORT = int(os.environ.get('PTRADE_RELAY_PORT', '19090'))
RELAY_RECORDINGS_DIR = Path(os.environ.get('PTRADE_RELAY_RECORDINGS_DIR', str(Path(__file__).resolve().parent / 'recordings')))
RELAY_STATE_FILE = os.environ.get('PTRADE_RELAY_STATE_FILE', 'ptrade-relay-latest.json')
RELAY_EXPECTED_INGEST_PATH = os.environ.get('PTRADE_RELAY_INGEST_PATH', '/ptrade')
RELAY_VALIDATION_INGEST_PATH = os.environ.get('PTRADE_RELAY_VALIDATION_PATH', '/ptrade/validation')
RELAY_HEALTH_PATH = os.environ.get('PTRADE_RELAY_HEALTH_PATH', '/health')
RELAY_L2_PATH = os.environ.get('PTRADE_RELAY_L2_PATH', '/l2-order-flow')
RELAY_PAYLOAD_PATH = os.environ.get('PTRADE_RELAY_PAYLOAD_PATH', '/payload/latest')
STALE_AFTER_MS = int(os.environ.get('PTRADE_RELAY_STALE_AFTER_MS', '120000'))
DEFAULT_SYMBOL = '002594.SZ'


relay_state = {
    'lastIngestAt': '',
    'lastPayload': None,
    'lastOrderFlowsBySymbol': {},
}


def build_windows_loopback_url():
    return f'http://127.0.0.1:{RELAY_PORT}'


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def ensure_recordings_dir():
    RELAY_RECORDINGS_DIR.mkdir(parents=True, exist_ok=True)


def state_file_path():
    return RELAY_RECORDINGS_DIR / RELAY_STATE_FILE


def load_relay_state():
    try:
        payload = json.loads(state_file_path().read_text(encoding='utf-8'))
    except Exception:
        return

    relay_state['lastIngestAt'] = payload.get('lastIngestAt', '')
    relay_state['lastPayload'] = payload.get('lastPayload')
    relay_state['lastOrderFlowsBySymbol'] = payload.get('lastOrderFlowsBySymbol', {})


def write_relay_state():
    ensure_recordings_dir()
    state_file_path().write_text(json.dumps(relay_state, ensure_ascii=False, indent=2), encoding='utf-8')


def to_iso_string(value):
    if not value:
        return now_iso()

    try:
        return datetime.fromisoformat(str(value).replace('Z', '+00:00')).astimezone(timezone.utc).isoformat()
    except Exception:
        return now_iso()


def normalize_symbol(symbol):
    if not symbol:
        return DEFAULT_SYMBOL
    normalized = str(symbol).strip()
    return normalized or DEFAULT_SYMBOL


def to_number(value):
    try:
        return float(value)
    except Exception:
        return 0.0


def to_int(value):
    try:
        return int(value)
    except Exception:
        return 0


def normalize_trade_time(raw_value):
    if raw_value is None:
        return '--'

    digits = ''.join(ch for ch in str(raw_value) if ch.isdigit())
    if len(digits) < 9:
        return str(raw_value)

    time_digits = digits[-9:]
    return f'{time_digits[0:2]}:{time_digits[2:4]}:{time_digits[4:6]}.{time_digits[6:9]}'


def normalize_side(raw_value):
    if raw_value in [0, '0']:
        return 'BUY'
    if raw_value in [1, '1']:
        return 'SELL'
    return 'UNKNOWN'


def build_levels_from_validation(validation_l2):
    top_bid = validation_l2.get('topBid') or {}
    top_ask = validation_l2.get('topAsk') or {}
    bids = []
    asks = []

    if top_bid.get('price'):
        bids.append({
            'price': to_number(top_bid.get('price')),
            'volume': to_int(top_bid.get('volume')),
            'orders': to_int(top_bid.get('orders')),
        })

    if top_ask.get('price'):
        asks.append({
            'price': to_number(top_ask.get('price')),
            'volume': to_int(top_ask.get('volume')),
            'orders': to_int(top_ask.get('orders')),
        })

    return bids, asks


def build_tape_from_validation(validation_l2):
    sample = validation_l2.get('transactionSample')
    if not isinstance(sample, list) or len(sample) < 3:
        return []

    return [{
        'time': normalize_trade_time(sample[0]),
        'side': normalize_side(sample[4] if len(sample) > 4 else None),
        'price': to_number(sample[1]),
        'volume': to_int(sample[2]),
    }]


def calculate_spread_bps(order_flow):
    bids = order_flow.get('bids') or []
    asks = order_flow.get('asks') or []
    best_bid = to_number(bids[0].get('price')) if bids else 0.0
    best_ask = to_number(asks[0].get('price')) if asks else 0.0

    if not best_bid or not best_ask:
        return 0.0

    mid = (best_bid + best_ask) / 2
    if not mid:
        return 0.0

    return round(((best_ask - best_bid) / mid) * 10000, 2)


def calculate_imbalance(order_flow):
    bid_volume = sum(to_int(level.get('volume')) for level in order_flow.get('bids') or [])
    ask_volume = sum(to_int(level.get('volume')) for level in order_flow.get('asks') or [])
    total_volume = bid_volume + ask_volume

    if not total_volume:
        return 0.0

    return round(bid_volume / total_volume, 4)


def build_mock_order_flow(symbol):
    return {
        'symbol': symbol,
        'capturedAt': now_iso(),
        'source': 'mock-ptrade-relay',
        'venue': 'simulated-l2',
        'depthLevels': 2,
        'spreadBps': 6.1,
        'imbalance': 0.62,
        'bids': [
            {'price': 202.08, 'volume': 12800, 'orders': 42},
            {'price': 202.07, 'volume': 11200, 'orders': 37},
        ],
        'asks': [
            {'price': 202.10, 'volume': 9100, 'orders': 26},
            {'price': 202.11, 'volume': 10400, 'orders': 29},
        ],
        'tape': [
            {'time': '09:36:58.112', 'side': 'BUY', 'price': 202.1, 'volume': 1200},
        ],
    }


def normalize_validation_payload(payload):
    symbol = normalize_symbol(payload.get('symbol'))
    validation_l2 = payload.get('l2') or {}
    bids, asks = build_levels_from_validation(validation_l2)
    order_flow = {
        'symbol': symbol,
        'capturedAt': to_iso_string(payload.get('generatedAt')),
        'source': 'ptrade-validation-relay',
        'venue': payload.get('businessType') or 'stock',
        'depthLevels': max(len(bids), len(asks)),
        'bids': bids,
        'asks': asks,
        'tape': build_tape_from_validation(validation_l2),
        'spreadBps': 0.0,
        'imbalance': 0.0,
        'validation': {
            'kind': payload.get('kind', ''),
            'phase': payload.get('phase', ''),
            'l2Status': validation_l2.get('status', 'unknown'),
            'l2Message': validation_l2.get('message', ''),
            'outboundStatus': (payload.get('outbound') or {}).get('status', 'unknown'),
            'accountStatus': (payload.get('account') or {}).get('status', 'unknown'),
        },
    }
    order_flow['spreadBps'] = calculate_spread_bps(order_flow)
    order_flow['imbalance'] = calculate_imbalance(order_flow)
    return order_flow


def normalize_order_flow_payload(payload):
    symbol = normalize_symbol(payload.get('symbol'))
    order_flow = build_mock_order_flow(symbol)
    order_flow.update(payload)
    order_flow['symbol'] = symbol
    order_flow['capturedAt'] = to_iso_string(payload.get('capturedAt'))
    order_flow['source'] = payload.get('source') or 'ptrade-relay'
    order_flow['venue'] = payload.get('venue') or 'stock'
    order_flow['depthLevels'] = to_int(payload.get('depthLevels')) or max(len(payload.get('bids') or []), len(payload.get('asks') or []))
    order_flow['bids'] = payload.get('bids') if isinstance(payload.get('bids'), list) else []
    order_flow['asks'] = payload.get('asks') if isinstance(payload.get('asks'), list) else []
    order_flow['tape'] = payload.get('tape') if isinstance(payload.get('tape'), list) else []
    order_flow['spreadBps'] = to_number(payload.get('spreadBps')) or calculate_spread_bps(order_flow)
    order_flow['imbalance'] = to_number(payload.get('imbalance')) or calculate_imbalance(order_flow)
    return order_flow


def normalize_incoming_payload(payload):
    if payload.get('kind') == 'ptrade-phase1-validation':
        return normalize_validation_payload(payload)
    return normalize_order_flow_payload(payload)


def is_relay_healthy():
    if not relay_state['lastIngestAt']:
        return False

    try:
        last_ingest_at = datetime.fromisoformat(relay_state['lastIngestAt'].replace('Z', '+00:00'))
    except Exception:
        return False

    age_ms = (datetime.now(timezone.utc) - last_ingest_at.astimezone(timezone.utc)).total_seconds() * 1000
    return age_ms <= STALE_AFTER_MS


def detect_local_ipv4():
    try:
        address = gethostbyname(gethostname())
        if address and address != '127.0.0.1':
            return address
    except Exception:
        pass
    return ''


def build_advertise_urls():
    urls = [build_windows_loopback_url()]
    detected_ip = detect_local_ipv4()
    if detected_ip and detected_ip != '127.0.0.1':
        urls.append(f'http://{detected_ip}:{RELAY_PORT}')
    return urls


def build_health_payload():
    healthy = is_relay_healthy()
    return {
        'mode': 'relay',
        'status': 'ready' if healthy else ('stale' if relay_state['lastIngestAt'] else 'waiting_for_ingest'),
        'transport': 'http-ingest',
        'message': 'ptrade relay 已收到最近数据，可供上游 bridge 拉取。' if healthy else ('ptrade relay 已收到数据，但最新数据已过期。' if relay_state['lastIngestAt'] else 'ptrade relay 尚未收到 ptrade 运行时推送。'),
        'capabilities': {
            'l2OrderFlow': bool(relay_state['lastOrderFlowsBySymbol']),
            'recorder': True,
            'replay': False,
        },
        'listen': {
            'host': RELAY_HOST,
            'port': RELAY_PORT,
            'ingestPath': RELAY_EXPECTED_INGEST_PATH,
            'validationIngestPath': RELAY_VALIDATION_INGEST_PATH,
        },
        'windowsLoopbackUrl': build_windows_loopback_url(),
        'advertiseUrls': build_advertise_urls(),
        'lastIngestAt': relay_state['lastIngestAt'],
        'symbols': sorted(relay_state['lastOrderFlowsBySymbol'].keys()),
        'lastKind': (relay_state['lastPayload'] or {}).get('kind', ''),
    }


class PtradeRelayHandler(BaseHTTPRequestHandler):
    def _send_json(self, status_code, payload):
        body = json.dumps(payload, ensure_ascii=False, indent=2).encode('utf-8')
        self.send_response(status_code)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self._send_json(204, {})

    def do_POST(self):
        parsed = urlparse(self.path)
        if parsed.path not in [RELAY_EXPECTED_INGEST_PATH, RELAY_VALIDATION_INGEST_PATH]:
            self._send_json(404, {'error': 'Not found'})
            return

        length = int(self.headers.get('Content-Length', '0'))
        try:
            raw_body = self.rfile.read(length).decode('utf-8') if length else '{}'
            payload = json.loads(raw_body or '{}')
        except Exception as error:
            self._send_json(400, {'error': str(error)})
            return

        normalized_order_flow = normalize_incoming_payload(payload)
        symbol = normalize_symbol(normalized_order_flow.get('symbol'))
        relay_state['lastIngestAt'] = now_iso()
        relay_state['lastPayload'] = payload
        relay_state['lastOrderFlowsBySymbol'][symbol] = normalized_order_flow
        write_relay_state()

        self._send_json(202, {
            'status': 'accepted',
            'symbol': symbol,
            'relayUrl': f'http://{detect_local_ipv4() or "127.0.0.1"}:{RELAY_PORT}',
            'windowsLoopbackUrl': build_windows_loopback_url(),
            'ingestPath': RELAY_EXPECTED_INGEST_PATH,
            'validationIngestPath': RELAY_VALIDATION_INGEST_PATH,
            'healthPath': RELAY_HEALTH_PATH,
            'l2Path': f'{RELAY_L2_PATH}?symbol={symbol}',
            'payloadPath': RELAY_PAYLOAD_PATH,
            'lastIngestAt': relay_state['lastIngestAt'],
        })

    def do_GET(self):
        parsed = urlparse(self.path)

        if parsed.path == RELAY_HEALTH_PATH:
            self._send_json(200, build_health_payload())
            return

        if parsed.path == RELAY_L2_PATH:
            params = parse_qs(parsed.query)
            symbol = normalize_symbol((params.get('symbol') or [DEFAULT_SYMBOL])[0])
            order_flow = relay_state['lastOrderFlowsBySymbol'].get(symbol) or relay_state['lastOrderFlowsBySymbol'].get(DEFAULT_SYMBOL)
            if not order_flow:
                self._send_json(404, {'error': 'No ptrade order-flow has been ingested yet', 'symbol': symbol})
                return
            self._send_json(200, order_flow)
            return

        if parsed.path == RELAY_PAYLOAD_PATH:
            self._send_json(200, {'lastIngestAt': relay_state['lastIngestAt'], 'lastPayload': relay_state['lastPayload']})
            return

        self._send_json(404, {'error': 'Not found'})

    def log_message(self, _format, *_args):
        return


def main():
    load_relay_state()
    server = ThreadingHTTPServer((RELAY_HOST, RELAY_PORT), PtradeRelayHandler)
    print(f'[ptrade-relay-win] listening on {RELAY_HOST}:{RELAY_PORT}')
    print(f'[ptrade-relay-win] windows-ptrade-target={build_windows_loopback_url()}{RELAY_EXPECTED_INGEST_PATH}')
    for url in build_advertise_urls():
        print(f'[ptrade-relay-win] url={url}')
    print(f'[ptrade-relay-win] ingest={RELAY_EXPECTED_INGEST_PATH}')
    print(f'[ptrade-relay-win] validation-ingest={RELAY_VALIDATION_INGEST_PATH}')
    print(f'[ptrade-relay-win] health={RELAY_HEALTH_PATH}')
    print(f'[ptrade-relay-win] l2={RELAY_L2_PATH}')
    print(f'[ptrade-relay-win] payload={RELAY_PAYLOAD_PATH}')
    server.serve_forever()


if __name__ == '__main__':
    main()