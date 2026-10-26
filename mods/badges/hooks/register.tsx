import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Active } from '../types'

export const BADGES: Record<string, string> = {
  dotconf: 'DOTCONF',
  'system-fix': 'FIX',
  'system-audit': 'AUDIT',
}

const SESSIONS_KEY = 'sessions'
const SKILLS_PREFIX = 'skills:'
const MAX_SESSIONS = 50
const STORE_VERSION = 1

const active = atom({ plugin: 'badges', key: 'active' } as const, [] as Active)

export const skillsOf = (raw: unknown): Active =>
  Array.isArray(raw) ? raw.filter((s): s is string => typeof s === 'string' && BADGES[s] !== undefined) : []

export const storedSkillsOf = (raw: unknown): Active =>
  typeof raw === 'object' && raw !== null && Reflect.get(raw, 'version') === STORE_VERSION ? skillsOf(Reflect.get(raw, 'skills')) : []

const settled = <T,>(p: Promise<T>) => p.then(v => v, () => undefined)

export const keptSessionsOf = (raw: unknown, id: string) =>
  [...(Array.isArray(raw) ? raw.filter((s): s is string => typeof s === 'string' && s !== id) : []), id].slice(-MAX_SESSIONS)

const persist = async ($: Pick<EngineInterface, 'store'>, prefix: string, id: string, value: object) => {
  const kept = keptSessionsOf(await $.store.get(SESSIONS_KEY), id)
  for (const key of await $.store.keys()) {
    if (key.startsWith(prefix) && !kept.includes(key.slice(prefix.length))) await $.store.delete(key)
  }
  await $.store.set(SESSIONS_KEY, kept)
  await $.store.set(prefix + id, { version: STORE_VERSION, ...value })
}

let saving: Promise<unknown> = Promise.resolve()

function save($: EngineInterface) {
  saving = saving.then(async () => {
    const id = await settled($.session.id())
    if (id !== undefined) await settled(persist($, SKILLS_PREFIX, id, { skills: await read($, active) }))
  })
  return saving
}

const restore = async ($: EngineInterface) => {
  const id = await settled($.session.id())
  const list = id === undefined ? [] : storedSkillsOf(await settled($.store.get(SKILLS_PREFIX + id)))
  if (list.length > 0) await update($, active, () => list)
}

const set = async ($: EngineInterface, next: (list: Active) => Active) => {
  await update($, active, next)
  await save($)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await settled(restore($))

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
