import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const workspaceDir = dirname(dirname(fileURLToPath(import.meta.url)))
const defaultEvidencePath = resolve(workspaceDir, 'reports/phase-c-evidence-last.json')
const defaultReportPath = resolve(workspaceDir, 'reports/phase-c-classification-last.json')
const allowedLabels = ['spring_candidate', 'breakdown_risk', 'short_squeeze_only', 'insufficient_evidence']

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const evidenceReport = JSON.parse(await readFile(options.evidencePath, 'utf8'))
  const windows = Array.isArray(evidenceReport.windows) ? evidenceReport.windows : []
  const classifications = windows.map((window) => classifyWindow(window))
  const report = {
    reportType: 'crypto_phase_c_classification',
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    evidencePath: options.evidencePath,
    totals: buildTotals(classifications),
    classifications,
    rules: {
      labels: allowedLabels,
      note: 'Classification only. This report does not generate entries, exits, position sizing, or trade actions.',
    },
  }

  await mkdir(dirname(options.reportPath), { recursive: true })
  await writeFile(options.reportPath, `${JSON.stringify(report, null, 2)}\n`)
  printSummary(report, options.reportPath)
}

function parseArgs(args) {
  const options = {
    evidencePath: defaultEvidencePath,
    reportPath: defaultReportPath,
  }

  for (const arg of args) {
    if (arg.startsWith('--evidence=')) {
      options.evidencePath = resolve(arg.slice('--evidence='.length))
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

function classifyWindow(window) {
  const reasons = []
  const warnings = []
  const evidence = window.evidence || {}
  const liquidation = evidence.liquidationSpike || {}
  const priceAction = evidence.priceAction || {}
  const orderBookRecovery = evidence.orderBookRecovery || {}
  const tradeFlow = evidence.tradeFlow || {}
  const cvdContext = evidence.cvdContext || {}
  const context = {
    liquidationDirection: classifyLiquidationDirection(liquidation),
    priceRecovery: buildPriceRecovery(priceAction),
    structureContext: buildStructureContext(evidence.structureContext || {}),
    bookRecovery: buildBookRecovery(orderBookRecovery),
    cvdContext: buildCvdContext(cvdContext, tradeFlow),
    tradeFlowBias: buildTradeFlowBias(tradeFlow),
    derivativesCoverage: buildDerivativesCoverage(evidence.derivativesContext || {}),
    openInterestShock: buildOpenInterestShock(evidence.derivativesContext?.openInterestShock || {}),
  }

  if (!window.readiness?.phaseCInputsReady) {
    reasons.push('missing_phase_c_inputs')
  }
  if (!window.readiness?.fullSensorReady) {
    warnings.push('missing_full_sensor_inputs')
  }
  if (liquidation.details === 0) {
    reasons.push('no_liquidation_spike')
  }
  for (const reason of window.interpretation?.reasons || []) {
    if (reason === 'provider_status_events_present') {
      warnings.push(reason)
    }
  }

  let label = 'insufficient_evidence'
  if (reasons.length === 0) {
    label = classifyReadyWindow(context)
  }

  if (label === 'short_squeeze_only') {
    reasons.push('short_liquidation_dominates')
  } else if (label === 'spring_candidate') {
    reasons.push('long_liquidation_with_recovery')
    reasons.push('structure_support_recovered')
    reasons.push('phase_c_cvd_supportive')
    reasons.push('open_interest_deleveraging_confirmed')
  } else if (label === 'breakdown_risk') {
    reasons.push('washout_recovery_not_confirmed')
    if (context.liquidationDirection === 'long' && !context.structureContext.supportRecovered) {
      reasons.push('structure_support_not_recovered')
    }
    if (context.liquidationDirection === 'long' && !context.cvdContext.phaseCFlowSupport) {
      reasons.push('phase_c_cvd_not_supportive')
    }
    if (context.liquidationDirection === 'long' && !context.openInterestShock.isDeleveraging) {
      reasons.push('open_interest_deleveraging_not_confirmed')
    }
  }

  return {
    id: window.id,
    description: window.description,
    filters: window.filters,
    label,
    confidence: estimateConfidence(label, context, warnings),
    reasons,
    warnings,
    context,
    guardrails: {
      emitsTradeAction: false,
      requiresHumanReview: true,
      nextAllowedStage: label === 'spring_candidate' ? 'manual_phase_c_review' : 'collect_more_evidence',
    },
  }
}

function classifyReadyWindow(context) {
  if (context.liquidationDirection === 'short') {
    return 'short_squeeze_only'
  }

  if (context.liquidationDirection !== 'long') {
    return 'breakdown_risk'
  }

  if (
    context.priceRecovery.recoveredFromLow &&
    context.bookRecovery.recoveredFromLow &&
    context.structureContext.supportRecovered &&
    context.cvdContext.phaseCFlowSupport &&
    context.openInterestShock.isDeleveraging
  ) {
    return 'spring_candidate'
  }

  return 'breakdown_risk'
}

function classifyLiquidationDirection(liquidation) {
  const samples = liquidation.samples || []
  const shortSamples = samples.filter((sample) => sample.posSide === 'short' || sample.side === 'buy').length
  const longSamples = samples.filter((sample) => sample.posSide === 'long' || sample.side === 'sell').length

  if ((liquidation.buyRawSize || 0) > (liquidation.sellRawSize || 0) && shortSamples >= longSamples) {
    return 'short'
  }
  if ((liquidation.sellRawSize || 0) > (liquidation.buyRawSize || 0) && longSamples >= shortSamples) {
    return 'long'
  }
  if (shortSamples > 0 && longSamples === 0) {
    return 'short'
  }
  if (longSamples > 0 && shortSamples === 0) {
    return 'long'
  }
  return liquidation.details > 0 ? 'mixed_or_unknown' : 'none'
}

function buildPriceRecovery(priceAction) {
  const spot = summarizePriceRecovery(priceAction.spot)
  const perp = summarizePriceRecovery(priceAction.perp)

  return {
    spot,
    perp,
    recoveredFromLow: spot.recoveredFromLow || perp.recoveredFromLow,
    bothRecoveredFromLow: spot.recoveredFromLow && perp.recoveredFromLow,
  }
}

function buildStructureContext(structureContext) {
  const spot = summarizeStructureContext(structureContext.spot)
  const perp = summarizeStructureContext(structureContext.perp)

  return {
    anchor: structureContext.anchor || {},
    spot,
    perp,
    supportBroken: spot.supportBroken || perp.supportBroken,
    supportRecovered: spot.supportRecovered || perp.supportRecovered,
    bothSupportRecovered: spot.supportRecovered && perp.supportRecovered,
  }
}

function summarizeStructureContext(structure) {
  return {
    observations: structure?.observations || 0,
    supportMethod: structure?.supportMethod || '',
    support: numberOrNull(structure?.support),
    resistance: numberOrNull(structure?.resistance),
    postAnchorLow: numberOrNull(structure?.postAnchorLow),
    last: numberOrNull(structure?.last),
    supportBroken: Boolean(structure?.supportBroken),
    supportRecovered: Boolean(structure?.supportRecovered),
    breakDepthPct: numberOrNull(structure?.breakDepthPct),
  }
}

function summarizePriceRecovery(price) {
  const recoveryFromLow = numberOrNull(price?.recoveryFromLow)
  const drawdownFromFirst = numberOrNull(price?.drawdownFromFirst)

  return {
    drawdownFromFirst,
    recoveryFromLow,
    recoveredFromLow: recoveryFromLow !== null && recoveryFromLow > 0,
  }
}

function buildBookRecovery(orderBookRecovery) {
  const spot = summarizeBookRecovery(orderBookRecovery.spot)
  const perp = summarizeBookRecovery(orderBookRecovery.perp)

  return {
    spot,
    perp,
    recoveredFromLow: spot.recoveredFromLow || perp.recoveredFromLow,
    topDepthImproved: spot.topDepthImproved || perp.topDepthImproved,
  }
}

function summarizeBookRecovery(book) {
  const recoveryFromLow = numberOrNull(book?.recoveryFromLow)
  const firstImbalance = numberOrNull(book?.firstTopDepth?.imbalance)
  const lastImbalance = numberOrNull(book?.lastTopDepth?.imbalance)

  return {
    samples: book?.samples || 0,
    recoveryFromLow,
    recoveredFromLow: recoveryFromLow !== null && recoveryFromLow > 0,
    firstTopDepthImbalance: firstImbalance,
    lastTopDepthImbalance: lastImbalance,
    topDepthImproved: firstImbalance !== null && lastImbalance !== null && lastImbalance > firstImbalance,
  }
}

function buildTradeFlowBias(tradeFlow) {
  return {
    spot: summarizeTradeFlow(tradeFlow.spot),
    perp: summarizeTradeFlow(tradeFlow.perp),
  }
}

function buildCvdContext(cvdContext, tradeFlow) {
  const spot = summarizeCvd(cvdContext.spot, tradeFlow.spot)
  const perp = summarizeCvd(cvdContext.perp, tradeFlow.perp)

  return {
    spot,
    perp,
    divergence: cvdContext.divergence || classifyCvdDivergence(spot, perp),
    phaseCFlowSupport: Boolean(cvdContext.phaseCFlowSupport ?? isPhaseCFlowSupportive(spot, perp)),
  }
}

function summarizeCvd(cvd, fallbackFlow) {
  if (cvd?.quality === 'observed') {
    return {
      trades: cvd.trades || 0,
      notionalDelta: numberOrNull(cvd.notionalDelta),
      deltaRatio: numberOrNull(cvd.deltaRatio),
      bias: cvd.bias || 'unknown',
      quality: cvd.quality,
    }
  }

  const flow = summarizeTradeFlow(fallbackFlow)
  const buyRawNotional = numberOrNull(fallbackFlow?.buyRawNotional) || 0
  const sellRawNotional = numberOrNull(fallbackFlow?.sellRawNotional) || 0
  const totalRawNotional = buyRawNotional + sellRawNotional
  const deltaRatio = totalRawNotional === 0 ? null : flow.netRawNotional / totalRawNotional

  return {
    trades: flow.trades,
    notionalDelta: flow.netRawNotional,
    deltaRatio,
    bias: classifyCvdBias(deltaRatio),
    quality: flow.trades > 0 ? 'observed' : 'missing_trades',
  }
}

function classifyCvdBias(deltaRatio) {
  if (deltaRatio === null) {
    return 'unknown'
  }
  if (deltaRatio >= 0.05) {
    return 'demand'
  }
  if (deltaRatio <= -0.05) {
    return 'supply'
  }
  return 'balanced'
}

function classifyCvdDivergence(spot, perp) {
  if (spot.quality !== 'observed' || perp.quality !== 'observed') {
    return 'insufficient_trade_flow'
  }
  if (spot.bias === 'demand' && perp.bias === 'supply') {
    return 'spot_demand_perp_supply'
  }
  if (spot.bias === 'supply' && perp.bias === 'demand') {
    return 'spot_supply_perp_demand'
  }
  if (spot.bias === 'demand' && perp.bias === 'demand') {
    return 'broad_demand'
  }
  if (spot.bias === 'supply' && perp.bias === 'supply') {
    return 'broad_supply'
  }
  return 'mixed_or_balanced'
}

function isPhaseCFlowSupportive(spot, perp) {
  if (spot.quality !== 'observed' || perp.quality !== 'observed') {
    return false
  }
  if (spot.bias === 'supply') {
    return false
  }
  return spot.bias === 'demand' || (spot.bias === 'balanced' && perp.bias !== 'demand')
}

function summarizeTradeFlow(flow) {
  const netRawNotional = numberOrNull(flow?.netRawNotional)
  let bias = 'flat'

  if (netRawNotional !== null && netRawNotional > 0) {
    bias = 'buy'
  } else if (netRawNotional !== null && netRawNotional < 0) {
    bias = 'sell'
  }

  return {
    trades: flow?.trades || 0,
    netRawNotional,
    bias,
  }
}

function buildDerivativesCoverage(derivatives) {
  return {
    openInterestSamples: derivatives.openInterest?.samples || 0,
    fundingRateSamples: derivatives.fundingRate?.samples || 0,
  }
}

function buildOpenInterestShock(openInterestShock) {
  return {
    samples: openInterestShock.samples || 0,
    change: numberOrNull(openInterestShock.change),
    changePct: numberOrNull(openInterestShock.changePct),
    direction: openInterestShock.direction || 'unknown',
    isDeleveraging: Boolean(openInterestShock.isDeleveraging),
    quality: openInterestShock.quality || 'missing',
  }
}

function estimateConfidence(label, context, warnings) {
  if (label === 'insufficient_evidence') {
    return 'low'
  }
  if (warnings.length > 0) {
    return 'medium'
  }
  if (label === 'spring_candidate' && context.priceRecovery.bothRecoveredFromLow && context.bookRecovery.topDepthImproved) {
    return 'medium'
  }
  return 'low'
}

function numberOrNull(value) {
  return Number.isFinite(value) ? value : null
}

function buildTotals(classifications) {
  return {
    windows: classifications.length,
    springCandidate: countLabel(classifications, 'spring_candidate'),
    breakdownRisk: countLabel(classifications, 'breakdown_risk'),
    shortSqueezeOnly: countLabel(classifications, 'short_squeeze_only'),
    insufficientEvidence: countLabel(classifications, 'insufficient_evidence'),
  }
}

function countLabel(classifications, label) {
  return classifications.filter((classification) => classification.label === label).length
}

function printSummary(report, reportPath) {
  console.log(`Phase C classification report written to ${reportPath}`)
  console.log(`Windows: ${report.totals.windows}`)
  console.log(`Spring candidates: ${report.totals.springCandidate}`)
  console.log(`Breakdown risk: ${report.totals.breakdownRisk}`)
  console.log(`Short squeeze only: ${report.totals.shortSqueezeOnly}`)
  console.log(`Insufficient evidence: ${report.totals.insufficientEvidence}`)
}

function printHelp() {
  console.log(`Usage: npm run crypto:phase-c:classify -- [options]

Options:
  --evidence=<path>  Phase C evidence report path. Default: crypto-workspace/reports/phase-c-evidence-last.json.
  --report=<path>    Output classification report path. Default: crypto-workspace/reports/phase-c-classification-last.json.
`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
