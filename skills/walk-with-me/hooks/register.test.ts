import { test, expect } from 'claude-code/testing'

import { TOOL } from './register'

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

for (const surface of ['terminal', 'desktop'] as const) {
  test(`band follows intake, mode and buttons on ${surface}`, async ($, on) => {
    const submitted: string[] = []
    on('skill.prompt', ($, e) => ({ text: e.text }))
    on('tool.call', () => ({ result: 'ran' }))
    on('prompt.submit', ($, e) => {
      submitted.push(e.text)
      return { text: e.text }
    })
    on('ui.render', () => ({ type: 'engine', ref: 0 }))

    const band = () =>
      $.ui.mount({ plugin: 'walk-with-me', surface, component: 'AbovePrompt', props: PROPS })

    expect(await (await band()).find({ text: 'WALK' })).toBeUndefined()

    await $.skill.prompt({ skill: 'walk-with-me', text: '' })
    expect(await (await band()).find({ text: 'WALK' })).toBeDefined()
    expect(await (await band()).find({ key: 'check' })).toBeUndefined()

    await $.tool.call({ tool: TOOL, mode: 'coach' })
    expect(await (await band()).find({ text: 'COACH' })).toBeDefined()
    await (await band()).press({ key: 'check' })
    expect(submitted).toEqual(['check'])

    await $.tool.call({ tool: TOOL, mode: 'interview' })
    expect(await (await band()).find({ text: 'INTERVIEW' })).toBeDefined()
    await (await band()).press({ key: 'hint' })
    await (await band()).press({ key: 'pause' })
    expect(submitted).toEqual(['check', 'hint', 'pause'])
    expect(await (await band()).find({ text: 'WALK' })).toBeUndefined()
  })
}

test('mode is saved under the session and restored on start', async ($, on) => {
  const store = new Map<string, unknown>()
  on('session.id', () => ({ value: 's1' }))
  on('store.get', ($, e) => ({ value: store.get(e.key) }))
  on('store.set', ($, e) => {
    store.set(e.key, e.value)
    return { value: undefined }
  })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('tool.register', () => ({ value: undefined }))
  on('session.end', ($, e) => ({ sessionId: e.sessionId }))
  on('skill.prompt', ($, e) => ({ text: e.text }))
  on('tool.call', () => ({ result: 'ran' }))
  on('ui.render', () => ({ type: 'engine', ref: 0 }))

  const band = () =>
    $.ui.mount({ plugin: 'walk-with-me', surface: 'terminal', component: 'AbovePrompt', props: PROPS })

  await $.skill.prompt({ skill: 'walk-with-me', text: '' })
  await $.tool.call({ tool: TOOL, mode: 'coach' })
  expect(store.get('sessions')).toEqual({ s1: 'coach' })

  await $.session.end({ reason: 'resume', sessionId: 's1', resume: { id: 's1' } })
  expect(await (await band()).find({ text: 'WALK' })).toBeUndefined()

  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/repo' })
  expect(await (await band()).find({ text: 'COACH' })).toBeDefined()

  await $.tool.call({ tool: TOOL, mode: 'off' })
  expect(store.get('sessions')).toEqual({})
})
