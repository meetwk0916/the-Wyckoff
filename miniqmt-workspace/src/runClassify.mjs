import { resolve } from 'node:path'
import { readJson, writeJsonReport, reportsDir } from './lib/io.mjs'
import { classifyWindow, LABELS } from './lib/classify.mjs'

async function main() {
  const evidencePath = resolve(reportsDir, 'evidence-last.json')
  const evidenceReport = await readJson(evidencePath)
  const windows = Array.isArray(evidenceReport.windows) ? evidenceReport.windows : []
  const classifications = windows.map((window) => classifyWindow(window))

  const totals = { windows: classifications.length }
  for (const label of LABELS) {
    totals[label] = classifications.filter((c) => c.label === label).length
  }

  const report = {
    reportType: 'miniqmt_wyckoff_classification',
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    rules: {
      labels: LABELS,
      note: 'Classification only. No entries, exits, sizing, or trade actions. spring_candidate requires full-sensor (L2) input.',
    },
    totals,
    classifications,
  }
  const reportPath = resolve(reportsDir, 'classification-last.json')
  await writeJsonReport(reportPath, report)

  console.log(`Classified windows: ${totals.windows}`)
  for (const label of LABELS) {
    console.log(`  ${label}: ${totals[label]}`)
  }
  console.log(`Wrote ${reportPath}`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
