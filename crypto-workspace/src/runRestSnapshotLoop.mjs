import { execFile } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const workspaceDir = dirname(dirname(fileURLToPath(import.meta.url)))
const defaultDataDir = resolve(workspaceDir, 'data/raw')
const defaultReportPath = resolve(workspaceDir, 'reports/rest-snapshot-loop-last.json')

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const startedAt = new Date()
  const deadlineMs = startedAt.getTime() + options.durationSec * 1000
  const report = {
    reportType: 'crypto_rest_snapshot_loop',
    schemaVersion: 1,
    startedAt: startedAt.toISOString(),
    finishedAt: '',
    provider: options.provider,
    eventType: options.eventType,
    intervalSec: options.intervalSec,
    durationSec: options.durationSec,
    iterations: [],
    totals: {
      iterations: 0,
      capturedEndpoints: 0,
      errorEndpoints: 0,
    },
  }

  await mkdir(dirname(options.reportPath), { recursive: true })

  while (Date.now() < deadlineMs) {
    const iteration = await runSnapshotIteration(options)
    report.iterations.push(iteration)
    report.totals.iterations += 1
    report.totals.capturedEndpoints += iteration.capturedEndpoints
    report.totals.errorEndpoints += iteration.errorEndpoints
    report.finishedAt = new Date().toISOString()
    await writeFile(options.reportPath, `${JSON.stringify(report, null, 2)}\n`)

    if (Date.now() + options.intervalSec * 1000 >= deadlineMs) {
      break
    }
    await sleep(options.intervalSec * 1000)
  }

  report.finishedAt = new Date().toISOString()
  await writeFile(options.reportPath, `${JSON.stringify(report, null, 2)}\n`)
  printSummary(report, options.reportPath)
}

function parseArgs(args) {
  const options = {
    provider: 'all',
    eventType: 'derivatives_state',
    intervalSec: 300,
    durationSec: 72 * 60 * 60,
    dataDir: defaultDataDir,
    reportPath: defaultReportPath,
    ignoreProxy: false,
  }

  for (const arg of args) {
    if (arg.startsWith('--provider=')) {
      options.provider = arg.slice('--provider='.length)
    } else if (arg.startsWith('--event-type=')) {
      options.eventType = arg.slice('--event-type='.length)
    } else if (arg.startsWith('--interval-sec=')) {
      options.intervalSec = parsePositiveNumber(arg.slice('--interval-sec='.length), '--interval-sec')
    } else if (arg.startsWith('--duration-sec=')) {
      options.durationSec = parsePositiveNumber(arg.slice('--duration-sec='.length), '--duration-sec')
    } else if (arg.startsWith('--duration-hours=')) {
      options.durationSec = parsePositiveNumber(arg.slice('--duration-hours='.length), '--duration-hours') * 60 * 60
    } else if (arg.startsWith('--data-dir=')) {
      options.dataDir = resolve(arg.slice('--data-dir='.length))
    } else if (arg.startsWith('--report=')) {
      options.reportPath = resolve(arg.slice('--report='.length))
    } else if (arg === '--ignore-proxy') {
      options.ignoreProxy = true
    } else if (arg === '--help' || arg === '-h') {
      printHelp()
      process.exit(0)
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }

  return options
}

function parsePositiveNumber(value, name) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive number, got: ${value}`)
  }
  return parsed
}

async function runSnapshotIteration(options) {
  const startedAt = new Date()
  const iterationReportPath = resolve(
    dirname(options.reportPath),
    `rest-snapshot-${startedAt.toISOString().replace(/[:.]/g, '-')}.json`,
  )

  try {
    await runScript('runRestCapture.mjs', [
      `--provider=${options.provider}`,
      `--event-type=${options.eventType}`,
      `--data-dir=${options.dataDir}`,
      `--report=${iterationReportPath}`,
      ...(options.ignoreProxy ? ['--ignore-proxy'] : []),
    ])
    const iterationReport = JSON.parse(await readFile(iterationReportPath, 'utf8'))
    const endpoints = iterationReport.endpoints || []

    return {
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      status: endpoints.some((endpoint) => endpoint.status === 'error') ? 'partial' : 'ok',
      reportPath: iterationReportPath,
      endpoints: endpoints.length,
      capturedEndpoints: endpoints.filter((endpoint) => endpoint.status === 'captured').length,
      errorEndpoints: endpoints.filter((endpoint) => endpoint.status === 'error').length,
    }
  } catch (error) {
    return {
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      status: 'error',
      reportPath: iterationReportPath,
      endpoints: 0,
      capturedEndpoints: 0,
      errorEndpoints: 1,
      error: error instanceof Error ? error.message : 'unknown snapshot loop error',
    }
  }
}

async function runScript(scriptName, args) {
  const scriptPath = resolve(workspaceDir, 'src', scriptName)
  await execFileAsync(process.execPath, [scriptPath, ...args], {
    cwd: dirname(workspaceDir),
    maxBuffer: 20 * 1024 * 1024,
  })
}

function sleep(ms) {
  return new Promise((resolveSleep) => {
    setTimeout(resolveSleep, ms)
  })
}

function printSummary(report, reportPath) {
  console.log(`REST snapshot loop report written to ${reportPath}`)
  console.log(`Iterations: ${report.totals.iterations}`)
  console.log(`Captured endpoints: ${report.totals.capturedEndpoints}`)
  console.log(`Error endpoints: ${report.totals.errorEndpoints}`)
}

function printHelp() {
  console.log(`Usage: npm run crypto:rest-snapshot-loop -- [options]

Options:
  --provider=<name>        Provider to capture: all, binance, okx. Default: all.
  --event-type=<type>      Event type: derivatives_state, open_interest, funding_rate, all. Default: derivatives_state.
  --interval-sec=<num>     Seconds between snapshots. Default: 300.
  --duration-sec=<num>     Total runtime in seconds. Default: 259200.
  --duration-hours=<num>   Total runtime in hours. Overrides duration seconds.
  --data-dir=<path>        Output data directory.
  --report=<path>          Loop summary report path.
  --ignore-proxy           Pass --ignore-proxy to each REST capture iteration.
`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
