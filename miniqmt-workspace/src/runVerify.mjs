import { resolve } from 'node:path'
import { readJson, reportsDir } from './lib/io.mjs'

// Pinned expectations. These freeze the deterministic behavior of the seed
// fixtures so signal-rule drift is caught early (same discipline as the crypto
// Phase C verify gate).
const expectedLabels = {
  'ashare-spring-reclaim-600570': 'spring_candidate',
  'ashare-reaction-failure-000001': 'reaction_failure',
  'ashare-no-l2-600570': 'insufficient_evidence',
}
const expectedGatedOutcome = {
  'ashare-spring-reclaim-600570': 'target_hit',
}
const expectedBaselineOutcome = {
  'ashare-reaction-failure-000001': 'invalidated',
}

async function main() {
  const classification = await readJson(resolve(reportsDir, 'classification-last.json'))
  const outcome = await readJson(resolve(reportsDir, 'outcome-last.json'))
  const failures = []

  const byId = new Map((classification.classifications || []).map((c) => [c.id, c]))
  for (const [id, label] of Object.entries(expectedLabels)) {
    const got = byId.get(id)
    if (!got) {
      failures.push(`Missing classification for ${id}`)
    } else if (got.label !== label) {
      failures.push(`Expected ${id} label ${label}, got ${got.label}`)
    }
  }

  if ((classification.totals?.spring_candidate || 0) !== 1) {
    failures.push(`Expected exactly 1 spring_candidate, got ${classification.totals?.spring_candidate}`)
  }

  // Hard rule: a candidate must always carry a pre-committed falsification contract.
  for (const c of classification.classifications || []) {
    if (c.label === 'spring_candidate' && !c.contract) {
      failures.push(`spring_candidate ${c.id} is missing a forward_falsification contract`)
    }
    if (c.guardrails?.emitsTradeAction !== false) {
      failures.push(`${c.id} must not emit a trade action`)
    }
  }

  const outcomeById = new Map((outcome.windows || []).map((w) => [w.id, w]))
  for (const [id, expected] of Object.entries(expectedGatedOutcome)) {
    const got = outcomeById.get(id)
    if (!got || got.gatedOutcome !== expected) {
      failures.push(`Expected ${id} gated outcome ${expected}, got ${got?.gatedOutcome}`)
    }
  }
  for (const [id, expected] of Object.entries(expectedBaselineOutcome)) {
    const got = outcomeById.get(id)
    if (!got || got.baselineOutcome !== expected) {
      failures.push(`Expected ${id} baseline outcome ${expected}, got ${got?.baselineOutcome}`)
    }
  }

  // The whole point of the baseline: the evidence gate must not do worse than
  // the dumb baseline on the pinned set.
  if (
    outcome.gated?.hitRateOfDecided !== null &&
    outcome.baseline?.hitRateOfDecided !== null &&
    outcome.gated?.hitRateOfDecided < outcome.baseline?.hitRateOfDecided
  ) {
    failures.push(
      `Evidence gate hit-rate ${outcome.gated.hitRateOfDecided} is below baseline ${outcome.baseline.hitRateOfDecided}`,
    )
  }

  printSummary(classification, outcome)

  if (failures.length > 0) {
    console.error('MiniQMT verification failed:')
    for (const failure of failures) {
      console.error(`- ${failure}`)
    }
    process.exit(1)
  }
  console.log('MiniQMT verification passed.')
}

function printSummary(classification, outcome) {
  console.log(`Windows: ${classification.totals?.windows}`)
  console.log(`  spring_candidate: ${classification.totals?.spring_candidate}`)
  console.log(`  upthrust_risk: ${classification.totals?.upthrust_risk}`)
  console.log(`  reaction_failure: ${classification.totals?.reaction_failure}`)
  console.log(`  insufficient_evidence: ${classification.totals?.insufficient_evidence}`)
  console.log(`Gated hit-rate: ${outcome.gated?.hitRateOfDecided}  Baseline hit-rate: ${outcome.baseline?.hitRateOfDecided}  Edge: ${outcome.edgeOverBaseline}`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
