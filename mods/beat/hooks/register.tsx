import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { BeatTurn } from '../types'

const turns = atom({ plugin: 'beat', key: 'turns' } as const, [])

const MAX_TURNS = 200
const BAR = 12
const CAP_LEFT = ''
const CAP_RIGHT = ''
const PILL_BG = '#313244'
const PILL_FG = '#cdd6f4'

type Part = 'think' | 'tools' | 'write' | 'other'
const PARTS: readonly { part: Part; icon: string; color: string }[] = [
  { part: 'think', icon: '', color: '#89b4fa' },
  { part: 'tools', icon: '', color: '#f9e2af' },
  { part: 'write', icon: '', color: '#a6e3a1' },
  { part: 'other', icon: '\uf254', color: '#cba6f7' },
]

export const formatDuration = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${s % 60}s`
  return `${Math.floor(m / 60)}h ${m % 60}m`
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
  let think: [number, number][] = []
  let write: [number, number][] = []
  let tools: [number, number][] = []

  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') await update($, turns, () => [])
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    turnStart = await $.clock.now()
    think = []
    write = []
    tools = []
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
      const turn: BeatTurn = partsOf(e.durationMs, (await $.clock.now()) - turnStart, think, write, tools)
      await update($, turns, list => [...list, turn].slice(-MAX_TURNS))
    }
    return done
  })

  on('ui.render', { component: 'TurnDuration' }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const list = await read($, turns)
    const hit = [...list].reverse().find(t => t.durationMs === e.props.durationMs)
    const values = secondsOf(hit === undefined ? [0, 0, 0, 0] : [hit.think, hit.tools, hit.write, hit.other])
    const cells = cellsOf(values, BAR)
    const shown = PARTS.map((p, i) => ({ ...p, seconds: values[i] ?? 0, cells: cells[i] ?? 0 })).filter(p => p.cells > 0)

    return (
      <Box flexDirection="row" marginTop={1} marginLeft={2}>
        <Text color={PILL_BG}>{CAP_LEFT}</Text>
        <Text backgroundColor={PILL_BG} color={PILL_FG} bold>
          {formatDuration(e.props.durationMs)}
        </Text>
        {shown.length > 0 && <Text backgroundColor={PILL_BG}> </Text>}
        {shown.map(p => (
          <Text key={`bar-${p.part}`} backgroundColor={PILL_BG} color={p.color}>
            {'━'.repeat(p.cells)}
          </Text>
        ))}
        {shown.map(p => (
          <Text key={`legend-${p.part}`} backgroundColor={PILL_BG}>
            <Text color={p.color}>{`  ${p.icon} `}</Text>
            <Text color={PILL_FG}>{formatDuration(p.seconds * 1000)}</Text>
          </Text>
        ))}
        <Text color={PILL_BG}>{CAP_RIGHT}</Text>
      </Box>
    )
  })
}
