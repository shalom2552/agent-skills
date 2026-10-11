import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

const stamps = atom({ plugin: 'frame', key: 'stamps' } as const, {})
const count = atom({ plugin: 'frame', key: 'count' } as const, 0)
const offsetMs = atom({ plugin: 'frame', key: 'offsetMs' } as const, null)

const BORDER = '#89b4fa'
const MAX_STAMPS = 500
const LONG = 10_000
const HEAD = 2_500
const TAIL = 2_500
const PASTE = /\n{0,2}<pasted_content id="([0-9a-f]{4})">\n([\s\S]*?)\n<\/pasted_content id="\1">\n{0,2}/g
const COUNT_ICON = ''
const CLOCK_ICON = '\u{f0150}'

export const parseOffset = (z: string) => {
  const m = /^([+-])(\d{2})(\d{2})$/.exec(z.trim())
  if (m === null) return null
  const sign = m[1] === '-' ? -1 : 1
  return sign * (Number(m[2]) * 60 + Number(m[3])) * 60_000
}

export const clockOf = (at: number, offset: number) => {
  const minutes = Math.floor((((at + offset) % 86_400_000) + 86_400_000) % 86_400_000 / 60_000)
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
}

export const unwrapPastes = (text: string) => {
  let out = ''
  let at = 0
  let afterBlock = false
  const addText = (piece: string, beforeBlock: boolean) => {
    let t = afterBlock ? piece.replace(/^\s+/, '') : piece
    if (beforeBlock) t = t.replace(/\s+$/, '')
    if (t === '') return
    if (afterBlock && out !== '') out += '\n'
    out += t
    afterBlock = false
  }
  for (const m of text.matchAll(PASTE)) {
    const body = m[2] ?? ''
    const isBlock = body.includes('\n')
    addText(text.slice(at, m.index), isBlock)
    if ((isBlock || afterBlock) && out !== '') out += '\n'
    out += body
    afterBlock = isBlock
    at = m.index + m[0].length
  }
  addText(text.slice(at), false)
  return out
}

export const displayOf = (text: string) => {
  const shown = unwrapPastes(text)
  if (shown.length <= LONG) return { head: shown, hiddenLines: 0, tail: '' }
  const head = shown.slice(0, HEAD)
  const tail = shown.slice(-TAIL)
  const hiddenLines = shown.slice(HEAD, -TAIL).split('\n').length - 1
  return { head, hiddenLines, tail }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    const ran = await $.process.run(['date', '+%z']).catch(() => undefined)
    const offset = ran?.exitCode === 0 ? parseOffset(ran.stdout) : null
    await update($, offsetMs, () => offset)
    return started
  })

  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') {
      await update($, stamps, () => ({}))
      await update($, count, () => 0)
    }
    return next(e)
  })

  on('session.append', { door: 'prompt' }, async ($, e, next) => {
    const kept = await next(e)
    if (kept.deny === undefined && e.agentId === undefined && e.origin.kind === 'composer') {
      const at = await $.clock.now()
      const texts = kept.message.content.flatMap(b => (b.type === 'text' ? [b.text.trim()] : []))
      const n = await update($, count, c => c + 1)
      await update($, stamps, all =>
        Object.fromEntries(
          [...Object.entries(all), [kept.uuid, { n, at, texts }] as const]
            .sort(([, a], [, b]) => a.n - b.n)
            .slice(-MAX_STAMPS),
        ),
      )
    }
    return kept
  })

  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    if (e.props.isExpanded || e.props.origin.kind !== 'composer') return next(e)

    const { Box, Text } = $.ui.resolve(e)
    const all = await read($, stamps)
    const text = e.props.text.trim()
    const stamp =
      all[e.requestId] ??
      Object.values(all)
        .filter(s => s.texts.includes(text))
        .sort((a, b) => b.n - a.n)[0]
    const offset = await read($, offsetMs)
    const shown = displayOf(e.props.text)
    const title =
      stamp === undefined
        ? undefined
        : offset === null
          ? `${COUNT_ICON} ${stamp.n}`
          : `${COUNT_ICON} ${stamp.n} · ${CLOCK_ICON} ${clockOf(stamp.at, offset)}`

    return (
      <Box flexDirection="column" marginTop={1}>
        <Box borderStyle="round" borderColor={BORDER} paddingX={1} flexDirection="row">
          <Text color={BORDER}>❯ </Text>
          <Box flexGrow={1} flexShrink={1} flexDirection="column">
            <Text>{shown.head}</Text>
            {shown.tail !== '' && <Text dimColor>… +{shown.hiddenLines} lines</Text>}
            {shown.tail !== '' && <Text>{shown.tail}</Text>}
          </Box>
        </Box>
        {title !== undefined && (
          <Box position="absolute" top={0} left={2}>
            <Text color={BORDER}> {title} </Text>
          </Box>
        )}
      </Box>
    )
  })
}
