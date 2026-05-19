import { execFile } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const workspaceDir = dirname(dirname(fileURLToPath(import.meta.url)))
const defaultCandidateReportPath = resolve(workspaceDir, 'reports/phase-c-candidates-last.json')
const defaultUnreviewedReportPath = resolve(workspaceDir, 'reports/phase-c-unreviewed-candidates-last.json')
const defaultFixturePath = resolve(workspaceDir, 'reports/phase-c-review-next-fixture.json')
const defaultEvidencePath = resolve(workspaceDir, 'reports/phase-c-review-next-evidence.json')
const defaultClassificationPath = resolve(workspaceDir, 'reports/phase-c-review-next-classification.json')
const defaultReportPath = resolve(workspaceDir, 'reports/phase-c-review-next-last.json')

async function main() {
  const options = parseArgs(process.argv.slice(2))

  if (options.refresh) {
    await runScript('runPhaseCCandidateScan.mjs', [`--report=${options.candidateReportPath}`])
    await runScript('runPhaseCUnreviewedCandidates.mjs', [
      `--candidates=${options.candidateReportPath}`,
      `--report=${options.unreviewedReportPath}`,
    ])
  }

  const unreviewedReport = JSON.parse(await readFile(options.unreviewedReportPath, 'utf8'))
  const candidate = pickCandidate(unreviewedReport.unreviewed || [])
  const report = await buildReviewNextReport(candidate, options)

  await mkdir(dirname(options.reportPath), { recursive: true })
  await writeFile(options.reportPath, `${JSON.stringify(report, null, 2)}\n`)
  printSummary(report, options.reportPath)
}

function parseArgs(args) {
  const options = {
    refresh: true,
    candidateReportPath: defaultCandidateReportPath,
    unreviewedReportPath: defaultUnreviewedReportPath,
    fixturePath: defaultFixturePath,
    evidencePath: defaultEvidencePath,
    classificationPath: defaultClassificationPath,
    reportPath: defaultReportPath,
  }

  for (const arg of args) {
    if (arg === '--no-refresh') {
      options.refresh = false
    } else if (arg.startsWith('--candidates=')) {
      options.candidateReportPath = resolve(arg.slice('--candidates='.length))
    } else if (arg.startsWith('--unreviewed=')) {
      options.unreviewedReportPath = resolve(arg.slice('--unreviewed='.length))
    } else if (arg.startsWith('--fixture-report=')) {
      options.fixturePath = resolve(arg.slice('--fixture-report='.length))
    } else if (arg.startsWith('--evidence-report=')) {
      options.evidencePath = resolve(arg.slice('--evidence-report='.length))
    } else if (arg.startsWith('--classification-report=')) {
      options.classificationPath = resolve(arg.slice('--classification-report='.length))
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

function pickCandidate(candidates) {
  return [...candidates].sort(comparePriority)[0] || null
}

function comparePriority(left, right) {
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

async function buildReviewNextReport(candidate, options) {
  const generatedAt = new Date().toISOString()
  if (!candidate) {
    return {
      reportType: 'crypto_phase_c_review_next',
      schemaVersion: 1,
      generatedAt,
      status: 'no_unreviewed_candidate',
      reports: {
        candidates: options.candidateReportPath,
        unreviewed: options.unreviewedReportPath,
        reviewNext: options.reportPath,
      },
      nextAction: 'Wait for a new unreviewed candidate or widen the scan inputs.',
    }
  }

  const fixture = normalizeFixtureDraft(candidate)
  await mkdir(dirname(options.fixturePath), { recursive: true })
  await writeFile(options.fixturePath, `${JSON.stringify({ fixtures: [fixture] }, null, 2)}\n`)

  await runScript('runPhaseCEvidence.mjs', [
    `--config=${options.fixturePath}`,
    `--fixture=${fixture.id}`,
    `--report=${options.evidencePath}`,
  ])
  await runScript('runPhaseCClassify.mjs', [`--evidence=${options.evidencePath}`, `--report=${options.classificationPath}`])

  const classificationReport = JSON.parse(await readFile(options.classificationPath, 'utf8'))
  const classification = classificationReport.classifications?.[0] || null

  return {
    reportType: 'crypto_phase_c_review_next',
    schemaVersion: 1,
    generatedAt,
    status: 'candidate_ready_for_manual_review',
    reports: {
      candidates: options.candidateReportPath,
      unreviewed: options.unreviewedReportPath,
      fixture: options.fixturePath,
      evidence: options.evidencePath,
      classification: options.classificationPath,
      reviewNext: options.reportPath,
    },
    candidate,
    fixtureDraft: fixture,
    suggestedLabel: classification?.label || 'unknown',
    suggestedConfidence: classification?.confidence || 'unknown',
    reasons: classification?.reasons || [],
    warnings: classification?.warnings || [],
    guardrails: {
      emitsTradeAction: false,
      requiresHumanReview: true,
      nextAllowedStage: 'manual_fixture_review',
    },
    nextAction: 'Manually review the evidence report before adding this fixture to config/replay-fixtures.json.',
  }
}

function normalizeFixtureDraft(candidate) {
  const draft = candidate.fixtureDraft || {}

  return {
    id: draft.id || candidate.id,
    description: draft.description || `${candidate.provider || 'Unknown'} BTC liquidation candidate window.`,
    provider: draft.provider || 'all',
    symbol: draft.symbol || candidate.symbol || 'BTC',
    eventType: draft.eventType || 'all',
    start: draft.start || candidate.window?.start,
    end: draft.end || candidate.window?.end,
    limit: draft.limit || 500,
    expected: draft.expected || {
      minimumPhaseCReady: Boolean(candidate.readiness?.phaseCInputsReady),
      fullSensorReady: Boolean(candidate.readiness?.fullSensorReady),
      requiredEventTypes: Object.keys(candidate.byEventType || {}),
    },
  }
}

async function runScript(scriptName, args) {
  const scriptPath = resolve(workspaceDir, 'src', scriptName)
  try {
    await execFileAsync(process.execPath, [scriptPath, ...args], {
      cwd: dirname(workspaceDir),
      maxBuffer: 20 * 1024 * 1024,
    })
  } catch (error) {
    const output = `${error.stdout || ''}${error.stderr || ''}`.trim()
    throw new Error(output || `Failed to run ${scriptName}`)
  }
}

function printSummary(report, reportPath) {
  console.log(`Phase C review-next report written to ${reportPath}`)
  console.log(`Status: ${report.status}`)
  if (report.status === 'candidate_ready_for_manual_review') {
    console.log(`Candidate: ${report.candidate.id}`)
    console.log(`Suggested label: ${report.suggestedLabel}`)
    console.log(`Suggested confidence: ${report.suggestedConfidence}`)
    console.log(`Evidence report: ${report.reports.evidence}`)
    console.log(`Classification report: ${report.reports.classification}`)
  } else {
    console.log(report.nextAction)
  }
}

function printHelp() {
  console.log(`Usage: npm run crypto:phase-c:review-next -- [options]

Options:
  --no-refresh                    Reuse existing candidates and unreviewed reports.
  --candidates=<path>             Candidate scan report path.
  --unreviewed=<path>             Unreviewed candidate report path.
  --fixture-report=<path>         Temporary single-fixture config output path.
  --evidence-report=<path>        Evidence output path.
  --classification-report=<path>  Classification output path.
  --report=<path>                 Review-next summary output path.
`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
