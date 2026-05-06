import json

try:
    import requests
except Exception:
    requests = None


LIVE_TRADE_STATES = ['PRETR', 'OCALL', 'TRADE', 'POSMT', 'PCALL']


def initialize(context):
    g.symbol = '600570.XSHG'
    g.validation_target = 'https://httpbin.org/post'
    g.validation_file = 'ptrade-phase1-validation-last.json'
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
    outbound = {
        'target': g.validation_target,
        'status': 'skipped',
        'httpStatus': None,
        'responsePreview': '',
        'error': '',
    }

    if not g.validation_target:
        outbound['error'] = 'validation_target 为空，已跳过出站 HTTP 验证。'
        return outbound

    if requests is None:
        outbound['status'] = 'error'
        outbound['error'] = 'requests 不可用，无法执行出站 HTTP 验证。'
        return outbound

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
        response = requests.post(
            g.validation_target,
            data=json.dumps(payload, ensure_ascii=False).encode('utf-8'),
            headers={'Content-Type': 'application/json; charset=utf-8'},
            timeout=5,
        )

        outbound['httpStatus'] = response.status_code
        outbound['responsePreview'] = response.text[:200]
        outbound['status'] = 'success'

        if response.status_code >= 400:
            outbound['status'] = 'error'
            outbound['error'] = 'HTTP {0}'.format(response.status_code)

        return outbound
    except Exception as error:
        outbound['status'] = 'error'
        outbound['error'] = str(error)
        return outbound


def persist_and_log(result):
    result['localResultPath'] = get_research_path() + g.validation_file

    try:
        with open(result['localResultPath'], 'w') as handler:
            handler.write(json.dumps(result, ensure_ascii=False, indent=2))
    except Exception as error:
        result['localPersistError'] = str(error)

    log.info('Wyckoff ptrade validation => {0}'.format(json.dumps(result, ensure_ascii=False)))


def fetch_transaction_payload(symbol):
    try:
        return get_individual_transaction([symbol], data_count=5, is_dict=True)
    except NameError:
        return get_individual_transcation([symbol], data_count=5, is_dict=True)


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