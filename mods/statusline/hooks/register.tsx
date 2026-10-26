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

const BLUE = '#89b4fa'
const SURFACE0 = '#313244'
const MANTLE = '#181825'
const GREEN = '#a6e3a1'
const YELLOW = '#f9e2af'
const RED = '#f38ba8'

const CAP_LEFT = ''
const CAP_RIGHT = ''
const GIT_ICON = ''

const settled = <T,>(p: Promise<T>) => p.then(v => v, () => undefined)

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
    const id = await settled($.session.id())
    if (id !== undefined) {
      const before = await read($, diff)
      const stored = storedDiffOf(await settled($.store.get(DIFF_PREFIX + id)))
      const base = stored ?? (await rebuilt($))
      await update($, diff, d => ({ added: base.added + d.added - before.added, removed: base.removed + d.removed - before.removed }))
      if (stored === undefined) await save($)
    }
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
    return next(e)
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
        const text = seg.color === BLUE ? MANTLE : BLUE
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

    const model =
      s.model === undefined ? undefined : (
        <Text>
          <Text bold>{s.model}</Text>
          {s.effort === undefined ? '' : ` ${s.effort}`}
          {s.isFast ? ' ⚡fast' : ''}
        </Text>
      )
    const branch = s.branch === undefined ? undefined : `${GIT_ICON} ${s.branch}${s.isDirty ? '*' : ''}`

    let ctx: RenderChildren
    if (s.percent !== undefined) {
      const window = s.window ?? 0
      const barPct = window > 0 ? Math.floor((s.percent * window) / BAR_CAP) : s.percent
      const filled = Math.min(8, Math.ceil((barPct * 8) / 100))
      ctx = (
        <Text color={heatOf(Math.floor((s.percent * window) / 100))}>
          {s.tokens === undefined ? '' : `${human(s.tokens)} `}
          {'▰'.repeat(filled)}
          <Text dimColor>{'▱'.repeat(8 - filled)}</Text>
          {' '}
          <Text bold>{`${s.percent}%`}</Text>
        </Text>
      )
    }

    const limit = (label: string, l: StatuslineLimit) => {
      const left = l.resetsAt === undefined ? undefined : countdown(l.resetsAt, now)
      return (
        <Text key={label}>
          {`${label} `}
          <Text bold>{`${l.percent}%`}</Text>
          {left === undefined ? '' : ` ↻${left}`}
        </Text>
      )
    }
    const five = s.limits.find(l => l.kind === 'five_hour')
    const seven = s.limits.find(l => l.kind === 'seven_day')
    const lims = [
      ...(five === undefined ? [] : [limit('5h', five)]),
      ...(seven === undefined || seven.percent < HOT ? [] : [limit('7d', seven)]),
    ]
    const lim = lims.length === 0 ? undefined : lims.flatMap((l, i) => (i === 0 ? [l] : [<Text key={`dot${i}`}> · </Text>, l]))

    return (
      <Box flexDirection="column">
        <Box flexDirection="row" marginLeft={-2} marginRight={-2}>
          <Box flexDirection="row" flexShrink={0}>
            {pills('r', [
              { color: BLUE, body: model },
              { color: SURFACE0, body: branch },
            ])}
            {d.added > 0 || d.removed > 0 ? (
              <Text>
                {' '}
                <Text color={GREEN}>{`+${d.added}`}</Text>/<Text color={RED}>{`-${d.removed}`}</Text>
              </Text>
            ) : null}
          </Box>
          <Box flexGrow={1} minWidth={1} />
          <Box flexDirection="row" flexShrink={0}>
            {s.cost === undefined ? null : <Text color={GREEN} bold>{`$${Math.round(s.cost * 100) / 100} `}</Text>}
            {pills('l', [
              { color: SURFACE0, body: ctx },
              { color: BLUE, body: lim },
            ])}
          </Box>
        </Box>
        {engine}
      </Box>
    )
  })
}
