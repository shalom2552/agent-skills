import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderChildren, Timer } from 'claude-code'

import type { StatuslineDiff, StatuslineLimit, StatuslineSnap } from '../types'

const EMPTY: StatuslineSnap = { isFast: false, isDirty: false, limits: [], minute: 0 }
const NO_DIFF: StatuslineDiff = { added: 0, removed: 0 }
const snap = atom({ plugin: 'statusline', key: 'snap' } as const, EMPTY)
const diff = atom({ plugin: 'statusline', key: 'diff' } as const, NO_DIFF)

const HOT = 50
const BAR_CAP = 300_000
const CTX_WARN = 150_000
const CTX_HOT = 300_000
const POLL_MS = 5_000
const MAX_SESSIONS = 50
const STORE_VERSION = 1
const SESSIONS_KEY = 'sessions'
const DIFF_PREFIX = 'diff:'
const SWITCH_POLL_MS = 200
const SWITCH_POLLS = 25

const BLUE = 'suggestion'
const PILL_BG = '#313244'
const DARK = 'inverseText'
const GREEN = 'success'
const YELLOW = 'warning'
const RED = 'error'

const MIN_BRANCH = 12
const DROPS = ['diff', 'branch', 'effort', 'fast', '7d', 'tokens', 'model', 'ctx', 'cost', '5h']
const FAST = ' ⚡fast'

const CAP_LEFT = ''
const CAP_RIGHT = ''
const GIT_ICON = ''

type Engine = EngineInterface

const settled = <T,>(p: Promise<T>) => p.then(v => v, () => undefined)
const noop = () => undefined

const widthOf = (s: string) => [...s].length

export const middle = (s: string, room: number) => {
  const chars = [...s]
  if (chars.length <= room) return s
  const head = Math.ceil((room - 1) / 2)
  return `${chars.slice(0, head).join('')}…${chars.slice(chars.length - (room - 1 - head)).join('')}`
}

export const dropToFit = (keys: readonly string[], drops: readonly string[], width: (kept: readonly string[]) => number, room: number) => {
  let kept = [...keys]
  for (const key of drops) {
    if (width(kept) <= room) break
    kept = kept.filter(k => k !== key)
  }
  return kept
}

const pillsWidthOf = (bodies: readonly number[]) => (bodies.length === 0 ? 0 : 2 + bodies.reduce((a, b) => a + b, 0) + 2 * (bodies.length - 1))

export const human = (n: number) => {
  if (n >= 1_000_000) return `${Math.floor(n / 1_000_000)}M`
  if (n >= 1_000) return `${Math.floor(n / 1_000)}k`
  return `${n}`
}

export const countdown = (at: number, now: number) => {
  const secs = Math.floor((at - now) / 1000)
  if (secs <= 0) return undefined
  const mins = Math.floor(secs / 60)
  const hours = Math.floor(mins / 60)
  return hours >= 48 ? `${Math.floor(hours / 24)}d` : hours >= 1 ? `${hours}h` : `${mins}m`
}

export const heatOf = (tokens: number) => (tokens >= CTX_HOT ? RED : tokens >= CTX_WARN ? YELLOW : BLUE)

export const patchLinesOf = (result: unknown): StatuslineDiff => {
  const hunks: unknown = typeof result === 'object' && result !== null ? Reflect.get(result, 'structuredPatch') : undefined
  const lines = Array.isArray(hunks) ? hunks.flatMap((h: unknown) => (typeof h === 'object' && h !== null ? Reflect.get(h, 'lines') : [])) : []
  if (lines.length === 0 && typeof result === 'object' && result !== null) {
    const content: unknown = Reflect.get(result, 'content')
    const original: unknown = Reflect.get(result, 'originalFile')
    const count = (s: unknown) => (typeof s === 'string' && s !== '' ? s.split('\n').length : 0)
    return { added: count(content), removed: count(original) }
  }
  return {
    added: lines.filter((l: unknown) => typeof l === 'string' && l.startsWith('+')).length,
    removed: lines.filter((l: unknown) => typeof l === 'string' && l.startsWith('-')).length,
  }
}

export const storedDiffOf = (raw: unknown): StatuslineDiff | undefined => {
  if (typeof raw !== 'object' || raw === null || Reflect.get(raw, 'version') !== STORE_VERSION) return undefined
  const added: unknown = Reflect.get(raw, 'added')
  const removed: unknown = Reflect.get(raw, 'removed')
  return typeof added === 'number' && typeof removed === 'number' ? { added, removed } : undefined
}

export const keptSessionsOf = (raw: unknown, id: string) =>
  [...(Array.isArray(raw) ? raw.filter((s): s is string => typeof s === 'string' && s !== id) : []), id].slice(-MAX_SESSIONS)

const persist = async ($: Pick<EngineInterface, 'store'>, prefix: string, id: string, value: object) => {
  const kept = keptSessionsOf(await $.store.get(SESSIONS_KEY), id)
  for (const key of await $.store.keys()) {
    if (key.startsWith(prefix) && !kept.includes(key.slice(prefix.length))) await $.store.delete(key)
  }
  await $.store.set(SESSIONS_KEY, kept)
  await $.store.set(prefix + id, { version: STORE_VERSION, ...value })
}

const rebuilt = async ($: EngineInterface): Promise<StatuslineDiff> => {
  const messages = await settled($.session.messages())
  return (Array.isArray(messages) ? messages : [])
    .flatMap(m => m.toolUses)
    .filter(u => (u.tool === 'Edit' || u.tool === 'Write') && u.isError === undefined && u.result !== undefined)
    .map(u => patchLinesOf(u.result))
    .reduce((a, p) => ({ added: a.added + p.added, removed: a.removed + p.removed }), NO_DIFF)
}

export const fieldOf = (o: unknown, key: string): unknown => (typeof o === 'object' && o !== null ? Reflect.get(o, key) : undefined)

const git = async ($: EngineInterface, cwd: string, args: string[]) => {
  const ran = await settled($.process.run(['git', '--no-optional-locks', '-C', cwd, ...args]))
  return ran?.exitCode === 0 ? ran.stdout.trim() : undefined
}

const branchOf = async ($: EngineInterface, cwd: string) =>
  (await git($, cwd, ['symbolic-ref', '--quiet', '--short', 'HEAD'])) ?? (await git($, cwd, ['rev-parse', '--short', 'HEAD']))

let stepEffort: string | undefined
let poll: Timer | undefined
let refreshing: Promise<void> | undefined
let isStale = false
let saving: Promise<unknown> = Promise.resolve()
let sessionId: string | undefined

function refreshSoon($: EngineInterface) {
  isStale = true
  refreshing ??= (async () => {
    try {
      while (isStale) {
        isStale = false
        await settled(refresh($))
      }
    } finally {
      refreshing = undefined
    }
  })()
  return refreshing
}

function save($: EngineInterface) {
  saving = saving.then(async () => {
    const id = await settled($.session.id())
    if (id !== undefined) await settled(persist($, DIFF_PREFIX, id, await read($, diff)))
  })
  return saving
}

async function restore($: Engine) {
  const id = await settled($.session.id())
  if (id === undefined || id === sessionId) return
  sessionId = id
  const before = await read($, diff)
  const stored = storedDiffOf(await settled($.store.get(DIFF_PREFIX + id)))
  const base = stored ?? (await rebuilt($))
  const now = await update($, diff, d => ({ added: base.added + d.added - before.added, removed: base.removed + d.removed - before.removed }))
  if (stored === undefined) await settled(persist($, DIFF_PREFIX, id, now))
}

function ensure($: Engine) {
  saving = saving.then(() => restore($)).catch(noop)
  return saving
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

async function refresh($: EngineInterface) {
  const cwd = await $.session.cwd()
  const [model, usage, effortSetting, modelSettings, fast, branch, status, now] = await Promise.all([
    settled($.session.model()),
    settled($.session.usage()),
    settled($.settings.read({ key: 'effortLevel' })),
    settled($.settings.read({ key: 'modelSettings' })),
    settled($.settings.read({ key: 'fastMode' })),
    branchOf($, cwd),
    git($, cwd, ['status', '--porcelain']),
    $.clock.now(),
  ])
  const limits: StatuslineLimit[] = (usage?.rateLimits ?? []).map(l => ({
    kind: l.kind,
    percent: Math.round(l.percentUsed),
    ...(l.resetsAt === undefined ? {} : { resetsAt: Date.parse(l.resetsAt) }),
  }))
  const perModel = model === undefined ? undefined : fieldOf(fieldOf(modelSettings, model), 'effortLevel')
  const effort = [perModel, effortSetting, stepEffort].find(v => typeof v === 'string')
  const next: StatuslineSnap = {
    ...(model === undefined ? {} : { model }),
    ...(typeof effort === 'string' ? { effort } : {}),
    isFast: fast === true,
    ...(branch === undefined ? {} : { branch }),
    isDirty: (status ?? '') !== '',
    ...(usage?.cost === undefined ? {} : { cost: usage.cost.usd }),
    ...(usage?.context.tokens === undefined ? {} : { tokens: usage.context.tokens }),
    ...(usage?.context.percent === undefined ? {} : { percent: Math.round(usage.context.percent) }),
    ...(usage === undefined ? {} : { window: usage.context.window }),
    limits,
    minute: Math.floor(now / 60_000),
  }
  const prev = await read($, snap)
  if (JSON.stringify(prev) !== JSON.stringify(next)) await update($, snap, () => next)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await ensure($)
    await refreshSoon($)
    poll?.cancel()
    poll = $.clock.every(POLL_MS, () => void refreshSoon($))
    return started
  })

  on('turn.step', async function* ($, e, next) {
    const done = yield* next(e)
    if (e.agentId === undefined && e.effort !== undefined) {
      stepEffort = String(e.effort)
      await refreshSoon($)
    }
    return done
  })

  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear' || e.reason === 'resume') {
      stepEffort = undefined
      await update($, diff, () => NO_DIFF)
    }
    const ended = await next(e)
    if (e.reason === 'clear' || e.reason === 'resume') {
      await ensure($)
      if (sessionId === e.sessionId) followSwitch($, e.sessionId)
    }
    return ended
  })

  on('tool.call', async ($, e, next) => {
    const done = await next(e)
    if ((e.tool === 'Edit' || e.tool === 'Write') && done.result !== undefined && done.isError === undefined) {
      const { added, removed } = patchLinesOf(done.result)
      if (added > 0 || removed > 0) {
        await update($, diff, d => ({ added: d.added + added, removed: d.removed + removed }))
        await save($)
      }
    }
    if (done.isReadOnly !== true) await refreshSoon($)
    return done
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    await refreshSoon($)
    return done
  })

  on('session.append', { door: 'command' }, async ($, e, next) => {
    const kept = await next(e)
    await refreshSoon($)
    return kept
  })

  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    const engine = await next(e)
    const s = await read($, snap)
    const d = await read($, diff)
    const now = await $.clock.now()
    const { Box, Text } = $.ui.resolve(e)

    type Seg = { color: string; body: RenderChildren }
    const pills = (dir: 'r' | 'l', segs: Seg[]) => {
      const shown = segs.filter(seg => seg.body !== undefined)
      const last = shown[shown.length - 1]
      if (last === undefined) return []
      const out = shown.flatMap((seg, i) => {
        const prev = shown[i - 1]
        const text = seg.color === BLUE ? DARK : BLUE
        const joint =
          prev === undefined
            ? [<Text key={`c${i}`} color={seg.color}>{CAP_LEFT}</Text>]
            : dir === 'r'
              ? [<Text key={`c${i}`} color={prev.color} backgroundColor={seg.color}>{CAP_RIGHT}</Text>]
              : [
                  <Text key={`s${i}`} backgroundColor={prev.color}> </Text>,
                  <Text key={`c${i}`} color={seg.color} backgroundColor={prev.color}>{CAP_LEFT}</Text>,
                ]
        return [
          ...joint,
          <Text key={`b${i}`} backgroundColor={seg.color} color={text}>
            {prev !== undefined && dir === 'r' ? ' ' : ''}
            {seg.body}
          </Text>,
        ]
      })
      return [...out, <Text key="end" color={last.color}>{CAP_RIGHT}</Text>]
    }

    const five = s.limits.find(l => l.kind === 'five_hour')
    const seven = s.limits.find(l => l.kind === 'seven_day')
    const shownSeven = seven === undefined || seven.percent < HOT ? undefined : seven
    const leftOf = (l: StatuslineLimit) => (l.resetsAt === undefined ? undefined : countdown(l.resetsAt, now))
    const limitText = (label: string, l: StatuslineLimit) => {
      const left = leftOf(l)
      return `${label} ${l.percent}%${left === undefined ? '' : ` ↻${left}`}`
    }

    const effortText = s.effort === undefined ? '' : ` ${s.effort}`
    const branchText = s.branch === undefined ? '' : `${GIT_ICON} ${s.branch}${s.isDirty ? '*' : ''}`
    const diffText = d.added > 0 || d.removed > 0 ? ` +${d.added}/-${d.removed}` : ''
    const costText = s.cost === undefined ? '' : `$${s.cost.toFixed(2)} `
    const tokensText = s.tokens === undefined ? '' : `${human(s.tokens)} `
    const keys = [
      ...(s.model === undefined ? [] : ['model']),
      ...(s.model === undefined || effortText === '' ? [] : ['effort']),
      ...(s.model === undefined || !s.isFast ? [] : ['fast']),
      ...(branchText === '' ? [] : ['branch']),
      ...(diffText === '' ? [] : ['diff']),
      ...(costText === '' ? [] : ['cost']),
      ...(s.percent === undefined ? [] : ['ctx']),
      ...(s.percent === undefined || tokensText === '' ? [] : ['tokens']),
      ...(five === undefined ? [] : ['5h']),
      ...(shownSeven === undefined ? [] : ['7d']),
    ]
    const width = (kept: readonly string[], branchWidth = widthOf(branchText)) => {
      const has = (key: string) => kept.includes(key)
      const lims = [
        ...(five !== undefined && has('5h') ? [widthOf(limitText('5h', five))] : []),
        ...(shownSeven !== undefined && has('7d') ? [widthOf(limitText('7d', shownSeven))] : []),
      ]
      const left = pillsWidthOf([
        ...(has('model') ? [widthOf(s.model ?? '') + (has('effort') ? widthOf(effortText) : 0) + (has('fast') ? widthOf(FAST) + 1 : 0)] : []), // ⚡ takes two cells
        ...(has('branch') ? [branchWidth] : []),
      ])
      const right = pillsWidthOf([
        ...(has('ctx') ? [(has('tokens') ? widthOf(tokensText) : 0) + 9 + widthOf(`${s.percent}%`)] : []),
        ...(lims.length === 0 ? [] : [lims.reduce((a, b) => a + b, 0) + 3 * (lims.length - 1)]),
      ])
      return left + (has('diff') ? widthOf(diffText) : 0) + 1 + (has('cost') ? widthOf(costText) : 0) + right
    }
    const columns = e.viewport?.columns
    const fitted = columns === undefined ? keys : dropToFit(keys, DROPS, width, columns)
    const branchRoom = columns === undefined ? 0 : columns - width([...fitted, 'branch'], 0)
    const dropped = DROPS.filter(k => keys.includes(k) && !fitted.includes(k))
    const isShort = dropped.at(-1) === 'branch' && branchRoom >= MIN_BRANCH
    const kept = isShort ? [...fitted, 'branch'] : fitted
    const has = (key: string) => kept.includes(key)

    const model = !has('model') ? undefined : (
      <Text>
        <Text bold>{s.model}</Text>
        {has('effort') ? effortText : ''}
        {has('fast') ? FAST : ''}
      </Text>
    )
    const branch = !has('branch') ? undefined : isShort ? middle(branchText, branchRoom) : branchText

    let ctx: RenderChildren
    if (s.percent !== undefined && has('ctx')) {
      const window = s.window ?? 0
      const barPct = window > 0 ? Math.floor((s.percent * window) / BAR_CAP) : s.percent
      const filled = Math.min(8, Math.ceil((barPct * 8) / 100))
      ctx = (
        <Text color={heatOf(Math.floor((s.percent * window) / 100))}>
          {has('tokens') ? tokensText : ''}
          {'▰'.repeat(filled)}
          <Text dimColor>{'▱'.repeat(8 - filled)}</Text>
          {' '}
          <Text bold>{`${s.percent}%`}</Text>
        </Text>
      )
    }

    const limit = (label: string, l: StatuslineLimit) => {
      const left = leftOf(l)
      return (
        <Text key={label}>
          {`${label} `}
          <Text bold>{`${l.percent}%`}</Text>
          {left === undefined ? '' : ` ↻${left}`}
        </Text>
      )
    }
    const lims = [
      ...(five === undefined || !has('5h') ? [] : [limit('5h', five)]),
      ...(shownSeven === undefined || !has('7d') ? [] : [limit('7d', shownSeven)]),
    ]
    const lim = lims.length === 0 ? undefined : lims.flatMap((l, i) => (i === 0 ? [l] : [<Text key={`dot${i}`}> · </Text>, l]))

    return (
      <Box flexDirection="column">
        <Box flexDirection="row" marginLeft={-2} marginRight={-2}>
          <Box flexDirection="row" flexShrink={0}>
            {pills('r', [
              { color: BLUE, body: model },
              { color: PILL_BG, body: branch },
            ])}
            {has('diff') ? (
              <Text>
                {' '}
                <Text color={GREEN}>{`+${d.added}`}</Text>/<Text color={RED}>{`-${d.removed}`}</Text>
              </Text>
            ) : null}
          </Box>
          <Box flexGrow={1} minWidth={1} />
          <Box flexDirection="row" flexShrink={0}>
            {has('cost') ? <Text color={GREEN} bold>{costText}</Text> : null}
            {pills('l', [
              { color: PILL_BG, body: ctx },
              { color: BLUE, body: lim },
            ])}
          </Box>
        </Box>
        {engine}
      </Box>
    )
  })
}
