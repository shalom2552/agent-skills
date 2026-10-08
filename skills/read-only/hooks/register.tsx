import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Mode } from '../types'

export const TOOL = 'mcp__read-only__mode'

const mode = atom({ plugin: 'read-only', key: 'mode' } as const, 'off' as Mode)

const set = ($: EngineInterface, next: Mode) => update($, mode, () => next)

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.tool.register({
      name: 'mode',
      description:
        'Set the /read-only mode band. "apply" right before making a change the user explicitly approved; "off" when the user leaves read-only.',
      inputSchema: {
        type: 'object',
        properties: { mode: { type: 'string', enum: ['apply', 'off'] } },
        required: ['mode'],
      },
    })

    return next(e)
  })

  on('skill.prompt', { skill: 'read-only' }, async ($, e, next) => {
    await set($, 'read-only')

    return next(e)
  })

  on('tool.call', { tool: TOOL }, async ($, e) => {
    const asked = (e as { mode?: unknown }).mode
    if (asked !== 'apply' && asked !== 'off') return { result: 'mode must be "apply" or "off".' }
    if (asked === 'apply' && (await read($, mode)) === 'off') return { result: 'Read-only is not on.' }
    await set($, asked)

    return { result: asked === 'apply' ? 'APPLY until this turn ends.' : 'Read-only off.' }
  })

  on('tool.call', { tool: ['Edit', 'Write', 'NotebookEdit'] }, async ($, e, next) =>
    (await read($, mode)) === 'read-only'
      ? { deny: `Read-only: edits are blocked. Get the user's explicit approval for this change, then call ${TOOL} with "apply".` }
      : next(e),
  ).catch(($, e, next) => (next.called ? next(e) : { deny: 'Read-only: its edit guard failed.' }))

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined && (await read($, mode)) === 'apply') await set($, 'read-only')

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const current = await read($, mode)
    if (current === 'off' || e.props.hasSurvey) return next(e)

    const { Box, Button, Text } = $.ui.resolve(e)
    const isApply = current === 'apply'

    return (
      <Box gap={1}>
        <Text bold inverse color={isApply ? 'warning' : 'planMode'}>
          {isApply ? ' APPLY ' : ' READ-ONLY '}
        </Text>
        {!e.props.isWorking && !isApply && (
          <Button
            variant="primary"
            key="apply"
            label="Apply"
            onPress={async () => {
              await set($, 'apply')
              void $.prompt.submit({ text: 'Apply that.', asUser: true })
            }}
          />
        )}
        {!e.props.isWorking && (
          <Button
            key="exit"
            label="Exit"
            onPress={async () => {
              await set($, 'off')
              void $.prompt.submit({ text: 'Leave read-only.', asUser: true })
            }}
          />
        )}
      </Box>
    )
  })
}
