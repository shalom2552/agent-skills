export type DiffResult = { text: string; adds: number; dels: number; truncated: boolean }

type Change = { a0: number; a1: number; b0: number; b1: number }
type Side = { lines: string[]; ids: Int32Array; hasEol: boolean }

const CONTEXT = 3
const MAX_TEXT = 100_000
const MAX_EDITS = 2000
const MAX_WORK = 30_000_000
const NO_EOL = '\\ No newline at end of file'
const CONTROL = /[\x00-\x08\x0b-\x1f\x7f]/g

function sides(before: string, after: string): [Side, Side] {
  const table = new Map<string, number>()
  const side = (text: string): Side => {
    const hasEol = text === '' || text.endsWith('\n')
    const lines = text === '' ? [] : (hasEol ? text.slice(0, -1) : text).split('\n')
    const ids = new Int32Array(lines.length)
    lines.forEach((line, i) => {
      const key = !hasEol && i === lines.length - 1 ? `\0${line}` : line
      let id = table.get(key)
      if (id === undefined) table.set(key, (id = table.size))
      ids[i] = id
    })
    return { lines, ids, hasEol }
  }
  return [side(before), side(after)]
}

function myers(a: Int32Array, b: Int32Array): Change[] | null {
  const n = a.length
  const m = b.length
  const offset = n + m + 1
  const v = new Int32Array(2 * offset + 1)
  const trace: Int32Array[] = []
  let work = 0
  let end = -1
  for (let d = 0; d <= n + m && end < 0; d++) {
    if (d > MAX_EDITS) return null
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[offset + k - 1]! < v[offset + k + 1]!) ? v[offset + k + 1]! : v[offset + k - 1]! + 1
      let y = x - k
      const x0 = x
      while (x < n && y < m && a[x] === b[y]) x++, y++
      work += 1 + x - x0
      v[offset + k] = x
      if (x >= n && y >= m) end = d
    }
    if (work > MAX_WORK) return null
    trace.push(v.slice(offset - d, offset + d + 1))
  }

  const del = new Uint8Array(n)
  const ins = new Uint8Array(m)
  let x = n
  let y = m
  for (let d = end; d > 0; d--) {
    const prev = trace[d - 1]!
    const at = (k: number) => prev[k + d - 1]!
    const k = x - y
    const down = k === -d || (k !== d && at(k - 1) < at(k + 1))
    const pk = down ? k + 1 : k - 1
    const px = at(pk)
    const py = px - pk
    if (down) ins[py] = 1
    else del[px] = 1
    x = px
    y = py
  }

  const changes: Change[] = []
  let i = 0
  let j = 0
  while (i < n || j < m) {
    while (i < n && j < m && !del[i] && !ins[j]) i++, j++
    const a0 = i
    const b0 = j
    while (i < n && del[i]) i++
    while (j < m && ins[j]) j++
    if (i > a0 || j > b0) changes.push({ a0, a1: i, b0, b1: j })
    else break
  }
  return changes
}

function diffChanges(a: Int32Array, b: Int32Array): Change[] {
  let pre = 0
  const max = Math.min(a.length, b.length)
  while (pre < max && a[pre] === b[pre]) pre++
  let suf = 0
  while (suf < max - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++
  const midA = a.subarray(pre, a.length - suf)
  const midB = b.subarray(pre, b.length - suf)
  if (midA.length === 0 && midB.length === 0) return []
  const found = midA.length && midB.length ? myers(midA, midB) : null
  const changes = found ?? [{ a0: 0, a1: midA.length, b0: 0, b1: midB.length }]
  return changes.map(c => ({ a0: c.a0 + pre, a1: c.a1 + pre, b0: c.b0 + pre, b1: c.b1 + pre }))
}

function group(changes: Change[]): Change[][] {
  const groups: Change[][] = []
  for (const c of changes) {
    const last = groups.at(-1)?.at(-1)
    if (last && c.a0 - last.a1 <= 2 * CONTEXT) groups.at(-1)!.push(c)
    else groups.push([c])
  }
  return groups
}

const range = (start: number, count: number) => `${count ? start + 1 : start},${count}`
const clean = (line: string) => line.replace(/\r$/, '').replace(CONTROL, '�')

export function diffText(before: string, after: string): DiffResult {
  const [a, b] = sides(before, after)
  const changes = diffChanges(a.ids, b.ids)
  let adds = 0
  let dels = 0
  for (const c of changes) {
    adds += c.b1 - c.b0
    dels += c.a1 - c.a0
  }

  const out: string[] = []
  let size = 0
  let truncated = false
  for (const hunk of group(changes)) {
    const first = hunk[0]!
    const last = hunk[hunk.length - 1]!
    const aStart = Math.max(0, first.a0 - CONTEXT)
    const bStart = first.b0 - (first.a0 - aStart)
    const aEnd = Math.min(a.lines.length, last.a1 + CONTEXT)
    const bEnd = last.b1 + (aEnd - last.a1)
    const header = `@@ -${range(aStart, aEnd - aStart)} +${range(bStart, bEnd - bStart)} @@`
    const room = MAX_TEXT - size - (out.length ? 1 : 0) - header.length
    if (room <= 0) {
      truncated = true
      break
    }

    const body: string[] = []
    let used = 0
    let aCount = 0
    let bCount = 0
    const push = (line: string, inA: boolean, inB: boolean) => {
      if (truncated) return
      if (used + 1 + line.length > room) {
        truncated = true
        return
      }
      body.push(line)
      used += 1 + line.length
      if (inA) aCount++
      if (inB) bCount++
    }
    const mark = (side: Side, i: number) => {
      if (!side.hasEol && i === side.lines.length - 1) push(NO_EOL, false, false)
    }
    const context = (from: number, to: number) => {
      for (let i = from; i < to; i++) push(` ${clean(a.lines[i]!)}`, true, true), mark(a, i)
    }

    let at = aStart
    for (const c of hunk) {
      context(at, c.a0)
      for (let i = c.a0; i < c.a1; i++) push(`-${clean(a.lines[i]!)}`, true, false), mark(a, i)
      for (let i = c.b0; i < c.b1; i++) push(`+${clean(b.lines[i]!)}`, false, true), mark(b, i)
      at = c.a1
    }
    context(at, aEnd)

    if (!body.length) break
    const head = truncated ? `@@ -${range(aStart, aCount)} +${range(bStart, bCount)} @@` : header
    out.push(head, ...body)
    size += (size ? 1 : 0) + head.length + used
    if (truncated) break
  }
  return { text: out.join('\n'), adds, dels, truncated }
}
