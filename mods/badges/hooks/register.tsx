import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Active } from '../types'

export const BADGES: Record<string, string> = {
  dotconf: 'DOTCONF',
  'system-fix': 'FIX',
  'system-audit': 'AUDIT',
}

const SESSIONS = 'sessions'
const MAX_SESSIONS = 20

const active = atom({ plugin: 'badges', key: 'active' } as const, [] as Active)

export const skillsOf = (raw: unknown): Active =>
  Array.isArray(raw) ? raw.filter((s): s is string => typeof s === 'string' && BADGES[s] !== undefined) : []

const savedOf = (raw: unknown): Record<string, unknown> =>
  typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? { ...(raw as Record<string, unknown>) } : {}

const save = async ($: EngineInterface, list: Active) => {
  const id = await $.session.id()
  const saved = savedOf(await $.store.get(SESSIONS))
  delete saved[id]
  const kept = Object.entries(saved).slice(1 - MAX_SESSIONS)
  await $.store.set(SESSIONS, Object.fromEntries(list.length === 0 ? kept : [...kept, [id, list]]))
}

const restore = async ($: EngineInterface) => {
  const list = skillsOf(savedOf(await $.store.get(SESSIONS))[await $.session.id()])
  if (list.length > 0) await update($, active, () => list)
}

const set = async ($: EngineInterface, next: (list: Active) => Active) => {
  await update($, active, next)
  await save($, await read($, active)).catch(() => undefined)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await restore($).catch(() => undefined)

    return next(e)
  })

  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear' || e.reason === 'resume') await update($, active, () => [])

    return next(e)
  })

  on('skill.prompt', { skill: Object.keys(BADGES) }, async ($, e, next) => {
    await set($, list => (list.includes(e.skill) ? list : [...list, e.skill]))

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const list = await read($, active)
    if (list.length === 0 || e.props.hasSurvey) return next(e)

    const { Box, Button, Text } = $.ui.resolve(e)
    const rest = await next(e)

    return (
      <Box flexDirection="column">
        <Box gap={1}>
          {list.flatMap(skill => [
            <Text bold inverse color="permission" key={`badge:${skill}`}>
              {` ${BADGES[skill]} `}
            </Text>,
            ...(e.props.isWorking
              ? []
              : [
                  <Button
                    key={`clear:${skill}`}
                    label="x"
                    onPress={() => set($, l => l.filter(s => s !== skill))}
                  />,
                ]),
          ])}
        </Box>
        {rest}
      </Box>
    )
  })
}
