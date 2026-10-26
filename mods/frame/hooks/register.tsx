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
const COMMAND_TAGS = /<command-(name|message|args)>[\s\S]*?<\/command-\1>/g
const COMMAND_NAME = /<command-name>([\s\S]*?)<\/command-name>/
const COMMAND_ARGS = /<command-args>([\s\S]*?)<\/command-args>/
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

// Undocumented (CC 2.1.296): a slash command's echo row (session.append door 'command') whose text starts
// with <command-...> tags is drawn by the engine, no UserMessage render. Prefixing "/name args" makes it
// a UserMessage row; the tags stay for the model. If commands lose the frame, re-probe those two events.
export const echoOf = (text: string) => {
  const name = COMMAND_NAME.exec(text)?.[1]
  if (name === undefined || !text.trimStart().startsWith('<command-')) return undefined
  const args = COMMAND_ARGS.exec(text)?.[1]?.trim() ?? ''
  return `${args === '' ? name : `${name} ${args}`}\n${text}`
}

export const unwrapCommand = (text: string) => (COMMAND_NAME.test(text) ? text.replace(COMMAND_TAGS, '').trim() : text)

export const displayOf = (text: string) => {
  const shown = unwrapPastes(unwrapCommand(text))
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

const textsOf = (content: readonly { type: string; text?: string }[]) =>
  content.flatMap(b => (b.type === 'text' && b.text !== undefined ? [b.text.trim()] : []))

const lastOf =(all: Stamps) => Object.values(all).reduce((a, s) => Math.max(a, s.n ?? 0), 0)

const newest = (entries: [string, FrameStamp][]) =>
  Object.fromEntries(entries.sort(([, a], [, b]) => a.at - b.at).slice(-MAX_STAMPS))

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

const stampRow = async (
  $: EngineInterface,
  cache: Map<string, Stamps>,
  uuid: string,
  texts: string[],
  isCounted: boolean,
  isNote = false,
) => {
  const at = await $.clock.now()
  const id = await settled($.session.id())
  const prior = id === undefined ? {} : await load($, cache, id)
  const base: FrameStamp = isNote ? { at, texts, note: true } : { at, texts }
  const stamp: FrameStamp = isCounted ? { n: await update($, count, c => Math.max(c, lastOf(prior)) + 1), ...base } : base
  await update($, stamps, all => newest([...Object.entries(all), [uuid, stamp]]))
  if (id !== undefined) {
    const all = newest([...Object.entries(prior), [uuid, stamp]])
    cache.set(id, all)
    await settled(persist($, id, all))
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
    const isComposer = e.origin.kind === 'composer'
    if (kept.deny === undefined && e.agentId === undefined && (isComposer || e.origin.kind === 'plugin')) {
      await stampRow($, stored, kept.uuid, textsOf(kept.message.content), isComposer)
    }
    return kept
  })

  on('session.append', { door: 'command' }, async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)
    const content = e.message.content.map(b => {
      if (b.type !== 'text') return b
      const echo = echoOf(b.text)
      return echo === undefined ? b : { ...b, text: echo }
    })
    if (content.every((b, i) => b === e.message.content[i])) return next(e)
    const kept = await next({ ...e, message: { ...e.message, content } })
    if (kept.deny === undefined) await stampRow($, stored, kept.uuid, textsOf(kept.message.content), false)
    return kept
  })

  on('session.append', { door: 'tool-result' }, async ($, e, next) => {
    const kept = await next(e)
    const texts = textsOf(kept.message.content).filter(t => t !== '')
    if (kept.deny === undefined && e.agentId === undefined && texts.length > 0) await stampRow($, stored, kept.uuid, texts, false, true)
    return kept
  })

  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    const isEcho = COMMAND_NAME.test(e.props.text)
    if (e.props.isExpanded) return isEcho ? next({ ...e, props: { ...e.props, text: unwrapCommand(e.props.text) } }) : next(e)
    const { origin } = e.props
    const isOwn = origin.kind === 'composer' || origin.kind === 'plugin' || isEcho

    const text = e.props.text.trim()
    const match = (all: Stamps) =>
      all[e.requestId] ??
      Object.values(all)
        .filter(s => s.texts.includes(text))
        .sort((a, b) => b.at - a.at)[0]
    let stamp = match(await read($, stamps))
    if (stamp === undefined) {
      const id = await settled($.session.id())
      if (id !== undefined) stamp = match(await load($, stored, id))
    }
    if (!isOwn && stamp?.note !== true) return next(e)

    const { Box, Text } = $.ui.resolve(e)
    const offset = await read($, offsetMs)
    const shown = displayOf(e.props.text)
    const parts = [
      ...(origin.kind === 'plugin' ? [origin.name] : []),
      ...(stamp?.n === undefined ? [] : [`${COUNT_ICON} ${stamp.n}`]),
      ...(stamp === undefined || offset === null ? [] : [`${CLOCK_ICON} ${clockOf(stamp.at, offset)}`]),
    ]
    const title = parts.length === 0 ? undefined : parts.join(' · ')

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
