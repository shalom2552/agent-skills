import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { FrameStamp } from '../types'

const stamps = atom({ plugin: 'frame', key: 'stamps' } as const, {})
const count = atom({ plugin: 'frame', key: 'count' } as const, 0)
const offsetMs = atom({ plugin: 'frame', key: 'offsetMs' } as const, null)

const BORDER = '#89b4fa'
const MAX_STAMPS = 500
const MAX_SESSIONS = 50
const STORE_VERSION = 1
const SESSIONS_KEY = 'sessions'
const STAMPS_PREFIX = 'stamps:'
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

type Stamps = Record<string, FrameStamp>

const settled = <T,>(p: Promise<T>) => p.then(v => v, () => undefined)

export const storedStampsOf = (raw: unknown): Stamps => {
  if (typeof raw !== 'object' || raw === null || Reflect.get(raw, 'version') !== STORE_VERSION) return {}
  const all = Reflect.get(raw, 'stamps')
  return typeof all === 'object' && all !== null ? all : {}
}

export const keptSessionsOf = (raw: unknown, id: string) =>
  [...(Array.isArray(raw) ? raw.filter((s): s is string => typeof s === 'string' && s !== id) : []), id].slice(-MAX_SESSIONS)

const lastOf = (all: Stamps) => Object.values(all).reduce((a, s) => Math.max(a, s.n), 0)

const newest = (entries: [string, FrameStamp][]) =>
  Object.fromEntries(entries.sort(([, a], [, b]) => a.n - b.n).slice(-MAX_STAMPS))

const load = async ($: EngineInterface, cache: Map<string, Stamps>, id: string) => {
  const cached = cache.get(id)
  if (cached !== undefined) return cached
  const all = storedStampsOf(await settled($.store.get(STAMPS_PREFIX + id)))
  cache.set(id, all)
  return all
}

const persist = async ($: EngineInterface, id: string, all: Stamps) => {
  await $.store.set(STAMPS_PREFIX + id, { version: STORE_VERSION, stamps: all })
  const kept = keptSessionsOf(await $.store.get(SESSIONS_KEY), id)
  await $.store.set(SESSIONS_KEY, kept)
  for (const key of await $.store.keys()) {
    if (key.startsWith(STAMPS_PREFIX) && !kept.includes(key.slice(STAMPS_PREFIX.length))) await $.store.delete(key)
  }
}

export const register: Register = on => {
  const stored = new Map<string, Stamps>()

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    const ran = await $.process.run(['date', '+%z']).catch(() => undefined)
    const offset = ran?.exitCode === 0 ? parseOffset(ran.stdout) : null
    await update($, offsetMs, () => offset)
    return started
  })

  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear' || e.reason === 'resume') {
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
      const id = await settled($.session.id())
      const prior = id === undefined ? {} : await load($, stored, id)
      const n = await update($, count, c => Math.max(c, lastOf(prior)) + 1)
      const stamp = { n, at, texts }
      await update($, stamps, all => newest([...Object.entries(all), [kept.uuid, stamp]]))
      if (id !== undefined) {
        const all = newest([...Object.entries(prior), [kept.uuid, stamp]])
        stored.set(id, all)
        await settled(persist($, id, all))
      }
    }
    return kept
  })

  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    if (e.props.isExpanded || e.props.origin.kind !== 'composer') return next(e)

    const { Box, Text } = $.ui.resolve(e)
    const text = e.props.text.trim()
    const match = (all: Stamps) =>
      all[e.requestId] ??
      Object.values(all)
        .filter(s => s.texts.includes(text))
        .sort((a, b) => b.n - a.n)[0]
    let stamp = match(await read($, stamps))
    if (stamp === undefined) {
      const id = await settled($.session.id())
      if (id !== undefined) stamp = match(await load($, stored, id))
    }
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
