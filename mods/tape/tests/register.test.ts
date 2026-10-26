import type { CommandRunInput, On, RenderInput, UiPane } from 'claude-code'
import type { MountTarget } from 'claude-code/testing'
import { describe, expect, mock, test } from 'claude-code/testing'

import { clip, flatten, labelOf, storedListOf, targetOf } from '../hooks/register'
import { textOf } from './text-of'

const SESSION = { surface: 'terminal', isInteractive: true, cwd: '/work' } as const

const TAPE: CommandRunInput = {
  command: 'tape',
  args: '',
  origin: { kind: 'composer' },
  presentation: { isFullscreen: true, columns: 160 },
}

const PANE: RenderInput<'Pane'> = {
  component: 'Pane',
  surface: 'terminal',
  requestId: 'tape',
  viewport: { columns: 160, rows: 40 },
  props: {
    title: 'Tape',
    isFocused: false,
    bodyColumns: 70,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
}

const MOUNT: MountTarget<'terminal', 'Pane'> = {
  plugin: 'tape',
  surface: 'terminal',
  component: 'Pane',
  requestId: 'tape',
  viewport: { columns: 160, rows: 40, isFullscreen: true },
  props: { ...PANE.props, isFocused: true },
}

function world(on: On, entries?: Record<string, unknown>) {
  const panes: UiPane[] = []
  const session = { id: 's1' }
  const clock = mock.clock(on, { now: 0 })
  const store = new Map<string, unknown>(Object.entries(entries ?? {}))
  on('store.get', ($, e) => ({ value: store.get(e.key) }))
  on('store.set', ($, e) => (store.set(e.key, e.value), { value: undefined }))
  on('store.delete', ($, e) => (store.delete(e.key), { value: undefined }))
  on('store.keys', () => ({ value: [...store.keys()] }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.end', ($, e) => ({ sessionId: e.sessionId }))
  on('session.cwd', () => ({ value: '/work' }))
  on('session.id', () => ({ value: session.id }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('ui.panes', () => ({ value: [...panes] }))
  on('ui.open', ($, e) => {
    panes.push({ id: e.id, title: e.title ?? e.id, isShown: true, isFocused: false, isPlaced: true })
    return { value: { isPlaced: true } }
  })
  on('ui.close', ($, e) => {
    panes.splice(panes.findIndex(p => p.id === e.id), 1)
    return { value: undefined }
  })
  return { panes, clock, session, store }
}

const saved = (id: string, turn: number, file: string, status = 'ok') => ({
  [`calls:${id}`]: { version: 1, calls: [{ id: `c-${id}`, turn, tool: 'Read', target: file, isAgent: false, startedAt: 0, endedAt: 1, status }] },
  [`turns:${id}`]: { version: 1, turns: [{ n: turn, prompt: `prompt ${id}` }] },
})

describe('register', () => {
  test('target picks the first known field, relative to cwd', () => {
    expect(targetOf({ file_path: '/work/src/a.ts' }, '/work')).toBe('src/a.ts')
    expect(targetOf({ command: '\n  npm test\nmore' }, '/work')).toBe('npm test ⏎ more')
    expect(targetOf({ command: '  ', description: 'list' }, '/work')).toBe('list')
    expect(targetOf({ other: 1 }, '/work')).toBe('')
  })

  test('flatten joins lines, collapses space and strips cwd', () => {
    expect(flatten('cat <<EOF\n  a   b\n\nEOF', '/work')).toBe('cat <<EOF ⏎ a b ⏎ EOF')
    expect(flatten('cd /work && npm test', '/work')).toBe('npm test')
    expect(flatten('cd "/work"; ls', '/work')).toBe('ls')
    expect(flatten('cd /work\nls', '/work')).toBe('ls')
    expect(flatten('cd /work/sub && ls', '/work')).toBe('cd sub && ls')
    expect(flatten('cat /work/a "/work/b" x=/work/c', '/work')).toBe('cat a "b" x=c')
    expect(flatten('ls /other/work/a /workspace/b', '/work')).toBe('ls /other/work/a /workspace/b')
    expect(flatten('a.b', 'a.b')).toBe('a.b')
    expect(Array.from(flatten('x'.repeat(5000), '/work'))).toHaveLength(1000)
  })

  test('clip cuts to the room with an ellipsis', () => {
    expect(clip('abcdef', 10)).toBe('abcdef')
    expect(clip('abcdef', 4)).toBe('abc…')
    expect(clip('😀😀😀', 2)).toBe('😀…')
    expect(clip('abc', 0)).toBe('')
  })

  test('a long command clips to one row, a press opens it whole, back returns', async ($, on) => {
    world(on)
    on('tool.call', () => ({ result: 'ran' }))
    await $.session.start(SESSION)
    await $.turn.start({ text: 'go', turnId: 't1' })
    const words = Array.from({ length: 60 }, (_, i) => `w${i}`)
    await $.tool.call({ tool: 'Bash', command: `cd /work && echo ${words.join(' ')}\nls` })

    const ui = await $.ui.mount(MOUNT)
    const row = (await ui.findAll({ type: 'Button' })).find(one => one.key?.startsWith('turn:') === false)
    expect(textOf(row)).toContain('✓ $')
    expect(textOf(row)).toContain('echo w0')
    expect(textOf(row)).toContain('…')
    expect(textOf(row)).not.toContain('w59')
    expect(textOf(row)).not.toContain('/work')

    await ui.press({ key: String(row?.key) })
    const code = await ui.find({ type: 'Code' })
    expect(code?.props.language).toBe('bash')
    expect(String(code?.props.source)).toContain('w59\nls')
    expect((await ui.find({ type: 'Button', key: 'back' }))?.props.hotkey).toBe('b')

    await ui.press({ key: 'back' })
    expect(await ui.find({ type: 'Code' })).toBeUndefined()
    expect(await ui.find({ type: 'Button', key: String(row?.key) })).toBeDefined()
    await ui.unmount()
  })

  test('older turns start folded, a press toggles, failures stay counted', async ($, on) => {
    world(on)
    on('tool.call', { tool: 'Read' }, () => ({ result: 'x', isError: true }) as never)
    on('tool.call', () => ({ result: 'ran' }))
    await $.session.start(SESSION)
    await $.turn.start({ text: 'one', turnId: 't1' })
    await $.tool.call({ tool: 'Read', file_path: '/work/old.ts' })
    await $.turn.start({ text: 'two', turnId: 't2' })
    await $.tool.call({ tool: 'Bash', command: 'ls new' })

    const ui = await $.ui.mount(MOUNT)
    let text = textOf(await ui.drawn())
    expect(text).toContain('▸ Turn 1')
    expect(text).toContain('✗1')
    expect(text).not.toContain('old.ts')
    expect(text).toContain('ls new')

    await ui.press({ key: 'turn:1' })
    await ui.press({ key: 'turn:2' })
    text = textOf(await ui.drawn())
    expect(text).toContain('old.ts')
    expect(text).not.toContain('ls new')
    await ui.unmount()
  })

  test('turn label skips engine markup', () => {
    expect(labelOf('\n<pasted_content id="e13d">\nbigclock() {\n</pasted_content id="e13d">')).toBe('bigclock() {')
    expect(labelOf('<command-message>read-only</command-message>\n<command-name>/read-only</command-name>')).toBe(
      'read-only',
    )
    expect(labelOf('fix the <div> layout')).toBe('fix the <div> layout')
    expect(labelOf('<pasted_content id="e13d">\n</pasted_content id="e13d">')).toBe('')
  })

  test('/tape toggles the pane', async ($, on) => {
    const w = world(on)
    await $.session.start(SESSION)

    expect(await $.command.run(TAPE)).toEqual({ text: 'Tape opened.' })
    expect(w.panes.map(p => p.id)).toEqual(['tape'])
    expect(await $.command.run(TAPE)).toEqual({ text: 'Tape closed.' })
    expect(w.panes).toEqual([])
  })

  test('the first tool call opens the pane, later ones leave it closed', async ($, on) => {
    const w = world(on)
    on('tool.call', () => ({ result: 'ran' }))
    await $.session.start(SESSION)
    await $.turn.start({ text: 'go', turnId: 't1' })
    expect(w.panes).toEqual([])

    await $.tool.call({ tool: 'Bash', command: 'ls' })
    expect(w.panes.map(p => p.id)).toEqual(['tape'])
    await $.command.run(TAPE)
    await $.tool.call({ tool: 'Bash', command: 'pwd' })
    expect(w.panes).toEqual([])
  })

  test('records calls per turn with status and duration', async ($, on) => {
    const w = world(on)
    on('tool.call', { tool: 'Bash' }, async () => {
      await w.clock.advance(1_500)
      return { result: 'ran' }
    })
    on('tool.call', { tool: 'Edit' }, () => ({ deny: 'no' }))
    on('tool.call', { tool: 'Read' }, () => ({ result: 'x', isError: true }) as never)
    await $.session.start(SESSION)

    await $.turn.start({ text: 'fix the build\nplease', turnId: 't1' })
    await $.tool.call({ tool: 'Read', file_path: '/work/README.md' })
    await $.turn.start({ text: 'run tests', turnId: 't2' })
    await $.tool.call({ tool: 'Edit', file_path: '/work/a.ts', old_string: 'a', new_string: 'b' })

    const text = textOf(await $.ui.render(PANE))
    expect(text).toContain('Turn 2')
    expect(text).toContain('run tests')
    expect(text).toContain('⊘ Edit')
    expect(text).toContain('a.ts')
    expect(text).toContain('Turn 1')
    expect(text).toContain('fix the build')
    expect(text).toContain('✗1')
    expect(text.indexOf('Turn 2')).toBeLessThan(text.indexOf('Turn 1'))
  })

  test('/clear empties the tape', async ($, on) => {
    const w = world(on)
    on('tool.call', () => ({ result: 'ran' }))
    await $.session.start(SESSION)
    await $.turn.start({ text: 'x', turnId: 't1' })
    await $.tool.call({ tool: 'Bash', command: 'ls' })
    w.session.id = 's2'
    await $.session.end({ reason: 'clear', sessionId: 's1', resume: { id: 's1' } })

    expect(textOf(await $.ui.render(PANE))).toContain('No tool calls yet.')
  })

  test('calls are saved and come back after a restart', async ($, on) => {
    const w = world(on, saved('s1', 4, 'kept.ts', 'running'))
    on('tool.call', () => ({ result: 'ran' }))
    await $.session.start(SESSION)

    const tree = await $.ui.render(PANE)
    expect(textOf(tree)).toContain('Turn 4')
    expect(textOf(tree)).toContain('✗ Read')
    expect(textOf(tree)).toContain('kept.ts')

    await $.turn.start({ text: 'next', turnId: 't5' })
    await $.tool.call({ tool: 'Bash', command: 'ls' })
    expect(storedListOf(w.store.get('calls:s1'), 'calls')).toHaveLength(2)
    expect(w.store.get('turns:s1')).toEqual({
      version: 1,
      turns: [
        { n: 4, prompt: 'prompt s1' },
        { n: 5, prompt: 'next' },
      ],
    })
  })

  test('resume swaps to that session’s tape', async ($, on) => {
    const w = world(on, { sessions: ['s2'], ...saved('s2', 1, 'other.ts') })
    on('tool.call', () => ({ result: 'ran' }))
    await $.session.start(SESSION)
    await $.turn.start({ text: 'mine', turnId: 't1' })
    await $.tool.call({ tool: 'Bash', command: 'ls mine' })

    w.session.id = 's2'
    await $.session.end({ reason: 'resume', sessionId: 's1', resume: { id: 's1' } })
    const text = textOf(await $.ui.render(PANE))
    expect(text).toContain('other.ts')
    expect(text).not.toContain('ls mine')
    expect(storedListOf(w.store.get('calls:s1'), 'calls')).toHaveLength(1)
  })

  test('keeps only the last five sessions', async ($, on) => {
    const old = ['a', 'b', 'c', 'd', 'e']
    const w = world(on, { sessions: old, ...old.reduce((all, id) => ({ ...all, ...saved(id, 1, `${id}.ts`) }), {}), ...saved('lost', 1, 'lost.ts') })
    on('tool.call', () => ({ result: 'ran' }))
    await $.session.start(SESSION)
    await $.turn.start({ text: 'x', turnId: 't1' })
    await $.tool.call({ tool: 'Bash', command: 'ls' })

    expect(w.store.get('sessions')).toEqual(['b', 'c', 'd', 'e', 's1'])
    expect(w.store.get('calls:a')).toBeUndefined()
    expect(w.store.get('turns:a')).toBeUndefined()
    expect(w.store.get('calls:lost')).toBeUndefined()
    expect(w.store.get('turns:lost')).toBeUndefined()
    expect(storedListOf(w.store.get('calls:b'), 'calls')).toHaveLength(1)
  })

  test('unversioned saves are not read', async ($, on) => {
    world(on, { 'calls:s1': [{ id: 'c', turn: 1, tool: 'Read', target: 'old.ts', isAgent: false, startedAt: 0, endedAt: 1, status: 'ok' }] })
    await $.session.start(SESSION)
    expect(textOf(await $.ui.render(PANE))).toContain('No tool calls yet.')
  })
})
