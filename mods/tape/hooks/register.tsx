import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { TapeCall, TapeStatus, TapeTurn } from '../types'

const PANE = 'tape'
const MAX_CALLS = 300
const MAX_TURNS = 50
const TARGET_KEYS = ['command', 'file_path', 'notebook_path', 'pattern', 'url', 'query', 'skill', 'description', 'prompt']

const calls = atom({ plugin: 'tape', key: 'calls' } as const, [])
const turns = atom({ plugin: 'tape', key: 'turns' } as const, [])

const ICON: Record<TapeStatus, { glyph: string; color: string }> = {
  running: { glyph: '●', color: 'warning' },
  ok: { glyph: '✓', color: 'success' },
  error: { glyph: '✗', color: 'error' },
  denied: { glyph: '⊘', color: 'error' },
}

export const firstLine = (text: string) => text.split('\n').find(l => l.trim().length > 0)?.trim() ?? ''

const TAG = /<\/?[a-z][\w-]*(?:\s[^<>]*)?>/gi

export const labelOf = (text: string) => {
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    const label = /^<\/?[a-z]/i.test(trimmed) ? trimmed.replace(TAG, '').trim() : trimmed
    if (label.length > 0) return label
  }
  return ''
}

export const targetOf = (input: Record<string, unknown>, cwd: string) => {
  for (const key of TARGET_KEYS) {
    const value = input[key]
    if (typeof value === 'string' && value.length > 0) {
      const line = firstLine(value)
      return line.startsWith(`${cwd}/`) ? line.slice(cwd.length + 1) : line
    }
  }
  return ''
}

export const formatSeconds = (ms: number) => (ms < 10_000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms / 1000)}s`)

const shortTool = (tool: string) => (tool.startsWith('mcp__') ? tool.split('__').slice(2).join('__') || tool : tool)

export const register: Register = on => {
  let turn = 0

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.command.register({
      name: 'tape',
      description: 'Toggle a live pane of tool calls, grouped by turn',
      immediate: true,
    })
    const known = await read($, turns)
    turn = known[known.length - 1]?.n ?? 0
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
    if (e.reason === 'clear') {
      turn = 0
      await update($, calls, () => [])
      await update($, turns, () => [])
    }
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    turn += 1
    const entry: TapeTurn = { n: turn, prompt: labelOf(e.text) }
    await update($, turns, list => [...list, entry].slice(-MAX_TURNS))
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const call: TapeCall = {
      id: e.tool_use_id,
      turn,
      tool: shortTool(String(e.tool)),
      target: targetOf(e as unknown as Record<string, unknown>, await $.session.cwd()),
      isAgent: e.agentId !== undefined,
      startedAt: await $.clock.now(),
      status: 'running',
    }
    await update($, calls, list => [...list, call].slice(-MAX_CALLS))

    let status: TapeStatus = 'error'
    try {
      const ran = await next(e)
      status = ran.deny !== undefined ? 'denied' : ran.isError === true ? 'error' : 'ok'
      return ran
    } finally {
      const endedAt = await $.clock.now()
      await update($, calls, list => list.map(one => (one.id === call.id ? { ...one, status, endedAt } : one)))
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
    const toolWidth = 10
    const timeWidth = 7

    return (
      <Box flexDirection="column">
        {order.reverse().map(n => {
          const group = byTurn.get(n) ?? []
          const prompt = known.find(t => t.n === n)?.prompt ?? ''
          return (
            <Box key={`turn-${n}`} flexDirection="column" marginBottom={1}>
              <Box flexDirection="row">
                <Text color="claude" bold>
                  {n === 0 ? 'Before first turn' : `Turn ${n}`}
                </Text>
                <Text dimColor> · {group.length} call{group.length === 1 ? '' : 's'}</Text>
                {prompt.length > 0 && width >= 40 && (
                  <Box flexGrow={1} flexShrink={1} marginLeft={1}>
                    <Text dimColor italic wrap="truncate-end">
                      {prompt}
                    </Text>
                  </Box>
                )}
              </Box>
              {[...group].reverse().map(call => {
                const icon = ICON[call.status]
                return (
                  <Box key={call.id} flexDirection="row">
                    <Box width={2} flexShrink={0}>
                      <Text color={icon.color}>{icon.glyph}</Text>
                    </Box>
                    <Box width={toolWidth} flexShrink={0}>
                      <Text bold={!call.isAgent} dimColor={call.isAgent} wrap="truncate-end">
                        {call.isAgent ? `↳${call.tool}` : call.tool}
                      </Text>
                    </Box>
                    <Box flexGrow={1} flexShrink={1}>
                      <Text dimColor={call.status !== 'running'} wrap="truncate-end">
                        {call.target}
                      </Text>
                    </Box>
                    <Box width={timeWidth} flexShrink={0} justifyContent="flex-end">
                      <Text dimColor>{call.endedAt === undefined ? '…' : formatSeconds(call.endedAt - call.startedAt)}</Text>
                    </Box>
                  </Box>
                )
              })}
            </Box>
          )
        })}
      </Box>
    )
  })
}
