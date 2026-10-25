import { atom, read, update } from 'claude-code'
import type { CoreEngineInterface, Register } from 'claude-code'

import type { TapeCall, TapeStatus, TapeTurn } from '../types'

const PANE = 'tape'
const MAX_CALLS = 300
const MAX_TURNS = 50
const MAX_SESSIONS = 5
const SESSIONS_KEY = 'sessions'
const MAX_TARGET = 1000
const SHOWN_LINES = 3
const MAX_LABEL = 16
const ICON_WIDTH = 2
const TIME_WIDTH = 7
const MIN_TARGET_WIDTH = 10
const TARGET_KEYS = ['command', 'file_path', 'notebook_path', 'pattern', 'url', 'query', 'skill', 'description', 'prompt']

const calls = atom({ plugin: 'tape', key: 'calls' } as const, [])
const turns = atom({ plugin: 'tape', key: 'turns' } as const, [])

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

export const wrapText = (text: string, width: number) => {
  const chars = Array.from(text)
  const room = Math.max(1, width)
  const lines: string[] = []
  let start = 0
  while (chars.length - start > room) {
    const space = chars.lastIndexOf(' ', start + room)
    const end = space > start ? space : start + room
    lines.push(chars.slice(start, end).join(''))
    start = space > start ? end + 1 : end
  }
  if (start < chars.length) lines.push(chars.slice(start).join(''))
  return lines
}

const labelOfCall = (call: TapeCall) => {
  const name =
    call.tool === 'Bash' ? '$' : call.tool.length > MAX_LABEL ? `${call.tool.slice(0, MAX_LABEL - 1)}…` : call.tool
  return call.isAgent ? `↳${name}` : name
}

export const formatSeconds = (ms: number) => (ms < 10_000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms / 1000)}s`)

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
    await $.ui.open({ id: PANE, title: 'Tape' })
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
    await saveCalls($, live, await update($, calls, list => [...list, call].slice(-MAX_CALLS)))

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

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const list = await read($, calls)
    const known = await read($, turns)

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

    const width = e.props.bodyColumns
    const latest = order[order.length - 1]

    const renderCall = (call: TapeCall) => {
      const icon = ICON[call.status]
      const label = labelOfCall(call)
      const labelWidth = label.length + 1
      const room = Math.max(MIN_TARGET_WIDTH, width - ICON_WIDTH - labelWidth - TIME_WIDTH)
      const lines = wrapText(call.target, room)
      const shown = lines.slice(0, SHOWN_LINES)
      const hidden = lines.slice(SHOWN_LINES)
      const line = (text: string, i: number) => (
        <Text key={`${call.id}-${i}`} dimColor={call.isAgent} wrap="truncate-end">
          {text}
        </Text>
      )
      return (
        <Box key={call.id} flexDirection="row">
          <Box width={ICON_WIDTH} flexShrink={0}>
            <Text color={icon.color}>{icon.glyph}</Text>
          </Box>
          <Box width={labelWidth} flexShrink={0}>
            <Text bold={!call.isAgent} dimColor={call.isAgent}>
              {label}
            </Text>
          </Box>
          <Box flexDirection="column" flexGrow={1} flexShrink={1}>
            {shown.map(line)}
            {hidden.length > 0 && (
              <Box display="none" hover={{ display: 'flex' }} flexDirection="column">
                {hidden.map((text, i) => line(text, SHOWN_LINES + i))}
              </Box>
            )}
          </Box>
          <Box width={TIME_WIDTH} flexShrink={0} flexDirection="column" alignItems="flex-end">
            <Text dimColor>
              {call.endedAt !== undefined
                ? formatSeconds(call.endedAt - call.startedAt)
                : call.status === 'running'
                  ? '…'
                  : ''}
            </Text>
            {hidden.length > 0 && <Text dimColor>{`+${hidden.length}`}</Text>}
          </Box>
        </Box>
      )
    }

    return (
      <Box flexDirection="column">
        {order.reverse().map(n => {
          const group = byTurn.get(n) ?? []
          const prompt = known.find(t => t.n === n)?.prompt ?? ''
          const failed = group.filter(call => call.status === 'error' || call.status === 'denied').length
          const isOpen = n === latest || group.some(call => call.status === 'running')
          const rows = [...group].reverse().map(renderCall)
          return (
            <Box key={`turn-${n}`} flexDirection="column" marginBottom={1}>
              <Box flexDirection="row">
                <Text color="claude" bold>
                  {n === 0 ? 'Before first turn' : `Turn ${n}`}
                </Text>
                <Text dimColor> · {group.length} call{group.length === 1 ? '' : 's'}</Text>
                {failed > 0 && <Text color="error"> · ✗{failed}</Text>}
                {prompt.length > 0 && width >= 40 && (
                  <Box flexGrow={1} flexShrink={1} marginLeft={1}>
                    <Text dimColor italic wrap="truncate-end">
                      {prompt}
                    </Text>
                  </Box>
                )}
              </Box>
              {isOpen ? (
                rows
              ) : (
                <Box display="none" hover={{ display: 'flex' }} flexDirection="column">
                  {rows}
                </Box>
              )}
            </Box>
          )
        })}
      </Box>
    )
  })
}
