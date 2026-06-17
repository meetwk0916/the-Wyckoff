import { readFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { workspaceDir } from './lib/io.mjs'
import { parseJsonl, validateRecording } from './lib/contract.mjs'

const recordingsDir = resolve(workspaceDir, 'fixtures/recordings')

async function main() {
  let files = []
  try {
    files = (await readdir(recordingsDir)).filter((name) => name.endsWith('.jsonl')).sort()
  } catch {
    console.error(`No recordings directory at ${recordingsDir}`)
    process.exit(1)
  }
  if (files.length === 0) {
    console.error('No .jsonl recordings found to validate.')
    process.exit(1)
  }

  let failed = false
  for (const file of files) {
    const text = await readFile(resolve(recordingsDir, file), 'utf8')
    const events = parseJsonl(text)
    const result = validateRecording(events)
    const countSummary = Object.entries(result.counts)
      .filter(([, n]) => n > 0)
      .map(([type, n]) => `${type}:${n}`)
      .join(' ')
    if (result.ok) {
      console.log(`OK   ${file} (${result.total} events) [${countSummary}]`)
    } else {
      failed = true
      console.error(`FAIL ${file} (${result.total} events)`) 
      for (const err of result.errors) {
        console.error(`  - #${err.index} ${err.error}${err.eventType ? ` (${err.eventType})` : ''}`)
      }
    }
  }

  if (failed) {
    console.error('Contract validation failed.')
    process.exit(1)
  }
  console.log('Contract validation passed.')
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
