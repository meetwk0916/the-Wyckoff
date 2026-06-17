// Held-out outcome evaluation. This is the falsification engine recommended in
// the methodology review: a contract frozen at decision time is scored ONLY on
// bars that come after the decision (fixture.heldOut). A dumb baseline ("buy any
// reclaim") is scored on the same held-out bars so we can tell whether the
// evidence chain adds anything over naive complexity.

import { num } from './wyckoff.mjs'

export function evaluateContract(contract, heldOut) {
  if (!contract || !Array.isArray(heldOut) || heldOut.length === 0) {
    return { outcome: 'no_data', bars: 0 }
  }
  const horizon = contract.invalidationBars && contract.invalidationBars > 0 ? contract.invalidationBars : heldOut.length
  const limit = Math.min(horizon, heldOut.length)
  for (let i = 0; i < limit; i += 1) {
    const bar = heldOut[i]
    const closeBelowStop = num(bar.c) < contract.stop
    const reachedTarget = num(bar.h) >= contract.target
    if (closeBelowStop) {
      return { outcome: 'invalidated', bars: i + 1 }
    }
    if (reachedTarget) {
      return { outcome: 'target_hit', bars: i + 1 }
    }
  }
  return { outcome: 'open', bars: limit }
}

// Naive baseline contract: enter at the anchor close, stop at the anchor low,
// same target geometry, no evidence gating at all.
export function baselineContract(item) {
  const s = item.evidence?.structure
  if (!s || !Number.isFinite(s.anchorClose)) {
    return null
  }
  const range = (s.resistance || 0) - (s.support || 0)
  const ratio = item.params?.targetExtensionRatio ?? 1.0
  return {
    type: 'baseline_naive_reclaim',
    entryRef: s.anchorClose,
    stop: s.anchorLow,
    target: s.anchorClose + Math.max(range, 0) * ratio,
    invalidationBars: item.params?.invalidationBars ?? 5,
  }
}

export function summarizeOutcomes(records) {
  const decided = records.filter((r) => r.outcome === 'target_hit' || r.outcome === 'invalidated')
  const hits = records.filter((r) => r.outcome === 'target_hit').length
  return {
    total: records.length,
    targetHit: hits,
    invalidated: records.filter((r) => r.outcome === 'invalidated').length,
    open: records.filter((r) => r.outcome === 'open').length,
    noData: records.filter((r) => r.outcome === 'no_data').length,
    decided: decided.length,
    hitRateOfDecided: decided.length > 0 ? Number((hits / decided.length).toFixed(3)) : null,
  }
}
