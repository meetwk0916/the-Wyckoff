import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises'
import { dirname, resolve, basename } from 'node:path'
import { fileURLToPath } from 'node:url'

export const workspaceDir = dirname(dirname(dirname(fileURLToPath(import.meta.url))))
export const fixturesDir = resolve(workspaceDir, 'fixtures')
export const reportsDir = resolve(workspaceDir, 'reports')

export async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'))
}

export async function readOptionalJson(path) {
  try {
    return await readJson(path)
  } catch {
    return null
  }
}

export async function writeJsonReport(path, payload) {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(payload, null, 2)}\n`)
}

export async function listFixtureFiles(dir = fixturesDir) {
  const entries = await readdir(dir)
  return entries
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => resolve(dir, name))
}

export async function loadFixtures(dir = fixturesDir) {
  const files = await listFixtureFiles(dir)
  const fixtures = []
  for (const file of files) {
    const fixture = await readJson(file)
    fixtures.push({ ...fixture, sourceFile: basename(file) })
  }
  return fixtures
}
