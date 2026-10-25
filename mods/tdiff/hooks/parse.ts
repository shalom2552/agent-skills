import { resolve } from './paths'

type Part = string | { ref: string }
type Raw = { kind: 'word'; parts: Part[]; isDynamic: boolean }
type Token = Raw | { kind: 'sep' } | { kind: 'redirect'; isWrite: boolean; toFd: boolean }
type Word = { text: string; isDynamic: boolean }
type Vars = Map<string, string | null>

const MAX_PATHS = 50
const PREFIXES = new Set(['sudo', 'env', 'nohup', 'time', 'command', 'exec', 'nice', 'builtin'])
const KEYWORDS = new Set(['do', 'then', 'else', 'elif', 'if', 'while', 'until', '{', '!'])
const DECLARERS = new Set(['export', 'declare', 'local', 'readonly', 'typeset'])
const BINDERS = new Set(['for', 'select', 'read', 'unset'])
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/
const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/
const NAME_START = /^[A-Za-z_][A-Za-z0-9_]*/
const BRACED = /^\{([A-Za-z_][A-Za-z0-9_]*)\}/

const literal = (raw: Raw | null | undefined) =>
  raw === null || raw === undefined || raw.isDynamic || raw.parts.some(part => typeof part !== 'string')
    ? null
    : (raw.parts as string[]).join('')

function tokenize(command: string, home: string): Token[] {
  const tokens: Token[] = []
  let word: Raw | null = null
  let quote: '' | "'" | '"' = ''
  let heredocs: string[] = []
  let i = 0

  const start = () => (word ??= { kind: 'word', parts: [], isDynamic: false })
  const add = (text: string) => {
    const parts = start().parts
    const last = parts[parts.length - 1]
    if (typeof last === 'string') parts[parts.length - 1] = last + text
    else parts.push(text)
  }
  const end = () => {
    if (word !== null) tokens.push(word)
    word = null
  }
  const dollar = () => {
    const rest = command.slice(i + 1)
    const name = BRACED.exec(rest)?.[1] ?? NAME_START.exec(rest)?.[0]
    if (name === undefined) {
      start().isDynamic = true
      add('$')
      i++
      return
    }
    start().parts.push({ ref: name })
    i += 1 + (rest.startsWith('{') ? name.length + 2 : name.length)
  }
  const skipHeredocs = () => {
    for (const delimiter of heredocs) {
      while (i < command.length) {
        const nl = command.indexOf('\n', i)
        const line = command.slice(i, nl < 0 ? command.length : nl)
        i = nl < 0 ? command.length : nl + 1
        if (line.trim() === delimiter) break
      }
    }
    heredocs = []
  }

  while (i < command.length) {
    const c = command[i] as string
    if (quote === "'") {
      if (c === "'") quote = ''
      else add(c)
      i++
      continue
    }
    if (quote === '"') {
      if (c === '"') quote = ''
      else if (c === '\\' && i + 1 < command.length) add(command[++i] as string)
      else if (c === '$') {
        dollar()
        continue
      } else {
        if (c === '`') start().isDynamic = true
        add(c)
      }
      i++
      continue
    }
    if (c === "'" || c === '"') {
      quote = c
      start()
      i++
      continue
    }
    if (c === '\\') {
      if (command[i + 1] !== '\n') add(command[i + 1] ?? '')
      i += 2
      continue
    }
    if (c === '\n') {
      end()
      tokens.push({ kind: 'sep' })
      i++
      skipHeredocs()
      continue
    }
    if (c === ' ' || c === '\t') {
      end()
      i++
      continue
    }
    if (c === '#' && word === null) {
      while (i < command.length && command[i] !== '\n') i++
      continue
    }
    if (c === ';' || c === '|' || c === '&' || c === '(' || c === ')') {
      if (c === '&' && command[i + 1] === '>') {
        end()
        i += command[i + 2] === '>' ? 3 : 2
        tokens.push({ kind: 'redirect', isWrite: true, toFd: false })
        continue
      }
      end()
      tokens.push({ kind: 'sep' })
      i += (c === '|' || c === '&') && command[i + 1] === c ? 2 : 1
      continue
    }
    if (c === '>' || c === '<') {
      const fd = /^\d+$/.test(literal(word as Raw | null) ?? '')
      if (fd) word = null
      else end()
      if (c === '<' && command[i + 1] === '<') {
        i += command[i + 2] === '-' ? 3 : 2
        if (command[i] === '<') {
          i++
          tokens.push({ kind: 'redirect', isWrite: false, toFd: false })
          continue
        }
        while (command[i] === ' ' || command[i] === '\t') i++
        let delimiter = ''
        while (i < command.length && !/[\s;|&<>()]/.test(command[i] as string)) {
          const ch = command[i] as string
          if (ch !== "'" && ch !== '"' && ch !== '\\') delimiter += ch
          i++
        }
        if (delimiter !== '') heredocs.push(delimiter)
        continue
      }
      i += c === '>' && (command[i + 1] === '>' || command[i + 1] === '|') ? 2 : 1
      const toFd = command[i] === '&'
      if (toFd) i++
      tokens.push({ kind: 'redirect', isWrite: c === '>', toFd })
      continue
    }
    if (c === '$') {
      dollar()
      continue
    }
    if (c === '`' || c === '*' || c === '?' || c === '[') start().isDynamic = true
    const isWordStart = word === null || /^[A-Za-z_][A-Za-z0-9_]*=$/.test(literal(word as Raw | null) ?? '')
    if (c === '~' && isWordStart && /^~(?=[/\s;|&<>)]|$)/.test(command.slice(i))) {
      if (home === '') start().isDynamic = true
      add(home === '' ? '~' : home)
      i++
      continue
    }
    add(c)
    i++
  }
  end()
  return tokens
}

function evaluate(raw: Raw, vars: Vars): Word {
  if (raw.isDynamic) return { text: '', isDynamic: true }
  let text = ''
  for (const part of raw.parts) {
    if (typeof part === 'string') {
      text += part
      continue
    }
    const value = vars.get(part.ref)
    if (value === undefined || value === null) return { text: '', isDynamic: true }
    text += value
  }
  return { text, isDynamic: false }
}

function assignmentOf(raw: Raw, vars: Vars) {
  const first = raw.parts[0]
  if (typeof first !== 'string') return undefined
  const name = ASSIGNMENT.exec(first)?.[0].slice(0, -1)
  if (name === undefined) return undefined
  const rest: Raw = { ...raw, parts: [first.slice(name.length + 1), ...raw.parts.slice(1)] }
  const value = evaluate(rest, vars)
  return { name, value: value.isDynamic ? null : value.text }
}

function operands(args: Word[], withValue: Set<string>) {
  const out: Word[] = []
  let isOptionsDone = false
  for (let j = 0; j < args.length; j++) {
    const arg = args[j] as Word
    if (!isOptionsDone && arg.text === '--') {
      isOptionsDone = true
      continue
    }
    if (!isOptionsDone && arg.text.startsWith('-') && arg.text.length > 1) {
      if (withValue.has(arg.text)) j++
      continue
    }
    out.push(arg)
  }
  return out
}

function inPlaceTargets(args: Word[], isSed: boolean) {
  let isInPlace = false
  let hasScriptOption = false
  const files: Word[] = []
  for (let j = 0; j < args.length; j++) {
    const arg = args[j] as Word
    const text = arg.text
    if (text === '--in-place' || text.startsWith('--in-place=')) {
      isInPlace = true
      continue
    }
    if (text === '-e' || text === '-f' || text === '--expression' || text === '--file') {
      hasScriptOption = true
      j++
      continue
    }
    if (text.startsWith('--expression=') || text.startsWith('--file=')) {
      hasScriptOption = true
      continue
    }
    if (/^-[A-Za-z]+/.test(text)) {
      const flags = /^-([A-Za-z]+)/.exec(text)?.[1] ?? ''
      if (flags.includes('i')) {
        isInPlace = true
        if (isSed && text === '-i' && args[j + 1]?.text === '') j++
      }
      if (flags.endsWith('e') && !flags.includes('i')) {
        hasScriptOption = true
        j++
      }
      continue
    }
    files.push(arg)
  }
  if (!isInPlace) return []
  return hasScriptOption ? files : files.slice(1)
}

function targetsOf(words: Word[]): Word[] {
  let at = 0
  while (at < words.length) {
    const text = (words[at] as Word).text
    if (ASSIGNMENT.test(text) || PREFIXES.has(text)) at++
    else break
  }
  const name = words[at]?.text.split('/').pop() ?? ''
  const args = words.slice(at + 1)

  switch (name) {
    case 'tee':
      return operands(args, new Set())
    case 'sed':
      return inPlaceTargets(args, true)
    case 'perl':
      return inPlaceTargets(args, false)
    case 'cp':
    case 'install':
    case 'ln': {
      const list = operands(args, new Set(['-t', '-S', '-m', '-o', '-g', '--target-directory', '--suffix']))
      return list.length >= 2 ? [list[list.length - 1] as Word] : []
    }
    case 'mv': {
      const list = operands(args, new Set(['-t', '-S', '--target-directory', '--suffix']))
      return list.length >= 2 ? list : []
    }
    case 'rm':
    case 'unlink':
    case 'shred':
      return operands(args, new Set(['-n', '-s', '--iterations', '--size']))
    case 'touch':
      return operands(args, new Set(['-d', '-t', '-r', '--date', '--reference']))
    case 'truncate':
      return operands(args, new Set(['-s', '-r', '--size', '--reference']))
    case 'dd':
      return args
        .filter(arg => arg.text.startsWith('of='))
        .map(arg => ({ ...arg, text: arg.text.slice(3) }))
    case 'curl':
    case 'wget': {
      const flag = name === 'curl' ? ['-o', '--output'] : ['-O', '--output-document']
      const out: Word[] = []
      args.forEach((arg, j) => {
        const next = args[j + 1]
        if (flag.includes(arg.text) && next !== undefined) out.push(next)
      })
      return out
    }
    default:
      return []
  }
}

export function commandPaths(command: string, where: { cwd: string; home: string }) {
  const found: { word: Word; cwd: string | null }[] = []
  const vars: Vars = new Map(where.home === '' ? [] : [['HOME', where.home]])
  let cwd: string | null = where.cwd
  let raws: Raw[] = []
  let pendingRedirect: { isWrite: boolean } | null = null

  const bind = (list: readonly Raw[]) => {
    for (const raw of list) {
      const assigned = assignmentOf(raw, vars)
      if (assigned !== undefined) vars.set(assigned.name, assigned.value)
      else if (NAME.test(literal(raw) ?? '')) vars.set(literal(raw) as string, null)
    }
  }
  const flush = () => {
    let at = 0
    while (at < raws.length && KEYWORDS.has(literal(raws[at]) ?? '')) at++
    const body = raws.slice(at)
    raws = []
    if (body.length === 0) return
    const head = literal(body[0])
    if (head !== null && BINDERS.has(head)) return bind(head === 'for' || head === 'select' ? body.slice(1, 2) : body.slice(1))
    if (head !== null && DECLARERS.has(head)) return bind(body.slice(1).filter(raw => assignmentOf(raw, vars) !== undefined))
    if (body.every(raw => assignmentOf(raw, vars) !== undefined)) return bind(body)

    let lead = 0
    while (lead < body.length && assignmentOf(body[lead] as Raw, vars) !== undefined) lead++
    const words = body.slice(lead).map(raw => evaluate(raw, vars))
    if (words[0]?.text === 'cd' && !words[0].isDynamic) {
      const target = words.slice(1).find(word => word.text !== '--')
      if (target === undefined) cwd = where.home === '' ? null : where.home
      else if (target.isDynamic || target.text === '-' || cwd === null) cwd = null
      else cwd = resolve(cwd, target.text)
      return
    }
    found.push(...targetsOf(words).map(word => ({ word, cwd })))
  }

  for (const token of tokenize(command, where.home)) {
    if (token.kind === 'redirect') {
      pendingRedirect = { isWrite: token.isWrite && !token.toFd }
      continue
    }
    if (token.kind === 'sep') {
      pendingRedirect = null
      flush()
      continue
    }
    if (pendingRedirect !== null) {
      if (pendingRedirect.isWrite) found.push({ word: evaluate(token, vars), cwd })
      pendingRedirect = null
      continue
    }
    raws.push(token)
  }
  flush()

  const paths = new Set<string>()
  for (const { word, cwd: base } of found) {
    if (word.isDynamic || word.text === '' || word.text.startsWith('-')) continue
    if (base === null && !word.text.startsWith('/')) continue
    const path = resolve(base ?? '/', word.text)
    if (path.startsWith('/dev/') || path.startsWith('/proc/')) continue
    paths.add(path)
    if (paths.size >= MAX_PATHS) break
  }
  return [...paths]
}
