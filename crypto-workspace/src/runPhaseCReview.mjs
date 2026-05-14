import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const workspaceDir = dirname(dirname(fileURLToPath(import.meta.url)))
const defaultClassificationPath = resolve(workspaceDir, 'reports/phase-c-classification-last.json')
const defaultReviewIndexPath = resolve(workspaceDir, 'reviews/phase-c-review-index.json')
const defaultReportPath = resolve(workspaceDir, 'reports/phase-c-review-last.json')
const allowedReviewLabels = [
  'confirmed_spring',
  'failed_spring',
  'short_squeeze_only',
  'breakdown_risk',
  'insufficient_evidence',
  'exclude_bad_data',
]

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const classificationReport = JSON.parse(await readFile(options.classificationPath, 'utf8'))
  const reviewIndex = JSON.parse(await readFile(options.reviewIndexPath, 'utf8'))
  const reviewById = new Map((reviewIndex.reviews || []).map((review) => [review.id, review]))
  const classifications = Array.isArray(classificationReport.classifications) ? classificationReport.classifications : []
  const windows = classifications.map((classification) => buildReviewWindow(classification, reviewById.get(classification.id)))
  const report = {
    reportType: 'crypto_phase_c_review',
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    classificationPath: options.classificationPath,
    reviewIndexPath: options.reviewIndexPath,
    totals: buildTotals(windows),
    windows,
    rules: {
      reviewLabels: allowedReviewLabels,
      note: 'Research review and scoring only. This report does not generate entries, exits, position sizing, or trade actions.',
    },
  }

  await mkdir(dirname(options.reportPath), { recursive: true })
  await writeFile(options.reportPath, `${JSON.stringify(report, null, 2)}\n`)
  printSummary(report, options.reportPath)
}

function parseArgs(args) {
  const options = {
    classificationPath: defaultClassificationPath,
    reviewIndexPath: defaultReviewIndexPath,
    reportPath: defaultReportPath,
  }

  for (const arg of args) {
    if (arg.startsWith('--classification=')) {
      options.classificationPath = resolve(arg.slice('--classification='.length))
    } else if (arg.startsWith('--review-index=')) {
      options.reviewIndexPath = resolve(arg.slice('--review-index='.length))
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

function buildReviewWindow(classification, review) {
  const score = scoreClassification(classification)
  const normalizedHumanLabel = normalizeHumanLabel(review?.humanLabel)
  const reviewStatus = review?.reviewStatus || 'pending'

  return {
    id: classification.id,
    description: classification.description,
    filters: classification.filters,
    systemLabel: classification.label,
    systemConfidence: classification.confidence,
    score,
    review: {
      status: reviewStatus,
      humanLabel: review?.humanLabel || '',
      normalizedHumanLabel,
      reviewer: review?.reviewer || '',
      reviewedAt: review?.reviewedAt || '',
      rationale: review?.rationale || '',
      machineReadableFactors: review?.machineReadableFactors || {},
      agreesWithSystem: Boolean(normalizedHumanLabel && normalizedHumanLabel === classification.label),
    },
    guardrails: {
      emitsTradeAction: false,
      usableForRuleCalibration: reviewStatus === 'reviewed' && normalizedHumanLabel !== 'exclude_bad_data',
    },
  }
}

function scoreClassification(classification) {
  const context = classification.context || {}
  const components = {
    structure: scoreStructure(context.structureContext || {}),
    liquidation: scoreLiquidation(context.liquidationDirection),
    cvd: scoreCvd(context.cvdContext || {}),
    orderBook: scoreOrderBook(context.bookRecovery || {}),
    funding: scoreFunding(context.fundingContext || {}, context.liquidationDirection),
    coverage: scoreCoverage(context.derivativesCoverage || {}, classification.warnings || []),
  }
  const total = Object.values(components).reduce((sum, component) => sum + component.points, 0)

  return {
    total,
    components,
    machineLabel: classifyScore(total, context, classification),
  }
}

function scoreStructure(structure) {
  const reasons = []
  let points = 0

  if (structure.supportBroken) {
    points += 1
    reasons.push('support_broken')
  }
  if (structure.supportRecovered) {
    points += 2
    reasons.push('support_recovered')
  }
  if (structure.phaseCStructureSupport) {
    points += 1
    reasons.push('phase_c_structure_supportive')
  }
  if (structure.bothSupportRecovered) {
    points += 1
    reasons.push('spot_and_perp_support_recovered')
  }

  return { points, reasons }
}

function scoreLiquidation(direction) {
  if (direction === 'long') {
    return { points: 2, reasons: ['long_liquidation_supports_washout'] }
  }
  if (direction === 'short') {
    return { points: -3, reasons: ['short_liquidation_points_to_short_squeeze'] }
  }
  if (direction === 'none') {
    return { points: -2, reasons: ['missing_liquidation'] }
  }
  return { points: -1, reasons: ['mixed_or_unknown_liquidation'] }
}

function scoreCvd(cvdContext) {
  const spotBias = cvdContext.spot?.bias || 'unknown'
  const perpBias = cvdContext.perp?.bias || 'unknown'
  const reasons = []
  let points = 0

  if (spotBias === 'demand') {
    points += 2
    reasons.push('spot_cvd_demand')
  } else if (spotBias === 'supply') {
    points -= 2
    reasons.push('spot_cvd_supply')
  }

  if (cvdContext.divergence === 'spot_demand_perp_supply') {
    points += 1
    reasons.push('spot_demand_perp_supply_divergence')
  } else if (spotBias === 'supply' && perpBias === 'supply') {
    points -= 1
    reasons.push('spot_and_perp_cvd_supply')
  }

  if (cvdContext.phaseCFlowSupport) {
    points += 1
    reasons.push('phase_c_cvd_supportive')
  }
  if (cvdContext.verdict?.distributionRisk) {
    points -= 1
    reasons.push('cvd_distribution_risk')
  }

  return { points, reasons }
}

function scoreOrderBook(bookRecovery) {
  const reasons = []
  let points = 0

  if (bookRecovery.recoveredFromLow) {
    points += 1
    reasons.push('book_mid_recovered')
  }
  if (bookRecovery.topDepthImproved) {
    points += 1
    reasons.push('top_depth_improved')
  }
  if (bookRecovery.askDepthRetreatedPost3m) {
    points += 1
    reasons.push('post3m_ask_depth_retreat')
  }
  if (bookRecovery.imbalanceImprovedPost3m) {
    points += 1
    reasons.push('post3m_imbalance_improved')
  }

  return { points, reasons }
}

function scoreFunding(fundingContext, liquidationDirection) {
  const crowding = fundingContext.crowding || 'unknown'
  const reasons = []
  let points = 0

  if (fundingContext.quality !== 'observed') {
    return { points, reasons: ['funding_missing_or_unobserved'] }
  }

  if (liquidationDirection === 'long' && (crowding === 'crowded_long' || crowding === 'extreme_crowded_long')) {
    points += fundingContext.extremeCrowding ? 2 : 1
    reasons.push(fundingContext.extremeCrowding ? 'extreme_crowded_longs_confirmed' : 'crowded_longs_confirmed')
  } else if (
    liquidationDirection === 'short' &&
    (crowding === 'crowded_short' || crowding === 'extreme_crowded_short')
  ) {
    points += fundingContext.extremeCrowding ? 2 : 1
    reasons.push(fundingContext.extremeCrowding ? 'extreme_crowded_shorts_confirmed' : 'crowded_shorts_confirmed')
  } else if (crowding === 'neutral') {
    reasons.push('funding_neutral')
  } else if (crowding !== 'unknown') {
    reasons.push(`funding_${crowding}`)
  }

  return { points, reasons }
}

function scoreCoverage(derivativesCoverage, warnings) {
  const reasons = []
  let points = 0

  if ((derivativesCoverage.openInterestSamples || 0) > 0) {
    points += 1
    reasons.push('open_interest_present')
  }
  if ((derivativesCoverage.fundingRateSamples || 0) > 0) {
    points += 1
    reasons.push('funding_present')
  }
  if (warnings.length > 0) {
    points -= 1
    reasons.push('classification_warnings_present')
  }

  return { points, reasons }
}

function classifyScore(total, context, classification) {
  if (classification.label === 'insufficient_evidence') {
    return 'insufficient_evidence'
  }
  if (context.liquidationDirection === 'short') {
    return 'short_squeeze_only'
  }
  if (context.liquidationDirection === 'long' && context.structureContext?.phaseCStructureSupport && total >= 6) {
    return 'spring_candidate'
  }
  return 'breakdown_risk'
}

function normalizeHumanLabel(label) {
  if (!label) {
    return ''
  }
  if (!allowedReviewLabels.includes(label)) {
    return 'invalid_review_label'
  }
  if (label === 'confirmed_spring') {
    return 'spring_candidate'
  }
  if (label === 'failed_spring') {
    return 'breakdown_risk'
  }
  return label
}

function buildTotals(windows) {
  const reviewed = windows.filter((window) => window.review.status === 'reviewed')
  const usable = windows.filter((window) => window.guardrails.usableForRuleCalibration)

  return {
    windows: windows.length,
    reviewed: reviewed.length,
    pending: windows.filter((window) => window.review.status !== 'reviewed').length,
    usableForRuleCalibration: usable.length,
    agreement: reviewed.filter((window) => window.review.agreesWithSystem).length,
    disagreement: reviewed.filter((window) => !window.review.agreesWithSystem).length,
    systemLabels: countBy(windows, (window) => window.systemLabel),
    humanLabels: countBy(reviewed, (window) => window.review.humanLabel || 'unlabeled'),
    scoreLabels: countBy(windows, (window) => window.score.machineLabel),
  }
}

function countBy(items, getKey) {
  return items.reduce((counts, item) => {
    const key = getKey(item)
    counts[key] = (counts[key] || 0) + 1
    return counts
  }, {})
}

function printSummary(report, reportPath) {
  console.log(`Phase C review report written to ${reportPath}`)
  console.log(`Windows: ${report.totals.windows}`)
  console.log(`Reviewed: ${report.totals.reviewed}`)
  console.log(`Pending: ${report.totals.pending}`)
  console.log(`Agreement: ${report.totals.agreement}`)
  console.log(`Disagreement: ${report.totals.disagreement}`)
}

function printHelp() {
  console.log(`Usage: npm run crypto:phase-c:review -- [options]

Options:
  --classification=<path>  Phase C classification report path. Default: crypto-workspace/reports/phase-c-classification-last.json.
  --review-index=<path>    Human review index path. Default: crypto-workspace/reviews/phase-c-review-index.json.
  --report=<path>          Output review report path. Default: crypto-workspace/reports/phase-c-review-last.json.
`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
