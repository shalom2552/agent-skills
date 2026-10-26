import type { On } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'

import { skillsOf, storedSkillsOf } from '../hooks/register'
import { textOf } from './text-of'

const SESSION = { surface: 'terminal', isInteractive: true, cwd: '/repo' } as const

const PROPS = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 10,
  bodyColumns: 80,
  scroll: { offset: 0, bodyRows: 10 },
  view: {},
  title: '',
  isFocused: false,
}

function world(on: On, store = new Map<string, unknown>(), session = { id: 's1' }) {
  on('session.id', () => ({ value: session.id }))
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
  on('skill.prompt', ($, e) => ({ text: e.text }))
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['engine'] }))
  return store
}

const ABOVE = { component: 'AbovePrompt', surface: 'terminal', requestId: 'b', props: PROPS } as const

describe('register', () => {
  test('a listed skill shows its badge, an unlisted one does not', async ($, on) => {
    world(on)
    const band = () => $.ui.mount({ plugin: 'badges', surface: 'terminal', component: 'AbovePrompt', props: PROPS })

    await $.skill.prompt({ skill: 'to-prompt', text: '' })
    expect(await (await band()).find({ text: 'DOTCONF' })).toBeUndefined()

    await $.skill.prompt({ skill: 'dotconf', text: '' })
    await $.skill.prompt({ skill: 'system-fix', text: '' })
    await $.skill.prompt({ skill: 'dotconf', text: '' })
    const ui = await band()
    expect(await ui.find({ text: 'DOTCONF' })).toBeDefined()
    expect(await ui.find({ text: 'FIX' })).toBeDefined()
    expect(await ui.find({ text: 'engine' })).toBeDefined()
  })

  test('x clears one badge', async ($, on) => {
    world(on)
    const band = () => $.ui.mount({ plugin: 'badges', surface: 'terminal', component: 'AbovePrompt', props: PROPS })

    await $.skill.prompt({ skill: 'dotconf', text: '' })
    await $.skill.prompt({ skill: 'system-audit', text: '' })
    await (await band()).press({ key: 'clear:dotconf' })
    expect(await (await band()).find({ text: 'DOTCONF' })).toBeUndefined()
    expect(await (await band()).find({ text: 'AUDIT' })).toBeDefined()
  })

  test('badges are saved under the session and restored on start', async ($, on) => {
    const store = world(on)
    await $.session.start(SESSION)
    await $.skill.prompt({ skill: 'dotconf', text: '' })
    expect(store.get('skills:s1')).toEqual({ version: 1, skills: ['dotconf'] })
    expect(store.get('sessions')).toEqual(['s1'])
  })

  test('a restart restores the saved badges', async ($, on) => {
    world(on, new Map<string, unknown>([['sessions', ['s1']], ['skills:s1', { version: 1, skills: ['dotconf'] }]]))
    await $.session.start(SESSION)
    expect(textOf(await $.ui.render(ABOVE))).toContain('DOTCONF')
  })

  test('resume shows the resumed session badges once its id is ready', async ($, on) => {
    const clock = mock.clock(on, { now: 0 })
    const session = { id: 's1' }
    const store = world(on, new Map<string, unknown>([['sessions', ['s2']], ['skills:s2', { version: 1, skills: ['system-audit'] }]]), session)
    await $.session.start(SESSION)
    await $.skill.prompt({ skill: 'dotconf', text: '' })
    await $.session.end({ reason: 'resume', sessionId: 's1', resume: { id: 's2' } })
    expect(textOf(await $.ui.render(ABOVE))).not.toContain('DOTCONF')

    session.id = 's2'
    await clock.advance(200)
    const text = textOf(await $.ui.render(ABOVE))
    expect(text).toContain('AUDIT')
    expect(text).not.toContain('DOTCONF')
    expect(store.get('skills:s1')).toEqual({ version: 1, skills: ['dotconf'] })
  })

  test('clear drops the badges', async ($, on) => {
    const clock = mock.clock(on, { now: 0 })
    const session = { id: 's1' }
    world(on, new Map(), session)
    await $.session.start(SESSION)
    await $.skill.prompt({ skill: 'dotconf', text: '' })
    await $.session.end({ reason: 'clear', sessionId: 's1', resume: { id: 's1' } })
    session.id = 's2'
    await clock.advance(200)
    expect(textOf(await $.ui.render(ABOVE))).not.toContain('DOTCONF')
  })

  test('the oldest sessions are evicted', async ($, on) => {
    const ids = Array.from({ length: 50 }, (_, i) => `old${i}`)
    const store = world(on, new Map<string, unknown>([['sessions', ids], ...ids.map(id => [`skills:${id}`, { version: 1, skills: ['dotconf'] }] as const)]))
    await $.skill.prompt({ skill: 'dotconf', text: '' })
    expect(store.has('skills:old0')).toBe(false)
    expect(store.has('skills:old1')).toBe(true)
    expect(store.get('sessions')).toEqual([...ids.slice(1), 's1'])
  })

  test('stored data is read defensively', () => {
    expect(skillsOf(['dotconf', 'nope', 3])).toEqual(['dotconf'])
    expect(skillsOf('junk')).toEqual([])
    expect(storedSkillsOf({ version: 1, skills: ['dotconf'] })).toEqual(['dotconf'])
    expect(storedSkillsOf({ s1: ['dotconf'] })).toEqual([])
  })
})
