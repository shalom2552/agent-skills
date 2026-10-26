import { atom, read, update } from 'claude-code'
import type { CoreEngineInterface, EngineInterface, Register } from 'claude-code'

import type { TapeCall, TapeStatus, TapeTurn } from '../types'

const PANE = 'tape'
const TITLE = 'Tape'
const MAX_CALLS = 300
const MAX_TURNS = 50
const MAX_SESSIONS = 5
const STORE_VERSION = 1
const SESSIONS_KEY = 'sessions'
const CALLS_PREFIX = 'calls:'
const TURNS_PREFIX = 'turns:'
const SWITCH_POLL_MS = 200
const SWITCH_POLLS = 25
const MAX_TARGET = 1000
const MAX_LABEL = 16
const INDENT = 2
const GLYPH = 2
const MIN_TARGET_WIDTH = 10
const MIN_COLUMNS = 24
const MIN_PROMPT_COLUMNS = 40
const FOCUS_COLOR = 'suggestion'
const TARGET_KEYS = ['command', 'file_path', 'notebook_path', 'pattern', 'url', 'query', 'skill', 'description', 'prompt']

const calls = atom({ plugin: 'tape', key: 'calls' } as const, [])
const turns = atom({ plugin: 'tape', key: 'turns' } as const, [])
const folds = atom({ plugin: 'tape', key: 'folds' } as const, {})
const focused = atom({ plugin: 'tape', key: 'focused' } as const, null)
const open = atom({ plugin: 'tape', key: 'open' } as const, null)

const ICON: Record<TapeStatus, { glyph: string; color: string }> = {
  running: { glyph: '●', color: 'warning' },
  ok: { glyph: '✓', color: 'success' },
  error: { glyph: '✗', color: 'error' },
  denied: { glyph: '⊘', color: 'error' },
}

const TAG = /<\/?[a-z][\w-]*(?:\s[^<>]*)?>/gi

export const labelOf = (text: string) => {
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    const label = /^<\/?[a-z]/i.test(trimmed) ? trimmed.replace(TAG, '').trim() : trimmed
    if (label.length > 0) return label
  }
  return ''
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export const flatten = (text: string, cwd: string) => {
  const here = escapeRegExp(cwd)
  const flat = text
    .split('\n')
    .map(line => line.replace(/\s+/g, ' ').trim())
    .filter(line => line.length > 0)
    .join(' ⏎ ')
    .replace(new RegExp(`^cd (['"]?)${here}/?\\1 *(?:&&|;|⏎) *`), '')
    .replace(new RegExp(`(^|[\\s'"=(:])${here}/`, 'g'), '$1')
  const chars = Array.from(flat)
  return chars.length > MAX_TARGET ? `${chars.slice(0, MAX_TARGET - 1).join('')}…` : flat
}

export const targetOf = (input: Record<string, unknown>, cwd: string) => {
  for (const key of TARGET_KEYS) {
    const value = input[key]
    if (typeof value === 'string' && value.trim().length > 0) return flatten(value, cwd)
  }
  return ''
}

const noop = () => undefined
const width = (text: string) => Array.from(text).length
const padStart = (text: string, room: number) => ' '.repeat(Math.max(0, room - width(text))) + text
const padEnd = (text: string, room: number) => text + ' '.repeat(Math.max(0, room - width(text)))

export const clip = (text: string, room: number) => {
  const chars = Array.from(text)
  if (chars.length <= room) return text
  return room <= 0 ? '' : `${chars.slice(0, room - 1).join('')}…`
}

const labelOfCall = (call: TapeCall) => {
  const name =
    call.tool === 'Bash' ? '$' : call.tool.length > MAX_LABEL ? `${call.tool.slice(0, MAX_LABEL - 1)}…` : call.tool
  return call.isAgent ? `↳${name}` : name
}

export const formatSeconds = (ms: number) => (ms < 10_000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms / 1000)}s`)

const timeOf = (call: TapeCall) =>
  call.endedAt !== undefined ? formatSeconds(call.endedAt - call.startedAt) : call.status === 'running' ? '…' : ''

const turnName = (n: number) => (n === 0 ? 'Before first turn' : `Turn ${n}`)

const shortTool = (tool: string) => (tool.startsWith('mcp__') ? tool.split('__').slice(2).join('__') || tool : tool)

type Engine = Pick<CoreEngineInterface, 'state' | 'store' | 'session' | 'clock'>
type Live = { turn: number; sessionId?: string; queue: Promise<unknown> }

const live: Live = { turn: 0, queue: Promise.resolve() }

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

export const storedListOf = <T,>(raw: unknown, field: string): T[] => {
  if (typeof raw !== 'object' || raw === null || Reflect.get(raw, 'version') !== STORE_VERSION) return []
  const list: unknown = Reflect.get(raw, field)
  return Array.isArray(list) ? list : []
}

async function adopt($: Engine, id: string) {
  live.sessionId = id
  const savedCalls = storedListOf<TapeCall>(await settled($.store.get(CALLS_PREFIX + id)), 'calls').map(call =>
    call.status === 'running' ? { ...call, status: 'error' as const } : call,
  )
  const savedTurns = storedListOf<TapeTurn>(await settled($.store.get(TURNS_PREFIX + id)), 'turns')
  live.turn = savedTurns[savedTurns.length - 1]?.n ?? 0
  await update($, calls, () => savedCalls)
  await update($, turns, () => savedTurns)
  await update($, folds, () => ({}))
  await update($, open, () => null)
}

async function sync($: Engine) {
  const id = await settled($.session.id())
  if (id !== undefined && id !== live.sessionId) await adopt($, id)
}

function enqueue(task: () => Promise<unknown>) {
  live.queue = live.queue.then(task).catch(noop)
  return live.queue
}

function ensure($: Engine) {
  return enqueue(() => sync($))
}

function followSwitch($: Engine, endedId: string) {
  let polls = 0
  const timer = $.clock.every(SWITCH_POLL_MS, () => {
    polls += 1
    void $.session
      .id()
      .then(async id => {
        if (id === endedId && polls < SWITCH_POLLS) return
        timer.cancel()
        if (id !== endedId) await ensure($)
      })
      .catch(noop)
  })
}

function saveCalls($: Engine) {
  return enqueue(async () => {
    if (live.sessionId !== undefined) await persist($, CALLS_PREFIX, live.sessionId, { calls: await read($, calls) })
  })
}

function saveTurns($: Engine) {
  return enqueue(async () => {
    if (live.sessionId !== undefined) await persist($, TURNS_PREFIX, live.sessionId, { turns: await read($, turns) })
  })
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.command.register({
      name: 'tape',
      description: 'Toggle a live pane of tool calls, grouped by turn',
      immediate: true,
    })
    await ensure($)
    return started
  })

  on('command.run', { command: 'tape' }, async $ => {
    const isOpen = (await $.ui.panes()).some(pane => pane.id === PANE)
    if (isOpen) {
      await $.ui.close({ id: PANE })
      return { text: 'Tape closed.' }
    }
    await $.ui.open({ id: PANE, title: TITLE })
    return { text: 'Tape opened.' }
  })

  on('session.end', async ($, e, next) => {
    await saveCalls($)
    await saveTurns($)
    const ended = await next(e)
    if (e.reason === 'clear' || e.reason === 'resume') {
      await ensure($)
      if (live.sessionId === e.sessionId) followSwitch($, e.sessionId)
    }
    return ended
  })

  on('turn.start', async ($, e, next) => {
    await ensure($)
    live.turn += 1
    const entry: TapeTurn = { n: live.turn, prompt: labelOf(e.text) }
    await update($, turns, list => [...list, entry].slice(-MAX_TURNS))
    await saveTurns($)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    await saveCalls($)
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    await ensure($)
    const call: TapeCall = {
      id: e.tool_use_id,
      turn: live.turn,
      tool: shortTool(String(e.tool)),
      target: targetOf(e as unknown as Record<string, unknown>, await $.session.cwd()),
      isAgent: e.agentId !== undefined,
      startedAt: await $.clock.now(),
      status: 'running',
    }
    const before = (await read($, calls)).length
    await update($, calls, list => [...list, call].slice(-MAX_CALLS))
    await saveCalls($)
    if (before === 0 && !(await $.ui.panes()).some(pane => pane.id === PANE)) {
      await $.ui.open({ id: PANE, title: TITLE }).catch(noop)
    }

    let status: TapeStatus = 'error'
    try {
      const ran = await next(e)
      status = ran.deny !== undefined ? 'denied' : ran.isError === true ? 'error' : 'ok'
      return ran
    } finally {
      const endedAt = await $.clock.now()
      await update($, calls, list => list.map(one => (one.id === call.id ? { ...one, status, endedAt } : one)))
      await saveCalls($)
    }
  })

  on('ui.focus', { requestId: PANE }, async ($, e, next) => {
    const moved = await next(e)
    if (moved.deny === undefined) await update($, focused, () => e.element ?? null)
    return moved
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button, Code } = $.ui.resolve(e)
    const list = await read($, calls)
    const known = await read($, turns)
    const folded = await read($, folds)
    const shownId = await read($, open)
    const ring = e.props.isFocused ? await read($, focused) : null
    const columns = Math.max(MIN_COLUMNS, e.props.bodyColumns)

    const ink = (isLit: boolean, color?: string, isDim?: boolean) =>
      isLit ? { color: FOCUS_COLOR } : { color, dimColor: isDim }

    const shown = list.find(call => call.id === shownId)
    if (shown !== undefined) {
      const icon = ICON[shown.status]
      const prompt = known.find(t => t.n === shown.turn)?.prompt ?? ''
      const back = {
        key: 'back',
        hotkey: 'b',
        label: 'back',
        onPress: async () => {
          await update($, open, () => null)
          await $.ui.focus({ requestId: PANE, key: shown.id }).catch(noop)
        },
      }
      return (
        <Box flexDirection="column">
          <Box flexDirection="row" justifyContent="space-between">
            {ring === 'back' ? (
              <Button {...back}>
                <Text color={FOCUS_COLOR}>back</Text>
              </Button>
            ) : (
              <Button {...back} />
            )}
            <Text dimColor>{timeOf(shown)}</Text>
          </Box>
          <Text>
            <Text color={icon.color}>{icon.glyph}</Text>{' '}
            <Text bold>
              {shown.isAgent ? '↳' : ''}
              {shown.tool}
            </Text>
            <Text dimColor> · {turnName(shown.turn)}</Text>
          </Text>
          {prompt.length > 0 && (
            <Text dimColor italic wrap="truncate-end">
              {prompt}
            </Text>
          )}
          {shown.target.length > 0 &&
            (shown.tool === 'Bash' ? (
              <Code key="target" source={shown.target.replaceAll(' ⏎ ', '\n')} language="bash" />
            ) : (
              <Text>{shown.target}</Text>
            ))}
        </Box>
      )
    }

    if (list.length === 0) {
      return (
        <Box flexDirection="column">
          <Text dimColor>No tool calls yet.</Text>
        </Box>
      )
    }

    const order: number[] = []
    const byTurn = new Map<number, TapeCall[]>()
    for (const call of list) {
      const group = byTurn.get(call.turn)
      if (group === undefined) {
        byTurn.set(call.turn, [call])
        order.push(call.turn)
      } else {
        group.push(call)
      }
    }

    const latest = order[order.length - 1]
    const labelWidth = Math.max(...list.map(call => width(labelOfCall(call)))) + 1
    const timeWidth = Math.max(1, ...list.map(call => width(timeOf(call))))
    const room = Math.max(MIN_TARGET_WIDTH, columns - INDENT - GLYPH - labelWidth - 1 - timeWidth)

    const toggle = (n: number, isOpen: boolean) => async () => {
      await update($, folds, now => ({ ...now, [String(n)]: !isOpen }))
      await $.ui.focus({ requestId: PANE, key: `turn:${n}` }).catch(noop)
    }

    const renderCall = (call: TapeCall) => {
      const icon = ICON[call.status]
      const isLit = ring === call.id
      const target = clip(call.target, room)
      return (
        <Box key={`row:${call.id}`} flexDirection="row" paddingLeft={INDENT}>
          <Button
            key={call.id}
            plain
            onPress={async () => {
              await update($, open, () => call.id)
              await $.ui.focus({ requestId: PANE, key: 'back' }).catch(noop)
            }}
          >
            <Text {...ink(isLit, icon.color)}>{icon.glyph} </Text>
            <Text bold={!call.isAgent} {...ink(isLit, undefined, call.isAgent)}>
              {padEnd(labelOfCall(call), labelWidth)}
            </Text>
            <Text {...ink(isLit, undefined, call.isAgent)}>{padEnd(target, room)}</Text>
            <Text mono {...ink(isLit, undefined, true)}>
              {' '}
              {padStart(timeOf(call), timeWidth)}
            </Text>
          </Button>
        </Box>
      )
    }

    return (
      <Box flexDirection="column" width={e.props.bodyColumns}>
        {order.reverse().map(n => {
          const group = byTurn.get(n) ?? []
          const failed = group.filter(call => call.status === 'error' || call.status === 'denied').length
          const isOpen = folded[String(n)] ?? (n === latest || group.some(call => call.status === 'running'))
          const isLit = ring === `turn:${n}`
          const head = turnName(n)
          const note = ` · ${group.length} call${group.length === 1 ? '' : 's'}`
          const fail = failed > 0 ? ` · ✗${failed}` : ''
          const asked = known.find(t => t.n === n)?.prompt ?? ''
          const prompt =
            columns >= MIN_PROMPT_COLUMNS ? clip(asked, columns - GLYPH - width(head) - width(note) - width(fail) - 1) : ''
          return (
            <Box key={`turn-${n}`} flexDirection="column" marginBottom={1}>
              <Box flexDirection="row">
                <Button key={`turn:${n}`} plain onPress={() => void toggle(n, isOpen)()}>
                  <Text {...ink(isLit, undefined, true)}>{isOpen ? '▾ ' : '▸ '}</Text>
                  <Text bold {...ink(isLit, 'claude')}>
                    {head}
                  </Text>
                  <Text {...ink(isLit, undefined, true)}>{note}</Text>
                  <Text {...ink(isLit, 'error')}>{fail}</Text>
                  <Text italic {...ink(isLit, undefined, true)}>
                    {prompt.length > 0 ? ` ${prompt}` : ''}
                  </Text>
                </Button>
              </Box>
              {isOpen && [...group].reverse().map(renderCall)}
            </Box>
          )
        })}
      </Box>
    )
  })
}
