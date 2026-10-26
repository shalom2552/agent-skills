import type { Register } from 'claude-code'

import { registerCore, startCore } from './core'
import { registerPane, startPane } from './pane'

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await startPane($).catch(() => undefined)
    await startCore($)
    return started
  })
  registerPane(on)
  registerCore(on)
}
