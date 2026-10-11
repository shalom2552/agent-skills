import type { On, RenderInput } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'

import { clockOf, displayOf, parseOffset, unwrapPastes } from '../hooks/register'
import { textOf } from './text-of'

const SESSION = { surface: 'terminal', isInteractive: true, cwd: '/work' } as const

const ROW = (requestId: string, text: string, isExpanded = false): RenderInput<'UserMessage'> => ({
  component: 'UserMessage',
  surface: 'terminal',
  requestId,
  viewport: { columns: 100, rows: 40 },
  props: { text, origin: { kind: 'composer' }, isExpanded },
})

function world(on: On, zone = '+0300\n') {
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.end', ($, e) => ({ sessionId: e.sessionId }))
  on('process.run', () => ({
    value: { exitCode: 0, stdout: zone, stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
  }))
  on('ui.render', { component: 'UserMessage' }, () => ({ type: 'Text', props: {}, children: ['engine'] }))
  return mock.clock(on, { now: 0 })
}

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

  test('a long prompt shows its head and tail', () => {
    const long = `${'a'.repeat(2_500)}${'\n'.repeat(3)}${'b'.repeat(6_000)}${'c'.repeat(2_500)}`
    expect(displayOf(long)).toEqual({ head: 'a'.repeat(2_500), hiddenLines: 3, tail: 'c'.repeat(2_500) })
    expect(displayOf('short')).toEqual({ head: 'short', hiddenLines: 0, tail: '' })
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

  test('ctrl+o and other senders keep the engine row', async ($, on) => {
    world(on)
    await $.session.start(SESSION)

    expect(textOf(await $.ui.render(ROW('u1', 'x', true)))).toBe('engine')
    const peer = ROW('p1', 'x')
    expect(textOf(await $.ui.render({ ...peer, props: { ...peer.props, origin: { kind: 'sdk' } } }))).toBe('engine')
  })

  test('/clear restarts the count', async ($, on) => {
    world(on)
    await $.session.start(SESSION)
    await $.session.append(prompt('u1', 'a'))
    await $.session.end({ reason: 'clear', sessionId: 's', resume: { id: 's' } })
    await $.session.append(prompt('u2', 'b'))

    expect(textOf(await $.ui.render(ROW('u2', 'b')))).toContain('\uea6b 1 ·')
  })
})
