import json


MIN_LOT_SIZE = 100


def initialize(context):
    g.symbols = ['600570.XSHG']
    g.execution_mode = 'paper'
    g.live_order_armed = False
    g.enable_l2_confirmation = False
    g.use_limit_price = True

    g.max_position_ratio = 0.25
    g.min_cash_reserve_ratio = 0.10
    g.breakout_lookback = 20
    g.fast_ma_window = 5
    g.slow_ma_window = 10
    g.volume_lookback = 10
    g.volume_ratio_threshold = 1.50
    g.entry_score_threshold = 3
    g.stop_loss_pct = 0.03

    g.report_file = 'ptrade-wyckoff-trade-report-last.json'
    g.latest_symbol_reports = []

    set_universe(g.symbols)
    set_parameters(not_restart_trade='1', server_restart_not_do_before='1')


def before_trading_start(context, data):
    g.latest_symbol_reports = []


def handle_data(context, data):
    reports = []

    for symbol in g.symbols:
        plan = build_symbol_plan(context, data, symbol)
        execution = execute_symbol_plan(symbol, plan)

        reports.append(
            {
                'symbol': symbol,
                'signal': plan.get('signal'),
                'position': plan.get('position'),
                'decision': plan.get('decision'),
                'execution': execution,
            }
        )

    g.latest_symbol_reports = reports


def after_trading_end(context, data):
    report = build_session_report(context)
    persist_report(report)


def build_symbol_plan(context, data, symbol):
    reference_price = get_reference_price(symbol, data)
    history = get_symbol_history(symbol)
    position = build_position_snapshot(safe_call(get_position, symbol))
    l2_confirmation = build_l2_confirmation(symbol)
    signal = evaluate_signal(symbol, history, reference_price, l2_confirmation)
    decision = decide_position_target(context, reference_price, position, signal)

    return {
        'symbol': symbol,
        'referencePrice': reference_price,
        'history': history,
        'position': position,
        'l2': l2_confirmation,
        'signal': signal,
        'decision': decision,
    }


def execute_symbol_plan(symbol, plan):
    decision = plan.get('decision') or {}
    position = plan.get('position') or {}
    reference_price = safe_float(plan.get('referencePrice'))

    open_orders = safe_call(get_open_orders, symbol)
    if not isinstance(open_orders, list):
        open_orders = []

    serialized_open_orders = serialize_orders(open_orders)

    if serialized_open_orders:
        return {
            'status': 'blocked',
            'reason': 'open_orders_present',
            'openOrders': serialized_open_orders,
        }

    if reference_price <= 0:
        return {
            'status': 'blocked',
            'reason': 'invalid_reference_price',
            'openOrders': serialized_open_orders,
        }

    desired_amount = build_desired_amount(decision, position, reference_price)
    current_amount = safe_int(position.get('amount'))
    enable_amount = safe_int(position.get('enableAmount'))
    delta_amount = normalize_order_amount(desired_amount - current_amount, current_amount, enable_amount)

    if delta_amount == 0:
        return {
            'status': 'noop',
            'reason': 'target_already_matched',
            'desiredAmount': desired_amount,
            'deltaAmount': 0,
            'openOrders': serialized_open_orders,
        }

    if not orders_enabled():
        return {
            'status': 'planned',
            'reason': 'submission_disabled',
            'desiredAmount': desired_amount,
            'deltaAmount': delta_amount,
            'openOrders': serialized_open_orders,
        }

    try:
        limit_price = None
        if g.use_limit_price:
            limit_price = reference_price

        if limit_price is None:
            order_id = order(symbol, delta_amount)
        else:
            order_id = order(symbol, delta_amount, limit_price=limit_price)

        return {
            'status': 'submitted' if order_id else 'rejected',
            'reason': 'order_called',
            'desiredAmount': desired_amount,
            'deltaAmount': delta_amount,
            'limitPrice': limit_price,
            'orderId': order_id,
            'openOrders': serialized_open_orders,
        }
    except Exception as error:
        return {
            'status': 'error',
            'reason': str(error),
            'desiredAmount': desired_amount,
            'deltaAmount': delta_amount,
            'limitPrice': reference_price if g.use_limit_price else None,
            'openOrders': serialized_open_orders,
        }


def evaluate_signal(symbol, history, reference_price, l2_confirmation):
    closes = history.get('close') or []
    highs = history.get('high') or closes
    lows = history.get('low') or closes
    volumes = history.get('volume') or []

    fast_ma = average_last(closes, g.fast_ma_window)
    slow_ma = average_last(closes, g.slow_ma_window)
    range_high = max_last(highs, g.breakout_lookback)
    range_low = min_last(lows, g.breakout_lookback)
    recent_volume = last_value(volumes)
    average_volume = average_last(volumes, g.volume_lookback)

    breakout_ready = bool(reference_price and range_high and reference_price >= range_high)
    trend_ready = bool(fast_ma and slow_ma and fast_ma >= slow_ma)
    volume_ratio = None
    if recent_volume is not None and average_volume and average_volume > 0:
        volume_ratio = recent_volume / average_volume
    volume_ready = bool(volume_ratio and volume_ratio >= g.volume_ratio_threshold)

    range_position = None
    if reference_price and range_high and range_low and range_high > range_low:
        range_position = (reference_price - range_low) / (range_high - range_low)
    pullback_ready = bool(range_position is not None and range_position >= 0.65)

    l2_ready = bool((not g.enable_l2_confirmation) or l2_confirmation.get('confirmed'))

    score = 0
    for flag in [breakout_ready, trend_ready, volume_ready, pullback_ready, l2_ready]:
        if flag:
            score += 1

    entry_ready = breakout_ready and trend_ready and pullback_ready and l2_ready and score >= g.entry_score_threshold
    exit_ready = bool(reference_price and slow_ma and reference_price < slow_ma)

    return {
        'symbol': symbol,
        'fastMA': fast_ma,
        'slowMA': slow_ma,
        'rangeHigh': range_high,
        'rangeLow': range_low,
        'rangePosition': range_position,
        'recentVolume': recent_volume,
        'averageVolume': average_volume,
        'volumeRatio': volume_ratio,
        'breakoutReady': breakout_ready,
        'trendReady': trend_ready,
        'volumeReady': volume_ready,
        'pullbackReady': pullback_ready,
        'l2Ready': l2_ready,
        'entryReady': entry_ready,
        'exitReady': exit_ready,
        'score': score,
    }


def decide_position_target(context, reference_price, position, signal):
    portfolio_value = safe_portfolio_attr(context, 'portfolio_value')
    cash = safe_portfolio_attr(context, 'cash')
    current_amount = safe_int(position.get('amount'))
    current_value = current_amount * safe_float(reference_price)
    cost_basis = safe_float(position.get('costBasis'))

    stop_loss_triggered = bool(
        current_amount > 0
        and reference_price
        and cost_basis > 0
        and reference_price <= cost_basis * (1 - g.stop_loss_pct)
    )

    action = 'hold'
    reason = 'no_signal'
    target_ratio = None
    target_value = current_value

    if current_amount == 0 and signal.get('entryReady'):
        reserve_cash = portfolio_value * g.min_cash_reserve_ratio
        investable_cash = max(cash - reserve_cash, 0)
        if investable_cash > 0:
            action = 'enter'
            reason = 'entry_signal'
            target_ratio = min(g.max_position_ratio, max(signal.get('score', 0) / 5.0, 0.0) * g.max_position_ratio)
            target_value = min(portfolio_value * target_ratio, investable_cash)
        else:
            action = 'hold'
            reason = 'cash_reserve_guard'
    elif current_amount > 0 and (signal.get('exitReady') or stop_loss_triggered):
        action = 'exit'
        reason = 'stop_loss' if stop_loss_triggered else 'trend_exit'
        target_ratio = 0.0
        target_value = 0.0
    elif current_amount > 0 and signal.get('score', 0) >= g.entry_score_threshold:
        action = 'hold'
        reason = 'position_kept'

    return {
        'action': action,
        'reason': reason,
        'targetRatio': target_ratio,
        'targetValue': target_value,
        'portfolioValue': portfolio_value,
        'cash': cash,
        'stopLossTriggered': stop_loss_triggered,
    }


def build_desired_amount(decision, position, reference_price):
    action = decision.get('action')
    current_amount = safe_int(position.get('amount'))

    if action == 'exit':
        return 0

    if action != 'enter':
        return current_amount

    target_value = safe_float(decision.get('targetValue'))
    if target_value <= 0 or reference_price <= 0:
        return current_amount

    target_amount = int(target_value / reference_price)
    target_amount = int(target_amount / MIN_LOT_SIZE) * MIN_LOT_SIZE
    return max(target_amount, 0)


def build_l2_confirmation(symbol):
    result = {
        'enabled': bool(g.enable_l2_confirmation),
        'confirmed': False,
        'topBid': normalize_level(None),
        'topAsk': normalize_level(None),
        'error': '',
    }

    if not g.enable_l2_confirmation:
        return result

    try:
        snapshot_payload = get_snapshot(symbol)
        snapshot = get_symbol_value(snapshot_payload, symbol)
        if not isinstance(snapshot, dict):
            result['error'] = 'snapshot_unavailable'
            return result

        top_bid = normalize_level(extract_level(snapshot.get('bid_grp'), 1))
        top_ask = normalize_level(extract_level(snapshot.get('offer_grp'), 1))
        bid_volume = safe_float(top_bid.get('volume'))
        ask_volume = safe_float(top_ask.get('volume'))

        result['topBid'] = top_bid
        result['topAsk'] = top_ask
        result['confirmed'] = bool(bid_volume > 0 and bid_volume >= ask_volume)
        return result
    except Exception as error:
        result['error'] = str(error)
        return result


def build_session_report(context):
    return {
        'kind': 'ptrade-wyckoff-trade-report',
        'generatedAt': format_current_dt(context),
        'executionMode': g.execution_mode,
        'liveOrderArmed': bool(g.live_order_armed),
        'tradeName': safe_value(get_trade_name),
        'businessType': safe_value(get_business_type),
        'frequency': safe_value(get_frequency),
        'loginAccount': safe_call(get_user_name, True),
        'boundAccount': safe_call(get_user_name, False),
        'portfolio': {
            'cash': safe_portfolio_attr(context, 'cash'),
            'portfolioValue': safe_portfolio_attr(context, 'portfolio_value'),
        },
        'symbols': g.latest_symbol_reports,
        'orders': serialize_orders(safe_call(get_orders)),
        'openOrders': serialize_orders(safe_call(get_open_orders)),
        'trades': serialize_trades(safe_call(get_trades)),
        'positions': serialize_positions(safe_call(get_positions, g.symbols)),
    }


def persist_report(report):
    report['localResultPath'] = build_report_path()

    try:
        with open(report['localResultPath'], 'w') as handler:
            handler.write(json.dumps(report, ensure_ascii=False, indent=2))
    except Exception as error:
        report['localPersistError'] = str(error)

    log.info('Wyckoff ptrade report => {0}'.format(json.dumps(report, ensure_ascii=False)))


def build_report_path():
    try:
        return get_research_path() + g.report_file
    except Exception:
        return g.report_file


def get_symbol_history(symbol):
    size = max(g.breakout_lookback, g.slow_ma_window, g.volume_lookback) + 2

    try:
        payload = get_history(size, '1d', ['close', 'high', 'low', 'volume'], symbol, fq='pre', include=False, is_dict=True)
    except Exception:
        payload = get_history(size, '1d', ['close', 'high', 'low', 'volume'], symbol, fq='pre', include=False)

    container = extract_history_container(payload, symbol)

    return {
        'close': extract_history_field(container, 'close'),
        'high': extract_history_field(container, 'high'),
        'low': extract_history_field(container, 'low'),
        'volume': extract_history_field(container, 'volume'),
    }


def get_reference_price(symbol, data):
    price = extract_data_price(data, symbol)
    if price > 0:
        return price

    snapshot_payload = safe_call(get_snapshot, symbol)
    snapshot = get_symbol_value(snapshot_payload, symbol)
    if isinstance(snapshot, dict):
        return safe_float(snapshot.get('last_px'))

    return 0.0


def build_position_snapshot(position):
    return {
        'amount': safe_int(read_object_value(position, 'amount')),
        'enableAmount': safe_int(read_object_value(position, 'enable_amount')),
        'costBasis': safe_float(read_object_value(position, 'cost_basis')),
        'lastPrice': safe_float(read_object_value(position, 'last_sale_price')),
    }


def serialize_orders(orders):
    if not isinstance(orders, list):
        return []

    result = []
    for item in orders:
        result.append(
            {
                'id': read_object_value(item, 'id'),
                'symbol': read_object_value(item, 'symbol'),
                'amount': safe_float(read_object_value(item, 'amount')),
                'filled': safe_float(read_object_value(item, 'filled')),
                'status': read_object_value(item, 'status'),
                'limit': safe_float(read_object_value(item, 'limit')),
                'entrustNo': read_object_value(item, 'entrust_no'),
            }
        )

    return result


def serialize_positions(positions):
    if not isinstance(positions, dict):
        return {}

    result = {}
    for symbol in positions:
        result[symbol] = build_position_snapshot(positions.get(symbol))

    return result


def serialize_trades(trades):
    if not isinstance(trades, dict):
        return {}

    result = {}
    for order_id in trades:
        rows = trades.get(order_id)
        if not isinstance(rows, list):
            rows = []
        result[order_id] = rows

    return result


def extract_history_container(payload, symbol):
    if isinstance(payload, dict):
        symbol_value = get_symbol_value(payload, symbol)
        if symbol_value is not None:
            return symbol_value
        return payload

    return payload


def extract_history_field(container, field_name):
    if isinstance(container, dict):
        return to_number_list(container.get(field_name))

    try:
        field_value = container[field_name]
        return to_number_list(field_value)
    except Exception:
        return []


def extract_data_price(data, symbol):
    symbol_data = None

    try:
        symbol_data = data[symbol]
    except Exception:
        symbol_data = None

    if symbol_data is None and isinstance(data, dict):
        symbol_data = get_symbol_value(data, symbol)

    if symbol_data is None:
        return 0.0

    for field in ['close', 'price', 'last_price']:
        value = read_object_value(symbol_data, field)
        value = safe_float(value)
        if value > 0:
            return value

    return 0.0


def normalize_order_amount(raw_delta, current_amount, enable_amount):
    if raw_delta > 0:
        normalized = int(raw_delta / MIN_LOT_SIZE) * MIN_LOT_SIZE
        return max(normalized, 0)

    if raw_delta < 0:
        sell_amount = min(abs(raw_delta), max(enable_amount, 0), max(current_amount, 0))
        if sell_amount == current_amount:
            return -sell_amount
        normalized = int(sell_amount / MIN_LOT_SIZE) * MIN_LOT_SIZE
        return -max(normalized, 0)

    return 0


def orders_enabled():
    if g.execution_mode == 'live':
        return bool(g.live_order_armed)
    return True


def average_last(values, size):
    tail = slice_last(values, size)
    if not tail:
        return None
    return sum(tail) / float(len(tail))


def max_last(values, size):
    tail = slice_last(values, size)
    if not tail:
        return None
    return max(tail)


def min_last(values, size):
    tail = slice_last(values, size)
    if not tail:
        return None
    return min(tail)


def slice_last(values, size):
    if not isinstance(values, list):
        return []
    if size <= 0:
        return []
    return values[-size:]


def last_value(values):
    if not isinstance(values, list) or not values:
        return None
    return values[-1]


def to_number_list(values):
    if values is None:
        return []

    if hasattr(values, 'tolist'):
        try:
            values = values.tolist()
        except Exception:
            values = list(values)

    if not isinstance(values, list):
        try:
            values = list(values)
        except Exception:
            return []

    result = []
    for item in values:
        number = safe_float(item)
        if number is not None:
            result.append(number)

    return result


def get_symbol_value(payload, symbol):
    if not isinstance(payload, dict):
        return None

    for candidate in build_symbol_candidates(symbol):
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
        result['price'] = safe_float(level[0])
    if len(level) > 1:
        result['volume'] = safe_float(level[1])
    if len(level) > 2:
        result['orders'] = safe_float(level[2])
    if len(level) > 3 and isinstance(level[3], dict):
        result['queueSize'] = len(level[3])

    return result


def safe_portfolio_attr(context, attr_name):
    try:
        value = getattr(context.portfolio, attr_name)
        return safe_float(value)
    except Exception:
        return 0.0


def read_object_value(obj, key, default=None):
    if obj is None:
        return default

    if isinstance(obj, dict):
        return obj.get(key, default)

    if hasattr(obj, key):
        try:
            return getattr(obj, key)
        except Exception:
            return default

    try:
        return obj[key]
    except Exception:
        return default


def safe_call(func, *args, **kwargs):
    try:
        return func(*args, **kwargs)
    except Exception:
        return None


def safe_value(func):
    try:
        return func()
    except Exception as error:
        return 'error: {0}'.format(error)


def safe_float(value):
    try:
        return float(value)
    except Exception:
        return 0.0


def safe_int(value):
    try:
        return int(float(value))
    except Exception:
        return 0


def format_current_dt(context):
    try:
        return str(context.blotter.current_dt)
    except Exception:
        return ''