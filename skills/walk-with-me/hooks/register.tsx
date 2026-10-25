import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Mode } from '../types'

export const TOOL = 'mcp__walk-with-me__mode'

const SESSIONS = 'sessions'
const MAX_SESSIONS = 20

const mode = atom({ plugin: 'walk-with-me', key: 'mode' } as const, 'off' as Mode)

const savedOf = (raw: unknown): Record<string, unknown> =>
  typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? { ...(raw as Record<string, unknown>) } : {}

const save = async ($: EngineInterface, next: Mode) => {
  const id = await $.session.id()
  const saved = savedOf(await $.store.get(SESSIONS))
  delete saved[id]
  const kept = Object.entries(saved).slice(1 - MAX_SESSIONS)
  await $.store.set(SESSIONS, Object.fromEntries(next === 'off' ? kept : [...kept, [id, next]]))
}

const restore = async ($: EngineInterface) => {
  const saved = savedOf(await $.store.get(SESSIONS))[await $.session.id()]
  if (saved === 'intake' || saved === 'coach' || saved === 'interview') await update($, mode, () => saved)
}

const set = async ($: EngineInterface, next: Mode) => {
  await update($, mode, () => next)
  await save($, next).catch(() => undefined)
}

const COMMANDS: Record<'coach' | 'interview', string[]> = {
  coach: ['check', 'show', 'more', 'pause', 'done'],
  interview: ['run', 'submit', 'hint', 'pause', 'give up'],
}

const ENDS = ['pause', 'done']

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.tool.register({
      name: 'mode',
      description:
        'Set the /walk-with-me band. "coach" or "interview" once intake picks the mode; "off" when the session pauses or its summary is written.',
      inputSchema: {
        type: 'object',
        properties: { mode: { type: 'string', enum: ['coach', 'interview', 'off'] } },
        required: ['mode'],
      },
    })
    await restore($).catch(() => undefined)

    return next(e)
  })

  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear' || e.reason === 'resume') await update($, mode, () => 'off')

    return next(e)
  })

  on('skill.prompt', { skill: 'walk-with-me' }, async ($, e, next) => {
    await set($, 'intake')

    return next(e)
  })

  on('tool.call', { tool: TOOL }, async ($, e) => {
    const asked = (e as { mode?: unknown }).mode
    if (asked !== 'coach' && asked !== 'interview' && asked !== 'off') {
      return { result: 'mode must be "coach", "interview" or "off".' }
    }
    await set($, asked)

    return { result: asked === 'off' ? 'Band off.' : `Band: ${asked}.` }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const current = await read($, mode)
    if (current === 'off' || e.props.hasSurvey) return next(e)

    const { Box, Button, Text } = $.ui.resolve(e)
    const rest = await next(e)

    return (
      <Box flexDirection="column">
        <Box gap={1}>
          <Text bold inverse color="success">
            {current === 'intake' ? ' WALK ' : ` WALK · ${current.toUpperCase()} `}
          </Text>
          {!e.props.isWorking &&
            current !== 'intake' &&
            COMMANDS[current].map((cmd, i) => (
              <Button
                variant={i === 0 ? 'primary' : undefined}
                key={cmd}
                label={cmd[0].toUpperCase() + cmd.slice(1)}
                onPress={async () => {
                  if (ENDS.includes(cmd)) await set($, 'off')
                  void $.prompt.submit({ text: cmd, asUser: true })
                }}
              />
            ))}
        </Box>
        {rest}
      </Box>
    )
  })
}
