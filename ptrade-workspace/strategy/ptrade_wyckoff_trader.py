import json
import pickle


MIN_LOT_SIZE = 100


def initialize(context):
    g.execution_mode = 'paper'
    g.live_order_armed = False
    g.enable_pilot_entries = True
    g.enable_pilot_promotion = True
    g.use_runtime_universe = True
    g.follow_runtime_symbols_for_policy_pool = True
    g.prune_state_to_active_symbols = True
    g.enable_l2_confirmation = True
    g.enable_trade_stream_confirmation = True
    g.require_l2_for_entry = False
    g.require_trade_stream_for_entry = False
    g.require_macro_filter = True
    g.require_rs_filter = False
    g.scale_position_cap_to_universe = True
    g.use_limit_price = True

    g.max_position_ratio = 0.25
    g.min_cash_reserve_ratio = 0.10
    g.breakout_lookback = 20
    g.fast_ma_window = 5
    g.slow_ma_window = 10
    g.long_ma_window = 30
    g.volume_lookback = 10
    g.volume_ratio_threshold = 1.50
    g.entry_score_threshold = 3
    g.pilot_entry_score_threshold = 2
    g.stop_loss_pct = 0.03
    g.trend_stop_loss_pct = 0.06
    g.structure_lookback = 30
    g.background_lookback = 90
    g.macro_ma_window = 120
    g.rs_lookback = 60
    g.beta_lookback = 60
    g.breakout_confirmation_bars = 5
    g.base_exclusion_bars = 10
    g.spring_penetration_pct = 0.015
    g.entry_zone_buffer_pct = 0.015
    g.phase_a_volume_ratio = 1.80
    g.spring_volume_ratio = 1.50
    g.sos_volume_ratio = 1.20
    g.pullback_volume_ratio = 0.85
    g.minimum_risk_reward = 2.50
    g.pilot_min_risk_reward = 1.80
    g.target_extension_ratio = 1.50
    g.background_decline_pct = 0.18
    g.secondary_test_tolerance_pct = 0.03
    g.upthrust_buffer_pct = 0.02
    g.utad_close_position_threshold = 0.75
    g.utad_min_volume_ratio = 1.00
    g.weakness_volume_ratio = 1.30
    g.order_book_imbalance_threshold = 0.10
    g.max_spread_pct = 0.01
    g.rs_threshold = -0.02
    g.max_beta = 1.20
    g.add_position_buffer = 0.02
    g.pilot_position_scale = 0.35
    g.trim_fraction = 0.50
    g.runner_position_fraction = 0.50
    g.benchmark_symbol = normalize_symbol('000300.XSHG')

    g.report_file = 'ptrade-wyckoff-trade-report-last.json'
    g.state_file = 'ptrade-wyckoff-state.pkl'
    g.policy_pool_file = 'ptrade-wyckoff-policy-pool.json'
    g.symbols, g.symbols_source = resolve_strategy_symbols(context)
    g.policy_symbol_pool = list(g.symbols)
    g.latest_symbol_reports = []
    g.runtime_capabilities = {}
    g.strategy_state = load_strategy_state()
    if getattr(g, 'prune_state_to_active_symbols', True):
        g.strategy_state = prune_strategy_state(g.strategy_state, g.symbols)
    g.policy_pool = load_policy_pool()

    if g.symbols:
        set_universe(g.symbols)

    if is_trade():
        set_parameters(not_restart_trade='1', server_restart_not_do_before='1')


def resolve_strategy_symbols(context):
    runtime_symbols = []
    if getattr(g, 'use_runtime_universe', True):
        runtime_symbols = resolve_runtime_symbols(context)
    if runtime_symbols:
        return runtime_symbols, 'runtime'

    configured_symbols = load_configured_symbol_candidates()
    if configured_symbols:
        return configured_symbols, 'policy_pool_config'

    return [], 'empty'


def resolve_runtime_symbols(context):
    universe_reader = globals().get('get_universe')
    if callable(universe_reader):
        symbols = extract_symbol_list(safe_call(universe_reader))
        if symbols:
            return symbols

    parameters_reader = globals().get('get_parameters')
    if callable(parameters_reader):
        symbols = resolve_symbols_from_container(safe_call(parameters_reader), exact_keys=build_runtime_symbol_keys())
        if symbols:
            return symbols

    parameter_reader = globals().get('get_parameter')
    if callable(parameter_reader):
        for key in build_runtime_symbol_keys():
            symbols = extract_symbol_list(safe_call(parameter_reader, key))
            if symbols:
                return symbols

    benchmark_readers = ['get_benchmark', 'get_benchmark_symbol']
    for reader_name in benchmark_readers:
        benchmark_reader = globals().get(reader_name)
        if callable(benchmark_reader):
            symbols = extract_symbol_list(safe_call(benchmark_reader))
            if symbols:
                return symbols

    direct_keys = ['symbols', 'symbol', 'universe', 'security', 'securities', 'stock', 'stocks']
    benchmark_keys = ['benchmark', 'benchmark_symbol', 'benchmark_symbols', 'benchmark_security', 'benchmark_securities', 'benchmark_stock', 'benchmark_stocks', 'benchmark_code', 'benchmark_codes']
    nested_keys = ['params', 'parameters', 'config', 'settings', 'param', 'backtest', 'backtest_config', 'strategy', 'strategy_config', 'strategy_params', 'options']

    search_containers = [context]
    for container_key in nested_keys:
        container = read_object_value(context, container_key)
        if container is not None:
            search_containers.append(container)

    for container in search_containers:
        symbols = resolve_symbols_from_container(container, exact_keys=direct_keys, key_tokens=['symbol', 'universe', 'security', 'stock'])
        if symbols:
            return symbols

    for container in search_containers:
        symbols = resolve_symbols_from_container(container, exact_keys=benchmark_keys, key_tokens=['benchmark'])
        if symbols:
            return symbols

    return []


def build_runtime_symbol_keys():
    return [
        'symbols',
        'symbol',
        'universe',
        'security',
        'securities',
        'stock',
        'stocks',
        'benchmark',
        'benchmark_symbol',
        'benchmark_symbols',
        'benchmark_security',
        'benchmark_securities',
        'benchmark_stock',
        'benchmark_stocks',
        'benchmark_code',
        'benchmark_codes',
    ]


def resolve_symbols_from_container(container, exact_keys=None, key_tokens=None):
    if container is None:
        return []

    direct_symbols = extract_symbol_list(container)
    if direct_symbols:
        return direct_symbols

    for key in exact_keys or []:
        symbols = extract_symbol_list(read_object_value(container, key))
        if symbols:
            return symbols

    for key, value in iter_object_items(container):
        lowered_key = str(key).lower()
        if key_tokens and not has_any_token(lowered_key, key_tokens):
            continue
        symbols = extract_symbol_list(value)
        if symbols:
            return symbols

    return []


def load_configured_symbol_candidates():
    path = build_local_path(g.policy_pool_file)
    try:
        with open(path, 'r') as handler:
            payload = json.loads(handler.read())
    except Exception:
        return []

    if isinstance(payload, list):
        return extract_symbol_list(payload)
    if isinstance(payload, dict):
        return extract_symbol_list(payload.get('symbols'))
    return []


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
    persist_strategy_state()


def build_symbol_plan(context, data, symbol):
    symbol = normalize_symbol(symbol)
    reference_price = get_reference_price(symbol, data)
    history = get_symbol_history(symbol)
    position = build_position_snapshot(safe_call(get_position, symbol))
    benchmark_history = get_benchmark_history()
    macro_context = analyze_macro_context(history, benchmark_history)
    policy_context = build_policy_pool_context(symbol)
    state_memory = reconcile_state_memory(symbol, position)
    l2_confirmation = build_l2_confirmation(symbol)
    signal = evaluate_signal(symbol, history, reference_price, l2_confirmation, macro_context, policy_context, state_memory)
    decision = decide_position_target(context, reference_price, position, signal, state_memory)
    next_state = build_next_symbol_state(symbol, signal, decision, state_memory)
    write_symbol_state(symbol, next_state)

    return {
        'symbol': symbol,
        'referencePrice': reference_price,
        'history': history,
        'position': position,
        'macro': macro_context,
        'policy': policy_context,
        'stateMemory': next_state,
        'l2': l2_confirmation,
        'signal': signal,
        'decision': decision,
    }


def execute_symbol_plan(symbol, plan):
    symbol = normalize_symbol(symbol)
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


def evaluate_signal(symbol, history, reference_price, l2_confirmation, macro_context=None, policy_context=None, state_memory=None):
    macro_context = macro_context or {}
    policy_context = policy_context or {'allowed': True, 'reason': 'not_configured'}
    state_memory = state_memory or {}
    closes = history.get('close') or []
    highs = history.get('high') or closes
    lows = history.get('low') or closes
    volumes = history.get('volume') or []

    context = analyze_wyckoff_context(closes, highs, lows, volumes, reference_price)
    setup = classify_wyckoff_setup(context, l2_confirmation)
    setup = apply_phase_memory_overrides(setup, context, state_memory)
    entry_zone, stop_loss, target_price = build_signal_levels(context, setup)
    entry_mid = average_last(entry_zone, len(entry_zone))
    risk_reward = compute_risk_reward(entry_zone, stop_loss, target_price)
    score = build_signal_score(setup, context, l2_confirmation)
    confidence = build_signal_confidence(setup, context, risk_reward, l2_confirmation, macro_context, policy_context)
    status = build_signal_status(setup, confidence, risk_reward, l2_confirmation, macro_context, policy_context, score)
    setup_type = setup.get('setupType')
    trade_stream = l2_confirmation.get('tradeStream') or {}
    active_long_management = bool(setup_type in ['SPRING', 'SOS', 'LPS', 'BUEC'])
    l2_available = bool(l2_confirmation.get('available'))
    l2_confirmed = bool(l2_confirmation.get('confirmed'))
    l2_gate_ready = bool((not g.require_l2_for_entry) or l2_confirmed)
    trade_stream_available = bool(trade_stream.get('available'))
    trade_stream_confirmed = bool(trade_stream.get('confirmed'))
    trade_stream_gate_ready = bool((not g.require_trade_stream_for_entry) or trade_stream_confirmed)
    policy_ready = bool(policy_context.get('allowed'))
    macro_ready = is_macro_gate_ready(setup, macro_context)
    rs_ready = bool((not g.require_rs_filter) or macro_context.get('rsReady'))
    system_ready = bool(policy_ready and macro_ready and rs_ready and l2_gate_ready and trade_stream_gate_ready)
    take_profit_ready = bool(
        active_long_management and target_price > 0 and reference_price and reference_price >= target_price
    )
    trend_weakening = bool(
        active_long_management
        and context.get('fastMA')
        and context.get('slowMA')
        and reference_price
        and reference_price < context.get('fastMA')
        and context.get('fastMA') < context.get('slowMA')
    )

    pilot_entries_enabled = bool(getattr(g, 'enable_pilot_entries', True))
    pilot_promotion_enabled = bool(getattr(g, 'enable_pilot_promotion', True))
    position_stage = state_memory.get('positionStage')
    if position_stage not in ['pilot', 'full']:
        position_stage = 'none'

    formal_entry_ready = bool(
        status == 'ACTION_REQUIRED' and setup.get('setupType') in ['SPRING', 'SOS', 'LPS', 'BUEC'] and system_ready
    )
    pilot_ready = bool(
        pilot_entries_enabled
        and status == 'PILOT_ACTION'
        and setup.get('setupType') in ['ST', 'SPRING']
        and system_ready
    )
    entry_ready = bool(formal_entry_ready or pilot_ready)
    add_ready = bool(status == 'ACTION_REQUIRED' and setup.get('addReady') and system_ready)
    trim_ready = bool(status == 'RISK_OFF' or setup.get('trimReady') or trend_weakening)
    exit_ready = bool(
        setup.get('exitReady')
        or (
            reference_price
            and (
                stop_loss > 0 and reference_price <= stop_loss
            )
        )
    )
    suggested_position_ratio = build_suggested_position_ratio(setup, confidence, status)
    effective_max_position_ratio = get_effective_max_position_ratio()
    state_managed_target_ratio = min(effective_max_position_ratio, safe_float(state_memory.get('managedTargetRatio')))
    promotion_ready = bool(
        pilot_promotion_enabled
        and position_stage == 'pilot'
        and state_managed_target_ratio > 0
        and formal_entry_ready
        and suggested_position_ratio > state_managed_target_ratio + g.add_position_buffer
    )

    return {
        'symbol': symbol,
        'phase': setup.get('phase'),
        'subPhase': setup.get('subPhase'),
        'setupType': setup.get('setupType'),
        'status': status,
        'thesis': build_signal_thesis(setup, context, status),
        'nextCheck': build_signal_next_check(setup, status, l2_confirmation),
        'entryZone': entry_zone,
        'entryMid': entry_mid,
        'stopLoss': stop_loss,
        'targetPrice': target_price,
        'riskReward': risk_reward,
        'confidence': confidence,
        'support': context.get('support'),
        'resistance': context.get('resistance'),
        'backgroundHigh': context.get('backgroundHigh'),
        'backgroundLow': context.get('backgroundLow'),
        'declineFromHigh': context.get('declineFromHigh'),
        'fastMA': context.get('fastMA'),
        'slowMA': context.get('slowMA'),
        'longMA': context.get('longMA'),
        'rangeHigh': context.get('resistance'),
        'rangeLow': context.get('support'),
        'rangePosition': context.get('closePosition'),
        'recentVolume': context.get('recentVolume'),
        'averageVolume': context.get('averageVolume'),
        'volumeRatio': context.get('volumeRatio'),
        'automaticRallySeen': context.get('automaticRallySeen'),
        'secondaryTestSeen': context.get('secondaryTestSeen'),
        'signOfStrengthSeen': context.get('signOfStrengthSeen'),
        'backupSeen': context.get('backupSeen'),
        'upthrustSeen': context.get('upthrustSeen'),
        'breakdownSeen': context.get('breakdownSeen'),
        'policyPoolReady': policy_ready,
        'policyPoolReason': policy_context.get('reason'),
        'macroReady': macro_ready,
        'longCycleReady': macro_context.get('longCycleReady'),
        'trendCycleReady': macro_context.get('trendCycleReady'),
        'macroMA': macro_context.get('macroMA'),
        'stockReturn': macro_context.get('stockReturn'),
        'benchmarkReturn': macro_context.get('benchmarkReturn'),
        'rsScore': macro_context.get('rsScore'),
        'rsReady': macro_context.get('rsReady'),
        'beta': macro_context.get('beta'),
        'betaReady': macro_context.get('betaReady'),
        'orderBookImbalance': l2_confirmation.get('imbalance'),
        'spreadPct': l2_confirmation.get('spreadPct'),
        'tradeCvd': trade_stream.get('cvd'),
        'l2DataAvailable': l2_available,
        'l2Confirmed': l2_confirmed,
        'l2Ready': l2_confirmed,
        'l2GateReady': l2_gate_ready,
        'l2Error': l2_confirmation.get('error'),
        'tradeStreamDataAvailable': trade_stream_available,
        'tradeStreamConfirmed': trade_stream_confirmed,
        'tradeStreamReady': trade_stream_confirmed,
        'tradeStreamGateReady': trade_stream_gate_ready,
        'tradeStreamError': trade_stream.get('error'),
        'systemReady': system_ready,
        'statePhaseMemory': state_memory.get('phase'),
        'pnfColumnCount': safe_int(state_memory.get('pnfColumnCount')),
        'breakoutReady': setup.get('breakoutReady'),
        'trendReady': context.get('trendReady'),
        'volumeReady': setup.get('volumeReady'),
        'pullbackReady': setup.get('pullbackReady'),
        'entryStage': 'pilot' if pilot_ready else 'full' if formal_entry_ready else 'none',
        'pilotReady': pilot_ready,
        'formalEntryReady': formal_entry_ready,
        'pilotEntriesEnabled': pilot_entries_enabled,
        'pilotPromotionEnabled': pilot_promotion_enabled,
        'positionStage': position_stage,
        'promotionReady': promotion_ready,
        'entryReady': entry_ready,
        'addReady': add_ready,
        'trimReady': trim_ready,
        'takeProfitReady': take_profit_ready,
        'trendWeakening': trend_weakening,
        'exitReady': exit_ready,
        'score': score,
        'suggestedPositionRatio': suggested_position_ratio,
    }


def decide_position_target(context, reference_price, position, signal, state_memory=None):
    state_memory = state_memory or {}
    effective_max_position_ratio = get_effective_max_position_ratio()
    portfolio_value = safe_portfolio_attr(context, 'portfolio_value')
    cash = safe_portfolio_attr(context, 'cash')
    current_amount = safe_int(position.get('amount'))
    current_value = current_amount * safe_float(reference_price)
    cost_basis = safe_float(position.get('costBasis'))
    structure_stop = safe_float(signal.get('stopLoss'))
    current_ratio = current_value / portfolio_value if portfolio_value > 0 else 0.0
    signal_desired_ratio = min(effective_max_position_ratio, safe_float(signal.get('suggestedPositionRatio')))
    managed_target_ratio = min(effective_max_position_ratio, safe_float(state_memory.get('managedTargetRatio')))
    runner_target_ratio = min(effective_max_position_ratio, safe_float(state_memory.get('runnerTargetRatio')))
    position_stage = state_memory.get('positionStage')
    if position_stage not in ['pilot', 'full']:
        position_stage = 'none'

    if current_amount > 0:
        if managed_target_ratio <= 0:
            managed_target_ratio = min(effective_max_position_ratio, max(signal_desired_ratio, current_ratio))
        elif signal_desired_ratio > managed_target_ratio:
            managed_target_ratio = signal_desired_ratio
        desired_ratio = managed_target_ratio
        if signal_desired_ratio > 0 and desired_ratio > runner_target_ratio * 2:
            runner_target_ratio = desired_ratio * g.runner_position_fraction
        elif runner_target_ratio <= 0 and desired_ratio > 0:
            runner_target_ratio = desired_ratio * g.runner_position_fraction
    else:
        desired_ratio = signal_desired_ratio
        managed_target_ratio = desired_ratio
        if runner_target_ratio <= 0 and desired_ratio > 0:
            runner_target_ratio = desired_ratio * g.runner_position_fraction

    runner_ratio = runner_target_ratio if current_amount > 0 else desired_ratio * g.runner_position_fraction if desired_ratio > 0 else 0.0
    runner_floor_ratio = effective_max_position_ratio * g.runner_position_fraction
    reserve_cash = portfolio_value * g.min_cash_reserve_ratio
    investable_cash = max(cash - reserve_cash, 0)
    setup_type = signal.get('setupType')
    signal_range_position = safe_float(signal.get('rangePosition'))
    pilot_promotion_ready = bool(
        getattr(g, 'enable_pilot_promotion', True)
        and current_amount > 0
        and position_stage == 'pilot'
        and signal.get('formalEntryReady')
        and desired_ratio > current_ratio + g.add_position_buffer
    )
    active_long_management = bool(setup_type in ['SPRING', 'SOS', 'LPS', 'BUEC'])
    runner_position_only = bool(current_amount > 0 and current_ratio > 0 and current_ratio <= runner_floor_ratio)
    runner_lost_trend = bool(
        runner_position_only
        and not active_long_management
        and signal.get('status') in ['BLOCKED', 'MONITORING']
        and not signal.get('trendReady')
        and signal_range_position <= 1.0
    )
    trend_stop_guard_active = bool(
        position_stage == 'full'
        and not signal.get('trendWeakening')
        and (
            signal.get('trendReady')
            or signal.get('longCycleReady')
            or signal.get('macroReady')
        )
    )
    cost_stop_pct = safe_float(getattr(g, 'stop_loss_pct', 0.0))
    if trend_stop_guard_active:
        cost_stop_pct = max(cost_stop_pct, safe_float(getattr(g, 'trend_stop_loss_pct', cost_stop_pct)))

    stop_loss_triggered = bool(
        current_amount > 0
        and reference_price
        and cost_basis > 0
        and cost_stop_pct > 0
        and reference_price <= cost_basis * (1 - cost_stop_pct)
    )
    structure_stop_triggered = bool(
        current_amount > 0 and structure_stop > 0 and reference_price and reference_price <= structure_stop
    )

    action = 'hold'
    reason = 'no_signal'
    target_ratio = None
    target_value = current_value

    if current_amount == 0 and signal.get('entryReady'):
        if investable_cash > 0 and desired_ratio > 0:
            action = 'enter'
            if signal.get('entryStage') == 'pilot':
                reason = 'pilot_{0}'.format(signal.get('setupType', 'entry_signal'))
            else:
                reason = signal.get('setupType', 'entry_signal')
            target_ratio = desired_ratio
            if target_ratio <= 0:
                target_ratio = min(effective_max_position_ratio, max(signal.get('score', 0) / 5.0, 0.0) * effective_max_position_ratio)
            target_value = min(portfolio_value * target_ratio, investable_cash)
        else:
            action = 'hold'
            reason = 'cash_reserve_guard'
    elif current_amount > 0 and (signal.get('exitReady') or stop_loss_triggered or structure_stop_triggered):
        action = 'exit'
        if structure_stop_triggered:
            reason = 'structure_stop'
        elif signal.get('status') == 'RISK_OFF':
            reason = signal.get('setupType', 'risk_off')
        else:
            reason = 'stop_loss' if stop_loss_triggered else 'trend_exit'
        target_ratio = 0.0
        target_value = 0.0
    elif pilot_promotion_ready:
        if investable_cash > 0:
            action = 'add'
            reason = 'pilot_promoted_{0}'.format(signal.get('setupType', 'entry_signal'))
            target_ratio = desired_ratio
            target_value = min(portfolio_value * target_ratio, current_value + investable_cash)
        else:
            action = 'hold'
            reason = 'cash_reserve_guard'
    elif current_amount > 0 and signal.get('takeProfitReady') and runner_ratio > 0 and current_ratio > runner_ratio:
        action = 'trim'
        reason = 'target_reached'
        target_ratio = runner_ratio
        target_value = portfolio_value * target_ratio
    elif current_amount > 0 and signal.get('trimReady'):
        action = 'trim'
        reason = 'trend_weakening' if signal.get('trendWeakening') else signal.get('setupType', 'trim_signal')
        if runner_ratio > 0 and current_ratio > runner_ratio:
            target_ratio = runner_ratio
        else:
            target_ratio = max(current_ratio * g.trim_fraction, 0.0)
        target_value = portfolio_value * target_ratio
    elif current_amount > 0 and runner_lost_trend:
        action = 'exit'
        reason = 'runner_lost_trend'
        target_ratio = 0.0
        target_value = 0.0
    elif current_amount > 0 and signal.get('addReady') and desired_ratio > current_ratio + g.add_position_buffer:
        if investable_cash > 0:
            action = 'add'
            reason = signal.get('setupType', 'add_signal')
            target_ratio = desired_ratio
            target_value = min(portfolio_value * target_ratio, current_value + investable_cash)
        else:
            action = 'hold'
            reason = 'cash_reserve_guard'
    elif current_amount > 0 and signal.get('status') in ['PILOT_ACTION', 'ACTION_REQUIRED', 'MONITORING']:
        action = 'hold'
        reason = 'position_kept'

    return {
        'action': action,
        'reason': reason,
        'targetRatio': target_ratio,
        'targetValue': target_value,
        'portfolioValue': portfolio_value,
        'cash': cash,
        'currentRatio': current_ratio,
        'effectiveMaxPositionRatio': effective_max_position_ratio,
        'signalDesiredRatio': signal_desired_ratio,
        'desiredRatio': desired_ratio,
        'positionStage': position_stage,
        'promotionReady': pilot_promotion_ready,
        'managedTargetRatio': managed_target_ratio,
        'runnerRatio': runner_ratio,
        'runnerTargetRatio': runner_target_ratio,
        'runnerFloorRatio': runner_floor_ratio,
        'costStopPct': cost_stop_pct,
        'stopLossTriggered': stop_loss_triggered,
        'structureStopTriggered': structure_stop_triggered,
    }


def analyze_wyckoff_context(closes, highs, lows, volumes, reference_price):
    fast_ma = average_last(closes, g.fast_ma_window)
    slow_ma = average_last(closes, g.slow_ma_window)
    long_ma = average_last(closes, g.long_ma_window)

    current_close = safe_float(reference_price or last_value(closes))
    current_high = safe_float(last_value(highs) or current_close)
    current_low = safe_float(last_value(lows) or current_close)
    recent_volume = safe_float(last_value(volumes))

    average_volume = average_last(slice_without_tail(volumes, 1), g.volume_lookback)
    if average_volume is None:
        average_volume = average_last(volumes, g.volume_lookback)
    average_volume = safe_float(average_volume)

    base_highs = slice_window_without_tail(highs, g.structure_lookback, g.base_exclusion_bars)
    base_lows = slice_window_without_tail(lows, g.structure_lookback, g.base_exclusion_bars)
    if not base_highs:
        base_highs = slice_last(highs, g.structure_lookback)
    if not base_lows:
        base_lows = slice_last(lows, g.structure_lookback)

    support = min(base_lows) if base_lows else current_low
    resistance = max(base_highs) if base_highs else current_high
    background_high = max_last(highs, g.background_lookback)
    background_low = min_last(lows, g.background_lookback)
    if background_high is None:
        background_high = resistance
    if background_low is None:
        background_low = support

    range_height = max(resistance - support, max(current_close * 0.01, 0.01))
    close_position = (current_close - support) / range_height if range_height > 0 else 0.0
    decline_from_high = (background_high - current_close) / background_high if background_high > 0 else 0.0

    recent_highs = slice_last(highs, g.breakout_confirmation_bars)
    recent_lows = slice_last(lows, g.breakout_confirmation_bars)
    recent_volumes = slice_last(volumes, g.breakout_confirmation_bars)
    recent_close_low = min(slice_last(closes, g.breakout_confirmation_bars)) if slice_last(closes, g.breakout_confirmation_bars) else current_close
    recent_swing_high = max(recent_highs) if recent_highs else current_high
    recent_swing_low = min(recent_lows) if recent_lows else current_low
    recent_volume_peak = max(recent_volumes) if recent_volumes else recent_volume
    pullback_volume = average_last(recent_volumes, len(recent_volumes)) if recent_volumes else recent_volume
    pullback_volume = safe_float(pullback_volume)

    volume_ratio = recent_volume / average_volume if average_volume > 0 else 0.0
    recent_volume_peak_ratio = recent_volume_peak / average_volume if average_volume > 0 else 0.0
    pullback_volume_ratio = pullback_volume / average_volume if average_volume > 0 else 0.0
    trend_ready = bool(fast_ma and slow_ma and current_close > slow_ma and fast_ma >= slow_ma)
    breakout_seen = bool(recent_highs and max(recent_highs) >= resistance * (1 + g.entry_zone_buffer_pct))
    spring_seen = bool(recent_swing_low <= support * (1 - g.spring_penetration_pct) and current_close > support)
    downtrend_mature = bool(long_ma and recent_close_low < long_ma and decline_from_high >= g.background_decline_pct)
    automatic_rally_seen = bool(close_position >= 0.35 and current_close >= support + range_height * 0.35)
    secondary_test_seen = bool(
        recent_swing_low >= support * (1 - g.secondary_test_tolerance_pct)
        and recent_swing_low <= support * (1 + g.secondary_test_tolerance_pct * 2)
        and pullback_volume_ratio > 0
        and pullback_volume_ratio <= 1.05
        and current_close > support
    )
    sign_of_strength_seen = bool(current_close > resistance and volume_ratio >= g.sos_volume_ratio and close_position >= 0.80)
    backup_seen = bool(
        current_close >= resistance * (1 - g.entry_zone_buffer_pct)
        and current_close <= resistance * (1 + g.entry_zone_buffer_pct * 2)
        and pullback_volume_ratio > 0
        and pullback_volume_ratio <= g.pullback_volume_ratio
    )
    upthrust_seen = bool(recent_swing_high >= resistance * (1 + g.upthrust_buffer_pct) and current_close < resistance)
    breakdown_seen = bool(current_close < support * (1 - g.entry_zone_buffer_pct) and volume_ratio >= g.weakness_volume_ratio)

    return {
        'support': round_price(support),
        'resistance': round_price(resistance),
        'backgroundHigh': round_price(background_high),
        'backgroundLow': round_price(background_low),
        'declineFromHigh': round(safe_float(decline_from_high), 4),
        'rangeHeight': range_height,
        'currentClose': current_close,
        'currentHigh': current_high,
        'currentLow': current_low,
        'recentSwingHigh': recent_swing_high,
        'recentSwingLow': recent_swing_low,
        'recentVolume': recent_volume,
        'recentVolumePeakRatio': recent_volume_peak_ratio,
        'averageVolume': average_volume,
        'volumeRatio': volume_ratio,
        'pullbackVolumeRatio': pullback_volume_ratio,
        'fastMA': fast_ma,
        'slowMA': slow_ma,
        'longMA': long_ma,
        'trendReady': trend_ready,
        'downtrendMature': downtrend_mature,
        'automaticRallySeen': automatic_rally_seen,
        'secondaryTestSeen': secondary_test_seen,
        'signOfStrengthSeen': sign_of_strength_seen,
        'backupSeen': backup_seen,
        'upthrustSeen': upthrust_seen,
        'breakdownSeen': breakdown_seen,
        'breakoutSeen': breakout_seen,
        'springSeen': spring_seen,
        'closePosition': close_position,
    }


def classify_wyckoff_setup(context, l2_confirmation):
    current_close = safe_float(context.get('currentClose'))
    support = safe_float(context.get('support'))
    resistance = safe_float(context.get('resistance'))
    volume_ratio = safe_float(context.get('volumeRatio'))
    pullback_volume_ratio = safe_float(context.get('pullbackVolumeRatio'))
    close_position = safe_float(context.get('closePosition'))
    downtrend_mature = bool(context.get('downtrendMature'))
    automatic_rally_seen = bool(context.get('automaticRallySeen'))
    secondary_test_seen = bool(context.get('secondaryTestSeen'))
    sign_of_strength_seen = bool(context.get('signOfStrengthSeen'))
    backup_seen = bool(context.get('backupSeen'))
    upthrust_seen = bool(context.get('upthrustSeen'))
    breakdown_seen = bool(context.get('breakdownSeen'))

    l2_ready = bool((not g.enable_l2_confirmation) or l2_confirmation.get('confirmed'))
    breakout_zone = bool(current_close >= resistance * (1 - g.entry_zone_buffer_pct))
    pullback_light = bool(pullback_volume_ratio > 0 and pullback_volume_ratio <= g.pullback_volume_ratio)
    spring_candidate = bool(context.get('springSeen') and close_position >= 0.45 and downtrend_mature)
    spring_confirmed = bool(
        spring_candidate and automatic_rally_seen and safe_float(context.get('recentVolumePeakRatio')) >= g.spring_volume_ratio
    )
    phase_a_candidate = bool(
        downtrend_mature and volume_ratio >= g.phase_a_volume_ratio and current_close <= support * (1 + g.entry_zone_buffer_pct * 4)
    )
    st_candidate = bool(downtrend_mature and automatic_rally_seen and secondary_test_seen and not spring_candidate)
    sos_candidate = bool(sign_of_strength_seen and context.get('breakoutSeen') and current_close > resistance)
    utad_candidate = bool(
        upthrust_seen
        and not context.get('trendReady')
        and close_position <= safe_float(getattr(g, 'utad_close_position_threshold', 0.75))
        and volume_ratio >= safe_float(getattr(g, 'utad_min_volume_ratio', 1.00))
    )
    buec_candidate = bool(
        context.get('breakoutSeen')
        and context.get('trendReady')
        and backup_seen
        and breakout_zone
        and safe_float(context.get('recentSwingLow')) >= resistance * (1 - g.entry_zone_buffer_pct)
        and pullback_light
    )
    lps_candidate = bool(
        context.get('breakoutSeen')
        and context.get('trendReady')
        and backup_seen
        and breakout_zone
        and close_position >= 0.60
        and pullback_light
    )

    if breakdown_seen:
        return {
            'phase': 'Phase E',
            'subPhase': 'SOW 跌破支撑',
            'setupType': 'WEAKNESS',
            'breakoutReady': False,
            'pullbackReady': False,
            'volumeReady': volume_ratio >= g.weakness_volume_ratio,
            'l2Ready': l2_ready,
            'baseConfidence': 86,
            'addReady': False,
            'trimReady': True,
            'exitReady': True,
        }

    if utad_candidate:
        return {
            'phase': 'Phase C',
            'subPhase': 'UTAD 假突破',
            'setupType': 'UTAD',
            'breakoutReady': False,
            'pullbackReady': False,
            'volumeReady': volume_ratio >= g.sos_volume_ratio,
            'l2Ready': l2_ready,
            'baseConfidence': 72,
            'addReady': False,
            'trimReady': True,
            'exitReady': False,
        }

    if sos_candidate:
        return {
            'phase': 'Phase D',
            'subPhase': 'SOS 放量突破',
            'setupType': 'SOS',
            'breakoutReady': True,
            'pullbackReady': backup_seen,
            'volumeReady': True,
            'l2Ready': l2_ready,
            'baseConfidence': 76,
            'addReady': True,
            'trimReady': False,
            'exitReady': False,
        }

    if buec_candidate:
        return {
            'phase': 'Phase D',
            'subPhase': 'BUEC 二次确认',
            'setupType': 'BUEC',
            'breakoutReady': True,
            'pullbackReady': True,
            'volumeReady': pullback_light,
            'l2Ready': l2_ready,
            'baseConfidence': 78,
            'addReady': True,
            'trimReady': False,
            'exitReady': False,
        }

    if lps_candidate:
        return {
            'phase': 'Phase D',
            'subPhase': 'LPS 回踩缩量',
            'setupType': 'LPS',
            'breakoutReady': True,
            'pullbackReady': True,
            'volumeReady': pullback_light,
            'l2Ready': l2_ready,
            'baseConfidence': 72,
            'addReady': True,
            'trimReady': False,
            'exitReady': False,
        }

    if spring_candidate:
        return {
            'phase': 'Phase C',
            'subPhase': 'Spring 收复确认' if spring_confirmed else 'Spring 待验证',
            'setupType': 'SPRING',
            'breakoutReady': spring_confirmed,
            'pullbackReady': True,
            'volumeReady': volume_ratio >= g.spring_volume_ratio,
            'l2Ready': l2_ready,
            'baseConfidence': 66 if spring_confirmed else 58,
            'addReady': False,
            'trimReady': False,
            'exitReady': False,
        }

    if st_candidate:
        return {
            'phase': 'Phase B',
            'subPhase': 'ST 缩量测试',
            'setupType': 'ST',
            'breakoutReady': False,
            'pullbackReady': True,
            'volumeReady': True,
            'l2Ready': l2_ready,
            'baseConfidence': 54,
            'addReady': False,
            'trimReady': False,
            'exitReady': False,
        }

    if phase_a_candidate:
        return {
            'phase': 'Phase A',
            'subPhase': 'SC 刚出现',
            'setupType': 'SC',
            'breakoutReady': False,
            'pullbackReady': False,
            'volumeReady': True,
            'l2Ready': l2_ready,
            'baseConfidence': 32,
            'addReady': False,
            'trimReady': False,
            'exitReady': False,
        }

    return {
        'phase': 'Phase B',
        'subPhase': '因果积累',
        'setupType': 'RANGE',
        'breakoutReady': False,
        'pullbackReady': close_position <= 0.45,
        'volumeReady': pullback_light,
        'l2Ready': l2_ready,
        'baseConfidence': 44,
        'addReady': False,
        'trimReady': False,
        'exitReady': False,
    }


def apply_phase_memory_overrides(setup, context, state_memory):
    state_memory = state_memory or {}
    previous_phase = state_memory.get('phase')

    if previous_phase != 'Phase E':
        return setup

    setup_type = setup.get('setupType')
    if setup_type in ['WEAKNESS', 'SC', 'SPRING', 'ST']:
        return setup

    automatic_rally_seen = bool(context.get('automaticRallySeen'))
    secondary_test_seen = bool(context.get('secondaryTestSeen'))
    sign_of_strength_seen = bool(context.get('signOfStrengthSeen'))

    if sign_of_strength_seen or (automatic_rally_seen and secondary_test_seen):
        return setup

    return {
        'phase': 'Phase E',
        'subPhase': '跌破后待自动反弹',
        'setupType': 'WEAKNESS',
        'breakoutReady': False,
        'pullbackReady': False,
        'volumeReady': bool(safe_float(context.get('volumeRatio')) >= g.weakness_volume_ratio),
        'l2Ready': setup.get('l2Ready'),
        'baseConfidence': max(80, safe_float(setup.get('baseConfidence'))),
        'addReady': False,
        'trimReady': True,
        'exitReady': True,
    }


def build_signal_levels(context, setup):
    support = safe_float(context.get('support'))
    resistance = safe_float(context.get('resistance'))
    range_height = safe_float(context.get('rangeHeight'))
    current_close = safe_float(context.get('currentClose'))
    current_low = safe_float(context.get('currentLow'))
    recent_swing_low = safe_float(context.get('recentSwingLow'))
    setup_type = setup.get('setupType')

    if setup_type == 'SPRING':
        entry_low = support
        entry_high = min(support + range_height * 0.22, max(current_close, support))
        stop_loss = min(current_low, recent_swing_low, support) * (1 - g.entry_zone_buffer_pct)
        target_price = resistance + range_height * g.target_extension_ratio
    elif setup_type == 'SOS':
        entry_low = resistance
        entry_high = max(current_close, resistance * (1 + g.entry_zone_buffer_pct))
        stop_loss = resistance * (1 - g.entry_zone_buffer_pct * 1.5)
        target_price = resistance + range_height * (g.target_extension_ratio + 0.25)
    elif setup_type in ['LPS', 'BUEC']:
        entry_low = resistance * (1 - g.entry_zone_buffer_pct)
        entry_high = resistance * (1 + g.entry_zone_buffer_pct)
        stop_loss = resistance * (1 - g.entry_zone_buffer_pct * 1.5)
        target_price = resistance + range_height * g.target_extension_ratio
    elif setup_type == 'ST':
        entry_low = support
        entry_high = support + range_height * 0.10
        stop_loss = support * (1 - g.stop_loss_pct)
        target_price = resistance
    elif setup_type == 'RANGE':
        entry_low = support * (1 + g.entry_zone_buffer_pct)
        entry_high = support * (1 + g.entry_zone_buffer_pct * 3)
        stop_loss = support * (1 - g.stop_loss_pct)
        target_price = resistance
    else:
        return [0.0, 0.0], 0.0, 0.0

    entry_zone = [round_price(entry_low), round_price(entry_high)]
    return entry_zone, round_price(stop_loss), round_price(target_price)


def compute_risk_reward(entry_zone, stop_loss, target_price):
    if not isinstance(entry_zone, list) or len(entry_zone) != 2:
        return 0.0

    entry_mid = average_last(entry_zone, len(entry_zone))
    if entry_mid is None:
        return 0.0

    risk = safe_float(entry_mid) - safe_float(stop_loss)
    reward = safe_float(target_price) - safe_float(entry_mid)
    if risk <= 0 or reward <= 0:
        return 0.0

    return round(reward / risk, 2)


def build_signal_score(setup, context, l2_confirmation):
    trade_stream = l2_confirmation.get('tradeStream') or {}
    micro_confirmation = bool(l2_confirmation.get('confirmed') or trade_stream.get('confirmed'))
    score = 0

    for flag in [
        setup.get('breakoutReady'),
        context.get('trendReady'),
        setup.get('volumeReady'),
        setup.get('pullbackReady'),
        micro_confirmation,
    ]:
        if flag:
            score += 1

    return score


def is_macro_gate_ready(setup, macro_context):
    if not getattr(g, 'require_macro_filter', False):
        return True

    if macro_context.get('longCycleReady'):
        return True

    return bool(
        setup.get('setupType') in ['SOS', 'LPS', 'BUEC']
        and macro_context.get('trendCycleReady')
    )


def build_signal_confidence(setup, context, risk_reward, l2_confirmation, macro_context=None, policy_context=None):
    macro_context = macro_context or {}
    policy_context = policy_context or {'allowed': True}
    confidence = safe_float(setup.get('baseConfidence'))
    macro_gate_ready = is_macro_gate_ready(setup, macro_context)

    if context.get('downtrendMature') and setup.get('setupType') in ['SC', 'ST', 'SPRING']:
        confidence += 5
    if context.get('automaticRallySeen') and setup.get('setupType') in ['ST', 'SPRING']:
        confidence += 4
    if context.get('secondaryTestSeen') and setup.get('setupType') in ['ST', 'SPRING']:
        confidence += 5
    if context.get('signOfStrengthSeen') and setup.get('setupType') in ['SOS', 'LPS', 'BUEC']:
        confidence += 6
    if context.get('backupSeen') and setup.get('setupType') in ['LPS', 'BUEC']:
        confidence += 5

    if context.get('trendReady'):
        confidence += 6
    if setup.get('volumeReady'):
        confidence += 8
    if setup.get('pullbackReady'):
        confidence += 6
    if risk_reward >= g.minimum_risk_reward:
        confidence += 8
    elif risk_reward > 0:
        confidence -= 8

    if policy_context.get('allowed'):
        confidence += 4
    else:
        confidence -= 20

    if macro_gate_ready:
        confidence += 6
    elif g.require_macro_filter:
        confidence -= 12

    if macro_context.get('rsReady'):
        confidence += 6
    elif g.require_rs_filter:
        confidence -= 8

    if macro_context.get('betaReady'):
        confidence += 4

    trade_stream = l2_confirmation.get('tradeStream') or {}
    if g.enable_l2_confirmation and l2_confirmation.get('available'):
        if l2_confirmation.get('confirmed'):
            confidence += 6
        elif g.require_l2_for_entry:
            confidence -= 10

    if g.enable_trade_stream_confirmation and trade_stream.get('available'):
        if trade_stream.get('confirmed'):
            confidence += 6
        elif g.require_trade_stream_for_entry:
            confidence -= 10

    return clamp(confidence, 0, 95)


def build_signal_status(setup, confidence, risk_reward, l2_confirmation, macro_context=None, policy_context=None, score=0):
    macro_context = macro_context or {}
    policy_context = policy_context or {'allowed': True}
    phase = setup.get('phase')
    setup_type = setup.get('setupType')
    pilot_entries_enabled = bool(getattr(g, 'enable_pilot_entries', True))
    trade_stream = l2_confirmation.get('tradeStream') or {}
    l2_gate_ready = bool((not g.require_l2_for_entry) or l2_confirmation.get('confirmed'))
    trade_stream_gate_ready = bool((not g.require_trade_stream_for_entry) or trade_stream.get('confirmed'))
    macro_ready = is_macro_gate_ready(setup, macro_context)
    rs_ready = bool((not g.require_rs_filter) or macro_context.get('rsReady'))

    if setup_type in ['UTAD', 'WEAKNESS']:
        return 'RISK_OFF'

    if not policy_context.get('allowed'):
        return 'BLOCKED'

    if not macro_ready or not rs_ready or not l2_gate_ready or not trade_stream_gate_ready:
        return 'BLOCKED'

    if phase == 'Phase A':
        return 'BUILDING'

    if setup_type == 'ST':
        if pilot_entries_enabled and risk_reward >= g.pilot_min_risk_reward and confidence >= 60 and score >= g.pilot_entry_score_threshold:
            return 'PILOT_ACTION'
        return 'MONITORING'

    if phase == 'Phase C':
        if pilot_entries_enabled and setup_type == 'SPRING' and risk_reward >= g.pilot_min_risk_reward and confidence >= 62 and score >= g.pilot_entry_score_threshold:
            if not setup.get('breakoutReady'):
                return 'PILOT_ACTION'
        threshold = 68 if setup_type == 'SPRING' else 72
        reward_threshold = max(g.minimum_risk_reward - 0.25, 2.0) if setup_type == 'SPRING' else g.minimum_risk_reward
        if setup.get('breakoutReady') and risk_reward >= reward_threshold and confidence >= threshold and score >= g.entry_score_threshold and l2_gate_ready:
            return 'ACTION_REQUIRED'
        return 'MONITORING'

    if phase == 'Phase D':
        if setup.get('breakoutReady') and risk_reward >= g.minimum_risk_reward and confidence >= 74 and score >= g.entry_score_threshold and l2_gate_ready:
            return 'ACTION_REQUIRED'
        if risk_reward > 0:
            return 'MONITORING'
        return 'BLOCKED'

    if risk_reward >= g.minimum_risk_reward:
        return 'MONITORING'
    return 'BLOCKED'


def build_signal_thesis(setup, context, status):
    support = format_price(context.get('support'))
    resistance = format_price(context.get('resistance'))
    setup_type = setup.get('setupType')

    if setup_type == 'WEAKNESS':
        return '跌破 {0} 后伴随放量，结构从积累或上升段切回风险释放，不应继续维持进攻仓位。'.format(support)
    if setup_type == 'UTAD':
        return '价格假突破 {0} 后收回箱体内，当前更像 UTAD，而不是有效上涨延续。'.format(resistance)
    if setup_type == 'SOS':
        return '放量突破 {0} 并站稳强势区，出现 SOS，允许把试仓推进到趋势仓位。'.format(resistance)
    if status == 'PILOT_ACTION' and setup_type == 'SPRING':
        return 'Spring 已出现并尝试收复 {0}，当前允许先用轻仓试仓验证承接是否继续改善。'.format(support)
    if status == 'PILOT_ACTION' and setup_type == 'ST':
        return '二次测试回到 {0} 附近且量能收缩，当前可先用试仓确认抛压是否真的衰竭。'.format(support)
    if setup_type == 'BUEC':
        return 'BUEC 后二次确认结构完整，回踩未跌回 {0} 下方，量能保持收缩。'.format(resistance)
    if setup_type == 'LPS':
        return '突破后回踩 {0} 一带，缩量守住强势区，满足 LPS 复核前置条件。'.format(resistance)
    if setup_type == 'SPRING':
        return 'Spring 已出现并尝试收复 {0}，当前重点是确认收复质量与承接延续。'.format(support)
    if setup_type == 'ST':
        return '二次测试回到 {0} 附近且量能收缩，说明抛压正在被重新验证。'.format(support)
    if setup_type == 'SC':
        return '卖压可能在 {0} 一带出现衰竭，但仍处于 Phase A 建底早期。'.format(support)
    if status == 'BLOCKED':
        return '结构仍在箱体内部，当前更像因果积累，不适合直接推进执行。'
    return '结构尚未进入 Phase D 执行段，继续观察支撑 {0} 与阻力 {1} 的演化。'.format(support, resistance)


def build_signal_next_check(setup, status, l2_confirmation):
    if setup.get('setupType') == 'WEAKNESS':
        return '优先保护已有仓位，观察是否继续跌破支撑并放量扩散。'
    if setup.get('setupType') == 'UTAD':
        return '确认假突破后是否继续回落到箱体下半区，再决定是否完全撤退。'
    if status == 'PILOT_ACTION' and setup.get('setupType') == 'SPRING':
        return '试仓后重点观察收回复位是否维持，以及后续是否升级成 SOS。'
    if status == 'PILOT_ACTION' and setup.get('setupType') == 'ST':
        return '试仓后重点观察测试低点是否守住，并等待自动反弹继续扩展。'
    if setup.get('setupType') == 'SOS':
        return '观察突破后的第一轮回踩是否守住阻力翻支撑，为后续 LPS/BUEC 做准备。'
    if setup.get('setupType') == 'BUEC':
        if g.enable_l2_confirmation and not l2_confirmation.get('available'):
            return '当前环境未提供 L2 盘口，保留结构观察，待真实盘口权限可用后再补确认。'
        if g.enable_l2_confirmation and not l2_confirmation.get('confirmed'):
            return '补做 L2 挂单承接确认，再决定是否推进到执行。'
        return '观察回踩后买盘是否继续延续，确认不跌回前高下方。'
    if setup.get('setupType') == 'LPS':
        return '继续跟踪回踩是否缩量并守住突破位。'
    if setup.get('setupType') == 'SPRING':
        return '确认收回支撑后的横住质量，并观察卖压是否继续衰减。'
    if setup.get('setupType') == 'ST':
        return '等待测试完成后的上冲质量，再判断是否升级到 Spring 或 SOS。'
    if status == 'BUILDING':
        return '等待自动反弹与二次测试，先确认 Phase A 是否完整。'
    return '继续观察箱体边界与量价关系，再决定是否升级阶段。'


def build_suggested_position_ratio(setup, confidence, status):
    setup_type = setup.get('setupType')
    effective_max_position_ratio = get_effective_max_position_ratio()

    if status == 'PILOT_ACTION':
        setup_scale = {
            'ST': g.pilot_position_scale,
            'SPRING': min(g.pilot_position_scale + 0.10, 0.60),
        }
    elif status == 'ACTION_REQUIRED':
        setup_scale = {
            'SOS': 0.80,
            'BUEC': 1.00,
            'LPS': 0.90,
            'SPRING': 0.55,
            'ST': 0.0,
            'RANGE': 0.0,
            'SC': 0.0,
            'UTAD': 0.0,
            'WEAKNESS': 0.0,
        }
    else:
        setup_scale = {}

    scale = setup_scale.get(setup_type, 0.0)
    ratio = effective_max_position_ratio * scale * (safe_float(confidence) / 100.0)
    return round(min(effective_max_position_ratio, ratio), 4)


def get_effective_max_position_ratio():
    base_ratio = clamp(safe_float(getattr(g, 'max_position_ratio', 0.0)), 0.0, 1.0)
    if not getattr(g, 'scale_position_cap_to_universe', False):
        return base_ratio

    reserve_ratio = clamp(safe_float(getattr(g, 'min_cash_reserve_ratio', 0.0)), 0.0, 0.95)
    deployable_ratio = max(0.0, 1.0 - reserve_ratio)
    active_symbols = extract_symbol_list(getattr(g, 'symbols', []))
    active_symbol_count = len(active_symbols) or 1
    scaled_ratio = deployable_ratio / float(active_symbol_count)
    return round(min(deployable_ratio, max(base_ratio, scaled_ratio)), 4)


def build_desired_amount(decision, position, reference_price):
    action = decision.get('action')
    current_amount = safe_int(position.get('amount'))

    if action == 'exit':
        return 0

    if action not in ['enter', 'add', 'trim']:
        return current_amount

    target_value = safe_float(decision.get('targetValue'))
    if target_value <= 0 or reference_price <= 0:
        return current_amount

    raw_target_amount = int(target_value / reference_price)
    target_amount = int(raw_target_amount / MIN_LOT_SIZE) * MIN_LOT_SIZE

    if action == 'trim' and current_amount > 0:
        if current_amount <= MIN_LOT_SIZE:
            return current_amount
        return max(min(current_amount, target_amount), MIN_LOT_SIZE)

    return max(target_amount, 0)


def build_l2_confirmation(symbol):
    result = {
        'enabled': bool(g.enable_l2_confirmation),
        'available': False,
        'confirmed': False,
        'topBid': normalize_level(None),
        'topAsk': normalize_level(None),
        'bidVolume': 0.0,
        'askVolume': 0.0,
        'imbalance': 0.0,
        'spreadPct': 0.0,
        'bidLevels': [],
        'askLevels': [],
        'tradeStream': build_trade_stream_confirmation(symbol),
        'error': '',
    }

    if not g.enable_l2_confirmation:
        return result

    if read_runtime_capability('snapshot') is False:
        result['error'] = 'snapshot_capability_unavailable'
        return result

    snapshot_payload = safe_runtime_call(
        ['get_snapshot'],
        symbol,
        capability_key='snapshot',
        disable_on_none=True,
    )
    if snapshot_payload is None:
        if read_runtime_capability('snapshot') is False:
            result['error'] = 'snapshot_capability_unavailable'
        else:
            result['error'] = 'snapshot_unavailable'
        return result

    snapshot = get_symbol_value(snapshot_payload, symbol)
    if not isinstance(snapshot, dict):
        result['error'] = 'snapshot_unavailable'
        return result

    bid_levels = normalize_order_book_levels(snapshot.get('bid_grp'))
    ask_levels = normalize_order_book_levels(snapshot.get('offer_grp'))
    top_bid = bid_levels[0] if bid_levels else normalize_level(None)
    top_ask = ask_levels[0] if ask_levels else normalize_level(None)
    bid_volume = sum_level_volume(bid_levels)
    ask_volume = sum_level_volume(ask_levels)
    imbalance = compute_imbalance(bid_volume, ask_volume)
    spread_pct = compute_spread_pct(top_bid, top_ask)

    result['available'] = bool(bid_levels or ask_levels)
    result['topBid'] = top_bid
    result['topAsk'] = top_ask
    result['bidLevels'] = bid_levels
    result['askLevels'] = ask_levels
    result['bidVolume'] = bid_volume
    result['askVolume'] = ask_volume
    result['imbalance'] = imbalance
    result['spreadPct'] = spread_pct
    result['confirmed'] = bool(
        result['available']
        and imbalance >= g.order_book_imbalance_threshold
        and (spread_pct <= 0 or spread_pct <= g.max_spread_pct)
    )
    return result


def build_trade_stream_confirmation(symbol):
    result = {
        'enabled': bool(g.enable_trade_stream_confirmation),
        'available': False,
        'confirmed': False,
        'buyVolume': 0.0,
        'sellVolume': 0.0,
        'unknownVolume': 0.0,
        'cvd': 0.0,
        'sampleSize': 0,
        'error': '',
    }

    if not g.enable_trade_stream_confirmation:
        return result

    if read_runtime_capability('trade_stream') is False:
        result['error'] = 'trade_stream_capability_unavailable'
        return result

    payload = safe_runtime_call(
        ['get_individual_transaction', 'get_individual_transcation'],
        symbol,
        capability_key='trade_stream',
        disable_on_none=True,
    )
    if payload is None:
        if read_runtime_capability('trade_stream') is False:
            result['error'] = 'trade_stream_capability_unavailable'
        else:
            result['error'] = 'trade_stream_unavailable'
        return result

    rows = extract_trade_rows(payload, symbol)
    result['sampleSize'] = len(rows)
    if not rows:
        result['error'] = 'trade_stream_empty'
        return result

    buy_volume = 0.0
    sell_volume = 0.0
    unknown_volume = 0.0
    for row in rows:
        volume = read_trade_volume(row)
        direction = read_trade_direction(row)
        if direction == 'buy':
            buy_volume += volume
        elif direction == 'sell':
            sell_volume += volume
        else:
            unknown_volume += volume

    cvd = buy_volume - sell_volume
    result['available'] = True
    result['buyVolume'] = buy_volume
    result['sellVolume'] = sell_volume
    result['unknownVolume'] = unknown_volume
    result['cvd'] = cvd
    result['confirmed'] = bool(buy_volume > sell_volume and cvd > 0)
    return result


def analyze_macro_context(history, benchmark_history):
    closes = history.get('close') or []
    highs = history.get('high') or closes
    benchmark_closes = benchmark_history.get('close') or []
    current_close = safe_float(last_value(closes))
    macro_ma = average_last(closes, g.macro_ma_window)
    background_high = max_last(highs, max(g.background_lookback, g.macro_ma_window))
    decline_from_high = 0.0
    if background_high and background_high > 0 and current_close > 0:
        decline_from_high = (background_high - current_close) / background_high

    stock_return = compute_window_return(closes, g.rs_lookback)
    benchmark_return = compute_window_return(benchmark_closes, g.rs_lookback)
    rs_score = compute_rs_score(stock_return, benchmark_return)
    beta = compute_beta(closes, benchmark_closes, g.beta_lookback)
    long_cycle_ready = bool(
        macro_ma
        and current_close > 0
        and (current_close <= macro_ma or decline_from_high >= g.background_decline_pct)
    )
    trend_cycle_ready = bool(
        macro_ma
        and current_close > 0
        and current_close >= macro_ma
    )
    rs_ready = bool(rs_score is not None and rs_score >= g.rs_threshold)
    beta_ready = bool(beta > 0 and beta <= g.max_beta)

    return {
        'benchmarkSymbol': g.benchmark_symbol,
        'macroMA': round_price(macro_ma),
        'declineFromHigh': round(safe_float(decline_from_high), 4),
        'longCycleReady': long_cycle_ready,
        'trendCycleReady': trend_cycle_ready,
        'stockReturn': round_nullable(stock_return, 4),
        'benchmarkReturn': round_nullable(benchmark_return, 4),
        'rsScore': round_nullable(rs_score, 4),
        'rsReady': rs_ready,
        'beta': round_nullable(beta, 4),
        'betaReady': beta_ready,
    }


def build_policy_pool_context(symbol):
    normalized_symbol = normalize_symbol(symbol)
    pool = g.policy_pool if isinstance(g.policy_pool, dict) else {}
    symbols = normalize_symbol_list(pool.get('symbols'))
    allowed = bool(not symbols or normalized_symbol in symbols)
    reason = 'policy_pool_allowed' if allowed else 'not_in_policy_pool'

    return {
        'allowed': allowed,
        'reason': reason,
        'source': pool.get('source', 'inline'),
        'symbols': symbols,
    }


def build_next_symbol_state(symbol, signal, decision, previous_state):
    previous_state = previous_state or {}
    effective_max_position_ratio = get_effective_max_position_ratio()
    phase = signal.get('phase')
    range_state = bool(phase in ['Phase B', 'Phase C'] and signal.get('support') and signal.get('resistance'))
    previous_pnf_count = safe_int(previous_state.get('pnfColumnCount'))
    pnf_count = previous_pnf_count + 1 if range_state else 0
    current_ratio = safe_float(decision.get('currentRatio'))
    managed_target_ratio = min(effective_max_position_ratio, safe_float(decision.get('managedTargetRatio')))
    runner_target_ratio = min(effective_max_position_ratio, safe_float(decision.get('runnerTargetRatio')))
    position_stage = previous_state.get('positionStage')
    if position_stage not in ['pilot', 'full']:
        position_stage = 'none'

    if decision.get('action') == 'exit' or (current_ratio <= 0 and managed_target_ratio <= 0):
        managed_target_ratio = 0.0
        runner_target_ratio = 0.0
        position_stage = 'none'
    elif managed_target_ratio > 0 and runner_target_ratio <= 0:
        runner_target_ratio = min(effective_max_position_ratio, managed_target_ratio * g.runner_position_fraction)

    if decision.get('action') == 'enter':
        position_stage = 'pilot' if signal.get('entryStage') == 'pilot' else 'full'
    elif decision.get('action') == 'add' and (
        str(decision.get('reason', '')).startswith('pilot_promoted')
        or signal.get('formalEntryReady')
        or signal.get('entryStage') == 'full'
    ):
        position_stage = 'full'
    elif managed_target_ratio > 0 and position_stage == 'none':
        position_stage = 'pilot' if signal.get('entryStage') == 'pilot' else 'full'

    return {
        'symbol': normalize_symbol(symbol),
        'phase': phase,
        'setupType': signal.get('setupType'),
        'status': signal.get('status'),
        'positionStage': position_stage,
        'support': signal.get('support'),
        'resistance': signal.get('resistance'),
        'pnfColumnCount': pnf_count,
        'lastAction': decision.get('action'),
        'lastReason': decision.get('reason'),
        'managedTargetRatio': round(managed_target_ratio, 4),
        'runnerTargetRatio': round(runner_target_ratio, 4),
    }


def read_symbol_state(symbol):
    state = g.strategy_state if isinstance(g.strategy_state, dict) else {}
    symbol_state = state.get(normalize_symbol(symbol))
    if isinstance(symbol_state, dict):
        return symbol_state
    return {}


def reconcile_state_memory(symbol, position):
    symbol_state = dict(read_symbol_state(symbol))
    if safe_int(position.get('amount')) > 0:
        return symbol_state

    symbol_state['positionStage'] = 'none'
    symbol_state['managedTargetRatio'] = 0.0
    symbol_state['runnerTargetRatio'] = 0.0
    return symbol_state


def write_symbol_state(symbol, symbol_state):
    if not isinstance(g.strategy_state, dict):
        g.strategy_state = {}
    g.strategy_state[normalize_symbol(symbol)] = symbol_state


def load_strategy_state():
    path = build_local_path(g.state_file)
    try:
        with open(path, 'rb') as handler:
            state = pickle.load(handler)
        if isinstance(state, dict):
            return state
    except Exception:
        return {}
    return {}


def persist_strategy_state():
    path = build_local_path(g.state_file)
    try:
        with open(path, 'wb') as handler:
            pickle.dump(g.strategy_state, handler)
    except Exception:
        return None
    return path


def prune_strategy_state(state, active_symbols):
    if not isinstance(state, dict):
        return {}

    symbols = extract_symbol_list(active_symbols)
    if not symbols:
        return state

    filtered_state = {}
    for symbol in symbols:
        normalized_symbol = normalize_symbol(symbol)
        symbol_state = state.get(normalized_symbol)
        if isinstance(symbol_state, dict):
            filtered_state[normalized_symbol] = symbol_state

    return filtered_state


def load_policy_pool():
    runtime_symbols = extract_symbol_list(g.symbols)
    if getattr(g, 'follow_runtime_symbols_for_policy_pool', True) and getattr(g, 'symbols_source', None) == 'runtime' and runtime_symbols:
        return {'source': 'runtime_symbols', 'symbols': runtime_symbols}

    fallback_symbols = extract_symbol_list(g.policy_symbol_pool)
    path = build_local_path(g.policy_pool_file)
    try:
        with open(path, 'r') as handler:
            payload = json.loads(handler.read())
    except Exception:
        return {'source': 'inline', 'symbols': fallback_symbols}

    if isinstance(payload, list):
        return {'source': path, 'symbols': extract_symbol_list(payload)}
    if isinstance(payload, dict):
        return {'source': path, 'symbols': extract_symbol_list(payload.get('symbols'))}
    return {'source': 'inline', 'symbols': fallback_symbols}


def get_benchmark_history():
    if not g.benchmark_symbol:
        return {'close': [], 'high': [], 'low': [], 'volume': []}
    return get_symbol_history(g.benchmark_symbol)


def normalize_order_book_levels(levels):
    result = []
    for level_no in range(1, 11):
        level = normalize_level(extract_level(levels, level_no))
        if safe_float(level.get('price')) > 0 or safe_float(level.get('volume')) > 0:
            result.append(level)
    return result


def sum_level_volume(levels):
    total = 0.0
    for level in levels:
        total += safe_float(level.get('volume'))
    return total


def compute_imbalance(bid_volume, ask_volume):
    total = safe_float(bid_volume) + safe_float(ask_volume)
    if total <= 0:
        return 0.0
    return round((safe_float(bid_volume) - safe_float(ask_volume)) / total, 4)


def compute_spread_pct(top_bid, top_ask):
    bid_price = safe_float(top_bid.get('price'))
    ask_price = safe_float(top_ask.get('price'))
    if bid_price <= 0 or ask_price <= 0:
        return 0.0
    mid_price = (bid_price + ask_price) / 2.0
    if mid_price <= 0:
        return 0.0
    return round((ask_price - bid_price) / mid_price, 4)


def read_runtime_capability(capability_key):
    capabilities = getattr(g, 'runtime_capabilities', None)
    if not isinstance(capabilities, dict):
        return None
    return capabilities.get(capability_key)


def write_runtime_capability(capability_key, available):
    if not isinstance(getattr(g, 'runtime_capabilities', None), dict):
        g.runtime_capabilities = {}
    g.runtime_capabilities[capability_key] = bool(available)


def is_unsupported_runtime_error(error):
    error_text = str(error).lower()
    for marker in ['不支持', 'unsupported', 'not support', 'not supported', '未实现', 'not available']:
        if marker in error_text:
            return True
    return False


def safe_runtime_call(function_names, *args, **kwargs):
    capability_key = kwargs.get('capability_key') or '|'.join(function_names)
    disable_on_none = bool(kwargs.get('disable_on_none'))
    capability_state = read_runtime_capability(capability_key)
    if capability_state is False:
        return None

    found_runtime_func = False
    for function_name in function_names:
        runtime_func = globals().get(function_name)
        if runtime_func is None:
            continue
        found_runtime_func = True
        try:
            payload = runtime_func(*args)
        except Exception as error:
            if is_unsupported_runtime_error(error):
                write_runtime_capability(capability_key, False)
                return None
            continue

        if payload is None:
            if disable_on_none and capability_state is None:
                write_runtime_capability(capability_key, False)
            return None

        write_runtime_capability(capability_key, True)
        return payload

    if not found_runtime_func and capability_state is None:
        write_runtime_capability(capability_key, False)
    return None


def extract_trade_rows(payload, symbol):
    symbol_payload = get_symbol_value(payload, symbol) if isinstance(payload, dict) else payload
    if symbol_payload is None:
        return []
    if hasattr(symbol_payload, 'to_dict'):
        try:
            records = symbol_payload.to_dict('records')
            if isinstance(records, list):
                return records
        except Exception:
            return []
    if isinstance(symbol_payload, list):
        return symbol_payload
    try:
        return list(symbol_payload)
    except Exception:
        return []


def read_trade_volume(row):
    value = read_first_value(row, ['volume', 'qty', 'amount', 'trade_volume', 'business_amount'])
    return max(safe_float(value), 0.0)


def read_trade_direction(row):
    value = read_first_value(row, ['side', 'bsflag', 'direction', 'tick_direction', 'trade_direction'])
    text = str(value).lower()
    if text in ['b', 'buy', 'active_buy', '1', '外盘', '买']:
        return 'buy'
    if text in ['s', 'sell', 'active_sell', '-1', '内盘', '卖']:
        return 'sell'
    return 'unknown'


def read_first_value(row, keys):
    for key in keys:
        value = read_object_value(row, key)
        if value is not None:
            return value
    return None


def compute_window_return(values, lookback):
    if not isinstance(values, list) or len(values) <= lookback:
        return None
    start_value = safe_float(values[-lookback - 1])
    end_value = safe_float(values[-1])
    if start_value <= 0 or end_value <= 0:
        return None
    return (end_value - start_value) / start_value


def compute_rs_score(stock_return, benchmark_return):
    if stock_return is None or benchmark_return is None:
        return None
    return stock_return - benchmark_return


def compute_beta(stock_closes, benchmark_closes, lookback):
    stock_returns = build_returns(slice_last(stock_closes, lookback + 1))
    benchmark_returns = build_returns(slice_last(benchmark_closes, lookback + 1))
    size = min(len(stock_returns), len(benchmark_returns))
    if size < 2:
        return 0.0
    stock_returns = stock_returns[-size:]
    benchmark_returns = benchmark_returns[-size:]
    stock_mean = sum(stock_returns) / float(size)
    benchmark_mean = sum(benchmark_returns) / float(size)
    covariance = 0.0
    variance = 0.0
    for index in range(size):
        stock_delta = stock_returns[index] - stock_mean
        benchmark_delta = benchmark_returns[index] - benchmark_mean
        covariance += stock_delta * benchmark_delta
        variance += benchmark_delta * benchmark_delta
    if variance <= 0:
        return 0.0
    return covariance / variance


def build_returns(values):
    result = []
    if not isinstance(values, list) or len(values) < 2:
        return result
    for index in range(1, len(values)):
        previous_value = safe_float(values[index - 1])
        current_value = safe_float(values[index])
        if previous_value > 0 and current_value > 0:
            result.append((current_value - previous_value) / previous_value)
    return result


def round_nullable(value, digits):
    if value is None:
        return None
    return round(safe_float(value), digits)


def build_session_report(context):
    return {
        'kind': 'ptrade-wyckoff-trade-report',
        'generatedAt': format_current_dt(context),
        'executionMode': g.execution_mode,
        'liveOrderArmed': bool(g.live_order_armed),
        'tradeName': safe_value(get_trade_name) if safe_call(is_trade) else None,
        'businessType': safe_value(get_business_type),
        'frequency': safe_value(get_frequency),
        'loginAccount': safe_call(get_user_name, True),
        'boundAccount': safe_call(get_user_name, False),
        'portfolio': {
            'cash': safe_portfolio_attr(context, 'cash'),
            'portfolioValue': safe_portfolio_attr(context, 'portfolio_value'),
        },
        'symbolUniverse': {
            'activeSymbols': g.symbols,
            'source': getattr(g, 'symbols_source', 'unknown'),
            'policyPoolSource': read_object_value(g.policy_pool, 'source', 'unknown'),
        },
        'symbols': g.latest_symbol_reports,
        'orders': serialize_orders(safe_call(get_orders)),
        'openOrders': serialize_orders(safe_call(get_open_orders)),
        'trades': serialize_trades(safe_call(get_trades)),
        'positions': serialize_positions(safe_call(get_positions, g.symbols)),
        'strategyState': g.strategy_state,
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
    return build_local_path(g.report_file)


def build_local_path(file_name):
    try:
        return get_research_path() + file_name
    except Exception:
        return file_name


def get_symbol_history(symbol):
    size = max(
        g.breakout_lookback,
        g.slow_ma_window,
        g.long_ma_window,
        g.volume_lookback,
        g.background_lookback,
        g.macro_ma_window,
        g.rs_lookback,
        g.beta_lookback,
        g.structure_lookback + g.base_exclusion_bars,
        g.breakout_confirmation_bars,
    ) + 2

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

    snapshot_payload = safe_runtime_call(
        ['get_snapshot'],
        symbol,
        capability_key='snapshot',
        disable_on_none=True,
    )
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


def slice_window_without_tail(values, window_size, exclude_tail):
    if not isinstance(values, list) or not values or window_size <= 0:
        return []

    if exclude_tail <= 0:
        return slice_last(values, window_size)

    end_index = len(values) - exclude_tail
    if end_index <= 0:
        return []

    start_index = max(0, end_index - window_size)
    return values[start_index:end_index]


def slice_without_tail(values, exclude_tail):
    if not isinstance(values, list) or not values:
        return []
    if exclude_tail <= 0:
        return values[:]
    end_index = len(values) - exclude_tail
    if end_index <= 0:
        return []
    return values[:end_index]


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
    normalized_symbol = normalize_symbol(symbol)
    candidates = [normalized_symbol]

    if normalized_symbol.endswith('.XSHG'):
        base = normalized_symbol.replace('.XSHG', '')
        candidates.append(base + '.SS')
        candidates.append(base + '.SH')
    elif normalized_symbol.endswith('.XSHE'):
        base = normalized_symbol.replace('.XSHE', '')
        candidates.append(base + '.SZ')

    if normalized_symbol.endswith('.SS'):
        candidates.append(normalized_symbol.replace('.SS', '.XSHG'))
        candidates.append(normalized_symbol.replace('.SS', '.SH'))
    elif normalized_symbol.endswith('.SH'):
        candidates.append(normalized_symbol.replace('.SH', '.XSHG'))
        candidates.append(normalized_symbol.replace('.SH', '.SS'))

    if normalized_symbol.endswith('.SZ'):
        candidates.append(normalized_symbol.replace('.SZ', '.XSHE'))

    deduped_candidates = []
    for candidate in candidates:
        if candidate not in deduped_candidates:
            deduped_candidates.append(candidate)

    return deduped_candidates


def normalize_symbol_list(symbols):
    if isinstance(symbols, str):
        symbols = split_symbol_value(symbols)

    if isinstance(symbols, tuple) or isinstance(symbols, set):
        symbols = list(symbols)

    if not isinstance(symbols, list):
        return []

    normalized_symbols = []
    for symbol in symbols:
        candidates = split_symbol_value(symbol) if isinstance(symbol, str) else [symbol]
        for candidate in candidates:
            normalized_symbol = normalize_symbol(candidate)
            if normalized_symbol and normalized_symbol not in normalized_symbols:
                normalized_symbols.append(normalized_symbol)

    return normalized_symbols


def extract_symbol_list(symbols):
    normalized_symbols = normalize_symbol_list(symbols)
    return [symbol for symbol in normalized_symbols if is_symbol_like(symbol)]


def split_symbol_value(value):
    if not isinstance(value, str):
        return []

    normalized_value = value.replace(';', ',').replace('\n', ',').replace('\t', ',').strip()
    if not normalized_value:
        return []

    if ',' in normalized_value:
        parts = normalized_value.split(',')
    else:
        parts = normalized_value.split()

    return [part.strip() for part in parts if part and part.strip()]


def normalize_symbol(symbol):
    if not isinstance(symbol, str):
        return symbol

    normalized_symbol = symbol.strip().upper()
    if normalized_symbol.isdigit() and len(normalized_symbol) == 6:
        if normalized_symbol.startswith('6'):
            return normalized_symbol + '.XSHG'
        if normalized_symbol.startswith('0') or normalized_symbol.startswith('2') or normalized_symbol.startswith('3'):
            return normalized_symbol + '.XSHE'
    if normalized_symbol.endswith('.SH'):
        return normalized_symbol.replace('.SH', '.XSHG')
    if normalized_symbol.endswith('.SS'):
        return normalized_symbol.replace('.SS', '.XSHG')
    if normalized_symbol.endswith('.SZ'):
        return normalized_symbol.replace('.SZ', '.XSHE')

    return normalized_symbol


def is_symbol_like(value):
    if not isinstance(value, str):
        return False

    normalized_value = value.strip().upper()
    if not normalized_value:
        return False
    if normalized_value.isdigit() and len(normalized_value) == 6:
        return True

    valid_suffixes = ['.XSHG', '.XSHE', '.SH', '.SS', '.SZ']
    for suffix in valid_suffixes:
        if normalized_value.endswith(suffix):
            base = normalized_value[:-len(suffix)]
            return base.isdigit() and len(base) == 6

    return False


def extract_level(levels, level_no):
    if isinstance(levels, list):
        index = level_no - 1
        if index >= 0 and index < len(levels):
            return levels[index]
        return None

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


def iter_object_items(obj):
    if obj is None:
        return []
    if isinstance(obj, dict):
        return list(obj.items())

    try:
        return list(vars(obj).items())
    except Exception:
        return []


def has_any_token(text, tokens):
    for token in tokens or []:
        if token in text:
            return True
    return False


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


def clamp(value, min_value, max_value):
    return max(min_value, min(max_value, value))


def round_price(value):
    number = safe_float(value)
    if number <= 0:
        return 0.0
    return round(number, 2)


def format_price(value):
    number = safe_float(value)
    if number <= 0:
        return '0.00'
    return '{0:.2f}'.format(number)


def format_current_dt(context):
    try:
        return str(context.blotter.current_dt)
    except Exception:
        return ''