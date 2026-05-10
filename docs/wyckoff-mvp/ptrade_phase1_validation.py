import json
import socket
from urllib.parse import urlparse

try:
    import sqlite3
except Exception:
    sqlite3 = None

try:
    import requests
except Exception:
    requests = None


LIVE_TRADE_STATES = ['PRETR', 'OCALL', 'TRADE', 'POSMT', 'PCALL']


def initialize(context):
    g.symbol = '600570.XSHG'
    g.validation_target = ''
    g.validation_targets = []
    g.validation_file = 'ptrade-phase1-validation-last.json'
    g.validation_sqlite_enabled = True
    g.validation_sqlite_file = 'ptrade-phase1-validation.sqlite3'
    g.validation_sqlite_table = 'phase1_validation_runs'
    g.smoke_test_enabled = False
    g.smoke_test_done = False
    g.validation_done = False

    set_universe(g.symbol)
    set_parameters(not_restart_trade='1', server_restart_not_do_before='1')
    run_interval(context, validate_live_session, seconds=10, interval_timer_ranges='09:30-14:59')

    if g.smoke_test_enabled:
        validate_smoke_session(context)


def before_trading_start(context, data):
    g.validation_done = False

    result = build_result(context, 'precheck')
    result['account'] = collect_account_info()
    result['outbound'] = probe_outbound_http(result)

    persist_and_log(result)


def handle_data(context, data):
    pass


def validate_smoke_session(context):
    if g.smoke_test_done:
        return

    result = build_result(context, 'smoke')
    result['account'] = collect_account_info()
    result['l2'] = build_skipped_l2_status(
        'smoke test 仅验证账号绑定和出站 HTTP；Level2 请在交易时段使用 live 模式确认。'
    )
    result['outbound'] = probe_outbound_http(result)

    persist_and_log(result)
    g.smoke_test_done = True


def validate_live_session(context):
    if g.validation_done:
        return

    result = build_result(context, 'live')
    result['account'] = collect_account_info()
    result['l2'] = collect_l2_status(g.symbol)
    result['outbound'] = probe_outbound_http(result)

    persist_and_log(result)
    g.validation_done = True


def build_result(context, phase):
    result = {
        'kind': 'ptrade-phase1-validation',
        'phase': phase,
        'generatedAt': format_current_dt(context),
        'symbol': g.symbol,
        'businessType': safe_value(get_business_type),
        'frequency': safe_value(get_frequency),
    }

    return result


def collect_account_info():
    result = {
        'status': 'ok',
        'loginAccount': None,
        'boundAccount': None,
        'tradeName': None,
        'errors': [],
    }

    try:
        result['loginAccount'] = get_user_name(True)
    except Exception as error:
        result['errors'].append('get_user_name(True): {0}'.format(error))

    try:
        result['boundAccount'] = get_user_name(False)
    except Exception as error:
        result['errors'].append('get_user_name(False): {0}'.format(error))

    try:
        result['tradeName'] = get_trade_name()
    except Exception as error:
        result['errors'].append('get_trade_name(): {0}'.format(error))

    if result['errors']:
        result['status'] = 'partial'

    return result


def collect_l2_status(symbol):
    result = {
        'status': 'unknown',
        'message': '',
        'symbol': symbol,
        'tradeStatus': None,
        'snapshotTimestamp': None,
        'topBid': normalize_level(None),
        'topAsk': normalize_level(None),
        'queueVisible': False,
        'entrustRows': 0,
        'entrustFields': [],
        'entrustSample': None,
        'transactionRows': 0,
        'transactionFields': [],
        'transactionSample': None,
    }

    try:
        snapshot_payload = get_snapshot(symbol)
        snapshot = get_symbol_value(snapshot_payload, symbol)

        if not isinstance(snapshot, dict) or not snapshot:
            result['status'] = 'snapshot_unavailable'
            result['message'] = 'get_snapshot 未返回可用快照，请先确认交易环境、标的代码和行情权限。'
            return result

        result['tradeStatus'] = snapshot.get('trade_status')
        result['snapshotTimestamp'] = snapshot.get('hsTimeStamp')
        result['topBid'] = normalize_level(extract_level(snapshot.get('bid_grp'), 1))
        result['topAsk'] = normalize_level(extract_level(snapshot.get('offer_grp'), 1))
        result['queueVisible'] = bool(result['topBid']['queueSize'] or result['topAsk']['queueSize'])

        entrust_payload = get_individual_entrust([symbol], data_count=5, is_dict=True)
        transaction_payload = fetch_transaction_payload(symbol)

        entrust_rows, entrust_fields, entrust_sample = unpack_dict_rows(entrust_payload, symbol)
        transaction_rows, transaction_fields, transaction_sample = unpack_dict_rows(transaction_payload, symbol)

        result['entrustRows'] = entrust_rows
        result['entrustFields'] = entrust_fields
        result['entrustSample'] = entrust_sample
        result['transactionRows'] = transaction_rows
        result['transactionFields'] = transaction_fields
        result['transactionSample'] = transaction_sample

        order_count_detected = False
        if to_int(result['topBid']['orders']) > 0 or to_int(result['topAsk']['orders']) > 0:
            order_count_detected = True

        if entrust_rows > 0 or transaction_rows > 0 or order_count_detected or result['queueVisible']:
            result['status'] = 'confirmed'
            result['message'] = '已确认到可用的 Level2 线索，可继续推进 exporter/relay 联调。'
            return result

        if result['tradeStatus'] not in LIVE_TRADE_STATES:
            result['status'] = 'market_not_live'
            result['message'] = '当前不在可确认 Level2 的交易时段，结果暂时不下结论。'
            return result

        result['status'] = 'not_detected'
        result['message'] = '快照可用，但逐笔和委托笔数都未确认到有效 Level2 数据，请检查 Level2 权限、标的订阅和市场时段。'
        return result
    except Exception as error:
        result['status'] = 'error'
        result['message'] = 'L2 验证异常: {0}'.format(error)
        return result


def build_skipped_l2_status(message):
    return {
        'status': 'skipped',
        'message': message,
        'symbol': g.symbol,
        'tradeStatus': None,
        'snapshotTimestamp': None,
        'topBid': normalize_level(None),
        'topAsk': normalize_level(None),
        'queueVisible': False,
        'entrustRows': 0,
        'entrustFields': [],
        'entrustSample': None,
        'transactionRows': 0,
        'transactionFields': [],
        'transactionSample': None,
    }


def probe_outbound_http(result):
    targets = collect_validation_targets()
    outbound = {
        'target': '',
        'targets': targets,
        'targetCount': len(targets),
        'successfulTarget': '',
        'attempts': [],
        'status': 'skipped',
        'failureStage': '',
        'httpStatus': None,
        'responsePreview': '',
        'error': '',
        'targetInfo': {
            'scheme': '',
            'host': '',
            'port': None,
            'path': '',
        },
        'dnsStatus': 'skipped',
        'resolvedAddresses': [],
        'tcpStatus': 'skipped',
        'tcpConnectedAddress': None,
        'requestStatus': 'skipped',
    }

    if not targets:
        outbound['failureStage'] = 'skipped'
        outbound['error'] = 'validation_target 为空，已跳过出站 HTTP 验证；Phase 0 默认优先写本地文件和 sqlite。'
        return outbound

    best_attempt = None
    for target in targets:
        attempt = probe_single_outbound_target(target, result)
        outbound['attempts'].append(attempt)

        if best_attempt is None:
            best_attempt = attempt

        if should_replace_outbound_summary(best_attempt, attempt):
            best_attempt = attempt

        if attempt['status'] == 'success':
            outbound['successfulTarget'] = attempt['target']
            merge_outbound_summary(outbound, attempt)
            return outbound

    if best_attempt is not None:
        merge_outbound_summary(outbound, best_attempt)

    return outbound


def probe_single_outbound_target(target, result):
    outbound = {
        'target': target,
        'status': 'skipped',
        'failureStage': '',
        'httpStatus': None,
        'responsePreview': '',
        'error': '',
        'targetInfo': {
            'scheme': '',
            'host': '',
            'port': None,
            'path': '',
        },
        'dnsStatus': 'skipped',
        'resolvedAddresses': [],
        'tcpStatus': 'skipped',
        'tcpConnectedAddress': None,
        'requestStatus': 'skipped',
    }

    target_info = parse_validation_target(target)
    outbound['targetInfo'] = target_info

    if not target_info['scheme'] or not target_info['host'] or not target_info['port']:
        outbound['status'] = 'error'
        outbound['failureStage'] = 'target'
        outbound['error'] = 'validation_target 格式无效，请使用 http://host/path 或 https://host/path。'
        return outbound

    if requests is None:
        outbound['status'] = 'error'
        outbound['failureStage'] = 'requests_import'
        outbound['error'] = 'requests 不可用，无法执行出站 HTTP 验证。'
        return outbound

    dns_candidates, dns_error = resolve_host_candidates(target_info['host'], target_info['port'])
    if dns_error:
        outbound['status'] = 'error'
        outbound['failureStage'] = 'dns'
        outbound['dnsStatus'] = 'error'
        outbound['error'] = 'DNS 解析失败: {0}'.format(dns_error)
        return outbound

    outbound['dnsStatus'] = 'success'
    outbound['resolvedAddresses'] = extract_resolved_addresses(dns_candidates)

    tcp_connected_address, tcp_error = probe_tcp_connect(dns_candidates)
    if tcp_error:
        outbound['status'] = 'error'
        outbound['failureStage'] = 'tcp'
        outbound['tcpStatus'] = 'error'
        outbound['error'] = 'TCP 连接失败: {0}'.format(tcp_error)
        return outbound

    outbound['tcpStatus'] = 'success'
    outbound['tcpConnectedAddress'] = tcp_connected_address

    payload = {
        'kind': result.get('kind'),
        'phase': result.get('phase'),
        'generatedAt': result.get('generatedAt'),
        'symbol': result.get('symbol'),
        'businessType': result.get('businessType'),
        'frequency': result.get('frequency'),
        'account': result.get('account'),
        'l2': result.get('l2'),
    }

    try:
        outbound['requestStatus'] = 'running'
        response = requests.post(
            target,
            data=json.dumps(payload, ensure_ascii=False).encode('utf-8'),
            headers={'Content-Type': 'application/json; charset=utf-8'},
            timeout=5,
        )

        outbound['httpStatus'] = response.status_code
        outbound['responsePreview'] = response.text[:200]
        outbound['status'] = 'success'
        outbound['requestStatus'] = 'success'

        if response.status_code >= 400:
            outbound['status'] = 'error'
            outbound['failureStage'] = 'http_status'
            outbound['requestStatus'] = 'error'
            outbound['error'] = 'HTTP {0}'.format(response.status_code)

        return outbound
    except Exception as error:
        outbound['status'] = 'error'
        outbound['failureStage'] = 'http'
        outbound['requestStatus'] = 'error'
        outbound['error'] = str(error)
        return outbound


def collect_validation_targets():
    targets = []

    configured_targets = getattr(g, 'validation_targets', None)
    if isinstance(configured_targets, (list, tuple)):
        for target in configured_targets:
            normalized = normalize_validation_target(target)
            if normalized and normalized not in targets:
                targets.append(normalized)

    fallback_target = normalize_validation_target(getattr(g, 'validation_target', ''))
    if fallback_target and fallback_target not in targets:
        targets.append(fallback_target)

    return targets


def normalize_validation_target(target):
    if target is None:
        return ''

    try:
        return str(target).strip()
    except Exception:
        return ''


def merge_outbound_summary(summary, attempt):
    summary['target'] = attempt.get('target', '')
    summary['status'] = attempt.get('status', 'error')
    summary['failureStage'] = attempt.get('failureStage', '')
    summary['httpStatus'] = attempt.get('httpStatus')
    summary['responsePreview'] = attempt.get('responsePreview', '')
    summary['error'] = attempt.get('error', '')
    summary['targetInfo'] = attempt.get('targetInfo', {})
    summary['dnsStatus'] = attempt.get('dnsStatus', 'skipped')
    summary['resolvedAddresses'] = attempt.get('resolvedAddresses', [])
    summary['tcpStatus'] = attempt.get('tcpStatus', 'skipped')
    summary['tcpConnectedAddress'] = attempt.get('tcpConnectedAddress')
    summary['requestStatus'] = attempt.get('requestStatus', 'skipped')


def should_replace_outbound_summary(current_attempt, candidate_attempt):
    current_score = score_outbound_attempt(current_attempt)
    candidate_score = score_outbound_attempt(candidate_attempt)

    if candidate_score != current_score:
        return candidate_score > current_score

    return False


def score_outbound_attempt(attempt):
    if not isinstance(attempt, dict):
        return -1

    if attempt.get('status') == 'success':
        return 100

    failure_stage = attempt.get('failureStage', '')
    stage_scores = {
        'http_status': 90,
        'http': 80,
        'tcp': 70,
        'dns': 60,
        'requests_import': 50,
        'target': 40,
        'skipped': 10,
    }

    return stage_scores.get(failure_stage, 0)


def persist_and_log(result):
    result['localResultPath'] = build_local_persist_path(g.validation_file)
    result['localSqlitePath'] = build_sqlite_path()
    result['localSqliteTable'] = getattr(g, 'validation_sqlite_table', 'phase1_validation_runs')

    try:
        with open(result['localResultPath'], 'w') as handler:
            handler.write(json.dumps(result, ensure_ascii=False, indent=2))
    except Exception as error:
        result['localPersistError'] = str(error)

    persist_result_to_sqlite(result)

    log.info('Wyckoff ptrade validation => {0}'.format(json.dumps(result, ensure_ascii=False)))


def build_local_persist_path(filename):
    return get_research_path() + filename


def build_sqlite_path():
    return build_local_persist_path(getattr(g, 'validation_sqlite_file', 'ptrade-phase1-validation.sqlite3'))


def persist_result_to_sqlite(result):
    if not bool(getattr(g, 'validation_sqlite_enabled', True)):
        result['localSqliteStatus'] = 'disabled'
        return

    if sqlite3 is None:
        result['localSqliteStatus'] = 'unavailable'
        result['localSqliteError'] = 'sqlite3 不可用，已跳过 sqlite 持久化。'
        return

    connection = None
    try:
        connection = sqlite3.connect(result['localSqlitePath'])
        cursor = connection.cursor()
        table_name = normalize_sqlite_identifier(result['localSqliteTable'])

        cursor.execute(
            'CREATE TABLE IF NOT EXISTS {0} ('
            'id INTEGER PRIMARY KEY AUTOINCREMENT, '
            'generated_at TEXT NOT NULL, '
            'phase TEXT NOT NULL, '
            'symbol TEXT NOT NULL, '
            'account_status TEXT, '
            'l2_status TEXT, '
            'outbound_status TEXT, '
            'outbound_failure_stage TEXT, '
            'payload_json TEXT NOT NULL'
            ')'.format(table_name)
        )
        cursor.execute(
            'INSERT INTO {0} ('
            'generated_at, phase, symbol, account_status, l2_status, outbound_status, outbound_failure_stage, payload_json'
            ') VALUES (?, ?, ?, ?, ?, ?, ?, ?)'.format(table_name),
            (
                safe_string(result.get('generatedAt')),
                safe_string(result.get('phase')),
                safe_string(result.get('symbol')),
                safe_string((result.get('account') or {}).get('status')),
                safe_string((result.get('l2') or {}).get('status')),
                safe_string((result.get('outbound') or {}).get('status')),
                safe_string((result.get('outbound') or {}).get('failureStage')),
                json.dumps(result, ensure_ascii=False),
            )
        )
        connection.commit()
        result['localSqliteStatus'] = 'persisted'
        result['localSqliteRowId'] = cursor.lastrowid
    except Exception as error:
        result['localSqliteStatus'] = 'error'
        result['localSqliteError'] = str(error)
    finally:
        if connection is not None:
            try:
                connection.close()
            except Exception:
                pass


def normalize_sqlite_identifier(value):
    text = safe_string(value) or 'phase1_validation_runs'
    normalized = []
    for char in text:
        if char.isalnum() or char == '_':
            normalized.append(char)
        else:
            normalized.append('_')

    identifier = ''.join(normalized).strip('_')
    if not identifier:
        return 'phase1_validation_runs'

    if identifier[0].isdigit():
        identifier = 't_' + identifier

    return identifier


def safe_string(value):
    if value is None:
        return ''

    try:
        return str(value)
    except Exception:
        return ''


def fetch_transaction_payload(symbol):
    try:
        return get_individual_transaction([symbol], data_count=5, is_dict=True)
    except NameError:
        return get_individual_transcation([symbol], data_count=5, is_dict=True)


def parse_validation_target(target):
    parsed = urlparse(target)
    scheme = (parsed.scheme or '').lower()
    host = parsed.hostname or ''
    port = parsed.port

    if port is None:
        if scheme == 'https':
            port = 443
        elif scheme == 'http':
            port = 80

    return {
        'scheme': scheme,
        'host': host,
        'port': port,
        'path': parsed.path or '/',
    }


def resolve_host_candidates(host, port):
    try:
        return socket.getaddrinfo(host, port, 0, socket.SOCK_STREAM), ''
    except Exception as error:
        return [], str(error)


def extract_resolved_addresses(candidates):
    addresses = []
    seen = set()

    for candidate in candidates:
        sockaddr = candidate[4]
        if not isinstance(sockaddr, tuple) or not sockaddr:
            continue

        address = sockaddr[0]
        if address in seen:
            continue

        seen.add(address)
        addresses.append(address)

    return addresses


def probe_tcp_connect(candidates):
    last_error = '未返回可连接地址。'

    for family, socktype, proto, _canonname, sockaddr in candidates:
        connection = None
        try:
            connection = socket.socket(family, socktype, proto)
            connection.settimeout(3)
            connection.connect(sockaddr)
            return sockaddr[0], ''
        except Exception as error:
            last_error = str(error)
        finally:
            if connection is not None:
                try:
                    connection.close()
                except Exception:
                    pass

    return None, last_error


def unpack_dict_rows(payload, symbol):
    if not isinstance(payload, dict):
        return 0, [], None

    rows = get_symbol_value(payload, symbol)
    if not isinstance(rows, list):
        rows = []

    fields = payload.get('fields')
    if not isinstance(fields, list):
        fields = []

    sample = None
    if rows:
        sample = rows[0]

    return len(rows), fields, sample


def get_symbol_value(payload, symbol):
    if not isinstance(payload, dict):
        return None

    candidates = build_symbol_candidates(symbol)
    for candidate in candidates:
        if candidate in payload:
            return payload[candidate]

    return None


def build_symbol_candidates(symbol):
    candidates = [symbol]

    if symbol.endswith('.XSHG'):
        candidates.append(symbol.replace('.XSHG', '.SS'))
    elif symbol.endswith('.SS'):
        candidates.append(symbol.replace('.SS', '.XSHG'))

    if symbol.endswith('.XSHE'):
        candidates.append(symbol.replace('.XSHE', '.SZ'))
    elif symbol.endswith('.SZ'):
        candidates.append(symbol.replace('.SZ', '.XSHE'))

    return candidates


def extract_level(levels, level_no):
    if not isinstance(levels, dict):
        return None

    if level_no in levels:
        return levels[level_no]

    level_key = str(level_no)
    if level_key in levels:
        return levels[level_key]

    return None


def normalize_level(level):
    result = {
        'price': None,
        'volume': None,
        'orders': None,
        'queueSize': 0,
    }

    if not isinstance(level, (list, tuple)):
        return result

    if len(level) > 0:
        result['price'] = level[0]
    if len(level) > 1:
        result['volume'] = level[1]
    if len(level) > 2:
        result['orders'] = level[2]
    if len(level) > 3 and isinstance(level[3], dict):
        result['queueSize'] = len(level[3])

    return result


def format_current_dt(context):
    try:
        return str(context.blotter.current_dt)
    except Exception:
        return ''


def safe_value(func):
    try:
        return func()
    except Exception as error:
        return 'error: {0}'.format(error)


def to_int(value):
    try:
        return int(value)
    except Exception:
        return 0