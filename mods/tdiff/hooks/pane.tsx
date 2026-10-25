import { atom, read, update } from 'claude-code'
import type { CoreEngineInterface, On } from 'claude-code'

import type { TdiffKind, TdiffNoText, TdiffShellReason } from '../types'
import { closeFile, openFile } from './core'
import { displayPath } from './paths'
import { buildTree, COLLAPSE_OVER, visibleLines } from './tree'
import type { Line } from './tree'

const PANE = 'tdiff'
const TITLE = 'Tdiff'
const ELSEWHERE = 'Elsewhere'

const rows = atom({ plugin: 'tdiff', key: 'rows' } as const, [], { shape: 'rows-1' })
const open = atom({ plugin: 'tdiff', key: 'open' } as const, null, { shape: 'open-1' })
const shell = atom(
  { plugin: 'tdiff', key: 'shell' } as const,
  { status: 'starting', reason: null },
  { shape: 'shell-1' },
)
const where = atom({ plugin: 'tdiff', key: 'where' } as const, { root: '/', home: '' }, { shape: 'where-1' })
const folds = atom({ plugin: 'tdiff', key: 'folds' } as const, {}, { shape: 'folds-1' })

const LETTER: Record<TdiffKind, { letter: string; color: string }> = {
  added: { letter: 'A', color: 'success' },
  modified: { letter: 'M', color: 'warning' },
  deleted: { letter: 'D', color: 'error' },
}

const NO_TEXT: Record<TdiffNoText | 'unchanged', string> = {
  binary: 'Binary file: no text diff.',
  'too-large': 'Too large to read: no text diff.',
  unchanged: 'No net change left in this file.',
}

const SHELL_REASON: Record<TdiffShellReason, string> = {
  'root-is-home': 'the root is the home folder',
  'root-is-fs-root': 'the root is /',
  'no-git': 'git is not available',
  'too-slow': 'snapshots took too long',
  failed: 'snapshots failed',
}

const OUTSIDE_COLOR = 'suggestion'
const ROOT_COLOR = 'claude'
const EDITED = 'edited since'
const NO_DIFF = 'no text diff'
const INDENT = 2
const GLYPH = 2
const LETTER_SLOT = 2
const MIN_COLUMNS = 24
const MAX_ROWS = 250
const CHAR_BUDGET = 60_000
const ROW_COST = 200

const noop = () => undefined
const width = (text: string) => Array.from(text).length
const padStart = (text: string, room: number) => ' '.repeat(Math.max(0, room - width(text))) + text
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

function middle(text: string, room: number) {
  const chars = Array.from(text)
  if (chars.length <= room) return text
  if (room <= 1) return '…'
  const head = Math.ceil((room - 1) / 2)
  return `${chars.slice(0, head).join('')}…${chars.slice(chars.length - (room - 1 - head)).join('')}`
}

export function startPane($: CoreEngineInterface) {
  return $.command.register({
    name: 'tdiff',
    description: 'Toggle a pane of the files Claude changed this session',
    immediate: true,
  })
}

export function registerPane(on: On) {
  on('command.run', { command: 'tdiff' }, async $ => {
    const isOpen = (await $.ui.panes()).some(pane => pane.id === PANE)
    if (isOpen) {
      await $.ui.close({ id: PANE })
      return { text: 'Tdiff closed.' }
    }
    const opened = await $.ui.open({ id: PANE, title: TITLE })
    return { text: opened.isPlaced ? 'Tdiff opened.' : `Tdiff is waiting: ${opened.reason}` }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button, Code } = $.ui.resolve(e)
    const list = await read($, rows)
    const shown = await read($, open)
    const place = await read($, where)
    const tracking = await read($, shell)
    const folded = await read($, folds)

    const tone = (text: string, n: number, color: string, isDim = false) => (
      <Text color={isDim || n === 0 ? undefined : color} dimColor={isDim || n === 0}>
        {text}
      </Text>
    )

    const counts = (adds: number, dels: number) => (
      <Text>
        {tone(`+${adds}`, adds, 'success')} {tone(`-${dels}`, dels, 'error')}
      </Text>
    )

    if (shown !== null) {
      const row = list.find(one => one.path === shown.path)
      const { isUnderRoot, label } = displayPath(shown.path, place)
      const adds = shown.diff?.adds ?? row?.adds ?? 0
      const dels = shown.diff?.dels ?? row?.dels ?? 0
      return (
        <Box flexDirection="column">
          <Box flexDirection="row" justifyContent="space-between">
            <Button
              key="back"
              hotkey="b"
              label="back"
              onPress={async () => {
                await closeFile($)
                await $.ui.focus({ requestId: PANE, key: shown.path }).catch(noop)
              }}
            />
            {counts(adds, dels)}
          </Box>
          <Text bold color={isUnderRoot ? undefined : OUTSIDE_COLOR} wrap="truncate-start">
            {row === undefined ? '' : `${LETTER[row.kind].letter} `}
            {label}
          </Text>
          {row?.isEditedSince === true && <Text color="warning">Edited since Claude's last change.</Text>}
          {shown.note !== null && <Text dimColor>{NO_TEXT[shown.note]}</Text>}
          {shown.note === null && shown.diff === null && <Text dimColor>Loading diff…</Text>}
          {shown.diff !== null && <Code key="diff" source={shown.diff.text} format="diff" path={shown.path} />}
          {shown.diff?.truncated === true && <Text dimColor>Diff cut short: too long to draw whole.</Text>}
        </Box>
      )
    }

    const footer =
      tracking.status === 'limited' ? (
        <Box marginTop={1}>
          <Text dimColor>Shell tracking limited: {SHELL_REASON[tracking.reason]}.</Text>
        </Box>
      ) : null

    if (list.length === 0) {
      return (
        <Box flexDirection="column">
          <Text dimColor>No changes yet.</Text>
          {footer}
        </Box>
      )
    }

    const labelled = list.map(row => ({ row, ...displayPath(row.path, place) }))
    const sections = [
      {
        key: 'root',
        heading: displayPath(place.root, place).label,
        headingColor: ROOT_COLOR,
        topColor: undefined,
        lines: visibleLines(buildTree(labelled.filter(one => one.isUnderRoot), 'root:'), folded),
      },
      {
        key: 'elsewhere',
        heading: ELSEWHERE,
        headingColor: OUTSIDE_COLOR,
        topColor: ROOT_COLOR,
        lines: visibleLines(buildTree(labelled.filter(one => !one.isUnderRoot), 'elsewhere:'), folded),
      },
    ].filter(section => section.lines.length > 0)

    let budget = { rows: MAX_ROWS, chars: CHAR_BUDGET }
    let hidden = 0
    const drawn = sections.map(section => {
      const lines = section.lines.filter(line => {
        const cost = ROW_COST + 2 * width(line.node.kind === 'dir' ? line.node.key : line.node.row.path)
        if (budget.rows <= 0 || budget.chars < cost) {
          hidden += 1
          return false
        }
        budget = { rows: budget.rows - 1, chars: budget.chars - cost }
        return true
      })
      return { ...section, lines }
    })

    const adds = list.reduce((sum, row) => sum + row.adds, 0)
    const dels = list.reduce((sum, row) => sum + row.dels, 0)
    const totals = drawn
      .flatMap(section => section.lines)
      .flatMap(({ node }): { adds: number; dels: number }[] =>
        node.kind === 'dir' ? [node] : node.row.noText === null ? [node.row] : [],
      )
    const addWidth = Math.max(width(`+${adds}`), ...totals.map(one => width(`+${one.adds}`)))
    const delWidth = Math.max(width(`-${dels}`), ...totals.map(one => width(`-${one.dels}`)))
    const countWidth = addWidth + 1 + delWidth

    const counted = (adds: number, dels: number, isDim: boolean) => (
      <Box flexShrink={0}>
        <Text mono>
          {' '}
          {tone(padStart(`+${adds}`, addWidth), adds, 'success', isDim)}{' '}
          {tone(padStart(`-${dels}`, delWidth), dels, 'error', isDim)}
        </Text>
      </Box>
    )
    const columns = Math.max(MIN_COLUMNS, e.props.bodyColumns)
    const countsRoom = 1 + countWidth

    const toggle = (key: string, count: number) => async () => {
      await update($, folds, now => ({ ...now, [key]: !(now[key] ?? count > COLLAPSE_OVER) }))
      await $.ui.focus({ requestId: PANE, key: `dir:${key}` }).catch(noop)
    }

    const TreeRow = ({ line, topColor }: { line: Line; topColor: string | undefined }) => {
      const indent = line.depth * INDENT
      if (line.node.kind === 'dir') {
        const dir = line.node
        const isCollapsed = 'isCollapsed' in line && line.isCollapsed
        const note = isCollapsed ? ` ${plural(dir.count, 'file')}` : ''
        const name = middle(dir.name, columns - indent - GLYPH - width(note) - countsRoom)
        return (
          <Box key={`row:${dir.key}`} flexDirection="row" paddingLeft={indent}>
            <Box flexShrink={0}>
              <Text dimColor>{isCollapsed ? '▸ ' : '▾ '}</Text>
            </Box>
            <Box flexGrow={1} flexShrink={1} minWidth={0}>
              <Button key={`dir:${dir.key}`} plain onPress={() => void toggle(dir.key, dir.count)()}>
                <Text color={line.depth === 0 ? topColor : undefined} wrap="truncate-middle">
                  {name}
                </Text>
              </Button>
            </Box>
            {isCollapsed && (
              <Box flexShrink={0}>
                <Text dimColor>{note}</Text>
              </Box>
            )}
            {counted(dir.adds, dir.dels, true)}
          </Box>
        )
      }
      const { row } = line.node
      const kind = LETTER[row.kind]
      const right = (row.isEditedSince ? 1 + width(EDITED) : 0) + (row.noText === null ? countsRoom : 1 + Math.max(countWidth, width(NO_DIFF)))
      const name = middle(line.node.name, columns - indent - GLYPH - LETTER_SLOT - right)
      return (
        <Box key={`row:${row.path}`} flexDirection="row" paddingLeft={indent}>
          <Box flexShrink={0}>
            <Text>
              {'  '}
              <Text color={kind.color}>{kind.letter}</Text>{' '}
            </Text>
          </Box>
          <Box flexGrow={1} flexShrink={1} minWidth={0}>
            <Button
              key={row.path}
              plain
              onPress={async () => {
                await openFile($, row.path)
                await $.ui.focus({ requestId: PANE, key: 'back' }).catch(noop)
              }}
            >
              <Text bold wrap="truncate-middle">
                {name}
              </Text>
            </Button>
          </Box>
          {row.isEditedSince && (
            <Box flexShrink={0}>
              <Text color="warning"> {EDITED}</Text>
            </Box>
          )}
          {row.noText === null ? (
            counted(row.adds, row.dels, false)
          ) : (
            <Box flexShrink={0}>
              <Text mono dimColor>
                {' '}
                {padStart(NO_DIFF, countWidth)}
              </Text>
            </Box>
          )}
        </Box>
      )
    }

    return (
      <Box flexDirection="column" width={e.props.bodyColumns}>
        <Box flexDirection="row">
          <Box flexGrow={1} flexShrink={1} minWidth={0}>
            <Text bold>{plural(list.length, 'file')}</Text>
          </Box>
          <Box flexShrink={0}>
            <Text mono>
              {' '}
              {tone(padStart(`+${adds}`, addWidth), adds, 'success')} {tone(padStart(`-${dels}`, delWidth), dels, 'error')}
            </Text>
          </Box>
        </Box>
        {drawn.map(section => (
          <Box key={section.key} flexDirection="column" marginTop={1}>
            <Text bold color={section.headingColor} wrap="truncate-start">
              {section.heading}
            </Text>
            {section.lines.map(line => TreeRow({ line, topColor: section.topColor }))}
          </Box>
        ))}
        {hidden > 0 && (
          <Box marginTop={1}>
            <Text dimColor>{plural(hidden, 'more row')}, collapse some folders.</Text>
          </Box>
        )}
        {footer}
      </Box>
    )
  })
}
