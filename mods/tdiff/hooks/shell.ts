import type { CoreEngineInterface } from 'claude-code'

import type { TdiffShellReason } from '../types'
import { sha } from './hash'
import { isUnder, relative } from './paths'

type Engine = Pick<CoreEngineInterface, 'process' | 'fs' | 'clock'>

export type Shadow = { gitDir: string; indexFile: string; root: string; cacheDir: string }

export type TreeChange = { path: string; baseBlob: string | null }

export const SNAPSHOT_BUDGET_MS = 5_000
const MAX_CHANGES = 500
const SKIPPED_MODES = new Set(['160000', '120000'])
const ATTRIBUTES = '* -text -eol -filter -ident -working-tree-encoding\n'

const EXCLUDES = [
  '.git/',
  '.hg/',
  '.svn/',
  '.jj/',
  'node_modules/',
  '.venv/',
  'venv/',
  '__pycache__/',
  '.mypy_cache/',
  '.pytest_cache/',
  '.ruff_cache/',
  '.tox/',
  '.next/',
  '.turbo/',
  '.gradle/',
  '.terraform/',
  '.DS_Store',
]

export class ShellOff extends Error {
  constructor(readonly reason: TdiffShellReason) {
    super(reason)
  }
}

export async function shadowFor(cacheDir: string, sessionDir: string, root: string): Promise<Shadow> {
  const id = (await sha(root)).slice(0, 40)
  return { gitDir: `${cacheDir}/shadow/${id}`, indexFile: `${sessionDir}/index-${id}`, root, cacheDir }
}

function envOf(shadow: Shadow): Record<string, string> {
  return {
    GIT_DIR: shadow.gitDir,
    GIT_WORK_TREE: shadow.root,
    GIT_INDEX_FILE: shadow.indexFile,
    GIT_OBJECT_DIRECTORY: `${shadow.gitDir}/objects`,
    GIT_COMMON_DIR: shadow.gitDir,
    GIT_ALTERNATE_OBJECT_DIRECTORIES: '',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: `${shadow.gitDir}/empty-config`,
    GIT_CONFIG_COUNT: '0',
    GIT_CONFIG_PARAMETERS: '',
    GIT_NAMESPACE: '',
    GIT_ATTR_NOSYSTEM: '1',
  }
}

function git($: Engine, shadow: Shadow, args: string[], timeoutMs?: number) {
  const argv = [
    'git',
    `--git-dir=${shadow.gitDir}`,
    `--work-tree=${shadow.root}`,
    '-c',
    'core.quotepath=off',
    '-c',
    'core.autocrlf=false',
    '-c',
    'core.fsmonitor=false',
    '-c',
    'gc.auto=0',
    ...args,
  ]
  return $.process.run(argv, { cwd: shadow.root, env: envOf(shadow), ...(timeoutMs === undefined ? {} : { timeoutMs }) })
}

export function guard(root: string, home: string): TdiffShellReason | null {
  if (root === '/') return 'root-is-fs-root'
  if (home !== '' && isUnder(home, root)) return 'root-is-home'
  return null
}

export async function prime($: Engine, shadow: Shadow) {
  const version = await $.process.run(['git', '--version']).catch(() => undefined)
  if (version === undefined || version.exitCode !== 0) throw new ShellOff('no-git')

  const own = isUnder(shadow.cacheDir, shadow.root) ? [`/${relative(shadow.cacheDir, shadow.root)}/`] : []
  await $.fs.write(`${shadow.gitDir}/empty-config`, '')
  await $.fs.write(`${shadow.gitDir}/info/exclude`, `${[...EXCLUDES, ...own].join('\n')}\n`)
  await $.fs.write(`${shadow.gitDir}/info/attributes`, ATTRIBUTES)
  if (!(await $.fs.exists(`${shadow.gitDir}/HEAD`))) {
    const made = await git($, shadow, ['init', '--quiet', '--template='])
    if (made.exitCode !== 0) throw new ShellOff('failed')
  }
  await snapshot($, shadow)
}

async function timed($: Engine, shadow: Shadow, args: string[], startedAt: number) {
  const left = SNAPSHOT_BUDGET_MS - ((await $.clock.now()) - startedAt)
  if (left <= 0) throw new ShellOff('too-slow')
  const ran = await git($, shadow, args, left).catch(() => undefined)
  if (ran === undefined || (await $.clock.now()) - startedAt > SNAPSHOT_BUDGET_MS) throw new ShellOff('too-slow')
  return ran
}

export async function snapshot($: Engine, shadow: Shadow) {
  const startedAt = await $.clock.now()
  const added = await timed($, shadow, ['add', '-A', '--ignore-errors'], startedAt)
  if (added.exitCode > 1) throw new ShellOff('failed')
  const written = await timed($, shadow, ['write-tree'], startedAt)
  const tree = written.stdout.trim()
  if (written.exitCode !== 0 || tree === '') throw new ShellOff('failed')
  return tree
}

export async function changes($: Engine, shadow: Shadow, before: string, after: string): Promise<TreeChange[]> {
  if (before === after) return []
  const listed = await git($, shadow, ['diff-tree', '-r', '-z', '--no-renames', before, after])
  if (listed.exitCode !== 0) throw new ShellOff('failed')
  const parts = listed.stdout.split('\0')
  const found: TreeChange[] = []
  for (let i = 0; i + 1 < parts.length && found.length < MAX_CHANGES; i += 2) {
    const meta = parts[i] as string
    const rel = parts[i + 1] as string
    if (!meta.startsWith(':')) break
    const [fromMode = '', toMode = '', fromBlob = '', , status = ''] = meta.slice(1).split(' ')
    if (SKIPPED_MODES.has(fromMode) || SKIPPED_MODES.has(toMode)) continue
    found.push({ path: `${shadow.root}/${rel}`, baseBlob: status.startsWith('A') ? null : fromBlob })
  }
  return found
}

export async function blob($: Engine, shadow: Shadow, id: string) {
  const read = await git($, shadow, ['cat-file', 'blob', id])
  if (read.exitCode !== 0) throw new ShellOff('failed')
  return { text: read.stdout, isTruncated: read.isStdoutTruncated }
}

export async function blobIdOf($: Engine, shadow: Shadow, path: string) {
  const read = await git($, shadow, ['hash-object', '--no-filters', '--', path])
  const id = read.stdout.trim()
  return read.exitCode === 0 && id !== '' ? id : undefined
}
