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

const TURN = { answer: '', durationMs: 0, isAborted: false, turnId: 't', reason: 'answer' } as const

for (const surface of ['terminal', 'desktop'] as const) {
  test(`band follows read-only, apply and exit on ${surface}`, async ($, on) => {
    const submitted: string[] = []
    on('skill.prompt', ($, e) => ({ text: e.text }))
    on('tool.call', () => ({ result: 'ran' }))
    on('turn.complete', () => ({ text: '' }))
    on('prompt.submit', ($, e) => {
      submitted.push(e.text)
      return { text: e.text }
    })
    on('ui.render', () => ({ type: 'engine', ref: 0 }))

    const band = () =>
      $.ui.mount({ plugin: 'read-only', surface, component: 'AbovePrompt', props: PROPS })
    const edit = () =>
      $.tool.call({ tool: 'Edit', file_path: '/x', old_string: 'a', new_string: 'b' })

    expect(await (await band()).find({ text: 'READ-ONLY' })).toBeUndefined()
    expect((await edit()).deny).toBeUndefined()

    await $.skill.prompt({ skill: 'read-only', text: '' })
    expect(await (await band()).find({ text: 'READ-ONLY' })).toBeDefined()
    expect((await edit()).deny).toContain('Read-only')

    await $.tool.call({ tool: TOOL, mode: 'apply' })
    expect(await (await band()).find({ text: 'APPLY' })).toBeDefined()
    expect((await edit()).deny).toBeUndefined()

    await $.turn.complete(TURN)
    expect((await edit()).deny).toContain('Read-only')

    const ui = await band()
    await ui.press({ key: 'apply' })
    expect(await (await band()).find({ text: 'APPLY' })).toBeDefined()
    expect(submitted).toEqual(['Apply that.'])

    await $.turn.complete(TURN)
    await (await band()).press({ key: 'exit' })
    expect(await (await band()).find({ text: 'READ-ONLY' })).toBeUndefined()
    expect((await edit()).deny).toBeUndefined()
    expect(submitted).toEqual(['Apply that.', 'Leave read-only.'])
  })
}

test('read-only is saved under the session and restored on start', async ($, on) => {
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
    $.ui.mount({ plugin: 'read-only', surface: 'terminal', component: 'AbovePrompt', props: PROPS })

  await $.skill.prompt({ skill: 'read-only', text: '' })
  await $.tool.call({ tool: TOOL, mode: 'apply' })
  expect(store.get('sessions')).toEqual({ s1: 'read-only' })

  await $.session.end({ reason: 'resume', sessionId: 's1', resume: { id: 's1' } })
  expect(await (await band()).find({ text: 'READ-ONLY' })).toBeUndefined()

  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/repo' })
  expect(await (await band()).find({ text: 'READ-ONLY' })).toBeDefined()

  await $.tool.call({ tool: TOOL, mode: 'off' })
  expect(store.get('sessions')).toEqual({})
})
