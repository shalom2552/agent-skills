import type { CommandRunInput, On, RenderInput, UiPane } from 'claude-code'
import type { MountTarget } from 'claude-code/testing'
import { describe, expect, mock, test } from 'claude-code/testing'

import { capCalls, clip, failedNote, flatten, formatSeconds, headOf, labelOf, storedListOf, summaryOf, tailOf, targetOf } from '../hooks/register'
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
  const waiting = { reason: '' }
  const transcript: { main: unknown[]; agents: Record<string, unknown[]> } = { main: [], agents: {} }
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
  on('session.messages', ($, e) => ({
    value: (e.agentId === undefined ? transcript.main : (transcript.agents[e.agentId] ?? { deny: 'unknown' })) as never,
  }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('agent.spawn', ($, e) => ({ model: 'm', agentId: `ag-${e.tool_use_id}` }))
  on('ui.panes', () => ({ value: [...panes] }))
  on('ui.open', ($, e) => {
    if (waiting.reason.length > 0) return { value: { isPlaced: false, reason: waiting.reason } }
    panes.push({ id: e.id, title: e.title ?? e.id, isShown: true, isFocused: false, isPlaced: true })
    return { value: { isPlaced: true } }
  })
  on('ui.close', ($, e) => {
    panes.splice(panes.findIndex(p => p.id === e.id), 1)
    return { value: undefined }
  })
  return { panes, clock, session, store, waiting, transcript }
}

const used = (tool_use_id: string, text: string, isError?: true, result?: unknown) => ({
  role: 'assistant',
  text: '',
  toolUses: [{ tool_use_id, tool: 'x', input: {}, text, isError, result }],
})

const said = (text: string) => ({ role: 'assistant', text, toolUses: [] })

const saved = (id: string, turn: number, file: string, status = 'ok') => ({
  [`calls:${id}`]: { version: 1, calls: [{ id: `c-${id}`, turn, tool: 'Read', target: file, startedAt: 0, endedAt: 1, status }] },
  [`turns:${id}`]: { version: 1, turns: [{ n: turn, prompt: `prompt ${id}` }] },
})

describe('register', () => {
  test('target picks the first known field, relative to cwd', () => {
    expect(targetOf({ file_path: '/work/src/a.ts' }, '/work')).toBe('src/a.ts')
    expect(targetOf({ command: '\n  npm test\nmore' }, '/work')).toBe('npm test ⏎ more')
    expect(targetOf({ command: '  ', description: 'list' }, '/work')).toBe('list')
    expect(targetOf({ other: 1 }, '/work')).toBe('')
  })

  test('durations show tenths, then seconds, then minutes', () => {
    expect(formatSeconds(1_240)).toBe('1.2s')
    expect(formatSeconds(45_000)).toBe('45s')
    expect(formatSeconds(65_000)).toBe('1m 5s')
    expect(formatSeconds(3_720_000)).toBe('1h 2m')
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
    expect(text).toContain('1 failed')
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

  test('/tape says why the pane waits', async ($, on) => {
    const w = world(on)
    w.waiting.reason = 'too narrow'
    await $.session.start(SESSION)

    expect(await $.command.run(TAPE)).toEqual({ text: 'Tape is waiting: too narrow' })
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
    expect(text).toContain('1 failed')
    expect(text.indexOf('Turn 2')).toBeLessThan(text.indexOf('Turn 1'))
  })

  test('a subagent turn start adds no turn', async ($, on) => {
    const w = world(on)
    on('tool.call', () => ({ result: 'ran' }))
    await $.session.start(SESSION)
    await $.turn.start({ text: 'spawn two', turnId: 't1' })
    await $.turn.start({ text: 'agent prompt', turnId: 't2', agentId: 'a1' })
    await $.tool.call({ tool: 'Bash', command: 'ls' })

    const text = textOf(await $.ui.render(PANE))
    expect(text).toContain('Turn 1')
    expect(text).not.toContain('agent prompt')
    expect(storedListOf(w.store.get('turns:s1'), 'turns')).toEqual([{ n: 1, prompt: 'spawn two' }])
  })

  test('failures read as a word unless narrow', () => {
    expect(failedNote(0, 70)).toBe('')
    expect(failedNote(4, 70)).toBe(' · 4 failed')
    expect(failedNote(4, 30)).toBe(' · ✗4')
  })

  test('agent calls have their own cap', () => {
    const call = (id: string, agentId?: string) => ({ id, turn: 1, tool: 'Bash', target: '', agentId, startedAt: 0, status: 'ok' as const })
    const main = Array.from({ length: 301 }, (_, i) => call(`m${i}`))
    const kept = capCalls([call('x', 'ag'), ...main])
    expect(kept).toHaveLength(301)
    expect(kept[0]?.id).toBe('x')
    expect(kept[1]?.id).toBe('m1')
  })

  test('subagents get their own section with live status and span', async ($, on) => {
    world(on)
    on('tool.call', { tool: 'Bash', command: 'ls bad' }, () => ({ result: 'x', isError: true }) as never)
    on('tool.call', () => ({ result: 'ran' }))
    await $.session.start(SESSION)
    await $.turn.start({ text: 'spawn two', turnId: 't1' })
    for (const [id, about] of [['u1', 'review A'], ['u2', 'review B']] as const) {
      await $.agent.spawn({ prompt: about, description: about, subagentType: 'general-purpose', tool_use_id: id } as never)
      await $.turn.start({ text: about, turnId: `t-${id}`, agentId: `ag-${id}` })
      await $.tool.call({ tool: 'Agent', tool_use_id: id, description: about, prompt: about } as never)
    }
    await $.tool.call({ tool: 'Bash', command: 'ls a', agentId: 'ag-u1' } as never)
    await $.tool.call({ tool: 'Bash', command: 'ls b', agentId: 'ag-u2' } as never)
    await $.tool.call({ tool: 'Bash', command: 'ls bad', agentId: 'ag-u2' } as never)
    await $.turn.complete({ answer: 'done', durationMs: 1, isAborted: false, turnId: 't-u2', agentId: 'ag-u2', reason: 'answer' })
    await $.turn.start({ text: '<task-notification>\n<task-id>ag-u2</task-id>', turnId: 't2' })
    await $.tool.call({ tool: 'Bash', command: 'ls main' })

    const text = textOf(await $.ui.render(PANE))
    expect(text).toContain('Turn 2 · 1 call ↩ review B')
    expect(text).toContain('Turn 1 · 2 calls')
    expect(text).toContain('● Agent a1 review A')
    expect(text).toContain('✓ Agent a2 review B')
    expect(text).toContain('── Agents · 1 running · 1 done ─')
    expect(text).toContain('▾ ● a1 general · review A')
    expect(text).toContain('T1→now · 1 call')
    expect(text).toContain('ls a')
    expect(text).toContain('▸ ✓ a2 general · review B')
    expect(text).toContain('T1→T1 · 2 calls · 1 failed')
    expect(text).not.toContain('ls b')
    expect(text.indexOf('ls main')).toBeLessThan(text.indexOf('Agents'))
  })

  test('an agent call shows its agent, not the turn prompt', async ($, on) => {
    world(on)
    on('tool.call', () => ({ result: 'ran' }))
    await $.session.start(SESSION)
    await $.turn.start({ text: 'main prompt', turnId: 't1' })
    await $.agent.spawn({ prompt: 'p', description: 'review A', subagentType: 'Explore', tool_use_id: 'u1' } as never)
    await $.tool.call({ tool: 'Bash', command: 'ls a', agentId: 'ag-u1', tool_use_id: 'c1' } as never)

    const ui = await $.ui.mount(MOUNT)
    await ui.press({ key: 'c1' })
    const text = textOf(await ui.drawn())
    expect(text).toContain('Bash · a1 Explore · review A')
    expect(text).not.toContain('main prompt')
    await ui.unmount()
  })

  test('agents are saved, and a running one comes back failed', async ($, on) => {
    const agent = { id: 'ag', description: 'review A', type: 'Explore', spawnTurn: 1, startedAt: 0, status: 'running' }
    const w = world(on, { ...saved('s1', 1, 'kept.ts'), 'agents:s1': { version: 1, agents: [agent] } })
    await $.session.start(SESSION)

    expect(textOf(await $.ui.render(PANE))).toContain('✗ a1 Explore · review A')
    await $.agent.spawn({ prompt: 'p', description: 'review B', subagentType: 'Explore', tool_use_id: 'u2' } as never)
    expect(storedListOf(w.store.get('agents:s1'), 'agents')).toHaveLength(2)
  })

  test('output summaries per tool', () => {
    const call = (tool: string, status = 'ok' as const) => ({ id: 'c', turn: 1, tool, target: 'a.ts', startedAt: 0, status })
    const out = (text: string, isError = false, result?: unknown) => ({ text, isError, result })
    expect(summaryOf(call('Bash'), out('a\nb\n'))).toBe('2 lines')
    expect(summaryOf(call('Bash'), out(''))).toBe('0 lines')
    expect(summaryOf(call('Bash'), out('Exit code 1\nboom', true))).toBe('exit 1')
    expect(summaryOf(call('Read'), out('x', true))).toBe('error')
    expect(summaryOf(call('Read'), out('1→a', false, { file: { numLines: 142 } }))).toBe('142 lines · a.ts')
    expect(summaryOf(call('Read'), out('1→a'))).toBe('1 line · a.ts')
    const patch = [{ lines: [' a', '-b', '+c', '+d'] }]
    expect(summaryOf(call('Edit'), out('ok', false, { structuredPatch: patch }))).toBe('+2 −1')
    expect(summaryOf(call('Write'), out('ok', false, { type: 'create', structuredPatch: [], content: 'a\nb\nc' }))).toBe('+3 −0')
    expect(summaryOf(call('Write'), out('ok'))).toBe('1 line')
    expect(summaryOf({ ...call('Edit'), status: 'denied' }, out('not now\nmore', true))).toBe('denied: not now')
  })

  test('output keeps the tail or the head', () => {
    const text = Array.from({ length: 25 }, (_, i) => `L${i + 1}`).join('\n')
    expect(tailOf(text)).toEqual({ more: 5, lines: Array.from({ length: 20 }, (_, i) => `L${i + 6}`) })
    expect(headOf(text, 2)).toEqual({ more: 23, lines: ['L1', 'L2'] })
    expect(tailOf('a')).toEqual({ more: 0, lines: ['a'] })
  })

  test('a call shows its output folded, a press shows the tail', async ($, on) => {
    const w = world(on)
    on('tool.call', () => ({ result: 'ran' }))
    await $.session.start(SESSION)
    await $.turn.start({ text: 'go', turnId: 't1' })
    await $.tool.call({ tool: 'Bash', command: 'seq 45', tool_use_id: 'c1' } as never)
    w.transcript.main = [used('c1', Array.from({ length: 45 }, (_, i) => `L${i + 1}.`).join('\n'))]

    const ui = await $.ui.mount(MOUNT)
    await ui.press({ key: 'c1' })
    let text = textOf(await ui.drawn())
    expect(text).toContain('── command ─')
    expect(text).toContain('▸ output · 45 lines')
    expect(text).not.toContain('L45.')
    expect((await ui.find({ type: 'Button', key: 'output' }))?.props.hotkey).toBe('o')

    await ui.press({ key: 'output' })
    text = textOf(await ui.drawn())
    expect(text).toContain('▾ output · 45 lines')
    expect(text).toContain('… 25 more lines')
    expect(text).toContain('L26.')
    expect(text).toContain('L45.')
    expect(text).not.toContain('L25.')

    await ui.press({ key: 'back' })
    await ui.press({ key: 'c1' })
    expect(textOf(await ui.drawn())).toContain('▸ output')
    await ui.unmount()
  })

  test('a failed agent call reads its output from the agent', async ($, on) => {
    const w = world(on)
    on('tool.call', () => ({ result: 'x', isError: true }) as never)
    await $.session.start(SESSION)
    await $.turn.start({ text: 'go', turnId: 't1' })
    await $.turn.start({ text: 'p', turnId: 't-ag', agentId: 'ag' })
    await $.tool.call({ tool: 'Bash', command: 'false', agentId: 'ag', tool_use_id: 'c1' } as never)
    w.transcript.agents.ag = [used('c1', 'Exit code 2\nboom', true)]

    const ui = await $.ui.mount(MOUNT)
    await ui.press({ key: 'c1' })
    await ui.press({ key: 'output' })
    const text = textOf(await ui.drawn())
    expect(text).toContain('output · exit 2')
    expect(text).toContain('boom')
    const head = await ui.find({ type: 'Button', key: 'output' })
    expect(JSON.stringify(head)).toContain('"color":"error"')
    await ui.unmount()
  })

  test('a spawn shows the agent summary and its report', async ($, on) => {
    const w = world(on)
    on('tool.call', () => ({ result: 'ran' }))
    await $.session.start(SESSION)
    await $.turn.start({ text: 'go', turnId: 't1' })
    await $.agent.spawn({ prompt: 'p', description: 'review A', subagentType: 'Explore', tool_use_id: 'u1' } as never)
    await $.tool.call({ tool: 'Agent', tool_use_id: 'u1', description: 'review A', prompt: 'p' } as never)
    await $.tool.call({ tool: 'Bash', command: 'ls', agentId: 'ag-u1' } as never)
    await $.turn.complete({ answer: 'done', durationMs: 1, isAborted: false, turnId: 't-u1', agentId: 'ag-u1', reason: 'answer' })
    w.transcript.main = [used('u1', 'Async agent launched successfully.')]
    w.transcript.agents['ag-u1'] = [said('first'), said('found two bugs\nsecond line')]

    const ui = await $.ui.mount(MOUNT)
    await ui.press({ key: 'u1' })
    expect(textOf(await ui.drawn())).toContain('▸ output · done · 0.0s · 1 call')
    await ui.press({ key: 'output' })
    const text = textOf(await ui.drawn())
    expect(text).toContain('found two bugs')
    expect(text).not.toContain('launched')
    await ui.unmount()
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

  test('/clear empties the tape once the new id is ready', async ($, on) => {
    const w = world(on)
    on('tool.call', () => ({ result: 'ran' }))
    await $.session.start(SESSION)
    await $.turn.start({ text: 'x', turnId: 't1' })
    await $.tool.call({ tool: 'Bash', command: 'ls' })
    await $.session.end({ reason: 'clear', sessionId: 's1', resume: { id: 's1' } })
    w.session.id = 's2'
    await w.clock.advance(200)

    expect(textOf(await $.ui.render(PANE))).toContain('No tool calls yet.')
    expect(storedListOf(w.store.get('calls:s1'), 'calls')).toHaveLength(1)
  })

  test('resume swaps tapes once the resumed id is ready', async ($, on) => {
    const w = world(on, { sessions: ['s2'], ...saved('s2', 1, 'other.ts') })
    on('tool.call', () => ({ result: 'ran' }))
    await $.session.start(SESSION)
    await $.turn.start({ text: 'mine', turnId: 't1' })
    await $.tool.call({ tool: 'Bash', command: 'ls mine' })
    await $.session.end({ reason: 'resume', sessionId: 's1', resume: { id: 's2' } })
    w.session.id = 's2'
    await w.clock.advance(200)

    const text = textOf(await $.ui.render(PANE))
    expect(text).toContain('other.ts')
    expect(text).not.toContain('ls mine')
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
    world(on, { 'calls:s1': [{ id: 'c', turn: 1, tool: 'Read', target: 'old.ts', startedAt: 0, endedAt: 1, status: 'ok' }] })
    await $.session.start(SESSION)
    expect(textOf(await $.ui.render(PANE))).toContain('No tool calls yet.')
  })
})
