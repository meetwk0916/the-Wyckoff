import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const workspaceDir = dirname(dirname(fileURLToPath(import.meta.url)))
const defaultCandidatePath = resolve(workspaceDir, 'reports/phase-c-candidates-last.json')
const defaultFixturePath = resolve(workspaceDir, 'config/replay-fixtures.json')
const defaultReviewPath = resolve(workspaceDir, 'reviews/phase-c-review-index.json')
const defaultReportPath = resolve(workspaceDir, 'reports/phase-c-unreviewed-candidates-last.json')
const DEFAULT_OVERLAP_RATIO = 0.5

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const [candidateReport, fixtureConfig, reviewIndex] = await Promise.all([
    readJson(options.candidatePath),
    readJson(options.fixturePath),
    readJson(options.reviewPath),
  ])

  const reviewedWindows = buildReviewedWindows(fixtureConfig, reviewIndex)
  const candidates = (candidateReport.candidates || []).map((candidate) =>
    annotateCandidate(candidate, reviewedWindows, options),
  )
  const unreviewed = candidates.filter((candidate) => !candidate.reviewMatch)
  const report = {
    reportType: 'crypto_phase_c_unreviewed_candidates',
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    inputs: {
      candidates: options.candidatePath,
      fixtures: options.fixturePath,
      reviews: options.reviewPath,
      overlapRatio: options.overlapRatio,
    },
    totals: {
      candidates: candidates.length,
      reviewed: candidates.length - unreviewed.length,
      unreviewed: unreviewed.length,
      unreviewedLongLiquidation: countDirection(unreviewed, 'long'),
      unreviewedShortLiquidation: countDirection(unreviewed, 'short'),
      unreviewedFullSensorReady: unreviewed.filter((candidate) => candidate.readiness?.fullSensorReady).length,
    },
    unreviewed,
    reviewed: candidates.filter((candidate) => candidate.reviewMatch),
  }

  await mkdir(dirname(options.reportPath), { recursive: true })
  await writeFile(options.reportPath, `${JSON.stringify(report, null, 2)}\n`)
  printSummary(report, options.reportPath)
}

function parseArgs(args) {
  const options = {
    candidatePath: defaultCandidatePath,
    fixturePath: defaultFixturePath,
    reviewPath: defaultReviewPath,
    reportPath: defaultReportPath,
    overlapRatio: DEFAULT_OVERLAP_RATIO,
  }

  for (const arg of args) {
    if (arg.startsWith('--candidates=')) {
      options.candidatePath = resolve(arg.slice('--candidates='.length))
    } else if (arg.startsWith('--fixtures=')) {
      options.fixturePath = resolve(arg.slice('--fixtures='.length))
    } else if (arg.startsWith('--reviews=')) {
      options.reviewPath = resolve(arg.slice('--reviews='.length))
    } else if (arg.startsWith('--report=')) {
      options.reportPath = resolve(arg.slice('--report='.length))
    } else if (arg.startsWith('--overlap-ratio=')) {
      options.overlapRatio = parseOverlapRatio(arg.slice('--overlap-ratio='.length))
    } else if (arg === '--help' || arg === '-h') {
      printHelp()
      process.exit(0)
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }

  return options
}

function parseOverlapRatio(value) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 1) {
    throw new Error(`--overlap-ratio must be > 0 and <= 1, got: ${value}`)
  }
  return parsed
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'))
}

function buildReviewedWindows(fixtureConfig, reviewIndex) {
  const reviewsById = new Map((reviewIndex.reviews || []).map((review) => [review.id, review]))

  return (fixtureConfig.fixtures || [])
    .filter((fixture) => reviewsById.has(fixture.id))
    .map((fixture) => ({
      id: fixture.id,
      start: fixture.start,
      end: fixture.end,
      startMs: Date.parse(fixture.start),
      endMs: Date.parse(fixture.end),
      humanLabel: reviewsById.get(fixture.id)?.humanLabel || '',
    }))
    .filter((window) => Number.isFinite(window.startMs) && Number.isFinite(window.endMs) && window.endMs > window.startMs)
}

function annotateCandidate(candidate, reviewedWindows, options) {
  const match = findReviewMatch(candidate, reviewedWindows, options.overlapRatio)

  return {
    id: candidate.id,
    center: candidate.center,
    provider: candidate.provider,
    symbol: candidate.symbol,
    liquidation: candidate.liquidation,
    window: candidate.window,
    byEventType: candidate.byEventType,
    byProvider: candidate.byProvider,
    readiness: candidate.readiness,
    priority: candidate.priority,
    fixtureDraft: candidate.fixtureDraft,
    reviewMatch: match,
  }
}

function findReviewMatch(candidate, reviewedWindows, requiredOverlapRatio) {
  const candidateStartMs = Date.parse(candidate.window?.start)
  const candidateEndMs = Date.parse(candidate.window?.end)
  if (!Number.isFinite(candidateStartMs) || !Number.isFinite(candidateEndMs) || candidateEndMs <= candidateStartMs) {
    return null
  }

  const candidateDuration = candidateEndMs - candidateStartMs
  let bestMatch = null

  for (const reviewed of reviewedWindows) {
    const overlapMs = Math.max(0, Math.min(candidateEndMs, reviewed.endMs) - Math.max(candidateStartMs, reviewed.startMs))
    const overlapRatio = overlapMs / candidateDuration
    if (overlapRatio < requiredOverlapRatio) {
      continue
    }
    if (!bestMatch || overlapRatio > bestMatch.overlapRatio) {
      bestMatch = {
        id: reviewed.id,
        humanLabel: reviewed.humanLabel,
        start: reviewed.start,
        end: reviewed.end,
        overlapRatio: round(overlapRatio),
      }
    }
  }

  return bestMatch
}

function countDirection(candidates, direction) {
  return candidates.filter((candidate) => candidate.liquidation?.direction === direction).length
}

function round(value) {
  return Math.round(value * 10000) / 10000
}

function printSummary(report, reportPath) {
  console.log(`Phase C unreviewed candidate report written to ${reportPath}`)
  console.log(`Candidates: ${report.totals.candidates}`)
  console.log(`Reviewed: ${report.totals.reviewed}`)
  console.log(`Unreviewed: ${report.totals.unreviewed}`)
  console.log(`Unreviewed long liquidation: ${report.totals.unreviewedLongLiquidation}`)
  console.log(`Unreviewed short liquidation: ${report.totals.unreviewedShortLiquidation}`)
  console.log(`Unreviewed full sensor ready: ${report.totals.unreviewedFullSensorReady}`)

  for (const candidate of report.unreviewed) {
    console.log(
      `- ${candidate.id} ${candidate.liquidation?.direction || 'unknown'} ${candidate.window?.start || 'n/a'} -> ${
        candidate.window?.end || 'n/a'
      } priority=${candidate.priority || 'n/a'} fullSensor=${candidate.readiness?.fullSensorReady || false}`,
    )
  }
}

function printHelp() {
  console.log(`Usage: npm run crypto:phase-c:unreviewed -- [options]

Options:
  --candidates=<path>       Candidate scan report path. Default: crypto-workspace/reports/phase-c-candidates-last.json.
  --fixtures=<path>         Replay fixture config path. Default: crypto-workspace/config/replay-fixtures.json.
  --reviews=<path>          Review index path. Default: crypto-workspace/reviews/phase-c-review-index.json.
  --report=<path>           Output report path. Default: crypto-workspace/reports/phase-c-unreviewed-candidates-last.json.
  --overlap-ratio=<number>  Minimum candidate-window overlap with reviewed fixtures. Default: ${DEFAULT_OVERLAP_RATIO}.
`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})

