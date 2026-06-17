import { resolve } from 'node:path'
import { readJson, loadFixtures, writeJsonReport, reportsDir } from './lib/io.mjs'
import { buildEvidence } from './lib/wyckoff.mjs'
import { evaluateContract, baselineContract, summarizeOutcomes } from './lib/outcome.mjs'

async function main() {
  const classificationReport = await readJson(resolve(reportsDir, 'classification-last.json'))
  const classifications = new Map(
    (classificationReport.classifications || []).map((c) => [c.id, c]),
  )
  const fixtures = await loadFixtures()

  const gatedRecords = []
  const baselineRecords = []
  const perWindow = []

  for (const fixture of fixtures) {
    const item = buildEvidence(fixture)
    const heldOut = Array.isArray(fixture.heldOut) ? fixture.heldOut : []
    const classification = classifications.get(fixture.id)
    const label = classification?.label || 'insufficient_evidence'

    // Evidence-gated: only score the pre-committed contract of spring_candidate.
    let gated = { outcome: 'not_a_candidate', bars: 0 }
    if (label === 'spring_candidate' && classification?.contract) {
      gated = evaluateContract(classification.contract, heldOut)
      gatedRecords.push({ id: fixture.id, ...gated })
    }

    // Baseline: score the naive contract on every window.
    const naive = baselineContract(item)
    const baseline = evaluateContract(naive, heldOut)
    baselineRecords.push({ id: fixture.id, ...baseline })

    perWindow.push({
      id: fixture.id,
      label,
      heldOutBars: heldOut.length,
      gatedOutcome: gated.outcome,
      baselineOutcome: baseline.outcome,
      contract: classification?.contract || null,
      baselineContract: naive,
    })
  }

  const gatedSummary = summarizeOutcomes(gatedRecords)
  const baselineSummary = summarizeOutcomes(baselineRecords)
  const report = {
    reportType: 'miniqmt_wyckoff_outcome',
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    note: 'Held-out falsification scoring. Evidence-gated candidates vs dumb baseline. No trade actions.',
    gated: gatedSummary,
    baseline: baselineSummary,
    edgeOverBaseline:
      gatedSummary.hitRateOfDecided !== null && baselineSummary.hitRateOfDecided !== null
        ? Number((gatedSummary.hitRateOfDecided - baselineSummary.hitRateOfDecided).toFixed(3))
        : null,
    windows: perWindow,
  }
  const reportPath = resolve(reportsDir, 'outcome-last.json')
  await writeJsonReport(reportPath, report)

  console.log(`Gated candidates scored: ${gatedSummary.total} (hits: ${gatedSummary.targetHit}, invalidated: ${gatedSummary.invalidated})`)
  console.log(`Gated hit-rate of decided: ${gatedSummary.hitRateOfDecided}`)
  console.log(`Baseline hit-rate of decided: ${baselineSummary.hitRateOfDecided}`)
  console.log(`Edge over baseline: ${report.edgeOverBaseline}`)
  console.log(`Wrote ${reportPath}`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
