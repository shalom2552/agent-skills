import type { On, RenderInput, SessionMessage, SessionUsage, Settings } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'

import { countdown, fieldOf, human, patchLinesOf, storedDiffOf } from '../hooks/register'
import { textOf } from './text-of'

const SESSION = { surface: 'terminal', isInteractive: true, cwd: '/repo' } as const

const HINT = (columns = 160): RenderInput<'PromptHint'> => ({
  component: 'PromptHint',
  surface: 'terminal',
  requestId: 'hint',
  viewport: { columns, rows: 40 },
  props: { isDraft: false, isWorking: false, hint: '? for shortcuts' },
})

const USAGE: SessionUsage = {
  startedAt: 0,
  context: { window: 1_000_000, tokens: 123_456, percent: 12.3 },
  rateLimits: [{ kind: 'five_hour', percentUsed: 72, resetsAt: new Date(2 * 3_600_000 + 18 * 60_000).toISOString() }],
  cost: { usd: 2.514 },
}

const EDIT = { structuredPatch: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-line two', '+line 2'] }] }
const CREATE = { type: 'create', structuredPatch: [], originalFile: null, content: 'line one\nline two\n' }

type World = { store?: Map<string, unknown>; messages?: SessionMessage[]; id?: string; settings?: Settings; isDetached?: boolean }

const SETTINGS: Settings = { effortLevel: 'high', modelSettings: { 'claude-opus-5-5': { effortLevel: 'medium' } } }

function world(on: On, { store = new Map(), messages = [], id = 's1', settings = SETTINGS, isDetached = false }: World = {}) {
  const clock = mock.clock(on, { now: 0 })
  const session = { id }
  const runs: string[][] = []
  on('session.cwd', () => ({ value: '/repo' }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.usage', () => ({ value: USAGE }))
  on('session.id', () => ({ value: session.id }))
  on('session.messages', () => ({ value: messages }))
  on('settings.read', () => ({ value: settings }))
  on('process.run', ($, e) => {
    runs.push([...e.argv])
    const detached = isDetached && e.argv.includes('symbolic-ref')
    const stdout = e.argv.includes('symbolic-ref') ? 'main\n' : e.argv.includes('rev-parse') ? 'abc1234\n' : e.argv.includes('status') ? ' M a.ts\n' : ''
    return { value: { exitCode: detached ? 1 : 0, stdout: detached ? '' : stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('store.get', ($, e) => ({ value: store.get(e.key) }))
  on('store.set', ($, e) => {
    store.set(e.key, e.value)
    return { value: undefined }
  })
  on('store.delete', ($, e) => {
    store.delete(e.key)
    return { value: undefined }
  })
  on('store.keys', () => ({ value: [...store.keys()] }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.end', ($, e) => ({ sessionId: e.sessionId }))
  on('tool.call', ($, e) => (e.tool === 'Read' ? { result: 'text', isReadOnly: true as const } : { result: e.tool === 'Write' ? CREATE : EDIT }))
  on('ui.render', { component: 'PromptHint' }, () => ({ type: 'Text', props: {}, children: ['engine hint'] }))
  return { store, runs, clock, session }
}

describe('register', () => {
  test('helpers', () => {
    expect(human(999)).toBe('999')
    expect(human(123_456)).toBe('123k')
    expect(human(2_500_000)).toBe('2M')
    expect(countdown(2 * 3_600_000 + 18 * 60_000, 0)).toBe('2h')
    expect(countdown(3 * 86_400_000 + 5 * 3_600_000, 0)).toBe('3d')
    expect(countdown(45 * 60_000, 0)).toBe('45m')
    expect(countdown(0, 1)).toBeUndefined()
  })

  test('counts lines like the engine', () => {
    expect(patchLinesOf(EDIT)).toEqual({ added: 1, removed: 1 })
    expect(patchLinesOf(CREATE)).toEqual({ added: 3, removed: 0 })
    expect(patchLinesOf({ structuredPatch: [], content: 'a\nb', originalFile: 'a' })).toEqual({ added: 2, removed: 1 })
    expect(patchLinesOf(undefined)).toEqual({ added: 0, removed: 0 })
  })

  test('reads stored totals of its own version only', () => {
    expect(storedDiffOf({ version: 1, added: 4, removed: 1 })).toEqual({ added: 4, removed: 1 })
    expect(storedDiffOf({ version: 2, added: 4, removed: 1 })).toBeUndefined()
    expect(storedDiffOf(null)).toBeUndefined()
  })

  test('draws every segment with the engine hint under it', async ($, on) => {
    world(on)
    await $.session.start(SESSION)
    const row = textOf(await $.ui.render(HINT()))
    expect(row).toContain('claude-opus-5-5')
    expect(row).toContain('medium')
    expect(row).toContain('main*')
    expect(row).toContain('$2.51')
    expect(row).toContain('123k')
    expect(row).toContain('12%')
    expect(row).toContain('5h 72% ↻2h')
    expect(row).toContain('engine hint')
  })

  test('adds edits and writes to the diff and saves it', async ($, on) => {
    const { store } = world(on)
    await $.session.start(SESSION)
    await $.tool.call({ tool: 'Write', file_path: '/t/a.txt', content: 'line one\nline two\n' })
    await $.tool.call({ tool: 'Edit', file_path: '/t/a.txt', old_string: 'line two', new_string: 'line 2' })
    expect(textOf(await $.ui.render(HINT()))).toContain('+4/-1')
    expect(store.get('diff:s1')).toEqual({ version: 1, added: 4, removed: 1 })
  })

  test('a resumed session starts from its saved total', async ($, on) => {
    world(on, { store: new Map([['diff:s1', { version: 1, added: 281, removed: 8 }]]) })
    await $.session.start(SESSION)
    expect(textOf(await $.ui.render(HINT()))).toContain('+281/-8')
  })

  test('with nothing saved, rebuilds the total from the transcript', async ($, on) => {
    const messages: SessionMessage[] = [
      { role: 'assistant', text: '', toolUses: [{ tool_use_id: 'a', tool: 'Write', input: {}, result: CREATE }] },
      { role: 'assistant', text: '', toolUses: [{ tool_use_id: 'b', tool: 'Edit', input: {}, result: EDIT }] },
      { role: 'assistant', text: '', toolUses: [{ tool_use_id: 'c', tool: 'Edit', input: {}, result: 'boom', isError: true }] },
    ]
    const { store } = world(on, { messages })
    await $.session.start(SESSION)
    expect(textOf(await $.ui.render(HINT()))).toContain('+4/-1')
    expect(store.get('diff:s1')).toEqual({ version: 1, added: 4, removed: 1 })
  })

  test('one poll however many sessions start', async ($, on) => {
    const { runs, clock } = world(on)
    await $.session.start(SESSION)
    await $.session.start(SESSION)
    runs.length = 0
    await clock.advance(5_000)
    expect(runs.filter(r => r.includes('status')).length).toBe(1)
  })

  test('git skips index locks and rev-parse unless detached', async ($, on) => {
    const { runs } = world(on)
    await $.session.start(SESSION)
    expect(runs.every(r => r.includes('--no-optional-locks'))).toBe(true)
    expect(runs.some(r => r.includes('rev-parse'))).toBe(false)
  })

  test('a detached head shows the short sha', async ($, on) => {
    world(on, { isDetached: true })
    await $.session.start(SESSION)
    expect(textOf(await $.ui.render(HINT()))).toContain('abc1234*')
  })

  test('read-only tools do not refresh', async ($, on) => {
    const { runs } = world(on)
    await $.session.start(SESSION)
    runs.length = 0
    await $.tool.call({ tool: 'Read', file_path: '/t/a.txt' })
    expect(runs.length).toBe(0)
    await $.tool.call({ tool: 'Edit', file_path: '/t/a.txt', old_string: 'a', new_string: 'b' })
    expect(runs.length).toBeGreaterThan(0)
  })

  test('odd settings do not break the row', async ($, on) => {
    world(on, { settings: JSON.parse('{"modelSettings":{"claude-opus-5-5":"medium"}}') })
    await $.session.start(SESSION)
    const row = textOf(await $.ui.render(HINT()))
    expect(row).toContain('claude-opus-5-5')
    expect(row).toContain('main*')
    expect(fieldOf('medium', 'effortLevel')).toBeUndefined()
  })

  test('clear resets the diff', async ($, on) => {
    world(on)
    await $.session.start(SESSION)
    await $.tool.call({ tool: 'Edit', file_path: '/t/a.txt', old_string: 'a', new_string: 'b' })
    await $.session.end({ reason: 'clear', sessionId: 's1', resume: { id: 's1' } })
    expect(textOf(await $.ui.render(HINT()))).not.toContain('+1/-1')
  })

  test('resume shows the resumed session total once its id is ready', async ($, on) => {
    const { store, clock, session } = world(on, { store: new Map([['sessions', ['s2']], ['diff:s2', { version: 1, added: 281, removed: 8 }]]) })
    await $.session.start(SESSION)
    await $.tool.call({ tool: 'Edit', file_path: '/t/a.txt', old_string: 'a', new_string: 'b' })
    await $.session.end({ reason: 'resume', sessionId: 's1', resume: { id: 's2' } })
    expect(textOf(await $.ui.render(HINT()))).not.toContain('+1/-1')

    session.id = 's2'
    await clock.advance(200)
    expect(textOf(await $.ui.render(HINT()))).toContain('+281/-8')
    await $.tool.call({ tool: 'Edit', file_path: '/t/a.txt', old_string: 'a', new_string: 'b' })
    expect(store.get('diff:s2')).toEqual({ version: 1, added: 282, removed: 9 })
    expect(store.get('diff:s1')).toEqual({ version: 1, added: 1, removed: 1 })
  })

  test('saves land in order', async ($, on) => {
    const { store } = world(on)
    await $.session.start(SESSION)
    await Promise.all([
      $.tool.call({ tool: 'Edit', file_path: '/t/a.txt', old_string: 'a', new_string: 'b' }),
      $.tool.call({ tool: 'Edit', file_path: '/t/b.txt', old_string: 'a', new_string: 'b' }),
      $.tool.call({ tool: 'Write', file_path: '/t/c.txt', content: 'x' }),
    ])
    expect(store.get('diff:s1')).toEqual({ version: 1, added: 5, removed: 2 })
  })
})
