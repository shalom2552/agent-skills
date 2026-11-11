import { atom, read, update } from 'claude-code'
import type { EngineInterface, ModelUsage, Register } from 'claude-code'

import type { BeatSaved, BeatTokens, BeatTurn } from '../types'

const turns = atom({ plugin: 'beat', key: 'turns' } as const, [])
const busy = atom({ plugin: 'beat', key: 'busy' } as const, false)

const MAX_TURNS = 200
const MAX_SESSIONS = 50
const STORE_VERSION = 3
const LEGACY_VERSION = 2
const ANCHOR_MS = 1_500
const SESSIONS_KEY = 'sessions'
const TURNS_PREFIX = 'turns:'
const BAR = 12
const MARGIN = 2
const GAP = 1
const DROPS = ['context', 'io', 'cache', 'cost', 'legend', 'bar']
const CAP_LEFT = ''
const CAP_RIGHT = ''
const PILL_BG = '#313244'
const PILL_FG = 'text'
const STAT_COLOR = 'suggestion'

type Part = 'think' | 'tools' | 'write' | 'other'
const PARTS: readonly { part: Part; icon: string; color: string }[] = [
  { part: 'think', icon: '', color: 'suggestion' },
  { part: 'tools', icon: '', color: 'warning' },
  { part: 'write', icon: '', color: 'success' },
  { part: 'other', icon: '\uf254', color: 'merged' },
]

export const formatDuration = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${s % 60}s`
  return `${Math.floor(m / 60)}h ${m % 60}m`
}

const widthOf = (s: string) => [...s].length

export const formatTokens = (n: number) => {
  if (n < 1_000) return `${n}`
  if (n < 999_950) return `${Number((n / 1_000).toFixed(1))}k`
  return `${Number((n / 1_000_000).toFixed(1))}M`
}

export const tokensOf = (usage: ModelUsage): BeatTokens => ({
  input: usage.input_tokens,
  output: usage.output_tokens,
  cacheRead: usage.cache_read_input_tokens,
  cacheCreation: usage.cache_creation_input_tokens,
})

export type Stat = { key: string; parts: readonly (readonly [icon: string, value: string])[] }

export const statsOf = (turn: BeatTurn): Stat[] => {
  const stats: Stat[] = []
  if (turn.tokens !== undefined) {
    const { input, output, cacheRead, cacheCreation } = turn.tokens
    const total = input + cacheRead + cacheCreation
    stats.push({ key: 'io', parts: [['↑', formatTokens(input)], ['↓', formatTokens(output)]] })
    if (total > 0) stats.push({ key: 'cache', parts: [['\uf1c0 ', `${Math.round((cacheRead / total) * 100)}%`]] })
  }
  if (turn.costUsd !== undefined) stats.push({ key: 'cost', parts: [['$', turn.costUsd.toFixed(2)]] })
  if (turn.contextPercent !== undefined) stats.push({ key: 'context', parts: [['\uf2db ', `${Math.round(turn.contextPercent)}%`]] })
  return stats
}

export const pillWidthOf = (stats: readonly Stat[]) =>
  stats.length === 0
    ? 0
    : widthOf(CAP_LEFT + CAP_RIGHT) +
      stats.reduce((a, s) => a + s.parts.reduce((b, [icon, value]) => b + widthOf(icon + value), 0) + s.parts.length - 1, 0) +
      2 * (stats.length - 1)

export const dropToFit = (keys: readonly string[], drops: readonly string[], width: (kept: readonly string[]) => number, room: number) => {
  let kept = [...keys]
  for (const key of drops) {
    if (width(kept) <= room) break
    kept = kept.filter(k => k !== key)
  }
  return kept
}

const settled = <T,>(p: Promise<T>) => p.then(v => v, () => undefined)

export const savedOf = (raw: unknown): BeatSaved => {
  if (typeof raw !== 'object' || raw === null) return { turns: [], rows: {} }
  const version: unknown = Reflect.get(raw, 'version')
  const list: unknown = Reflect.get(raw, 'turns')
  if ((version !== STORE_VERSION && version !== LEGACY_VERSION) || !Array.isArray(list)) return { turns: [], rows: {} }
  const rows: unknown = Reflect.get(raw, 'rows')
  const valid = version === STORE_VERSION && typeof rows === 'object' && rows !== null && !Array.isArray(rows)
  return { turns: list, rows: valid ? Object.fromEntries(Object.entries(rows)) : {} }
}

export const sumOf = (span: readonly BeatTurn[], durationMs: number): BeatTurn => {
  const add = (pick: (t: BeatTurn) => number) => span.reduce((a, t) => a + pick(t), 0)
  const think = add(t => t.think)
  const tools = add(t => t.tools)
  const write = add(t => t.write)
  const tokens = span.flatMap(t => t.tokens ?? [])
  const costs = span.flatMap(t => t.costUsd ?? [])
  const contextPercent = [...span].reverse().find(t => t.contextPercent !== undefined)?.contextPercent
  return {
    durationMs,
    think,
    tools,
    write,
    other: Math.max(0, durationMs - think - tools - write),
    ...(tokens.length === 0
      ? {}
      : {
          tokens: {
            input: tokens.reduce((a, t) => a + t.input, 0),
            output: tokens.reduce((a, t) => a + t.output, 0),
            cacheRead: tokens.reduce((a, t) => a + t.cacheRead, 0),
            cacheCreation: tokens.reduce((a, t) => a + t.cacheCreation, 0),
          },
        }),
    ...(costs.length === 0 ? {} : { costUsd: costs.reduce((a, b) => a + b, 0) }),
    ...(contextPercent === undefined ? {} : { contextPercent }),
  }
}

export const spanOf = (list: readonly BeatTurn[], durationMs: number, seenAt: number) => {
  const from = seenAt - durationMs
  let first = -1
  let best = ANCHOR_MS
  list.forEach((t, i) => {
    const gap = t.startedAt === undefined ? Infinity : Math.abs(t.startedAt - from)
    if (gap <= best) {
      best = gap
      first = i
    }
  })
  if (first === -1) return undefined
  return sumOf(
    list.slice(first).filter(t => t.startedAt !== undefined && t.startedAt < seenAt),
    durationMs,
  )
}

const lastOf = <T,>(rows: Record<string, T>, n: number) => Object.fromEntries(Object.entries(rows).slice(-n))

export const keptSessionsOf = (raw: unknown, id: string) =>
  [...(Array.isArray(raw) ? raw.filter((s): s is string => typeof s === 'string' && s !== id) : []), id].slice(-MAX_SESSIONS)

const load = async <T,>($: Pick<EngineInterface, 'store'>, cache: Map<string, T>, prefix: string, id: string, parse: (raw: unknown) => T) => {
  const cached = cache.get(id)
  if (cached !== undefined) return cached
  const value = parse(await settled($.store.get(prefix + id)))
  cache.set(id, value)
  return value
}

const persist = async ($: Pick<EngineInterface, 'store'>, prefix: string, id: string, latest: () => object | undefined) => {
  const kept = keptSessionsOf(await $.store.get(SESSIONS_KEY), id)
  for (const key of await $.store.keys()) {
    if (key.startsWith(prefix) && !kept.includes(key.slice(prefix.length))) await $.store.delete(key)
  }
  await $.store.set(SESSIONS_KEY, kept)
  const value = latest()
  if (value !== undefined) await $.store.set(prefix + id, { version: STORE_VERSION, ...value })
}

export const unionMs = (spans: readonly (readonly [number, number])[]) => {
  const sorted = [...spans].sort((a, b) => a[0] - b[0])
  let total = 0
  let end = -Infinity
  for (const [s, e] of sorted) {
    if (e <= end) continue
    total += e - Math.max(s, end)
    end = e
  }
  return total
}

export const exclusiveMs = (spans: readonly (readonly [number, number])[], cut: readonly (readonly [number, number])[]) =>
  unionMs([...spans, ...cut]) - unionMs(cut)

export const partsOf = (
  durationMs: number,
  wallMs: number,
  think: readonly (readonly [number, number])[],
  write: readonly (readonly [number, number])[],
  tools: readonly (readonly [number, number])[],
) => {
  const paused = Math.max(0, wallMs - durationMs)
  const turn = {
    think: exclusiveMs(think, tools),
    tools: Math.max(0, unionMs(tools) - paused),
    write: exclusiveMs(write, tools),
  }
  return { durationMs, ...turn, other: Math.max(0, durationMs - turn.think - turn.tools - turn.write) }
}

export const secondsOf = (values: readonly number[]) => {
  const exact = values.map(v => v / 1000)
  const secs = exact.map(Math.floor)
  let left = Math.round(exact.reduce((a, b) => a + b, 0)) - secs.reduce((a, b) => a + b, 0)
  for (const [, i] of exact.map((v, i) => [v - Math.floor(v), i] as const).sort((a, b) => b[0] - a[0])) {
    if (left <= 0) break
    secs[i] = (secs[i] ?? 0) + 1
    left -= 1
  }
  return secs
}

export const cellsOf = (values: readonly number[], width: number) => {
  const sum = values.reduce((a, b) => a + b, 0)
  if (sum <= 0) return values.map(() => 0)
  const cells = values.map(v => (v > 0 ? Math.max(1, Math.round((v / sum) * width)) : 0))
  let over = cells.reduce((a, b) => a + b, 0) - width
  while (over !== 0) {
    const i = cells.indexOf(Math.max(...cells))
    cells[i] = (cells[i] ?? 0) - Math.sign(over)
    over -= Math.sign(over)
  }
  return cells
}

export const register: Register = on => {
  let turnStart = 0
  let costStart: number | undefined
  let think: [number, number][] = []
  let write: [number, number][] = []
  let tools: [number, number][] = []
  const stored = new Map<string, BeatSaved>()
  const seen = new Map<string, number>()

  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear' || e.reason === 'resume') {
      await update($, turns, () => [])
      await update($, busy, () => false)
    }
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)
    turnStart = await $.clock.now()
    costStart = (await settled($.session.usage()))?.cost?.usd
    think = []
    write = []
    tools = []
    await update($, busy, () => true)
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    if (e.agentId !== undefined) return yield* next(e)

    let phase: 'think' | 'write' = 'think'
    let mark = await $.clock.now()
    const close = (now: number) => {
      ;(phase === 'think' ? think : write).push([mark, now])
      mark = now
    }

    for await (const chunk of next(e)) {
      const want: 'think' | 'write' = chunk.kind === 'thinking' ? 'think' : chunk.kind === 'engine' || chunk.kind === 'stop' ? phase : 'write'
      if (want !== phase) {
        close(await $.clock.now())
        phase = want
      }
      yield chunk
    }
    close(await $.clock.now())
  })

  on('tool.call', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)
    const start = await $.clock.now()
    try {
      return await next(e)
    } finally {
      tools.push([start, await $.clock.now()])
    }
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId === undefined) {
      const wallMs = (await $.clock.now()) - turnStart
      const session = await settled($.session.usage())
      const costEnd = session?.cost?.usd
      const contextPercent = session?.context.percent
      const turn: BeatTurn = {
        ...partsOf(e.durationMs, wallMs, think, write, tools),
        ...(e.usage === undefined ? {} : { tokens: tokensOf(e.usage) }),
        ...(costStart === undefined || costEnd === undefined ? {} : { costUsd: Math.max(0, costEnd - costStart) }),
        ...(contextPercent === undefined ? {} : { contextPercent }),
        startedAt: turnStart,
      }
      const id = await settled($.session.id())
      if (id !== undefined) {
        const saved = await load($, stored, TURNS_PREFIX, id, savedOf)
        stored.set(id, { ...saved, turns: [...saved.turns, turn].slice(-MAX_TURNS) })
      }
      await update($, turns, list => [...list, turn].slice(-MAX_TURNS))
      await update($, busy, () => false)
      if (id !== undefined) await settled(persist($, TURNS_PREFIX, id, () => stored.get(id)))
    }
    return done
  })

  on('ui.render', { component: 'TurnDuration' }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const { requestId } = e
    const { durationMs } = e.props
    const live = await read($, turns)
    const waiting = await read($, busy)
    const id = await settled($.session.id())
    const saved = id === undefined ? undefined : await load($, stored, TURNS_PREFIX, id, savedOf)
    const match = (list: readonly BeatTurn[]) => [...list].reverse().find(t => t.durationMs === durationMs)
    let hit = saved?.rows[requestId] ?? match(live) ?? (saved === undefined ? undefined : match(saved.turns))
    if (hit === undefined) {
      const seenAt = seen.get(requestId) ?? (await $.clock.now())
      seen.set(requestId, seenAt)
      if (!waiting) hit = spanOf(saved?.turns ?? live, durationMs, seenAt)
      if (hit !== undefined && id !== undefined && saved !== undefined) {
        stored.set(id, { ...saved, rows: lastOf({ ...saved.rows, [requestId]: hit }, MAX_TURNS) })
        await settled(persist($, TURNS_PREFIX, id, () => stored.get(id)))
      }
    }
    const values = secondsOf(hit === undefined ? [0, 0, 0, 0] : [hit.think, hit.tools, hit.write, hit.other])
    const cells = cellsOf(values, BAR)
    const shown = PARTS.map((p, i) => ({ ...p, seconds: values[i] ?? 0, cells: cells[i] ?? 0 })).filter(p => p.cells > 0)
    const time = formatDuration(e.props.durationMs)
    const legends = shown.map(p => ({ ...p, head: `  ${p.icon} `, tail: formatDuration(p.seconds * 1000) }))

    const barWidth = 1 + shown.reduce((a, p) => a + p.cells, 0)
    const legendWidth = legends.reduce((a, p) => a + widthOf(p.head + p.tail), 0)
    const all = hit === undefined ? [] : statsOf(hit)
    const keys = [...all.map(s => s.key), ...(shown.length > 0 ? ['bar', 'legend'] : [])]
    const width = (kept: readonly string[]) => {
      const pill = pillWidthOf(all.filter(s => kept.includes(s.key)))
      return (
        widthOf(CAP_LEFT + time + CAP_RIGHT) +
        (kept.includes('bar') ? barWidth : 0) +
        (kept.includes('legend') ? legendWidth : 0) +
        (pill > 0 ? GAP + pill : 0)
      )
    }
    const columns = e.viewport?.columns
    const kept = columns === undefined ? keys : dropToFit(keys, DROPS, width, columns - 2 * MARGIN)
    const stats = all.filter(s => kept.includes(s.key))
    const bars = kept.includes('bar') ? shown : []
    const legend = kept.includes('legend') ? legends : []

    return (
      <Box flexDirection="row" marginTop={1} marginLeft={MARGIN} marginRight={MARGIN}>
        <Box flexDirection="row" flexShrink={0}>
          <Text color={PILL_BG}>{CAP_LEFT}</Text>
          <Text backgroundColor={PILL_BG} color={PILL_FG} bold>
            {time}
          </Text>
          {bars.length > 0 && <Text backgroundColor={PILL_BG}> </Text>}
          {bars.map(p => (
            <Text key={`bar-${p.part}`} backgroundColor={PILL_BG} color={p.color}>
              {'━'.repeat(p.cells)}
            </Text>
          ))}
          {legend.map(p => (
            <Text key={`legend-${p.part}`} backgroundColor={PILL_BG}>
              <Text color={p.color}>{p.head}</Text>
              <Text color={PILL_FG}>{p.tail}</Text>
            </Text>
          ))}
          <Text color={PILL_BG}>{CAP_RIGHT}</Text>
        </Box>
        {stats.length > 0 && <Box flexGrow={1} minWidth={GAP} />}
        {stats.length > 0 && (
          <Box flexDirection="row" flexShrink={0}>
            <Text color={PILL_BG}>{CAP_LEFT}</Text>
            {stats.map((stat, i) => (
              <Text key={stat.key} backgroundColor={PILL_BG}>
                {i > 0 && '  '}
                {stat.parts.map(([icon, value], j) => (
                  <Text key={`${stat.key}-${j}`}>
                    {j > 0 && ' '}
                    <Text color={STAT_COLOR}>{icon}</Text>
                    <Text color={PILL_FG}>{value}</Text>
                  </Text>
                ))}
              </Text>
            ))}
            <Text color={PILL_BG}>{CAP_RIGHT}</Text>
          </Box>
        )}
      </Box>
    )
  })
}
