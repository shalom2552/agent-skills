import { describe, expect, test } from 'claude-code/testing'

import { diffText } from '../hooks/diff'

const lines = (n: number, tag = 'l') => Array.from({ length: n }, (_, i) => `${tag}${i + 1}`)
const file = (xs: string[]) => xs.map(x => `${x}\n`).join('')
const hunks = (text: string) => text.split('\n').filter(l => l.startsWith('@@'))

describe('diffText', () => {
  test('identical texts give nothing', () => {
    expect(diffText('a\nb\n', 'a\nb\n')).toEqual({ text: '', adds: 0, dels: 0, truncated: false })
    expect(diffText('', '')).toEqual({ text: '', adds: 0, dels: 0, truncated: false })
  })

  test('insert keeps three lines of context', () => {
    const before = lines(10)
    const after = [...before.slice(0, 5), 'new', ...before.slice(5)]
    const r = diffText(file(before), file(after))
    expect(r.text).toBe(['@@ -3,6 +3,7 @@', ' l3', ' l4', ' l5', '+new', ' l6', ' l7', ' l8'].join('\n'))
    expect([r.adds, r.dels, r.truncated]).toEqual([1, 0, false])
  })

  test('delete', () => {
    const r = diffText('a\nb\nc\n', 'a\nc\n')
    expect(r.text).toBe(['@@ -1,3 +1,2 @@', ' a', '-b', ' c'].join('\n'))
    expect([r.adds, r.dels]).toEqual([0, 1])
  })

  test('replace shows removals before additions', () => {
    const r = diffText('a\nb\nc\n', 'a\nx\ny\nc\n')
    expect(r.text).toBe(['@@ -1,3 +1,4 @@', ' a', '-b', '+x', '+y', ' c'].join('\n'))
    expect([r.adds, r.dels]).toEqual([2, 1])
  })

  test('nearby changes merge, distant ones split', () => {
    const base = lines(30)
    const near = base.map((l, i) => (i === 5 || i === 11 ? `${l}!` : l))
    expect(hunks(diffText(file(base), file(near)).text)).toEqual(['@@ -3,13 +3,13 @@'])
    const far = base.map((l, i) => (i === 2 || i === 20 ? `${l}!` : l))
    expect(hunks(diffText(file(base), file(far)).text)).toEqual(['@@ -1,6 +1,6 @@', '@@ -18,7 +18,7 @@'])
  })

  test('empty base is all added', () => {
    const r = diffText('', 'a\nb\n')
    expect(r.text).toBe(['@@ -0,0 +1,2 @@', '+a', '+b'].join('\n'))
    expect([r.adds, r.dels]).toEqual([2, 0])
  })

  test('empty latest is all removed', () => {
    const r = diffText('a\nb\n', '')
    expect(r.text).toBe(['@@ -1,2 +0,0 @@', '-a', '-b'].join('\n'))
    expect([r.adds, r.dels]).toEqual([0, 2])
  })

  test('trailing newline differences are marked', () => {
    const added = diffText('a\nb', 'a\nb\n')
    expect(added.text).toBe(['@@ -1,2 +1,2 @@', ' a', '-b', '\\ No newline at end of file', '+b'].join('\n'))
    expect([added.adds, added.dels]).toEqual([1, 1])
    const removed = diffText('a\n', 'a')
    expect(removed.text).toBe(['@@ -1,1 +1,1 @@', '-a', '+a', '\\ No newline at end of file'].join('\n'))
    const both = diffText('a\nb', 'x\nb')
    expect(both.text).toBe(['@@ -1,2 +1,2 @@', '-a', '+x', ' b', '\\ No newline at end of file'].join('\n'))
  })

  test('CRLF lines diff by content and draw without carriage returns', () => {
    const r = diffText('a\r\nb\r\nc\r\n', 'a\r\nx\r\nc\r\n')
    expect(r.text).toBe(['@@ -1,3 +1,3 @@', ' a', '-b', '+x', ' c'].join('\n'))
    expect(r.text).not.toContain('\r')
  })

  test('control characters are replaced', () => {
    expect(diffText('', 'a\x1bb\tc\n').text).toBe(['@@ -0,0 +1,1 @@', '+a�b\tc'].join('\n'))
  })

  test('cap cuts at a line boundary with a valid hunk, counts stay whole', () => {
    const big = lines(20_000, 'line-')
    const r = diffText('', file(big))
    expect(r.truncated).toBe(true)
    expect(r.text.length).toBeLessThanOrEqual(100_000)
    expect([r.adds, r.dels]).toEqual([20_000, 0])
    const out = r.text.split('\n')
    const shown = out.length - 1
    expect(out[0]).toBe(`@@ -0,0 +1,${shown} @@`)
    expect(out.at(-1)).toBe(`+line-${shown}`)
  })

  test('cap applies across many hunks', () => {
    const base = lines(40_000, 'row-').map(l => l + '-'.repeat(40))
    const after = base.map((l, i) => (i % 100 === 50 ? `${l}!` : l))
    const r = diffText(file(base), file(after))
    expect(r.truncated).toBe(true)
    expect([r.adds, r.dels]).toEqual([400, 400])
    expect(r.text.length).toBeLessThanOrEqual(100_000)
    expect(r.text.split('\n').at(-1)).toMatch(/^[ +-]row-/)
  })

  test('large inputs stay fast and bail to a whole replace', () => {
    const a = lines(200_000, 'a')
    const b = lines(200_000, 'b')
    const start = Date.now()
    const r = diffText(file(['top', ...a, 'end']), file(['top', ...b, 'end']))
    expect(Date.now() - start).toBeLessThan(3000)
    expect([r.adds, r.dels]).toEqual([200_000, 200_000])
    expect(r.text.startsWith('@@ -1,') && r.text.includes('\n top\n-a1\n')).toBe(true)
    expect(r.truncated).toBe(true)
  })

  test('a small edit in a large file is found exactly', () => {
    const base = lines(300_000)
    const after = [...base]
    after[150_000] = 'changed'
    const start = Date.now()
    const r = diffText(file(base), file(after))
    expect(Date.now() - start).toBeLessThan(2000)
    expect([r.adds, r.dels, r.truncated]).toEqual([1, 1, false])
    expect(hunks(r.text)).toEqual(['@@ -149998,7 +149998,7 @@'])
  })
})
