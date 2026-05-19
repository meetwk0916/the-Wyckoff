import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const workspaceDir = dirname(dirname(fileURLToPath(import.meta.url)))
const defaultClassificationPath = resolve(workspaceDir, 'reports/phase-c-classification-last.json')
const defaultReviewPath = resolve(workspaceDir, 'reports/phase-c-review-last.json')
const defaultCandidatePath = resolve(workspaceDir, 'reports/phase-c-candidates-last.json')

const expectedClassifications = {
  'okx-btc-liquidation-2026-05-09T12-14Z': 'short_squeeze_only',
  'okx-btc-short-liquidation-2026-05-18T13-54Z': 'short_squeeze_only',
  'okx-btc-long-liquidation-2026-05-17T14-07Z': 'breakdown_risk',
  'okx-btc-no-liquidation-2026-05-09T12-33Z': 'insufficient_evidence',
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const [classificationReport, reviewReport, candidateReport] = await Promise.all([
    readJson(options.classificationPath),
    readJson(options.reviewPath),
    readOptionalJson(options.candidatePath),
  ])
  const failures = []
  const classificationById = new Map(
    (classificationReport.classifications || []).map((classification) => [classification.id, classification]),
  )

  for (const [id, expectedLabel] of Object.entries(expectedClassifications)) {
    const classification = classificationById.get(id)
    if (!classification) {
      failures.push(`Missing classification for ${id}`)
    } else if (classification.label !== expectedLabel) {
      failures.push(`Expected ${id} to be ${expectedLabel}, got ${classification.label}`)
    }
  }

  if ((classificationReport.totals?.springCandidate || 0) !== 0) {
    failures.push(`Expected pinned fixture spring_candidate count to remain 0, got ${classificationReport.totals.springCandidate}`)
  }
  if ((reviewReport.totals?.disagreement || 0) !== 0) {
    failures.push(`Expected review disagreement count to remain 0, got ${reviewReport.totals.disagreement}`)
  }

  printSummary(classificationReport, reviewReport, candidateReport)

  if (failures.length > 0) {
    console.error('Phase C verification failed:')
    for (const failure of failures) {
      console.error(`- ${failure}`)
    }
    process.exit(1)
  }

  console.log('Phase C verification passed.')
}

function parseArgs(args) {
  const options = {
    classificationPath: defaultClassificationPath,
    reviewPath: defaultReviewPath,
    candidatePath: defaultCandidatePath,
  }

  for (const arg of args) {
    if (arg.startsWith('--classification=')) {
      options.classificationPath = resolve(arg.slice('--classification='.length))
    } else if (arg.startsWith('--review=')) {
      options.reviewPath = resolve(arg.slice('--review='.length))
    } else if (arg.startsWith('--candidates=')) {
      options.candidatePath = resolve(arg.slice('--candidates='.length))
    } else if (arg === '--help' || arg === '-h') {
      printHelp()
      process.exit(0)
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }

  return options
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'))
}

async function readOptionalJson(path) {
  try {
    return await readJson(path)
  } catch {
    return null
  }
}

function printSummary(classificationReport, reviewReport, candidateReport) {
  console.log(`Classification windows: ${classificationReport.totals?.windows ?? 'n/a'}`)
  console.log(`Spring candidates: ${classificationReport.totals?.springCandidate ?? 'n/a'}`)
  console.log(`Breakdown risk: ${classificationReport.totals?.breakdownRisk ?? 'n/a'}`)
  console.log(`Short squeeze only: ${classificationReport.totals?.shortSqueezeOnly ?? 'n/a'}`)
  console.log(`Insufficient evidence: ${classificationReport.totals?.insufficientEvidence ?? 'n/a'}`)
  console.log(`Review agreement: ${reviewReport.totals?.agreement ?? 'n/a'}`)
  console.log(`Review disagreement: ${reviewReport.totals?.disagreement ?? 'n/a'}`)

  if (candidateReport) {
    console.log(`Candidate BTC liquidations: ${candidateReport.totals?.btcLiquidationEvents ?? 'n/a'}`)
    console.log(`Candidate long liquidations: ${candidateReport.totals?.longLiquidationCandidates ?? 'n/a'}`)
    console.log(`Candidate short liquidations: ${candidateReport.totals?.shortLiquidationCandidates ?? 'n/a'}`)
  }
}

function printHelp() {
  console.log(`Usage: npm run crypto:phase-c:verify -- [options]

Options:
  --classification=<path>  Phase C classification report path. Default: crypto-workspace/reports/phase-c-classification-last.json.
  --review=<path>          Phase C review report path. Default: crypto-workspace/reports/phase-c-review-last.json.
  --candidates=<path>      Optional candidate scan report path. Default: crypto-workspace/reports/phase-c-candidates-last.json.
`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
