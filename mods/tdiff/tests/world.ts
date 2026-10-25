import type { CommandSpec, On, UiPane } from 'claude-code'
import { mock } from 'claude-code/testing'

import type { TdiffOpen, TdiffRow, TdiffShell, TdiffWhere } from '../types'

type File = { text: string; mtimeMs: number; size?: number }
type GitCall = { argv: readonly string[]; env: Record<string, string>; timeoutMs?: number }
type Options = { home?: string; root?: string; cache?: string; git?: 'ok' | 'missing'; gitDelayMs?: number; isPlaced?: boolean; isStateLive?: boolean }

let sessions = 0

export const START = { surface: 'terminal', isInteractive: true } as const

export function world(on: On, options: Options = {}) {
  const home = options.home ?? '/home/test'
  const root = options.root ?? '/work/app'
  const cache = options.cache ?? `${home}/.cache`
  const clock = mock.clock(on, { now: 1_000 })
  mock.env(on, options.cache === undefined ? { HOME: home } : { HOME: home, XDG_CACHE_HOME: options.cache })

  sessions += 1
  const session = { id: `t${sessions}-s1`, cwd: root, root }
  const files = new Map<string, File>()
  const state = new Map<string, { value: unknown; version: number }>()
  const gitCalls: GitCall[] = []
  const bash: { effect: (command: string) => void | Promise<void> } = { effect: () => undefined }

  const put = (path: string, text: string, size?: number) =>
    files.set(path, { text, mtimeMs: clock.now(), ...(size === undefined ? {} : { size }) })
  const isDir = (path: string) => [...files.keys()].some(key => key.startsWith(`${path}/`))

  const faults = { fs: false, baseWrites: 0 }
  const gates = new Map<string, Promise<void>>()
  const toolRuns: string[] = []
  const gate = (path: string) => {
    let open = () => undefined as void
    gates.set(path, new Promise<void>(done => (open = done)))
    return () => {
      gates.delete(path)
      open()
    }
  }
  on('fs.read', ($, e) => {
    if (faults.fs) return { deny: 'broken' }
    const file = files.get(e.path)
    if (file === undefined) return { deny: `ENOENT: ${e.path}` }
    if ((file.size ?? 0) > 4 * 1024 * 1024) return { deny: 'too large' }
    return { value: e.as === 'bytes' ? { base64: btoa(file.text) } : file.text }
  })
  on('fs.write', ($, e) => {
    if (faults.fs) return { deny: 'disk full' }
    if (faults.baseWrites > 0 && e.path.includes('/base/')) {
      faults.baseWrites -= 1
      return { deny: 'disk full' }
    }
    put(e.path, e.text)
    return { value: undefined }
  })
  on('fs.exists', ($, e) => ({ value: files.has(e.path) || isDir(e.path) }))
  on('fs.stat', async ($, e) => {
    await gates.get(e.path)
    if (faults.fs) return { deny: 'broken' }
    const file = files.get(e.path)
    if (file !== undefined) {
      return { value: { kind: 'file', size: file.size ?? file.text.length, mtimeMs: file.mtimeMs, isLink: false } }
    }
    if (isDir(e.path)) return { value: { kind: 'dir', size: 0, mtimeMs: 0, isLink: false } }
    return { deny: `ENOENT: ${e.path}` }
  })

  if (options.isStateLive !== true) {
    on('state.get', ($, e) => {
      const held = state.get(`${e.plugin}/${e.key}`)
      return { value: held ?? { value: undefined, version: 0 } }
    })
    on('state.set', ($, e) => {
      const name = `${e.plugin}/${e.key}`
      const version = state.get(name)?.version ?? 0
      if (e.ifVersion !== undefined && e.ifVersion !== version) return { value: { isSet: false, version } }
      state.set(name, { value: e.value, version: version + 1 })
      return { value: { isSet: true, version: version + 1 } }
    })
  }

  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.end', ($, e) => ({ sessionId: e.sessionId }))
  on('turn.complete', () => ({ text: '' }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('session.id', () => ({ value: session.id }))
  on('session.cwd', () => ({ value: session.cwd }))
  on('session.root', () => ({ value: session.root }))

  const commands: CommandSpec[] = []
  const panes: UiPane[] = []
  const isPlaced = options.isPlaced ?? true
  on('command.register', ($, e) => (commands.push(e), { value: { command: e.name } }))
  on('ui.panes', () => ({ value: [...panes] }))
  on('ui.open', ($, e) => {
    if (!panes.some(pane => pane.id === e.id)) {
      panes.push({ id: e.id, title: e.title ?? e.id, isShown: isPlaced, isFocused: false, isPlaced })
    }
    return { value: isPlaced ? { isPlaced: true } : { isPlaced: false, reason: 'narrow terminal' } }
  })
  on('ui.close', ($, e) => {
    const at = panes.findIndex(pane => pane.id === e.id)
    if (at >= 0) panes.splice(at, 1)
    return { value: undefined }
  })

  on('tool.call', { tool: 'Write' }, ($, e) => {
    toolRuns.push(`Write ${e.file_path}`)
    put(e.file_path, e.content)
    return { result: 'written' }
  })
  on('tool.call', { tool: 'Edit' }, ($, e) => {
    const file = files.get(e.file_path)
    if (file === undefined || !file.text.includes(e.old_string)) return { result: 'no match', isError: true } as never
    put(e.file_path, file.text.replace(e.old_string, e.new_string))
    return { result: 'edited' }
  })
  on('tool.call', { tool: 'NotebookEdit' }, ($, e) => {
    put(e.notebook_path, e.new_source)
    return { result: 'edited' }
  })
  on('tool.call', { tool: 'Bash' }, async ($, e) => {
    await bash.effect(e.command)
    return { result: 'ran' }
  })

  const blobs = new Map<string, string>()
  const blobIds = new Map<string, string>()
  const trees = new Map<string, Map<string, string>>()
  const treeIds = new Map<string, string>()
  const indexes = new Map<string, Map<string, string>>()
  const blobOf = (text: string) => {
    let id = blobIds.get(text)
    if (id === undefined) {
      id = `b${blobIds.size + 1}`.padEnd(40, '0')
      blobIds.set(text, id)
      blobs.set(id, text)
    }
    return id
  }
  const ok = (stdout = '') => ({
    value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
  })

  on('process.run', async ($, e) => {
    const env = e.init?.env ?? {}
    gitCalls.push({ argv: e.argv, env, ...(e.init?.timeoutMs === undefined ? {} : { timeoutMs: e.init.timeoutMs }) })
    if (e.argv[0] !== 'git' || options.git === 'missing') return { deny: 'ENOENT: cannot start' }
    if (e.argv[1] === '--version') return ok('git version 2.0.0\n')
    const args = [...e.argv.slice(1)]
    let gitDir = ''
    let workTree = ''
    const rest: string[] = []
    for (let i = 0; i < args.length; i++) {
      const arg = args[i] as string
      if (arg.startsWith('--git-dir=')) gitDir = arg.slice(10)
      else if (arg.startsWith('--work-tree=')) workTree = arg.slice(12)
      else if (arg === '-c') i++
      else rest.push(arg)
    }
    const [sub] = rest
    const fail = (stderr: string) => ({
      value: { exitCode: 128, stdout: '', stderr, isStdoutTruncated: false, isStderrTruncated: false },
    })
    const parentOf = (path: string) => path.slice(0, path.lastIndexOf('/'))
    if (sub === 'init') {
      if (!isDir(gitDir)) return fail(`fatal: Invalid path '${parentOf(gitDir)}'`)
      put(`${gitDir}/HEAD`, 'ref: refs/heads/main\n')
      if (!files.has(`${gitDir}/info/exclude`)) put(`${gitDir}/info/exclude`, '# git ls-files\n')
      return ok()
    }
    if (!files.has(`${gitDir}/HEAD`)) return fail(`fatal: not a git repository: '${gitDir}'`)
    if (sub === 'hash-object') {
      const file = files.get(rest[rest.length - 1] ?? '')
      return file === undefined ? fail('fatal: could not open') : ok(`${blobOf(file.text)}\n`)
    }
    if (sub === 'add') {
      if (!isDir(parentOf(env.GIT_INDEX_FILE ?? ''))) return fail(`fatal: Unable to create '${env.GIT_INDEX_FILE}.lock'`)
      if (options.gitDelayMs !== undefined) {
        const limit = e.init?.timeoutMs ?? 30_000
        await clock.advance(Math.min(options.gitDelayMs, limit))
        if (options.gitDelayMs > limit) return { deny: 'timed out: killed' }
      }
      const excludes = (files.get(`${gitDir}/info/exclude`)?.text ?? '').split('\n').filter(line => line !== '')
      const index = new Map<string, string>()
      for (const [path, file] of files) {
        if (!path.startsWith(`${workTree}/`)) continue
        const rel = path.slice(workTree.length + 1)
        const segments = rel.split('/')
        const isExcluded = excludes.some(pattern =>
          pattern.startsWith('/')
            ? `/${rel}`.startsWith(pattern)
            : pattern.endsWith('/')
              ? segments.slice(0, -1).includes(pattern.slice(0, -1))
              : segments.includes(pattern),
        )
        if (!isExcluded) index.set(rel, blobOf(file.text))
      }
      indexes.set(env.GIT_INDEX_FILE ?? '', index)
      return ok()
    }
    if (sub === 'write-tree') {
      const index = indexes.get(env.GIT_INDEX_FILE ?? '') ?? new Map<string, string>()
      const key = JSON.stringify([...index].sort())
      let id = treeIds.get(key)
      if (id === undefined) {
        id = `t${treeIds.size + 1}`.padEnd(40, '0')
        treeIds.set(key, id)
        trees.set(id, new Map(index))
      }
      return ok(`${id}\n`)
    }
    if (sub === 'diff-tree') {
      const [from, to] = rest.slice(-2).map(id => trees.get(id) ?? new Map<string, string>())
      const out: string[] = []
      const zero = '0'.repeat(40)
      for (const rel of [...new Set([...from!.keys(), ...to!.keys()])].sort()) {
        const a = from!.get(rel)
        const b = to!.get(rel)
        if (a === b) continue
        if (a === undefined) out.push(`:000000 100644 ${zero} ${b} A`, rel)
        else if (b === undefined) out.push(`:100644 000000 ${a} ${zero} D`, rel)
        else out.push(`:100644 100644 ${a} ${b} M`, rel)
      }
      return ok(out.map(part => `${part}\0`).join(''))
    }
    if (sub === 'cat-file') return ok(blobs.get(rest[rest.length - 1] ?? '') ?? '')
    return { value: { exitCode: 129, stdout: '', stderr: 'unknown', isStdoutTruncated: false, isStderrTruncated: false } }
  })

  const unwrap = <T>(key: string): T | undefined => {
    const held = state.get(`tdiff/${key}`)?.value as { value: T } | undefined
    return held?.value
  }

  return {
    home,
    root,
    cache,
    clock,
    session,
    files,
    gitCalls,
    toolRuns,
    gate,
    commands,
    panes,
    bash,
    faults,
    put,
    text: (path: string) => files.get(path)?.text,
    dataDir: (id = session.id) => `${cache}/claude-tdiff/${id}`,
    shadowDir: `${cache}/claude-tdiff/shadow/`,
    rows: () => unwrap<TdiffRow[]>('rows') ?? [],
    open: () => unwrap<TdiffOpen | null>('open') ?? null,
    shell: () => unwrap<TdiffShell>('shell'),
    where: () => unwrap<TdiffWhere>('where'),
    seedOpen: (path: string) =>
      state.set('tdiff/open', {
        value: { shape: 'open-1', value: { path, diff: null, note: null } },
        version: (state.get('tdiff/open')?.version ?? 0) + 1,
      }),
  }
}
