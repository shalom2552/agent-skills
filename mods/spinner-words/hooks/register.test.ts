import { test, expect } from 'claude-code/testing'
import { WORDS } from './register'

for (const surface of ['terminal', 'desktop'] as const) {
  test(`spinner word comes from the list on ${surface}`, async ($, on) => {
    const seen: string[] = []
    on('ui.render', { component: 'Spinner' }, ($, e) => {
      seen.push(e.props.word)
      return { type: 'engine', ref: 0 }
    })
    for (const word of ['Sauteing', 'Baking']) {
      await $.ui.render({
        surface,
        component: 'Spinner',
        requestId: 'main',
        props: { word, message: null, suffix: '…', mode: 'thinking' },
      })
    }
    expect(seen.length).toBe(2)
    for (const w of seen) expect(WORDS).toContain(w)
  })
}
