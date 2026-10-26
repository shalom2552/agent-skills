import { atom, read, update } from 'claude-code'
import type { CoreEngineInterface, On } from 'claude-code'

import type { TdiffKind, TdiffNoText, TdiffOpen, TdiffRow, TdiffShell } from '../types'
import { diffText } from './diff'
import { sha } from './hash'
import { commandPaths } from './parse'
import { isUnder, normalize, resolve } from './paths'
import { blob, blobIdOf, changes, guard, prime, shadowFor, ShellOff, snapshot } from './shell'
import type { Shadow } from './shell'

export type Engine = Pick<CoreEngineInterface, 'state' | 'fs' | 'session' | 'clock' | 'env' | 'process'>

type Snap = { state: 'absent' } | { state: 'text' | 'binary' | 'too-large'; sig: string }
type Stat = { mtimeMs: number; size: number }
type Seen = { snap: Snap; stat: Stat | null; text: string | null }

type FileRecord = {
  path: string
  hash: string
  base: Snap
  latest: Snap | null
  latestStat: Stat | null
  adds: number
  dels: number
  changedAt: number
  isEditedSince: boolean
}

type Live = {
  id?: string
  dir?: string
  cacheDir?: string
  isShellSlow: boolean
  root: string
  home: string
  files: Map<string, FileRecord>
  inflight: Map<string, number>
  queue: Promise<unknown>
  shadow?: Shadow
  shellQueue: Promise<unknown>
  primed: Promise<boolean>
}

type BaseLoader = () => Promise<Seen>
type Ticket = { isCancelled: boolean; counted: string[] }
type Waiter = { readonly signal: AbortSignal; readonly budget: { readonly remainingMs: number } }

const rows = atom({ plugin: 'tdiff', key: 'rows' } as const, [], { shape: 'rows-1' })
const open = atom({ plugin: 'tdiff', key: 'open' } as const, null, { shape: 'open-1' })
const shell = atom(
  { plugin: 'tdiff', key: 'shell' } as const,
  { status: 'starting', reason: null },
  { shape: 'shell-1' },
)
const where = atom({ plugin: 'tdiff', key: 'where' } as const, { root: '/', home: '' }, { shape: 'where-1' })

const LEDGER_SHAPE = 'tdiff-ledger-1'
const READ_CAP = 4 * 1024 * 1024
const ABSENT: Seen = { snap: { state: 'absent' }, stat: null, text: null }
export const MAX_WAIT_MS = 8_000
const BUDGET_MARGIN_MS = 1_500
export const SWITCH_POLL_MS = 200
const SWITCH_POLLS = 25

const live: Live = {
  isShellSlow: false,
  root: '/',
  home: '',
  files: new Map(),
  inflight: new Map(),
  queue: Promise.resolve(),
  shellQueue: Promise.resolve(),
  primed: Promise.resolve(false),
}

const noop = () => undefined

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const run = live.queue.then(task)
  live.queue = run.catch(noop)
  return run
}

function enqueueShell<T>(task: () => Promise<T>): Promise<T> {
  const run = live.shellQueue.then(task)
  live.shellQueue = run.catch(noop)
  return run
}

async function within<T>($: Engine, next: Waiter, work: Promise<T>): Promise<{ value: T } | undefined> {
  const settled = work.then(
    value => ({ value }),
    () => undefined,
  )
  const left = Math.min(MAX_WAIT_MS, next.budget.remainingMs - BUDGET_MARGIN_MS)
  if (next.signal.aborted || !(left > 0)) return undefined
  const stop = new AbortController()
  const timeout = $.clock.sleep(left, { signal: stop.signal }).then(noop, noop)
  try {
    return await Promise.race([settled, timeout])
  } finally {
    stop.abort()
  }
}

const isTextLike = (text: string) => !text.includes('\0') && !text.includes('�')

async function binarySig($: Engine, path: string, stat: Stat) {
  const shadow = live.shadow
  const id = shadow === undefined ? undefined : await blobIdOf($, shadow, path).catch(() => undefined)
  if (id !== undefined) return `git:${id}`
  const bytes = await $.fs.read(path, { as: 'bytes' }).catch(() => undefined)
  return bytes === undefined ? `${stat.size}:${stat.mtimeMs}` : `sha:${await sha(bytes.base64)}`
}

async function readDisk($: Engine, path: string): Promise<Seen> {
  const stat = await $.fs.stat(path).catch(() => undefined)
  if (stat === undefined || stat.kind !== 'file') return ABSENT
  const at: Stat = { mtimeMs: stat.mtimeMs, size: stat.size }
  if (stat.size > READ_CAP) return { snap: { state: 'too-large', sig: `${stat.size}:${stat.mtimeMs}` }, stat: at, text: null }
  const text = await $.fs.read(path).catch(() => undefined)
  if (text !== undefined && isTextLike(text)) return { snap: { state: 'text', sig: await sha(text) }, stat: at, text }
  return { snap: { state: 'binary', sig: await binarySig($, path, at) }, stat: at, text: null }
}

const sameSnap = (a: Snap, b: Snap) => a.state === b.state && (a.state === 'absent' || a.sig === (b as { sig: string }).sig)
const isChanged = (rec: FileRecord): rec is FileRecord & { latest: Snap } => rec.latest !== null && !sameSnap(rec.base, rec.latest)

function noTextOf(rec: FileRecord): TdiffNoText | null {
  const states = [rec.base.state, rec.latest?.state]
  if (states.includes('too-large')) return 'too-large'
  if (states.includes('binary')) return 'binary'
  return null
}

function kindOf(rec: FileRecord): TdiffKind {
  if (rec.base.state === 'absent') return 'added'
  if (rec.latest?.state === 'absent') return 'deleted'
  return 'modified'
}

const snapFile = (kind: 'base' | 'latest', rec: FileRecord) => `${live.dir}/${kind}/${rec.hash}`

async function snapText($: Engine, kind: 'base' | 'latest', rec: FileRecord) {
  const snap = kind === 'base' ? rec.base : rec.latest
  if (snap?.state !== 'text') return ''
  return $.fs.read(snapFile(kind, rec)).catch(() => '')
}

function toRows(): TdiffRow[] {
  return [...live.files.values()]
    .filter(isChanged)
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    .map(rec => ({
      path: rec.path,
      kind: kindOf(rec),
      adds: rec.adds,
      dels: rec.dels,
      noText: noTextOf(rec),
      changedAt: rec.changedAt,
      isEditedSince: rec.isEditedSince,
    }))
}

async function diffOf($: Engine, path: string): Promise<TdiffOpen> {
  const rec = live.files.get(path)
  if (rec === undefined || !isChanged(rec)) return { path, diff: null, note: 'unchanged' }
  const noText = noTextOf(rec)
  if (noText !== null) return { path, diff: null, note: noText }
  return { path, diff: diffText(await snapText($, 'base', rec), await snapText($, 'latest', rec)), note: null }
}

async function save($: Engine) {
  if (live.dir === undefined) return
  const files = [...live.files.values()]
  await $.fs.write(`${live.dir}/ledger.json`, JSON.stringify({ shape: LEDGER_SHAPE, isShellSlow: live.isShellSlow, files }))
}

async function publish($: Engine, changed: readonly string[]) {
  await update($, rows, () => toRows())
  const current = await read($, open)
  if (current !== null && changed.includes(current.path)) {
    const next = await diffOf($, current.path)
    await update($, open, () => next)
  }
}

async function setShell($: Engine, next: TdiffShell) {
  await update($, shell, () => next)
}

function isRecord(value: unknown): value is FileRecord {
  if (typeof value !== 'object' || value === null) return false
  const rec = value as Partial<FileRecord>
  return typeof rec.path === 'string' && typeof rec.hash === 'string' && typeof rec.base === 'object'
}

type Ledger = { shape?: unknown; isShellSlow?: unknown; files?: unknown }

async function load($: Engine, dir: string) {
  const files = new Map<string, FileRecord>()
  const text = await $.fs.read(`${dir}/ledger.json`).catch(() => undefined)
  if (text === undefined) return { files, isShellSlow: false }
  try {
    const parsed = JSON.parse(text) as Ledger
    if (parsed.shape !== LEDGER_SHAPE || !Array.isArray(parsed.files)) return { files, isShellSlow: false }
    for (const rec of parsed.files) if (isRecord(rec)) files.set(rec.path, rec)
    return { files, isShellSlow: parsed.isShellSlow === true }
  } catch {
    return { files, isShellSlow: false }
  }
}

const safeId = (id: string) => id.replace(/[^A-Za-z0-9._-]/g, '_')

async function adopt($: Engine, id: string) {
  const home = (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE')) ?? ''
  const cache = (await $.env.get('XDG_CACHE_HOME')) || (home === '' ? '' : `${home}/.cache`)
  live.id = id
  live.home = home === '' ? '' : normalize(home)
  live.root = normalize(await $.session.root())
  live.cacheDir = cache === '' ? undefined : `${normalize(cache)}/claude-tdiff`
  live.dir = live.cacheDir === undefined ? undefined : `${live.cacheDir}/${safeId(id)}`
  const loaded = live.dir === undefined ? { files: new Map<string, FileRecord>(), isShellSlow: false } : await load($, live.dir)
  live.files = loaded.files
  live.isShellSlow = loaded.isShellSlow
  live.inflight = new Map()
  const isSaved = await save($).then(
    () => true,
    () => false,
  )

  await update($, where, () => ({ root: live.root, home: live.home }))
  await update($, rows, () => toRows())
  const current = await read($, open)
  const reopened = current !== null && live.files.has(current.path) ? await diffOf($, current.path) : null
  await update($, open, () => reopened)
  await startShell($, isSaved)
}

async function startShell($: Engine, hasSessionDir: boolean) {
  const reason = live.isShellSlow ? 'too-slow' : guard(live.root, live.home)
  const { dir, cacheDir } = live
  live.shadow = undefined
  if (reason !== null || dir === undefined || cacheDir === undefined || !hasSessionDir) {
    live.primed = Promise.resolve(false)
    await setShell($, { status: 'limited', reason: reason ?? 'failed' })
    return
  }
  const shadow = await shadowFor(cacheDir, dir, live.root)
  live.shadow = shadow
  await setShell($, { status: 'starting', reason: null })
  live.primed = enqueueShell(async () => {
    try {
      await prime($, shadow)
      if (live.shadow === shadow) await setShell($, { status: 'on', reason: null })
      return true
    } catch (error) {
      await shellFailed($, shadow, error)
      return false
    }
  })
}

async function shellFailed($: Engine, shadow: Shadow, error: unknown) {
  if (live.shadow !== shadow) return
  live.shadow = undefined
  live.primed = Promise.resolve(false)
  const reason = error instanceof ShellOff ? error.reason : 'failed'
  if (reason === 'too-slow') {
    live.isShellSlow = true
    await enqueue(() => save($)).catch(noop)
  }
  await setShell($, { status: 'limited', reason }).catch(noop)
}

async function sync($: Engine) {
  const id = await $.session.id()
  if (id !== live.id) await adopt($, id)
}

export function ensure($: Engine) {
  return enqueue(() => sync($))
}

type Touch = { path: string; load?: BaseLoader }

const newTicket = (): Ticket => ({ isCancelled: false, counted: [] })

function touch($: Engine, list: readonly Touch[], ticket: Ticket) {
  return enqueue(async () => {
    if (ticket.isCancelled) return undefined
    await sync($)
    for (const { path } of list) {
      live.inflight.set(path, (live.inflight.get(path) ?? 0) + 1)
      ticket.counted.push(path)
    }
    let isFresh = false
    for (const { path, load } of list) {
      if (live.files.has(path) || live.dir === undefined) continue
      try {
        const seen = await (load ?? (() => readDisk($, path)))()
        const rec: FileRecord = {
          path,
          hash: (await sha(path)).slice(0, 40),
          base: seen.snap,
          latest: null,
          latestStat: null,
          adds: 0,
          dels: 0,
          changedAt: 0,
          isEditedSince: false,
        }
        if (seen.text !== null) await $.fs.write(snapFile('base', rec), seen.text)
        live.files.set(path, rec)
        isFresh = true
      } catch {
        continue
      }
    }
    if (isFresh) await save($).catch(noop)
    return live.id
  })
}

function releaseAll(ticket: Ticket) {
  const released = new Set<string>()
  for (const path of ticket.counted.splice(0)) {
    const left = (live.inflight.get(path) ?? 1) - 1
    if (left <= 0) {
      live.inflight.delete(path)
      released.add(path)
    } else {
      live.inflight.set(path, left)
    }
  }
  return released
}

function forget($: Engine, ticket: Ticket, sessionId: string | undefined) {
  return enqueue(async () => {
    const released = releaseAll(ticket)
    if (sessionId === undefined || sessionId !== live.id) return
    let isDropped = false
    for (const path of released) {
      const rec = live.files.get(path)
      if (rec !== undefined && rec.latest === null) {
        live.files.delete(path)
        isDropped = true
      }
    }
    if (isDropped) await save($)
  })
}

function settle($: Engine, paths: readonly string[], ticket: Ticket, sessionId: string | undefined) {
  return enqueue(async () => {
    releaseAll(ticket)
    if (sessionId === undefined || sessionId !== live.id) return
    const changed: string[] = []
    for (const path of new Set(paths)) {
      const rec = live.files.get(path)
      if (rec === undefined) continue
      const wasChanged = isChanged(rec)
      const seen = await readDisk($, path)
      if (rec.latest !== null && sameSnap(rec.latest, seen.snap)) {
        rec.latestStat = seen.stat
        continue
      }
      rec.latest = seen.snap
      rec.latestStat = seen.stat
      rec.isEditedSince = false
      if (seen.text !== null) await $.fs.write(snapFile('latest', rec), seen.text)
      if (isChanged(rec)) {
        const counted = noTextOf(rec) === null ? diffText(await snapText($, 'base', rec), seen.text ?? '') : null
        rec.adds = counted?.adds ?? 0
        rec.dels = counted?.dels ?? 0
        rec.changedAt = await $.clock.now()
      } else {
        rec.adds = 0
        rec.dels = 0
      }
      if (wasChanged || isChanged(rec)) changed.push(path)
    }
    if (changed.length === 0) return
    await save($)
    await publish($, changed)
  })
}

async function isEdited($: Engine, rec: FileRecord & { latest: Snap }) {
  const stat = await $.fs.stat(rec.path).catch(() => undefined)
  const isFile = stat !== undefined && stat.kind === 'file'
  if (rec.latest.state === 'absent') return isFile
  if (!isFile) return true
  if (rec.latestStat !== null && stat.mtimeMs === rec.latestStat.mtimeMs && stat.size === rec.latestStat.size) return false
  const seen = await readDisk($, rec.path)
  if (!sameSnap(seen.snap, rec.latest)) return true
  rec.latestStat = seen.stat
  return false
}

export function recheckEdited($: Engine) {
  return enqueue(async () => {
    await sync($)
    let isAny = false
    for (const rec of live.files.values()) {
      if (!isChanged(rec)) continue
      const isNow = await isEdited($, rec).catch(() => rec.isEditedSince)
      if (isNow !== rec.isEditedSince) {
        rec.isEditedSince = isNow
        isAny = true
      }
    }
    if (!isAny) return
    await save($)
    await update($, rows, () => toRows())
  })
}

export function openFile($: Engine, path: string) {
  return enqueue(async () => {
    await sync($)
    const next = await diffOf($, path)
    await update($, open, () => next)
  })
}

export function closeFile($: Engine) {
  return enqueue(async () => {
    await update($, open, () => null)
  })
}

async function shellBefore($: Engine, shadow: Shadow, ticket: Ticket) {
  if (!(await live.primed) || live.shadow !== shadow) return undefined
  return enqueueShell(async () => (ticket.isCancelled ? undefined : snapshot($, shadow))).catch(async error => {
    await shellFailed($, shadow, error)
    return undefined
  })
}

async function shellAfter($: Engine, shadow: Shadow, before: string) {
  return enqueueShell(async () => {
    const after = await snapshot($, shadow)
    return changes($, shadow, before, after)
  }).catch(async error => {
    await shellFailed($, shadow, error)
    return []
  })
}

function blobLoader($: Engine, shadow: Shadow, id: string | null): BaseLoader {
  if (id === null) return async () => ABSENT
  return async () => {
    const read = await blob($, shadow, id)
    if (read.isTruncated) return { snap: { state: 'too-large', sig: `git:${id}` }, stat: null, text: null }
    if (!isTextLike(read.text)) return { snap: { state: 'binary', sig: `git:${id}` }, stat: null, text: null }
    return { snap: { state: 'text', sig: await sha(read.text) }, stat: null, text: read.text }
  }
}

async function onFileCall<R extends { deny?: string }>($: Engine, next: Waiter, path: string, run: () => Promise<R>) {
  const ticket = newTicket()
  const touched = await within($, next, touch($, [{ path }], ticket))
  if (touched === undefined) ticket.isCancelled = true
  const sessionId = touched?.value
  let ran: R | undefined
  try {
    ran = await run()
    return ran
  } finally {
    if (ticket.isCancelled) void forget($, ticket, sessionId).catch(noop)
    else if (ran === undefined || ran.deny !== undefined) await within($, next, forget($, ticket, sessionId))
    else await within($, next, settle($, [path], ticket, sessionId))
  }
}

type Prepared = { shadow?: Shadow; before?: string; extra: string[]; sessionId?: string }

async function prepareBash($: Engine, command: string, ticket: Ticket): Promise<Prepared> {
  const cwd = normalize(await $.session.cwd())
  await ensure($)
  const shadow = live.shadow
  const before = shadow === undefined ? undefined : await shellBefore($, shadow, ticket)
  const isShadowed = before !== undefined
  const extra = commandPaths(command, { cwd, home: live.home }).filter(
    path => (live.cacheDir === undefined || !isUnder(path, live.cacheDir)) && !(isShadowed && isUnder(path, live.root)),
  )
  const sessionId = await touch($, extra.map(path => ({ path })), ticket)
  return { shadow, before, extra, sessionId }
}

async function finishBash($: Engine, prepared: Prepared, ticket: Ticket) {
  const { shadow, before, extra, sessionId } = prepared
  const found = shadow !== undefined && before !== undefined ? await shellAfter($, shadow, before) : []
  const inTree = found.filter(change => !extra.includes(change.path))
  if (shadow !== undefined && inTree.length > 0) {
    await touch($, inTree.map(change => ({ path: change.path, load: blobLoader($, shadow, change.baseBlob) })), ticket)
  }
  await settle($, [...extra, ...inTree.map(change => change.path)], ticket, sessionId)
}

async function onBash<R extends { deny?: string }>($: Engine, next: Waiter, command: string, run: () => Promise<R>) {
  const ticket = newTicket()
  const prepared = await within($, next, prepareBash($, command, ticket))
  if (prepared === undefined) ticket.isCancelled = true
  let ran: R | undefined
  try {
    ran = await run()
    return ran
  } finally {
    if (prepared === undefined) void forget($, ticket, undefined).catch(noop)
    else if (ran === undefined || ran.deny !== undefined) await within($, next, forget($, ticket, prepared.value.sessionId))
    else await within($, next, finishBash($, prepared.value, ticket))
  }
}

function followSwitch($: Engine, endedId: string) {
  let polls = 0
  const timer = $.clock.every(SWITCH_POLL_MS, () => {
    polls += 1
    void $.session
      .id()
      .then(async id => {
        if (id === endedId && polls < SWITCH_POLLS) return
        timer.cancel()
        if (id !== endedId) await ensure($)
      })
      .catch(noop)
  })
}

export async function startCore($: Engine) {
  await ensure($).catch(noop)
  await recheckEdited($).catch(noop)
}

export function registerCore(on: On) {
  on('session.end', async ($, e, next) => {
    const ended = await next(e)
    if (e.reason === 'clear' || e.reason === 'resume') {
      await ensure($).catch(noop)
      if (live.id === e.sessionId) followSwitch($, e.sessionId)
    }
    return ended
  })

  on('turn.start', async ($, e, next) => {
    await ensure($).catch(noop)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    await recheckEdited($).catch(noop)
    return done
  })

  on('tool.call', { tool: ['Edit', 'Write', 'NotebookEdit'] }, async ($, e, next) => {
    const raw = e.tool === 'NotebookEdit' ? e.notebook_path : e.tool === 'Edit' || e.tool === 'Write' ? e.file_path : ''
    if (typeof raw !== 'string' || raw === '' || next.signal.aborted) return next(e)
    const cwd = await $.session.cwd().catch(() => live.root)
    return onFileCall($, next, resolve(cwd, raw), () => next(e))
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    if (next.signal.aborted) return next(e)
    return onBash($, next, typeof e.command === 'string' ? e.command : '', () => next(e))
  })
}
