import type { CommandRunInput, On, RenderInput, UiPane } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'

import { labelOf, targetOf } from '../hooks/register'
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

function world(on: On) {
  const panes: UiPane[] = []
  const clock = mock.clock(on, { now: 0 })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.end', ($, e) => ({ sessionId: e.sessionId }))
  on('session.cwd', () => ({ value: '/work' }))
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
  return { panes, clock }
}

describe('register', () => {
  test('target picks the first known field, relative to cwd', () => {
    expect(targetOf({ file_path: '/work/src/a.ts' }, '/work')).toBe('src/a.ts')
    expect(targetOf({ command: '\n  npm test\nmore' }, '/work')).toBe('npm test')
    expect(targetOf({ other: 1 }, '/work')).toBe('')
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
    expect(text).toContain('⊘Edit')
    expect(text).toContain('a.ts')
    expect(text).toContain('Turn 1')
    expect(text).toContain('fix the build')
    expect(text).toContain('✗Read')
    expect(text).toContain('README.md')
    expect(text.indexOf('Turn 2')).toBeLessThan(text.indexOf('Turn 1'))
  })

  test('/clear empties the tape', async ($, on) => {
    world(on)
    on('tool.call', () => ({ result: 'ran' }))
    await $.session.start(SESSION)
    await $.turn.start({ text: 'x', turnId: 't1' })
    await $.tool.call({ tool: 'Bash', command: 'ls' })
    await $.session.end({ reason: 'clear', sessionId: 's', resume: { id: 's' } })

    expect(textOf(await $.ui.render(PANE))).toContain('No tool calls yet.')
  })
})
