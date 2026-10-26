import { atom, read, update } from 'claude-code'
import type { CoreEngineInterface, Register } from 'claude-code'

import type { TapeCall, TapeStatus, TapeTurn } from '../types'

const PANE = 'tape'
const TITLE = 'Tape'
const MAX_CALLS = 300
const MAX_TURNS = 50
const MAX_SESSIONS = 5
const SESSIONS_KEY = 'sessions'
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

type Engine = Pick<CoreEngineInterface, 'state' | 'store' | 'session'>
type Live = { turn: number; sessionId?: string; queue: Promise<void> }

const callsKey = (id: string) => `calls:${id}`
const turnsKey = (id: string) => `turns:${id}`
const listOf = <T,>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : [])

async function adopt($: Engine, live: Live, id: string) {
  live.sessionId = id
  const savedCalls = listOf<TapeCall>(await $.store.get(callsKey(id))).map(call =>
    call.status === 'running' ? { ...call, status: 'error' as const } : call,
  )
  const savedTurns = listOf<TapeTurn>(await $.store.get(turnsKey(id)))
  live.turn = savedTurns[savedTurns.length - 1]?.n ?? 0
  await update($, calls, () => savedCalls)
  await update($, turns, () => savedTurns)
  await update($, folds, () => ({}))
  await update($, open, () => null)

  const ids = [...listOf<string>(await $.store.get(SESSIONS_KEY)).filter(one => one !== id), id]
  for (const stale of ids.slice(0, -MAX_SESSIONS)) {
    await $.store.delete(callsKey(stale))
    await $.store.delete(turnsKey(stale))
  }
  await $.store.set(SESSIONS_KEY, ids.slice(-MAX_SESSIONS))
}

async function sync($: Engine, live: Live) {
  const id = await $.session.id()
  if (id !== live.sessionId) await adopt($, live, id)
}

function ensure($: Engine, live: Live) {
  live.queue = live.queue.then(() => sync($, live)).catch(() => undefined)
  return live.queue
}

async function persist($: Engine, key: string, value: unknown) {
  await $.store.set(key, value).catch(() => undefined)
}

async function saveCalls($: Engine, live: Live, list: TapeCall[]) {
  if (live.sessionId !== undefined) await persist($, callsKey(live.sessionId), list)
}

async function saveTurns($: Engine, live: Live, list: TapeTurn[]) {
  if (live.sessionId !== undefined) await persist($, turnsKey(live.sessionId), list)
}

export const register: Register = on => {
  const live: Live = { turn: 0, queue: Promise.resolve() }

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.command.register({
      name: 'tape',
      description: 'Toggle a live pane of tool calls, grouped by turn',
      immediate: true,
    })
    await ensure($, live)
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
    await saveCalls($, live, await read($, calls))
    await saveTurns($, live, await read($, turns))
    const ended = await next(e)
    if (e.reason === 'clear' || e.reason === 'resume') await ensure($, live)
    return ended
  })

  on('turn.start', async ($, e, next) => {
    await ensure($, live)
    live.turn += 1
    const entry: TapeTurn = { n: live.turn, prompt: labelOf(e.text) }
    await saveTurns($, live, await update($, turns, list => [...list, entry].slice(-MAX_TURNS)))
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    await saveCalls($, live, await read($, calls))
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    await ensure($, live)
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
    await saveCalls($, live, await update($, calls, list => [...list, call].slice(-MAX_CALLS)))
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
      await saveCalls(
        $,
        live,
        await update($, calls, list => list.map(one => (one.id === call.id ? { ...one, status, endedAt } : one))),
      )
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
