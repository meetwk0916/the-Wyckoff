import { execFile } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const workspaceDir = dirname(dirname(fileURLToPath(import.meta.url)))
const defaultScreenName = 'wyckoff_bybit_liq_capture_7d_heartbeat'
const defaultStatusReportPath = resolve(workspaceDir, 'reports/capture-status-last.json')
const defaultCandidateReportPath = resolve(workspaceDir, 'reports/phase-c-candidates-last.json')
const defaultReportPath = resolve(workspaceDir, 'reports/daily-capture-check-last.json')
const staleHeartbeatMinutes = 15
const staleDataPayloadMinutes = 15

async function main() {
  const options = parseArgs(process.argv.slice(2))

  await runScript('runCaptureStatus.mjs', [
    `--screen=${options.screenName}`,
    `--report=${options.statusReportPath}`,
    `--stale-data-payload-min=${options.staleDataPayloadMinutes}`,
  ])
  await runScript('runPhaseCCandidateScan.mjs', [`--report=${options.candidateReportPath}`])

  const statusReport = JSON.parse(await readFile(options.statusReportPath, 'utf8'))
  const candidateReport = JSON.parse(await readFile(options.candidateReportPath, 'utf8'))
  const report = buildDailyReport(statusReport, candidateReport, options)

  await mkdir(dirname(options.reportPath), { recursive: true })
  await writeFile(options.reportPath, `${JSON.stringify(report, null, 2)}\n`)
  printSummary(report)
}

function parseArgs(args) {
  const options = {
    screenName: defaultScreenName,
    statusReportPath: defaultStatusReportPath,
    candidateReportPath: defaultCandidateReportPath,
    reportPath: defaultReportPath,
    staleDataPayloadMinutes,
  }

  for (const arg of args) {
    if (arg.startsWith('--screen=')) {
      options.screenName = arg.slice('--screen='.length)
    } else if (arg.startsWith('--status-report=')) {
      options.statusReportPath = resolve(arg.slice('--status-report='.length))
    } else if (arg.startsWith('--candidates-report=')) {
      options.candidateReportPath = resolve(arg.slice('--candidates-report='.length))
    } else if (arg.startsWith('--report=')) {
      options.reportPath = resolve(arg.slice('--report='.length))
    } else if (arg.startsWith('--stale-data-payload-min=')) {
      options.staleDataPayloadMinutes = parsePositiveNumber(arg.slice('--stale-data-payload-min='.length))
    } else if (arg === '--help' || arg === '-h') {
      printHelp()
      process.exit(0)
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }

  return options
}

function parsePositiveNumber(value) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Expected positive number, got: ${value}`)
  }
  return parsed
}

async function runScript(scriptName, args) {
  const scriptPath = resolve(workspaceDir, 'src', scriptName)
  try {
    await execFileAsync(process.execPath, [scriptPath, ...args], {
      cwd: dirname(workspaceDir),
      maxBuffer: 10 * 1024 * 1024,
    })
  } catch (error) {
    const output = `${error.stdout || ''}${error.stderr || ''}`.trim()
    throw new Error(output || `Failed to run ${scriptName}`)
  }
}

function buildDailyReport(statusReport, candidateReport, options) {
  const generatedAt = new Date().toISOString()
  const totals = statusReport.totals || {}
  const candidateTotals = candidateReport.totals || {}
  const lastProviderStatusAgeMinutes = minutesSince(totals.lastProviderStatusAt, generatedAt)
  const captureHealth = statusReport.captureHealth || { status: 'unknown', reasons: [] }
  const attention = buildAttention(
    statusReport.screen || {},
    totals,
    candidateTotals,
    lastProviderStatusAgeMinutes,
    captureHealth,
  )
  const lastDataPayload = captureHealth.lastDataPayload || {
    at: totals.lastDataPayloadAt || '',
    ageMinutes: minutesSince(totals.lastDataPayloadAt, generatedAt),
    path: totals.lastDataPayloadPath || '',
    eventType: totals.lastDataPayloadEventType || '',
    staleAfterMinutes: options.staleDataPayloadMinutes,
  }

  return {
    reportType: 'crypto_daily_capture_check',
    schemaVersion: 1,
    generatedAt,
    screenName: options.screenName,
    reports: {
      status: options.statusReportPath,
      candidates: options.candidateReportPath,
      daily: options.reportPath,
    },
    capture: {
      screenStatus: statusReport.screen?.status || 'unknown',
      healthStatus: captureHealth.status || 'unknown',
      healthReasons: captureHealth.reasons || [],
      latestStatusFile: captureHealth.latestStatusFile || null,
      matchedSession: statusReport.screen?.matchedSession || null,
      runningSessions: statusReport.screen?.sessions || [],
      files: totals.files || 0,
      bytes: totals.bytes || 0,
      events: totals.events || 0,
      btcEvents: totals.btcEvents || 0,
      btcLiquidationEvents: totals.btcLiquidationEvents || 0,
      btcLongLiquidationEvents: totals.btcLongLiquidationEvents || 0,
      btcShortLiquidationEvents: totals.btcShortLiquidationEvents || 0,
      providerStatusEvents: totals.providerStatusEvents || 0,
      dataPayloadEvents: totals.dataPayloadEvents || 0,
      lastDataPayloadAt: lastDataPayload.at || '',
      lastDataPayloadAgeMinutes: lastDataPayload.ageMinutes,
      lastDataPayloadPath: lastDataPayload.path || '',
      lastDataPayloadEventType: lastDataPayload.eventType || '',
      staleDataPayloadMinutes: lastDataPayload.staleAfterMinutes || options.staleDataPayloadMinutes,
      lastEventAt: totals.lastEventAt || '',
      lastEventPath: totals.lastEventPath || '',
      lastProviderStatusAt: totals.lastProviderStatusAt || '',
      lastProviderStatusPath: totals.lastProviderStatusPath || '',
      lastProviderStatusAgeMinutes,
      parseErrors: totals.parseErrors || 0,
    },
    candidates: {
      btcLiquidationEvents: candidateTotals.btcLiquidationEvents || 0,
      total: candidateTotals.candidates || 0,
      longLiquidation: candidateTotals.longLiquidationCandidates || 0,
      shortLiquidation: candidateTotals.shortLiquidationCandidates || 0,
      fullSensorReady: candidateTotals.fullSensorReadyCandidates || 0,
    },
    attention,
  }
}

function buildAttention(screen, totals, candidateTotals, heartbeatAgeMinutes, captureHealth = {}) {
  const reasons = []

  if (screen.status !== 'running') {
    reasons.push('capture_screen_not_running')
  }
  if (heartbeatAgeMinutes === null) {
    reasons.push('missing_provider_heartbeat')
  } else if (heartbeatAgeMinutes > staleHeartbeatMinutes) {
    reasons.push('provider_heartbeat_stale')
  }
  if ((totals.parseErrors || 0) > 0) {
    reasons.push('parse_errors_present')
  }
  if (captureHealth.status === 'connected_no_payload') {
    reasons.push('capture_connected_no_payload')
  }
  if (captureHealth.status === 'market_payload_stale' || captureHealth.reasons?.includes('data_payload_stale')) {
    reasons.push('market_payload_stale')
  }
  if ((candidateTotals.longLiquidationCandidates || 0) > 0 || (totals.btcLongLiquidationEvents || 0) > 0) {
    reasons.push('long_liquidation_candidate_available')
  }

  return {
    needsAttention: reasons.length > 0,
    staleHeartbeatMinutes,
    reasons,
  }
}

function minutesSince(timestamp, nowTimestamp) {
  if (!timestamp) {
    return null
  }
  const timestampMs = new Date(timestamp).getTime()
  const nowMs = new Date(nowTimestamp).getTime()
  if (!Number.isFinite(timestampMs) || !Number.isFinite(nowMs)) {
    return null
  }
  return Math.round(((nowMs - timestampMs) / 60_000) * 10) / 10
}

function printSummary(report) {
  console.log('Daily crypto capture check')
  console.log(`Capture screen: ${report.capture.screenStatus}`)
  console.log(`Capture health: ${report.capture.healthStatus}`)
  console.log(`Capture health reasons: ${report.capture.healthReasons.join(', ') || 'none'}`)
  console.log(`Screen name: ${report.screenName}`)
  console.log(`Last provider status at: ${report.capture.lastProviderStatusAt || 'n/a'}`)
  console.log(
    `Last provider status age: ${
      report.capture.lastProviderStatusAgeMinutes === null ? 'n/a' : `${report.capture.lastProviderStatusAgeMinutes}m`
    }`,
  )
  console.log(`Last data payload at: ${report.capture.lastDataPayloadAt || 'n/a'}`)
  console.log(
    `Last data payload age: ${
      report.capture.lastDataPayloadAgeMinutes === null ? 'n/a' : `${report.capture.lastDataPayloadAgeMinutes}m`
    }`,
  )
  console.log(`Last data payload type: ${report.capture.lastDataPayloadEventType || 'n/a'}`)
  console.log(`BTC events: ${report.capture.btcEvents}`)
  console.log(`BTC liquidation events: ${report.capture.btcLiquidationEvents}`)
  console.log(`BTC long liquidation events: ${report.capture.btcLongLiquidationEvents}`)
  console.log(`BTC short liquidation events: ${report.capture.btcShortLiquidationEvents}`)
  console.log(`Long liquidation candidates: ${report.candidates.longLiquidation}`)
  console.log(`Short liquidation candidates: ${report.candidates.shortLiquidation}`)
  console.log(`Full sensor ready candidates: ${report.candidates.fullSensorReady}`)
  console.log(`Parse errors: ${report.capture.parseErrors}`)
  console.log(`Needs attention: ${report.attention.needsAttention}`)
  console.log(`Attention reasons: ${report.attention.reasons.join(', ') || 'none'}`)
  console.log(`Daily report: ${report.reports.daily}`)
}

function printHelp() {
  console.log(`Usage: npm run crypto:daily-check -- [options]

Options:
  --screen=<name>              Screen session name. Default: ${defaultScreenName}.
  --status-report=<path>       Capture status report path.
  --candidates-report=<path>   Phase C candidate report path.
  --report=<path>              Daily check report path.
  --stale-data-payload-min=<minutes>
                               Mark market payload stale after this many minutes. Default: ${staleDataPayloadMinutes}.
`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
