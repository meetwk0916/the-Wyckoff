import { execFile } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const workspaceDir = dirname(dirname(fileURLToPath(import.meta.url)))
const defaultConfigPath = resolve(workspaceDir, 'config/replay-fixtures.json')
const defaultReportDir = resolve(workspaceDir, 'reports/fixtures')
const defaultSummaryPath = resolve(workspaceDir, 'reports/replay-fixtures-last.json')
const replayScriptPath = resolve(workspaceDir, 'src/runReplayWindow.mjs')

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const config = JSON.parse(await readFile(options.configPath, 'utf8'))
  const fixtures = Array.isArray(config.fixtures) ? config.fixtures : []

  await mkdir(options.reportDir, { recursive: true })
  await mkdir(dirname(options.summaryPath), { recursive: true })

  const results = []
  for (const fixture of fixtures) {
    if (options.fixtureId !== 'all' && fixture.id !== options.fixtureId) {
      continue
    }
    results.push(await runFixture(fixture, options))
  }
  if (results.length === 0) {
    throw new Error(`No replay fixtures matched --fixture=${options.fixtureId}`)
  }

  const summary = {
    reportType: 'crypto_replay_fixtures',
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    configPath: options.configPath,
    reportDir: options.reportDir,
    totals: buildTotals(results),
    fixtures: results,
  }

  await writeFile(options.summaryPath, `${JSON.stringify(summary, null, 2)}\n`)
  printSummary(summary, options.summaryPath)
  if (summary.totals.failed > 0) {
    process.exitCode = 1
  }
}

function parseArgs(args) {
  const options = {
    configPath: defaultConfigPath,
    reportDir: defaultReportDir,
    summaryPath: defaultSummaryPath,
    fixtureId: 'all',
  }

  for (const arg of args) {
    if (arg.startsWith('--config=')) {
      options.configPath = resolve(arg.slice('--config='.length))
    } else if (arg.startsWith('--report-dir=')) {
      options.reportDir = resolve(arg.slice('--report-dir='.length))
    } else if (arg.startsWith('--summary=')) {
      options.summaryPath = resolve(arg.slice('--summary='.length))
    } else if (arg.startsWith('--fixture=')) {
      options.fixtureId = arg.slice('--fixture='.length)
    } else if (arg === '--help' || arg === '-h') {
      printHelp()
      process.exit(0)
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }

  return options
}

async function runFixture(fixture, options) {
  const reportPath = resolve(options.reportDir, `${fixture.id}.json`)
  const args = [
    replayScriptPath,
    `--start=${fixture.start}`,
    `--end=${fixture.end}`,
    `--event-type=${fixture.eventType || 'all'}`,
    `--symbol=${fixture.symbol || 'BTC'}`,
    `--provider=${fixture.provider || 'all'}`,
    `--limit=${fixture.limit || 200}`,
    `--report=${reportPath}`,
  ]

  await execFileAsync(process.execPath, args)
  const report = JSON.parse(await readFile(reportPath, 'utf8'))
  const checks = buildChecks(fixture, report)

  return {
    id: fixture.id,
    description: fixture.description,
    reportPath,
    status: checks.every((check) => check.passed) ? 'passed' : 'failed',
    filters: report.filters,
    totals: report.totals,
    byEventType: report.byEventType,
    byInstrumentType: report.byInstrumentType,
    latency: report.latency,
    evidence: report.evidence,
    checks,
  }
}

function buildChecks(fixture, report) {
  const expected = fixture.expected || {}
  const checks = []

  if (typeof expected.minimumPhaseCReady === 'boolean') {
    checks.push({
      name: 'minimumPhaseCReady',
      expected: expected.minimumPhaseCReady,
      actual: Boolean(report.evidence?.minimumPhaseCReady),
      passed: Boolean(report.evidence?.minimumPhaseCReady) === expected.minimumPhaseCReady,
    })
  }

  if (typeof expected.fullSensorReady === 'boolean') {
    checks.push({
      name: 'fullSensorReady',
      expected: expected.fullSensorReady,
      actual: Boolean(report.evidence?.fullSensorReady),
      passed: Boolean(report.evidence?.fullSensorReady) === expected.fullSensorReady,
    })
  }

  for (const eventType of expected.requiredEventTypes || []) {
    checks.push({
      name: `hasEventType:${eventType}`,
      expected: true,
      actual: Boolean(report.byEventType?.[eventType]),
      passed: Boolean(report.byEventType?.[eventType]),
    })
  }

  return checks
}

function buildTotals(results) {
  return {
    fixtures: results.length,
    passed: results.filter((result) => result.status === 'passed').length,
    failed: results.filter((result) => result.status === 'failed').length,
  }
}

function printSummary(summary, summaryPath) {
  console.log(`Replay fixture summary written to ${summaryPath}`)
  console.log(`Fixtures: ${summary.totals.fixtures}`)
  console.log(`Passed: ${summary.totals.passed}`)
  console.log(`Failed: ${summary.totals.failed}`)
}

function printHelp() {
  console.log(`Usage: npm run crypto:fixtures -- [options]

Options:
  --config=<path>      Replay fixture config path.
  --fixture=<id>       Fixture id to run. Default: all.
  --report-dir=<path>  Per-fixture replay report directory.
  --summary=<path>     Fixture summary report path.
`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
