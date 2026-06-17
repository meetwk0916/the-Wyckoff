// Conservative A-share Wyckoff classifier. Mirrors the crypto Phase C
// discipline: emits labels + reasons + a pre-committed falsification contract,
// never a trade action. A spring_candidate REQUIRES full-sensor (L2) input;
// missing L2 must degrade to insufficient_evidence, never be faked as confirmed.

export const LABELS = ['spring_candidate', 'upthrust_risk', 'reaction_failure', 'insufficient_evidence']

export function classifyWindow(item) {
  const reasons = []
  const warnings = []
  const ev = item.evidence
  const s = ev.structure
  const params = item.params

  if (!item.readiness.inputsReady) {
    return baseResult(item, 'insufficient_evidence', ['missing_inputs'], warnings, null, 0.2)
  }

  if (s.failedBreakout) {
    reasons.push('failed_breakout_above_resistance')
    if (s.closePosition < params.utadCloseThreshold) {
      reasons.push('weak_close_in_range')
    }
    return baseResult(item, 'upthrust_risk', reasons, warnings, null, 0.55)
  }

  if (s.springConfirmed) {
    const supportive = ev.background.accumulationContext && ev.relativeStrength.rsOk && ev.relativeStrength.betaOk && ev.macro.macroOk
    const microOk = item.readiness.fullSensorReady && ev.microstructure.bookRecovered && ev.microstructure.cvdSupport

    if (!ev.background.accumulationContext) reasons.push('background_not_accumulative')
    if (!ev.relativeStrength.rsOk) reasons.push('relative_strength_weak')
    if (!ev.relativeStrength.betaOk) reasons.push('beta_too_high')
    if (!ev.macro.macroOk) reasons.push('macro_filter_failed')

    if (!item.readiness.fullSensorReady) {
      reasons.push('micro_unconfirmed_no_l2')
      warnings.push('l2_or_transactions_missing')
      return baseResult(item, 'insufficient_evidence', reasons, warnings, null, 0.3)
    }
    if (!ev.microstructure.bookRecovered) reasons.push('order_book_not_recovered')
    if (!ev.microstructure.cvdSupport) reasons.push('cvd_not_supportive')

    if (supportive && microOk) {
      const contract = buildContract(item, params)
      return baseResult(
        item,
        'spring_candidate',
        ['spring_penetration_and_reclaim', 'structure_support_reclaimed', 'micro_confirmed', 'macro_and_rs_ok'],
        warnings,
        contract,
        estimateConfidence(item),
      )
    }
    reasons.unshift('spring_not_fully_confirmed')
    return baseResult(item, 'reaction_failure', reasons, warnings, null, 0.45)
  }

  if (s.brokeSupport && !s.reclaimedSupport) {
    reasons.push('support_broken_no_reclaim')
    return baseResult(item, 'reaction_failure', reasons, warnings, null, 0.5)
  }

  reasons.push('no_decisive_structure')
  return baseResult(item, 'insufficient_evidence', reasons, warnings, null, 0.25)
}

function buildContract(item, params) {
  const s = item.evidence.structure
  const stop = s.anchorLow
  const entryRef = s.anchorClose
  const range = s.resistance - s.support
  const target = entryRef + Math.max(range, 0) * params.targetExtensionRatio
  return {
    type: 'forward_falsification',
    note: 'Pre-committed at decision time. Evaluated only on held-out bars by runOutcome.',
    entryRef,
    stop,
    target,
    invalidationBars: params.invalidationBars,
    invalidationRule: 'close_below_stop_within_invalidation_bars',
    targetRule: 'high_reaches_target_before_invalidation',
  }
}

function estimateConfidence(item) {
  const ev = item.evidence
  let score = 0.6
  if (ev.background.declinePct >= ev.params?.backgroundDeclinePct) score += 0.05
  if (ev.relativeStrength.rs > 0) score += 0.05
  if (ev.microstructure.lastCvd > 0) score += 0.05
  if (ev.microstructure.lastImbalance > 0) score += 0.05
  return Math.min(0.85, Number(score.toFixed(2)))
}

function baseResult(item, label, reasons, warnings, contract, confidence) {
  return {
    id: item.id,
    symbol: item.symbol,
    description: item.description,
    filters: item.filters,
    label,
    confidence,
    reasons,
    warnings,
    contract,
    guardrails: {
      emitsTradeAction: false,
      requiresHumanReview: true,
      nextAllowedStage: label === 'spring_candidate' ? 'manual_structure_review' : 'collect_more_evidence',
    },
  }
}
