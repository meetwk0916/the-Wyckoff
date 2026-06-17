import { resolve } from 'node:path'
import { loadFixtures, writeJsonReport, reportsDir } from './lib/io.mjs'
import { buildEvidence } from './lib/wyckoff.mjs'

async function main() {
  const fixtures = await loadFixtures()
  const windows = fixtures.map((fixture) => buildEvidence(fixture))
  const report = {
    reportType: 'miniqmt_wyckoff_evidence',
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    note: 'Evidence only. This report does not emit entries, exits, sizing, or trade actions.',
    totals: {
      windows: windows.length,
      inputsReady: windows.filter((w) => w.readiness.inputsReady).length,
      fullSensorReady: windows.filter((w) => w.readiness.fullSensorReady).length,
    },
    windows,
  }
  const reportPath = resolve(reportsDir, 'evidence-last.json')
  await writeJsonReport(reportPath, report)
  console.log(`Evidence windows: ${report.totals.windows}`)
  console.log(`Inputs ready: ${report.totals.inputsReady}`)
  console.log(`Full sensor (L2) ready: ${report.totals.fullSensorReady}`)
  console.log(`Wrote ${reportPath}`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
