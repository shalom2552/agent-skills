import type { MockClock, TestBody } from 'claude-code/testing'
import type { BeatTurn } from '../types'
import type { On, RenderInput, SessionUsage, TurnStepChunk, TurnStepInput, TurnUsage } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'

import {
  cellsOf,
  fitStats,
  formatDuration,
  formatTokens,
  keptSessionsOf,
  partsOf,
  pillWidthOf,
  secondsOf,
  statsOf,
  storedTurnsOf,
  tokensOf,
  unionMs,
} from '../hooks/register'
import { textOf } from './text-of'

const LINE = (durationMs: number, columns = 120): RenderInput<'TurnDuration'> => ({
  component: 'TurnDuration',
  surface: 'terminal',
  requestId: 'line',
  viewport: { columns, rows: 40 },
  props: { word: 'Baked', durationMs },
})

const STEP = (index: number, agentId?: string): TurnStepInput => ({
  turnId: 't',
  index,
  model: 'm',
  messageCount: 1,
  ...(agentId === undefined ? {} : { agentId }),
})

type Beat = readonly [TurnStepChunk, number]

const costs = (...usd: number[]) => {
  let reads = 0
  return (): SessionUsage => ({
    startedAt: 0,
    context: { window: 200_000, percent: 41.2 },
    rateLimits: [],
    cost: { usd: usd[Math.min(reads++, usd.length - 1)] ?? 0 },
  })
}

type World = { usage?: () => SessionUsage; store?: Map<string, unknown>; failStore?: boolean; maxKeys?: number }

function world(on: On, script: Beat[][], { usage = costs(0.1, 0.14), store = new Map(), failStore = false, maxKeys = Infinity }: World = {}) {
  const clock: MockClock = mock.clock(on, { now: 0 })
  on('session.usage', () => ({ value: usage() }))
  on('session.id', () => ({ value: 's1' }))
  on('store.get', ($, e) => ({ value: store.get(e.key) }))
  on('store.set', ($, e) => {
    if (failStore || (!store.has(e.key) && store.size >= maxKeys)) throw new Error('disk full')
    store.set(e.key, e.value)
    return { value: undefined }
  })
  on('store.delete', ($, e) => {
    store.delete(e.key)
    return { value: undefined }
  })
  on('store.keys', () => ({ value: [...store.keys()] }))
  on('session.end', ($, e) => ({ sessionId: e.sessionId }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('tool.call', async () => {
    await clock.advance(4_000)
    return { result: 'ran' }
  })
  on('turn.step', async function* ($, e) {
    for (const [chunk, ms] of script[e.index] ?? []) {
      await clock.advance(ms)
      yield chunk
    }
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: null }
  })
  return clock
}

async function drain(stream: AsyncIterable<unknown>) {
  for await (const _ of stream) void _
}

const USAGE: TurnUsage = {
  input_tokens: 2_000,
  cache_read_input_tokens: 10_000,
  cache_creation_input_tokens: 345,
  output_tokens: 1_800,
  model: 'm',
}

const thinking = (text: string): TurnStepChunk => ({ kind: 'thinking', index: 0, text })
const text = (t: string): TurnStepChunk => ({ kind: 'text', index: 1, text: t })

describe('register', () => {
  test('helpers', () => {
    expect(formatDuration(45_000)).toBe('45s')
    expect(formatDuration(134_000)).toBe('2m 14s')
    expect(formatDuration(3_720_000)).toBe('1h 2m')
    expect(unionMs([[0, 10], [5, 15], [20, 25]])).toBe(20)
    expect(cellsOf([1, 0, 1], 16)).toEqual([8, 0, 8])
    expect(cellsOf([1, 100, 1], 16).reduce((a, b) => a + b, 0)).toBe(16)
    expect(cellsOf([1, 100, 1], 16)[0]).toBe(1)
    expect(cellsOf([0, 0, 0], 16)).toEqual([0, 0, 0])
    expect(formatTokens(999)).toBe('999')
    expect(formatTokens(1_000)).toBe('1k')
    expect(formatTokens(12_345)).toBe('12.3k')
    expect(formatTokens(999_949)).toBe('999.9k')
    expect(formatTokens(999_950)).toBe('1M')
    expect(formatTokens(2_340_000)).toBe('2.3M')
    expect(tokensOf(USAGE)).toEqual({ input: 12_345, output: 1_800, cacheRead: 10_000 })
  })

  test('splits a turn into think, tools and write', async ($, on) => {
    world(on, [[[thinking('hmm'), 3_000], [text('hi'), 1_000], [text('!'), 2_000]]])
    await $.turn.start({ text: 'go', turnId: 't' })
    await drain($.turn.step(STEP(0)))
    await $.tool.call({ tool: 'Bash', command: 'ls' })
    await $.turn.complete({ answer: 'hi', durationMs: 10_000, isAborted: false, turnId: 't', reason: 'answer' })

    const line = textOf(await $.ui.render(LINE(10_000)))
    expect(line).toContain('10s')
    expect(line).toContain(' 4s')
    expect(line).toContain(' 4s')
    expect(line).toContain(' 2s')
  })

  test('parts share one timeline and add up to the turn', () => {
    expect(partsOf(10_000, 10_000, [[0, 2_000]], [[2_000, 8_000]], [[5_000, 9_000]])).toEqual({
      durationMs: 10_000,
      think: 2_000,
      tools: 4_000,
      write: 3_000,
      other: 1_000,
    })
  })

  test('time waiting on a permission prompt leaves tools', () => {
    expect(partsOf(3_000, 5_000, [[0, 1_000]], [], [[1_000, 5_000]])).toEqual({
      durationMs: 3_000,
      think: 1_000,
      tools: 2_000,
      write: 0,
      other: 0,
    })
  })

  test('legend seconds sum to the rounded total', () => {
    expect(secondsOf([1_400, 1_400, 1_200, 0])).toEqual([2, 1, 1, 0])
    expect(secondsOf([400, 400, 400, 0])).toEqual([1, 0, 0, 0])
  })

  test('time outside steps and tools shows as its own part', async ($, on) => {
    world(on, [[[thinking('hmm'), 3_000], [text('hi'), 1_000], [text('!'), 2_000]]])
    await $.turn.start({ text: 'go', turnId: 't' })
    await drain($.turn.step(STEP(0)))
    await $.tool.call({ tool: 'Bash', command: 'ls' })
    await $.turn.complete({ answer: 'hi', durationMs: 12_000, isAborted: false, turnId: 't', reason: 'answer' })

    expect(textOf(await $.ui.render(LINE(12_000)))).toContain('\uf254 2s')
  })

  test('subagent steps are not counted', async ($, on) => {
    world(on, [[[thinking('a'), 5_000]]])
    await $.turn.start({ text: 'go', turnId: 't' })
    await drain($.turn.step(STEP(0, 'sub')))
    await $.turn.complete({ answer: '', durationMs: 5_000, isAborted: false, turnId: 't', reason: 'answer' })

    const line = textOf(await $.ui.render(LINE(5_000)))
    expect(line).not.toContain('')
  })

  test('an unknown turn draws the time pill alone', async ($, on) => {
    world(on, [])
    const line = textOf(await $.ui.render(LINE(7_000)))
    expect(line).toContain('7s')
    expect(line).not.toContain('')
  })

  test('usage draws as a second pill', async ($, on) => {
    world(on, [[[text('hi'), 1_000]]])
    await $.turn.start({ text: 'go', turnId: 't' })
    await drain($.turn.step(STEP(0)))
    await $.turn.complete({ answer: 'hi', durationMs: 1_000, isAborted: false, turnId: 't', reason: 'answer', usage: USAGE })

    const line = textOf(await $.ui.render(LINE(1_000)))
    expect(line).toContain('↑12.3k ↓1.8k')
    expect(line).toContain('\uf1c0 81%')
    expect(line).toContain('$0.04')
    expect(line).toContain('\uf2db 41%')
  })

  test('a turn with no token usage still shows cost and context', async ($, on) => {
    world(on, [[[text('hi'), 1_000]]])
    await $.turn.start({ text: 'go', turnId: 't' })
    await drain($.turn.step(STEP(0)))
    await $.turn.complete({ answer: 'hi', durationMs: 1_000, isAborted: true, turnId: 't', reason: 'aborted' })

    const line = textOf(await $.ui.render(LINE(1_000)))
    expect(line).not.toContain('↑')
    expect(line).toContain('$0.04')
  })

  test('a failing usage read keeps the turn', async ($, on) => {
    world(on, [[[text('hi'), 1_000]]], {
      usage: () => {
        throw new Error('down')
      },
    })
    await $.turn.start({ text: 'go', turnId: 't' })
    await drain($.turn.step(STEP(0)))
    await $.turn.complete({ answer: 'hi', durationMs: 1_000, isAborted: false, turnId: 't', reason: 'answer', usage: USAGE })

    const line = textOf(await $.ui.render(LINE(1_000)))
    expect(line).toContain('↑12.3k ↓1.8k')
    expect(line).not.toContain('$')
  })

  test('stats drop from the right as room runs out', () => {
    const turn: BeatTurn = {
      durationMs: 1_000,
      think: 0,
      tools: 0,
      write: 1_000,
      other: 0,
      tokens: { input: 12_345, output: 1_800, cacheRead: 10_000 },
      costUsd: 0.04,
      contextPercent: 41,
    }
    const stats = statsOf(turn)
    const keys = (room: number) => fitStats(stats, room).map(s => s.key)
    expect(keys(pillWidthOf(stats))).toEqual(['io', 'cache', 'cost', 'context'])
    expect(keys(pillWidthOf(stats) - 1)).toEqual(['io', 'cache', 'cost'])
    expect(keys(pillWidthOf(stats.slice(0, 1)))).toEqual(['io'])
    expect(keys(0)).toEqual([])
    expect(statsOf({ ...turn, tokens: { input: 0, output: 0, cacheRead: 0 } }).map(s => s.key)).toEqual(['io', 'cost', 'context'])
  })

  test('the usage pill drops when both pills do not fit', async ($, on) => {
    world(on, [[[text('hi'), 1_000]]])
    await $.turn.start({ text: 'go', turnId: 't' })
    await drain($.turn.step(STEP(0)))
    await $.turn.complete({ answer: 'hi', durationMs: 1_000, isAborted: false, turnId: 't', reason: 'answer', usage: USAGE })

    const line = textOf(await $.ui.render(LINE(1_000, 30)))
    expect(line).toContain('1s')
    expect(line).not.toContain('↑')
  })

  const TURN: BeatTurn = {
    durationMs: 9_000,
    think: 3_000,
    tools: 4_000,
    write: 2_000,
    other: 0,
    tokens: { input: 12_345, output: 1_800, cacheRead: 10_000 },
    costUsd: 0.04,
    contextPercent: 41,
  }

  const finish = async ($: Parameters<TestBody>[0], usage?: TurnUsage) => {
    await $.turn.start({ text: 'go', turnId: 't' })
    await drain($.turn.step(STEP(0)))
    await $.turn.complete({ answer: 'hi', durationMs: 1_000, isAborted: false, turnId: 't', reason: 'answer', ...(usage === undefined ? {} : { usage }) })
  }

  test('turns are saved under the session', async ($, on) => {
    const store = new Map<string, unknown>()
    world(on, [[[text('hi'), 1_000]]], { store })
    await finish($, USAGE)

    expect(storedTurnsOf(store.get('turns:s1')).map(t => t.tokens?.output)).toEqual([1_800])
    expect(store.get('sessions')).toEqual(['s1'])
  })

  test('a resumed session draws its stored turns', async ($, on) => {
    world(on, [], { store: new Map([['turns:s1', { version: 1, turns: [TURN] }]]) })

    const line = textOf(await $.ui.render(LINE(9_000)))
    expect(line).toContain(' 3s')
    expect(line).toContain('↑12.3k ↓1.8k')
    expect(line).toContain('$0.04')
  })

  test('a resume drops live turns and draws from the store', async ($, on) => {
    const store = new Map<string, unknown>()
    world(on, [[[text('hi'), 1_000]]], { store })
    await finish($, USAGE)
    await $.session.end({ reason: 'resume', sessionId: 's1', resume: { id: 's1' } })

    expect(textOf(await $.ui.render(LINE(1_000)))).toContain('↑12.3k ↓1.8k')
  })

  test('new turns add to the stored ones', async ($, on) => {
    const store = new Map<string, unknown>([['turns:s1', { version: 1, turns: [TURN] }]])
    world(on, [[[text('hi'), 1_000]]], { store })
    await finish($, USAGE)

    expect(storedTurnsOf(store.get('turns:s1')).map(t => t.durationMs)).toEqual([9_000, 1_000])
  })

  test('the oldest sessions are evicted', async ($, on) => {
    const ids = Array.from({ length: 50 }, (_, i) => `old${i}`)
    const store = new Map<string, unknown>([['sessions', ids], ...ids.map(id => [`turns:${id}`, { version: 1, turns: [TURN] }] as const)])
    world(on, [[[text('hi'), 1_000]]], { store })
    await finish($, USAGE)

    expect(store.has('turns:old0')).toBe(false)
    expect(store.has('turns:old1')).toBe(true)
    expect(store.has('turns:s1')).toBe(true)
    expect(store.get('sessions')).toEqual([...ids.slice(1), 's1'])
  })

  test('a full store frees room before it saves', async ($, on) => {
    const ids = Array.from({ length: 50 }, (_, i) => `old${i}`)
    const store = new Map<string, unknown>([['sessions', ids], ...ids.map(id => [`turns:${id}`, { version: 1, turns: [TURN] }] as const)])
    world(on, [[[text('hi'), 1_000]]], { store, maxKeys: store.size })
    await finish($, USAGE)

    expect(store.has('turns:old0')).toBe(false)
    expect(store.has('turns:s1')).toBe(true)
  })

  test('a failing store keeps the live turn', async ($, on) => {
    world(on, [[[text('hi'), 1_000]]], { failStore: true })
    await finish($, USAGE)

    expect(textOf(await $.ui.render(LINE(1_000)))).toContain('↑12.3k ↓1.8k')
  })

  test('stored data is read defensively', () => {
    expect(storedTurnsOf({ version: 1, turns: [TURN] })).toEqual([TURN])
    expect(storedTurnsOf({ version: 0, turns: [TURN] })).toEqual([])
    expect(storedTurnsOf('junk')).toEqual([])
    expect(storedTurnsOf(undefined)).toEqual([])
    expect(keptSessionsOf(['a', 'b', 7, 'c'], 'b')).toEqual(['a', 'c', 'b'])
    expect(keptSessionsOf(undefined, 'a')).toEqual(['a'])
  })
})
