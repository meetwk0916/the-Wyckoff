import { execFile } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const workspaceDir = dirname(dirname(fileURLToPath(import.meta.url)))
const repoDir = dirname(workspaceDir)
const defaultWatchReportPath = resolve(workspaceDir, 'reports/phase-c-watch-last.json')
const defaultExportPath = resolve(repoDir, 'public/mock/crypto-phase-c-watch.json')

async function main() {
  const options = parseArgs(process.argv.slice(2))

  if (options.refresh) {
    await runScript('runPhaseCWatch.mjs', [`--report=${options.watchReportPath}`])
  }

  const watchReport = JSON.parse(await readFile(options.watchReportPath, 'utf8'))
  const exportPayload = {
    ...watchReport,
    exportedAt: new Date().toISOString(),
    sourceReport: options.watchReportPath,
  }

  await mkdir(dirname(options.exportPath), { recursive: true })
  await writeFile(options.exportPath, `${JSON.stringify(exportPayload, null, 2)}\n`)

  console.log(`Phase C watch mock exported to ${options.exportPath}`)
}

function parseArgs(args) {
  const options = {
    refresh: true,
    watchReportPath: defaultWatchReportPath,
    exportPath: defaultExportPath,
  }

  for (const arg of args) {
    if (arg === '--no-refresh') {
      options.refresh = false
    } else if (arg.startsWith('--watch-report=')) {
      options.watchReportPath = resolve(arg.slice('--watch-report='.length))
    } else if (arg.startsWith('--output=')) {
      options.exportPath = resolve(arg.slice('--output='.length))
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
      cwd: repoDir,
      maxBuffer: 30 * 1024 * 1024,
    })
  } catch (error) {
    const output = `${error.stdout || ''}${error.stderr || ''}`.trim()
    throw new Error(output || `Failed to run ${scriptName}`)
  }
}

function printHelp() {
  console.log(`Usage: npm run crypto:phase-c:watch:export -- [options]

Options:
  --no-refresh             Export the existing watch report without rerunning watch.
  --watch-report=<path>    Source watch report path.
  --output=<path>          Public mock output path.
`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
