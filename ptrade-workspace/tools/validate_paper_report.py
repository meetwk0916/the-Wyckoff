#!/usr/bin/env python3
import argparse
import json
import sys


def main():
    args = parse_args()
    report = load_json(args.report)
    errors = []
    warnings = []

    check_required_top_level(report, errors)
    check_execution_mode(report, errors, warnings)
    check_symbol_reports(report, errors, warnings)
    check_account_audit(report, errors, warnings)
    check_reconciliation(report, errors, warnings)
    check_strategy_state(report, warnings)

    print_result(args.report, errors, warnings)
    return 1 if errors else 0


def parse_args():
    parser = argparse.ArgumentParser(
        description='Validate ptrade Wyckoff paper trading report consistency.'
    )
    parser.add_argument(
        '--report',
        required=True,
        help='Path to ptrade-wyckoff-trade-report-last.json.',
    )
    return parser.parse_args()


def load_json(path):
    try:
        with open(path, 'r') as handle:
            return json.loads(handle.read())
    except Exception as error:
        print('ERROR: failed to read report: {0}'.format(error))
        sys.exit(1)


def check_required_top_level(report, errors):
    required_keys = [
        'kind',
        'generatedAt',
        'executionMode',
        'liveOrderArmed',
        'symbolUniverse',
        'symbols',
        'orders',
        'openOrders',
        'trades',
        'positions',
        'orderResponseEvents',
        'tradeResponseEvents',
        'accountAudit',
        'executionReconciliation',
        'strategyState',
    ]
    for key in required_keys:
        if key not in report:
            errors.append('missing top-level field: {0}'.format(key))

    if report.get('kind') != 'ptrade-wyckoff-trade-report':
        errors.append('unexpected report kind: {0}'.format(report.get('kind')))


def check_execution_mode(report, errors, warnings):
    if report.get('executionMode') != 'paper':
        errors.append('executionMode must be paper, got: {0}'.format(report.get('executionMode')))
    if report.get('liveOrderArmed') is True:
        errors.append('liveOrderArmed must stay false during paper acceptance')

    active_symbols = nested(report, ['symbolUniverse', 'activeSymbols'], [])
    if not isinstance(active_symbols, list) or not active_symbols:
        warnings.append('symbolUniverse.activeSymbols is empty or not a list')


def check_symbol_reports(report, errors, warnings):
    symbols = report.get('symbols')
    if not isinstance(symbols, list):
        errors.append('symbols must be a list')
        return
    if not symbols:
        warnings.append('symbols report list is empty')
        return

    for index, symbol_report in enumerate(symbols):
        label = 'symbols[{0}]'.format(index)
        if not isinstance(symbol_report, dict):
            errors.append('{0} must be an object'.format(label))
            continue

        for key in ['symbol', 'signal', 'position', 'decision', 'execution']:
            if key not in symbol_report:
                errors.append('{0} missing {1}'.format(label, key))

        execution = symbol_report.get('execution')
        if isinstance(execution, dict):
            status = execution.get('status')
            if not status:
                warnings.append('{0}.execution.status is empty'.format(label))
            if status == 'submitted' and not execution.get('orderId'):
                errors.append('{0}.execution submitted without orderId'.format(label))
            if status == 'recovering' and not execution.get('recovery'):
                warnings.append('{0}.execution recovering without recovery details'.format(label))

        signal = symbol_report.get('signal')
        if isinstance(signal, dict):
            for key in ['phase', 'setupType', 'status', 'systemReady']:
                if key not in signal:
                    warnings.append('{0}.signal missing {1}'.format(label, key))


def check_account_audit(report, errors, warnings):
    audit = report.get('accountAudit')
    if not isinstance(audit, dict):
        errors.append('accountAudit must be an object')
        return

    if audit.get('enabled') is False:
        warnings.append('accountAudit is disabled')
        return

    all_orders = audit.get('allOrders')
    all_positions = audit.get('allPositions')
    unmatched = audit.get('unmatchedAccountOrders')
    unmanaged = audit.get('unmanagedPositions')

    if audit.get('allOrdersAvailable') is False:
        warnings.append('get_all_orders unavailable: {0}'.format(audit.get('allOrdersError')))
    elif not isinstance(all_orders, list):
        errors.append('accountAudit.allOrders must be a list when available')

    if audit.get('allPositionsAvailable') is False:
        warnings.append('get_all_positions unavailable: {0}'.format(audit.get('allPositionsError')))
    elif not isinstance(all_positions, list):
        errors.append('accountAudit.allPositions must be a list when available')

    if unmatched is not None and not isinstance(unmatched, list):
        errors.append('accountAudit.unmatchedAccountOrders must be a list')
    if unmanaged is not None and not isinstance(unmanaged, list):
        errors.append('accountAudit.unmanagedPositions must be a list')

    if isinstance(unmatched, list) and unmatched:
        warnings.append('unmatched account orders found: {0}'.format(len(unmatched)))
    if isinstance(unmanaged, list) and unmanaged:
        warnings.append('unmanaged positions found: {0}'.format(len(unmanaged)))


def check_reconciliation(report, errors, warnings):
    reconciliation = report.get('executionReconciliation')
    if not isinstance(reconciliation, dict):
        errors.append('executionReconciliation must be an object')
        return

    order_events = report.get('orderResponseEvents')
    trade_events = report.get('tradeResponseEvents')
    if not isinstance(order_events, list):
        errors.append('orderResponseEvents must be a list')
        order_events = []
    if not isinstance(trade_events, list):
        errors.append('tradeResponseEvents must be a list')
        trade_events = []

    if reconciliation.get('orderResponseEventCount') != len(order_events):
        errors.append('order response event count mismatch')
    if reconciliation.get('tradeResponseEventCount') != len(trade_events):
        errors.append('trade response event count mismatch')

    unmatched_count = reconciliation.get('unmatchedAccountOrderCount')
    unmatched = nested(report, ['accountAudit', 'unmatchedAccountOrders'], [])
    if isinstance(unmatched, list) and unmatched_count != len(unmatched):
        errors.append('unmatched account order count mismatch')

    unmanaged_count = reconciliation.get('unmanagedPositionCount')
    unmanaged = nested(report, ['accountAudit', 'unmanagedPositions'], [])
    if isinstance(unmanaged, list) and unmanaged_count != len(unmanaged):
        errors.append('unmanaged position count mismatch')

    if not order_events and not trade_events:
        warnings.append('no order/trade response events recorded; confirm whether there were no paper orders')


def check_strategy_state(report, warnings):
    state = report.get('strategyState')
    if not isinstance(state, dict):
        warnings.append('strategyState is not an object')
        return

    active_symbols = nested(report, ['symbolUniverse', 'activeSymbols'], [])
    if not isinstance(active_symbols, list):
        return

    for symbol in active_symbols:
        if symbol not in state:
            warnings.append('active symbol missing strategyState: {0}'.format(symbol))


def nested(payload, keys, default=None):
    current = payload
    for key in keys:
        if not isinstance(current, dict):
            return default
        current = current.get(key)
    return default if current is None else current


def print_result(path, errors, warnings):
    print('ptrade paper report check: {0}'.format(path))
    for item in errors:
        print('ERROR: {0}'.format(item))
    for item in warnings:
        print('WARNING: {0}'.format(item))

    if errors:
        print('Result: failed ({0} errors, {1} warnings)'.format(len(errors), len(warnings)))
    else:
        print('Result: passed ({0} warnings)'.format(len(warnings)))


if __name__ == '__main__':
    sys.exit(main())
