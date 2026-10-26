import type { On, RenderInput } from 'claude-code'
import type { MountTarget } from 'claude-code/testing'
import { describe, expect, mock, test } from 'claude-code/testing'

import { clockOf, displayOf, parseOffset, storedStampsOf, unwrapPastes } from '../hooks/register'
import { textOf } from './text-of'

const SESSION = { surface: 'terminal', isInteractive: true, cwd: '/work' } as const

const ROW = (requestId: string, text: string, isExpanded = false): RenderInput<'UserMessage'> => ({
  component: 'UserMessage',
  surface: 'terminal',
  requestId,
  viewport: { columns: 100, rows: 40 },
  props: { text, origin: { kind: 'composer' }, isExpanded },
})

function world(on: On, zone = '+0300\n', store?: Map<string, unknown>) {
  if (store !== undefined) {
    on('session.id', () => ({ value: 's1' }))
    on('store.get', ($, e) => ({ value: store.get(e.key) }))
    on('store.set', async ($, e) => {
      if (e.key === 'sessions') for (let i = 0; i < 10; i++) await Promise.resolve()
      store.set(e.key, e.value)
      return { value: undefined }
    })
    on('store.delete', ($, e) => (store.delete(e.key), { value: undefined }))
    on('store.keys', () => ({ value: [...store.keys()] }))
  }
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.end', ($, e) => ({ sessionId: e.sessionId }))
  on('process.run', () => ({
    value: { exitCode: 0, stdout: zone, stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
  }))
  on('ui.render', { component: 'UserMessage' }, () => ({ type: 'Text', props: {}, children: ['engine'] }))
  return mock.clock(on, { now: 0 })
}

const MOUNT = (requestId: string, text: string): MountTarget<'terminal', 'UserMessage'> => ({
  plugin: 'frame',
  surface: 'terminal',
  component: 'UserMessage',
  requestId,
  viewport: { columns: 100, rows: 40 },
  props: { text, origin: { kind: 'composer' }, isExpanded: false },
})

const prompt = (uuid: string, text: string) => ({
  message: { type: 'user' as const, role: 'user' as const, content: [{ type: 'text' as const, text }] },
  door: 'prompt' as const,
  origin: { kind: 'composer' as const },
  uuid,
})

describe('register', () => {
  test('offset and clock', () => {
    expect(parseOffset('+0300\n')).toBe(3 * 3_600_000)
    expect(parseOffset('-0530')).toBe(-(5 * 60 + 30) * 60_000)
    expect(parseOffset('junk')).toBeNull()
    expect(clockOf(0, 3 * 3_600_000)).toBe('03:00')
    expect(clockOf(0, -60_000)).toBe('23:59')
  })

  test('frames a prompt with its number and local time', async ($, on) => {
    const clock = world(on)
    await $.session.start(SESSION)
    await clock.advance(14 * 3_600_000 + 2 * 60_000)
    await $.session.append(prompt('u1', 'fix the bug'))
    await $.session.append(prompt('u2', 'now test it'))

    const text = textOf(await $.ui.render(ROW('u2', 'now test it')))
    expect(text).toContain('now test it')
    expect(text).toContain('\uea6b 2 · \u{f0150} 17:02')
  })

  test('pasted text drops its wrapper', () => {
    const paste = (body: string) => `<pasted_content id="e13d">\n${body}\n</pasted_content id="e13d">`
    expect(unwrapPastes(`look:\n\n${paste('a\nb')}\n\nthoughts?`)).toBe('look:\na\nb\nthoughts?')
    expect(unwrapPastes(`run ${paste('ls')} now`)).toBe('run ls now')
    expect(unwrapPastes('<pasted_content id="zzzz">\nx\n</pasted_content id="zzzz">')).toContain('<pasted_content')
    expect(unwrapPastes('plain')).toBe('plain')
  })

  test('a prompt over 40 lines shows its first 12 and last 4 lines', () => {
    const lines = Array.from({ length: 41 }, (_, i) => `line ${i + 1}`)
    expect(displayOf(lines.join('\n'))).toEqual({ head: lines.slice(0, 12).join('\n'), hidden: '+25 lines', tail: lines.slice(-4).join('\n') })
    expect(displayOf(lines.slice(0, 40).join('\n'))).toEqual({ head: lines.slice(0, 40).join('\n'), hidden: '', tail: '' })
  })

  test('a long prompt with few lines is cut by chars', () => {
    const long = `${'a'.repeat(2_500)}${'\n'.repeat(3)}${'b'.repeat(48_000)}${'c'.repeat(2_500)}`
    expect(displayOf(long)).toEqual({ head: 'a'.repeat(2_500), hidden: '+48k chars', tail: 'c'.repeat(2_500) })
    expect(displayOf('short')).toEqual({ head: 'short', hidden: '', tail: '' })
  })

  test('long lines past 40 fall back to the char cut', () => {
    const long = Array.from({ length: 41 }, () => 'x'.repeat(1_000)).join('\n')
    expect(displayOf(long).hidden).toBe('+36k chars')
  })

  test('a pasted prompt is framed without its wrapper', async ($, on) => {
    world(on)
    await $.session.start(SESSION)
    const pasted = '<pasted_content id="e13d">\nbigclock\n</pasted_content id="e13d">'
    await $.session.append(prompt('u1', pasted))

    const text = textOf(await $.ui.render(ROW('u1', pasted)))
    expect(text).toContain('bigclock')
    expect(text).not.toContain('<pasted_content')
    expect(text).toContain(' 1 ·')
  })

  test('stamps the stored row, not the input', async ($, on) => {
    world(on)
    on('session.append', ($, e, next) =>
      next({ ...e, message: { ...e.message, content: [{ type: 'text' as const, text: 'stored' }] } }),
    )
    await $.session.start(SESSION)
    await $.session.append(prompt('u1', 'typed'))

    expect(textOf(await $.ui.render(ROW('row-1', 'stored')))).toContain(' 1 ·')
    expect(textOf(await $.ui.render(ROW('row-1', 'typed')))).not.toContain('')
  })

  test('each text block of a prompt matches on its own', async ($, on) => {
    world(on)
    await $.session.start(SESSION)
    await $.session.append({
      ...prompt('u1', ''),
      message: {
        type: 'user',
        role: 'user',
        content: [
          { type: 'text', text: 'first' },
          { type: 'text', text: 'second' },
        ],
      },
    })

    expect(textOf(await $.ui.render(ROW('row-1', ' second\n')))).toContain(' 1 ·')
  })

  test('keeps only the newest stamps', async ($, on) => {
    world(on)
    await $.session.start(SESSION)
    for (let i = 0; i <= 500; i++) await $.session.append(prompt(`u${i}`, `p${i}`))

    expect(textOf(await $.ui.render(ROW('u0', 'p0')))).not.toContain('\uea6b')
    expect(textOf(await $.ui.render(ROW('u500', 'p500')))).toContain(' 501 ·')
  })

  test('a row whose id differs from the stored one is matched by its text', async ($, on) => {
    world(on)
    await $.session.start(SESSION)
    await $.session.append(prompt('u1', '[Image #3] look'))

    expect(textOf(await $.ui.render(ROW('row-1', '[Image #3] look')))).toContain('\uea6b 1 ·')
  })

  test('a prompt from before the mod loaded is framed without a title', async ($, on) => {
    world(on)
    await $.session.start(SESSION)

    const text = textOf(await $.ui.render(ROW('old', 'hello')))
    expect(text).toContain('hello')
    expect(text).not.toContain('\uea6b')
  })

  test('a plugin prompt is framed with its name and time, no number', async ($, on) => {
    world(on)
    await $.session.start(SESSION)
    await $.session.append({ ...prompt('u1', 'Apply that.'), origin: { kind: 'plugin', name: 'read-only' } })
    await $.session.append(prompt('u2', 'next'))

    const row = ROW('u1', 'Apply that.')
    const text = textOf(await $.ui.render({ ...row, props: { ...row.props, origin: { kind: 'plugin', name: 'read-only' } } }))
    expect(text).toContain('Apply that.')
    expect(text).toContain('read-only · \u{f0150} 03:00')
    expect(text).not.toContain('')
    expect(textOf(await $.ui.render(ROW('u2', 'next')))).toContain(' 1 ·')
  })

  test('a narrow frame caps the plugin name, then drops name, number and time', async ($, on) => {
    world(on)
    await $.session.start(SESSION)
    const origin = { kind: 'plugin', name: 'a-very-long-plugin-name' } as const
    await $.session.append({ ...prompt('u1', 'Apply that.'), origin })
    await $.session.append(prompt('u2', 'next'))

    const plugin = async (columns: number) => {
      const row = ROW('u1', 'Apply that.')
      return textOf(await $.ui.render({ ...row, viewport: { columns, rows: 40 }, props: { ...row.props, origin } }))
    }
    const composer = async (columns: number) => textOf(await $.ui.render({ ...ROW('u2', 'next'), viewport: { columns, rows: 40 } }))
    expect(await plugin(32)).toContain(' a-very-long-plu… · \u{f0150} 03:00 ')
    expect(await plugin(31)).not.toContain('a-very')
    expect(await plugin(31)).toContain(' \u{f0150} 03:00 ')
    expect(await plugin(12)).not.toContain('03:00')
    expect(await composer(19)).toContain(' 1 · \u{f0150} 03:00 ')
    expect(await composer(18)).not.toContain(' 1')
    expect(await composer(18)).toContain(' \u{f0150} 03:00 ')
  })

  test('a note added on approve is framed with its time, no number', async ($, on) => {
    world(on)
    await $.session.start(SESSION)
    await $.session.append({
      message: {
        type: 'user',
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 't1', content: 'ok' },
          { type: 'text', text: 'an' },
        ],
      },
      door: 'tool-result',
      origin: { kind: 'tool', tool: 'Bash' },
      uuid: 'r1',
    })

    const row = ROW('r1', 'an')
    const text = textOf(await $.ui.render({ ...row, props: { ...row.props, origin: { kind: 'unclassified' } } }))
    expect(text).toContain('an')
    expect(text).toContain('\u{f0150} 03:00')
    expect(text).not.toContain('\uea6b')
  })

  test('ctrl+o and other senders keep the engine row', async ($, on) => {
    world(on)
    await $.session.start(SESSION)

    expect(textOf(await $.ui.render(ROW('u1', 'x', true)))).toBe('engine')
    const peer = ROW('p1', 'x')
    expect(textOf(await $.ui.render({ ...peer, props: { ...peer.props, origin: { kind: 'sdk' } } }))).toBe('engine')
  })

  test('prompts sent at once all reach the store', async ($, on) => {
    const store = new Map<string, unknown>()
    world(on, '+0300\n', store)
    await $.session.start(SESSION)
    await Promise.all([$.session.append(prompt('u1', 'a')), $.session.append(prompt('u2', 'b'))])

    expect(Object.keys(storedStampsOf(store.get('stamps:s1'))).sort()).toEqual(['u1', 'u2'])
  })

  test('/clear restarts the count', async ($, on) => {
    world(on)
    await $.session.start(SESSION)
    await $.session.append(prompt('u1', 'a'))
    await $.session.end({ reason: 'clear', sessionId: 's', resume: { id: 's' } })
    await $.session.append(prompt('u2', 'b'))

    expect(textOf(await $.ui.render(ROW('u2', 'b')))).toContain('\uea6b 1 ·')
  })

  test('a cut prompt expands to the whole text and collapses again', async ($, on) => {
    world(on)
    await $.session.start(SESSION)
    const long = Array.from({ length: 60 }, (_, i) => `line ${i + 1}`).join('\n')
    await $.session.append(prompt('u1', long))
    await $.session.append(prompt('u2', long))

    const ui = await $.ui.mount(MOUNT('u1', long))
    const other = await $.ui.mount(MOUNT('u2', long))
    expect(textOf(await ui.drawn())).toContain('… +44 lines  expand')
    expect(textOf(await ui.drawn())).not.toContain('line 30')
    expect(await ui.find({ type: 'Button', key: 'collapse' })).toBeUndefined()

    await ui.press({ key: 'expand' })
    const open = textOf(await ui.drawn())
    expect(open).toContain(long)
    expect(open).not.toContain('+44 lines')
    expect(open).toContain('line 60collapse')
    expect(await ui.find({ type: 'Button', key: 'expand' })).toBeUndefined()
    expect(textOf(await other.drawn())).toContain('+44 lines')

    await ui.press({ key: 'collapse' })
    expect(textOf(await ui.drawn())).toContain('… +44 lines  expand')
    expect(textOf(await ui.drawn())).not.toContain('line 30')
    await ui.unmount()
    await other.unmount()
  })

  test('a prompt that is not cut has no button', async ($, on) => {
    world(on)
    await $.session.start(SESSION)
    await $.session.append(prompt('u1', 'short'))

    const ui = await $.ui.mount(MOUNT('u1', 'short'))
    expect(await ui.findAll({ type: 'Button' })).toEqual([])
    await ui.unmount()
  })
})
