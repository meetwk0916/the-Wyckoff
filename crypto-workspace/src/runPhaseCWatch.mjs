import { execFile } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const workspaceDir = dirname(dirname(fileURLToPath(import.meta.url)))
const defaultDailyReportPath = resolve(workspaceDir, 'reports/daily-capture-check-last.json')
const defaultCandidateReportPath = resolve(workspaceDir, 'reports/phase-c-candidates-last.json')
const defaultUnreviewedReportPath = resolve(workspaceDir, 'reports/phase-c-unreviewed-candidates-last.json')
const defaultReviewNextReportPath = resolve(workspaceDir, 'reports/phase-c-review-next-last.json')
const defaultReportPath = resolve(workspaceDir, 'reports/phase-c-watch-last.json')

async function main() {
  const options = parseArgs(process.argv.slice(2))

  await runScript('runDailyCaptureCheck.mjs', [
    `--report=${options.dailyReportPath}`,
    `--candidates-report=${options.candidateReportPath}`,
  ])
  await runScript('runPhaseCUnreviewedCandidates.mjs', [
    `--candidates=${options.candidateReportPath}`,
    `--report=${options.unreviewedReportPath}`,
  ])
  await runScript('runPhaseCReviewNext.mjs', [
    '--no-refresh',
    `--candidates=${options.candidateReportPath}`,
    `--unreviewed=${options.unreviewedReportPath}`,
    `--report=${options.reviewNextReportPath}`,
  ])

  const [daily, candidates, unreviewed, reviewNext] = await Promise.all([
    readJson(options.dailyReportPath),
    readJson(options.candidateReportPath),
    readJson(options.unreviewedReportPath),
    readJson(options.reviewNextReportPath),
  ])
  const report = buildWatchReport(daily, candidates, unreviewed, reviewNext, options)

  await mkdir(dirname(options.reportPath), { recursive: true })
  await writeFile(options.reportPath, `${JSON.stringify(report, null, 2)}\n`)
  printSummary(report, options.reportPath)
}

function parseArgs(args) {
  const options = {
    dailyReportPath: defaultDailyReportPath,
    candidateReportPath: defaultCandidateReportPath,
    unreviewedReportPath: defaultUnreviewedReportPath,
    reviewNextReportPath: defaultReviewNextReportPath,
    reportPath: defaultReportPath,
  }

  for (const arg of args) {
    if (arg.startsWith('--daily-report=')) {
      options.dailyReportPath = resolve(arg.slice('--daily-report='.length))
    } else if (arg.startsWith('--candidates-report=')) {
      options.candidateReportPath = resolve(arg.slice('--candidates-report='.length))
    } else if (arg.startsWith('--unreviewed-report=')) {
      options.unreviewedReportPath = resolve(arg.slice('--unreviewed-report='.length))
    } else if (arg.startsWith('--review-next-report=')) {
      options.reviewNextReportPath = resolve(arg.slice('--review-next-report='.length))
    } else if (arg.startsWith('--report=')) {
      options.reportPath = resolve(arg.slice('--report='.length))
    } else if (arg === '--help' || arg === '-h') {
      printHelp()
      process.exit(0)
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }

  return options
}

async function runScript(scriptName, args) {
  const scriptPath = resolve(workspaceDir, 'src', scriptName)
  try {
    await execFileAsync(process.execPath, [scriptPath, ...args], {
      cwd: dirname(workspaceDir),
      maxBuffer: 30 * 1024 * 1024,
    })
  } catch (error) {
    const output = `${error.stdout || ''}${error.stderr || ''}`.trim()
    throw new Error(output || `Failed to run ${scriptName}`)
  }
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'))
}

function buildWatchReport(daily, candidateReport, unreviewedReport, reviewNextReport, options) {
  const sourceIssues = daily.attention?.sourceIssues || []
  const candidates = [...(unreviewedReport.reviewed || []), ...(unreviewedReport.unreviewed || [])]
  const bestLong = pickBestLongCandidate(candidates)
  const unreviewed = unreviewedReport.unreviewed || []
  const sourceSummary = summarizeSources(daily.sourceHealth || [])
  const nextAction = chooseNextAction(sourceIssues, unreviewed, bestLong, reviewNextReport)

  return {
    reportType: 'crypto_phase_c_watch',
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    reports: {
      daily: options.dailyReportPath,
      candidates: options.candidateReportPath,
      unreviewed: options.unreviewedReportPath,
      reviewNext: options.reviewNextReportPath,
      watch: options.reportPath,
    },
    sourceSummary,
    candidateSummary: {
      btcLiquidationEvents: candidateReport.totals?.btcLiquidationEvents || 0,
      liquidationClusters: candidateReport.totals?.liquidationClusters || 0,
      candidates: candidateReport.totals?.candidates || 0,
      longLiquidation: candidateReport.totals?.longLiquidationCandidates || 0,
      shortLiquidation: candidateReport.totals?.shortLiquidationCandidates || 0,
      fullSensorReady: candidateReport.totals?.fullSensorReadyCandidates || 0,
      unreviewed: unreviewedReport.totals?.unreviewed || 0,
      unreviewedLongLiquidation: unreviewedReport.totals?.unreviewedLongLiquidation || 0,
      unreviewedFullSensorReady: unreviewedReport.totals?.unreviewedFullSensorReady || 0,
      bestLong,
    },
    reviewNext: {
      status: reviewNextReport.status || 'unknown',
      suggestedLabel: reviewNextReport.suggestedLabel || '',
      suggestedConfidence: reviewNextReport.suggestedConfidence || '',
      nextAction: reviewNextReport.nextAction || '',
    },
    attention: {
      needsAttention: Boolean(daily.attention?.needsAttention),
      reasons: daily.attention?.reasons || [],
      sourceIssues,
    },
    nextAction,
  }
}

function summarizeSources(sourceHealth) {
  return {
    healthy: sourceHealth.filter((source) => ['fresh', 'connected_no_sample', 'connected_no_payload'].includes(source.status))
      .length,
    fresh: sourceHealth.filter((source) => source.status === 'fresh').length,
    quiet: sourceHealth.filter((source) => ['connected_no_sample', 'connected_no_payload'].includes(source.status)).length,
    issues: sourceHealth.filter((source) => ['stale', 'error', 'no_status', 'not_running'].includes(source.status)).length,
    sources: sourceHealth.map((source) => ({
      key: source.key,
      label: source.label,
      status: source.status,
      lastDataPayloadAgeMinutes: source.lastDataPayloadAgeMinutes,
    })),
  }
}

function pickBestLongCandidate(candidates) {
  const longCandidates = candidates.filter((candidate) => candidate.liquidation?.direction === 'long')
  const candidate = [...longCandidates].sort(compareCandidatePriority)[0]
  if (!candidate) {
    return null
  }

  return {
    id: candidate.id,
    priority: candidate.priority,
    center: candidate.center,
    fullSensorReady: Boolean(candidate.readiness?.fullSensorReady),
    phaseCInputsReady: Boolean(candidate.readiness?.phaseCInputsReady),
    clusterEvents: candidate.cluster?.events || candidate.liquidation?.clusterEvents || 1,
    reviewMatch: candidate.reviewMatch || null,
  }
}

function compareCandidatePriority(left, right) {
  return priorityRank(left) - priorityRank(right) || String(left.center || '').localeCompare(String(right.center || ''))
}

function priorityRank(candidate) {
  const priority = candidate.priority || ''
  if (priority.includes('p0_long_liquidation_full_sensor')) {
    return 0
  }
  if (priority.includes('p1_long_liquidation_phase_c_ready')) {
    return 1
  }
  if (priority.includes('control_short_squeeze')) {
    return 2
  }
  return 3
}

function chooseNextAction(sourceIssues, unreviewed, bestLong, reviewNext) {
  if (sourceIssues.length > 0) {
    return `Fix source issue: ${sourceIssues[0].label} is ${sourceIssues[0].status}.`
  }
  if (unreviewed.length > 0) {
    return `Review next unreviewed candidate: ${unreviewed[0].id}.`
  }
  if (bestLong && bestLong.fullSensorReady) {
    return 'No unreviewed candidate. Keep monitoring for a new full-sensor long liquidation cluster.'
  }
  if (bestLong) {
    return 'Long liquidation exists but is not full-sensor ready. Keep OI/Funding and trade/book captures running.'
  }
  if (reviewNext.status === 'no_unreviewed_candidate') {
    return 'No unreviewed candidate. Keep capture screens running and check again later.'
  }
  return 'Keep capture screens running and check reports.'
}

function printSummary(report, reportPath) {
  console.log(`Phase C watch report written to ${reportPath}`)
  console.log(
    `Sources: fresh=${report.sourceSummary.fresh}; quiet=${report.sourceSummary.quiet}; issues=${report.sourceSummary.issues}`,
  )
  console.log(
    `Candidates: total=${report.candidateSummary.candidates}; clusters=${report.candidateSummary.liquidationClusters}; long=${report.candidateSummary.longLiquidation}; short=${report.candidateSummary.shortLiquidation}; fullSensor=${report.candidateSummary.fullSensorReady}; unreviewed=${report.candidateSummary.unreviewed}`,
  )
  if (report.candidateSummary.bestLong) {
    console.log(
      `Best long: ${report.candidateSummary.bestLong.id}; priority=${report.candidateSummary.bestLong.priority}; fullSensor=${report.candidateSummary.bestLong.fullSensorReady}`,
    )
  }
  console.log(`Review-next: ${report.reviewNext.status}`)
  console.log(`Next action: ${report.nextAction}`)
}

function printHelp() {
  console.log(`Usage: npm run crypto:phase-c:watch -- [options]

Options:
  --daily-report=<path>        Daily check report path.
  --candidates-report=<path>   Candidate scan report path.
  --unreviewed-report=<path>   Unreviewed report path.
  --review-next-report=<path>  Review-next report path.
  --report=<path>              Watch summary output path.
`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
