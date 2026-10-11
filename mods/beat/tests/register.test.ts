import type { MockClock } from 'claude-code/testing'
import type { On, RenderInput, TurnStepChunk, TurnStepInput } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'

import { cellsOf, formatDuration, partsOf, secondsOf, unionMs } from '../hooks/register'
import { textOf } from './text-of'

const LINE = (durationMs: number): RenderInput<'TurnDuration'> => ({
  component: 'TurnDuration',
  surface: 'terminal',
  requestId: 'line',
  viewport: { columns: 120, rows: 40 },
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

function world(on: On, script: Beat[][]) {
  const clock: MockClock = mock.clock(on, { now: 0 })
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
})
