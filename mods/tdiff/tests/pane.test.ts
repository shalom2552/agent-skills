import type { CommandRunInput } from 'claude-code'
import type { MountTarget } from 'claude-code/testing'
import { describe, expect, test } from 'claude-code/testing'

import { START, world } from './world'

const SURFACES = ['terminal', 'desktop'] as const
const COLUMNS = 60

const TDIFF: CommandRunInput = {
  command: 'tdiff',
  args: '',
  origin: { kind: 'composer' },
  presentation: { isFullscreen: true, columns: 160 },
}

const pane = <P extends (typeof SURFACES)[number]>(surface: P): MountTarget<P, 'Pane'> => ({
  plugin: 'tdiff',
  surface,
  component: 'Pane',
  requestId: 'tdiff',
  viewport: { columns: 160, rows: 40, isFullscreen: true },
  props: {
    title: 'Tdiff',
    isFocused: false,
    bodyColumns: COLUMNS,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
})

const DONE = { answer: '', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' } as const

const lines = (...list: string[]) => list.map(line => `${line}\n`).join('')

function inline(node: unknown): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(inline).join('')
  if (typeof node !== 'object' || node === null) return ''
  const props = (Reflect.get(node, 'props') ?? {}) as Record<string, unknown>
  const children = (Reflect.get(node, 'children') ?? []) as unknown[]
  if (Reflect.get(node, 'type') === 'Button' && children.length === 0) return `[ ${String(props.label)} ] `
  return inline(children)
}

function screen(node: unknown): string[] {
  if (typeof node !== 'object' || node === null) return []
  const type = Reflect.get(node, 'type')
  const props = (Reflect.get(node, 'props') ?? {}) as Record<string, unknown>
  const children = (Reflect.get(node, 'children') ?? []) as unknown[]
  if (type === 'Code') return String(props.source).replace(/\n$/, '').split('\n')
  if (type !== 'Box') return [inline(node)]
  if (props.flexDirection === 'column') return children.flatMap(screen)
  return [' '.repeat(Number(props.paddingLeft ?? 0)) + children.map(inline).join('')]
}

const squeeze = (line: string) => line.trimEnd().replace(/(\S) +/g, '$1 ')
const view = async (ui: { drawn: () => Promise<unknown> }) => screen(await ui.drawn()).map(squeeze)

for (const surface of SURFACES) {
  describe(`pane on ${surface}`, () => {
    test('rows sit in two sections with letters, counts and tags', async ($, on) => {
      const w = world(on, { root: '/home/test/proj', isStateLive: true })
      w.put(`${w.root}/src/app.ts`, lines('a', 'b', 'c'))
      await $.session.start({ cwd: w.root, ...START })
      await $.tool.call({ tool: 'Edit', file_path: `${w.root}/src/app.ts`, old_string: 'b', new_string: 'B\nB2' })
      await $.tool.call({ tool: 'Write', file_path: `${w.root}/src/new.ts`, content: lines('n') })
      await $.tool.call({ tool: 'Write', file_path: `${w.root}/logo.bin`, content: 'a\0b' })
      await $.tool.call({ tool: 'Write', file_path: `${w.home}/.config/tool.conf`, content: lines('k=v') })
      await $.tool.call({ tool: 'Write', file_path: '/opt/other/x.txt', content: lines('o') })
      await $.turn.complete(DONE)
      await w.clock.advance(1_000)
      w.put(`${w.root}/src/new.ts`, lines('mine'))
      await $.turn.complete(DONE)

      const ui = await $.ui.mount(pane(surface))
      const text = await view(ui)
      expect(text).toEqual([
        '5 files +5 -1',
        '~/proj',
        '▾ src/',
        '    M app.ts +2 -1',
        '    A new.ts edited since +1 -0',
        '  A logo.bin no text diff',
        'Elsewhere',
        '▾ /opt/other/',
        '    A x.txt +1 -0',
        '▾ ~/.config/',
        '    A tool.conf +1 -0',
      ])
      const raw = screen(await ui.drawn())
      expect(raw[3]?.endsWith(' +2 -1')).toBe(true)
      expect(raw[5]?.endsWith(' no text diff')).toBe(true)
      expect(await ui.find({ type: 'Text', text: /^\+3$/ })).toBeUndefined()
      expect((await ui.find({ type: 'Text', text: /^\+2$/ }))?.props.color).toBe('success')

      const colorOf = async (text: string) => (await ui.findAll({ type: 'Text' })).find(one => one.text === text)?.props
      expect((await colorOf('app.ts'))?.bold).toBe(true)
      expect((await colorOf('~/proj'))?.color).toBe('claude')
      expect((await colorOf('Elsewhere'))?.color).toBe('ide')
      expect((await colorOf('/opt/other/'))?.color).toBe('ide')
      expect((await colorOf('~/.config/'))?.color).toBe('ide')
      expect((await colorOf('src/'))?.color).toBeUndefined()
      expect((await colorOf('tool.conf'))?.color).toBeUndefined()
      expect((await colorOf('x.txt'))?.color).toBeUndefined()
      expect((await ui.find({ type: 'Text', text: '▾ ' }))?.props.dimColor).toBe(true)
      expect(text.join('\n')).not.toMatch(/project/i)
      await ui.unmount()
    })

    test('folders nest, single-child chains merge, totals add up', async ($, on) => {
      const w = world(on, { isStateLive: true })
      for (const path of ['src/lib/utils/a.ts', 'src/lib/utils/b.ts', 'src/main.ts', 'README.md']) w.put(`${w.root}/${path}`, 'x\n')
      await $.session.start({ cwd: w.root, ...START })
      for (const path of ['src/lib/utils/a.ts', 'src/lib/utils/b.ts', 'src/main.ts', 'README.md']) {
        await $.tool.call({ tool: 'Edit', file_path: `${w.root}/${path}`, old_string: 'x', new_string: 'y\nz' })
      }

      const ui = await $.ui.mount(pane(surface))
      expect(await view(ui)).toEqual([
        '4 files +8 -4',
        w.root,
        '▾ src/',
        '  ▾ lib/utils/',
        '      M a.ts +2 -1',
        '      M b.ts +2 -1',
        '    M main.ts +2 -1',
        '  M README.md +2 -1',
      ])
      await ui.unmount()
    })

    test('big folders start collapsed, a press toggles, and the choice stays', async ($, on) => {
      const w = world(on, { isStateLive: true })
      await $.session.start({ cwd: w.root, ...START })
      for (let i = 0; i < 21; i++) await $.tool.call({ tool: 'Write', file_path: `${w.root}/gen/f${i}.ts`, content: 'x\n' })
      for (let i = 0; i < 20; i++) await $.tool.call({ tool: 'Write', file_path: `${w.root}/small/s${i}.ts`, content: 'x\n' })

      const ui = await $.ui.mount({ ...pane(surface), props: { ...pane(surface).props, isFocused: true } })
      let text = await view(ui)
      expect(text).toContain('▸ gen/ 21 files +21 -0')
      expect(text).toContain('▾ small/')
      expect((await ui.find({ type: 'Text', text: /^\+21$/ }))?.props.color).toBe('success')
      expect(text).toContain('    A s0.ts +1 -0')
      expect(text.some(line => line.includes('f0.ts'))).toBe(false)

      await ui.press({ key: 'dir:root:gen/' })
      await ui.press({ key: 'dir:root:small/' })
      text = await view(ui)
      expect(text).toContain('▾ gen/')
      expect(text).toContain('    A f0.ts +1 -0')
      expect(text).toContain('▸ small/ 20 files +20 -0')
      await ui.unmount()

      const again = await $.ui.mount(pane(surface))
      expect(await view(again)).toContain('▸ small/ 20 files +20 -0')
      await again.unmount()
    })

    test('past the row cap the rest is summed up in one line', async ($, on) => {
      const w = world(on, { isStateLive: true })
      await $.session.start({ cwd: w.root, ...START })
      for (let i = 0; i < 270; i++) await $.tool.call({ tool: 'Write', file_path: `${w.root}/f${String(i).padStart(3, '0')}.ts`, content: 'x\n' })

      const ui = await $.ui.mount(pane(surface))
      expect(await ui.findAll({ type: 'Button' })).toHaveLength(250)
      expect((await view(ui)).at(-1)).toBe('20 more rows, collapse some folders.')
      await ui.unmount()
    })

    test('zero counts are dim on file rows and the header', async ($, on) => {
      const w = world(on, { isStateLive: true })
      await $.session.start({ cwd: w.root, ...START })
      await $.tool.call({ tool: 'Write', file_path: `${w.root}/src/a.ts`, content: lines('a', 'b') })

      const ui = await $.ui.mount(pane(surface))
      const zeros = await ui.findAll({ type: 'Text', text: /^-0$/ })
      expect(zeros).toHaveLength(2)
      for (const zero of zeros) {
        expect(zero.props.dimColor).toBe(true)
        expect(zero.props.color).toBeUndefined()
      }
      const twos = await ui.findAll({ type: 'Text', text: /^\+2$/ })
      expect(twos.map(two => two.props.color)).toEqual(['success', 'success'])
      await ui.unmount()
    })

    test('a long merged folder stays on one line at 40 columns', async ($, on) => {
      const w = world(on, { isStateLive: true })
      const deep = '/var/tmp/build-cache-0123456789/very-long-project-name-for-testing/scratchpad/demo'
      await $.session.start({ cwd: w.root, ...START })
      await $.tool.call({ tool: 'Write', file_path: `${deep}/src/app.ts`, content: 'x\n' })
      await $.tool.call({ tool: 'Write', file_path: `${deep}/a-very-long-file-name-that-will-not-fit-here.ts`, content: 'x\n' })

      const ui = await $.ui.mount({ ...pane(surface), props: { ...pane(surface).props, bodyColumns: 40 } })
      const raw = screen(await ui.drawn())
      const rows = raw.filter(line => /[▾▸]|^ *[AMD] /.test(line))
      expect(rows).toHaveLength(4)
      for (const line of rows) expect(Array.from(line).length).toBeLessThanOrEqual(40)
      expect(rows[0]).toMatch(/^▾ \/var\/tmp\/.*….*\/demo\/ *$/)
      expect(rows.some(line => /^ {4}A a-very.*….*\.ts \+1 -0$/.test(line))).toBe(true)
      await ui.unmount()
    })

    test('names truncate in the middle to fit the row', async ($, on) => {
      const w = world(on, { isStateLive: true })
      const name = 'a-very-long-file-name-that-will-not-fit-here.ts'
      await $.session.start({ cwd: w.root, ...START })
      await $.tool.call({ tool: 'Write', file_path: `${w.root}/deep/${name}`, content: 'x\n' })
      await $.tool.call({ tool: 'Write', file_path: `${w.root}/deep/b.ts`, content: 'x\n' })

      const ui = await $.ui.mount({ ...pane(surface), props: { ...pane(surface).props, bodyColumns: 40 } })
      expect((await ui.find({ type: 'Text', text: /^a-very.*…/ }))?.props.wrap).toBe('truncate-middle')
      expect((await ui.find({ type: 'Text', text: 'deep/' }))?.props.wrap).toBe('truncate-middle')
      expect(Reflect.get(await ui.drawn(), 'props')).toEqual(expect.objectContaining({ width: 40 }))
      await ui.unmount()
    })

    test('an empty session says so', async ($, on) => {
      const w = world(on, { isStateLive: true })
      await $.session.start({ cwd: w.root, ...START })

      const ui = await $.ui.mount(pane(surface))
      expect(screen(await ui.drawn())).toEqual(['No changes yet.'])
      await ui.unmount()
    })

    test('opening a row shows its hunks, a new edit refreshes them, back returns', async ($, on) => {
      const w = world(on, { isStateLive: true })
      const file = `${w.root}/src/o.ts`
      w.put(file, lines('one', 'two', 'three'))
      await $.session.start({ cwd: w.root, ...START })
      await $.tool.call({ tool: 'Edit', file_path: file, old_string: 'one', new_string: 'uno' })

      const ui = await $.ui.mount(pane(surface))
      await ui.press({ key: file })
      const code = await ui.find({ type: 'Code' })
      expect(code?.props).toEqual(expect.objectContaining({ format: 'diff', path: file }))
      expect(String(code?.props.source)).toContain('-one')
      expect(String(code?.props.source)).toContain('+uno')
      expect((await view(ui)).slice(0, 2)).toEqual(['[ back ] +1 -1', 'M src/o.ts'])
      expect((await ui.find({ type: 'Button', key: 'back' }))?.props.hotkey).toBe('b')

      await $.tool.call({ tool: 'Edit', file_path: file, old_string: 'three', new_string: 'tres' })
      expect(String((await ui.find({ type: 'Code' }))?.props.source)).toContain('+tres')
      expect((await view(ui))[0]).toBe('[ back ] +2 -2')

      await ui.press({ key: 'back' })
      expect(await ui.find({ type: 'Code' })).toBeUndefined()
      expect(await ui.find({ type: 'Button', key: file })).toBeDefined()
      await ui.unmount()
    })

    test('a binary row opens to a note, not a diff', async ($, on) => {
      const w = world(on, { isStateLive: true })
      await $.session.start({ cwd: w.root, ...START })
      await $.tool.call({ tool: 'Write', file_path: `${w.root}/img.bin`, content: 'a\0b' })

      const ui = await $.ui.mount(pane(surface))
      await ui.press({ key: `${w.root}/img.bin` })
      expect(await ui.find({ type: 'Code' })).toBeUndefined()
      expect(await ui.find({ type: 'Text', text: /no text diff/ })).toBeDefined()
      await ui.unmount()
    })

    test('limited shell tracking is noted in the footer with its reason', async ($, on) => {
      const w = world(on, { root: '/home/test', isStateLive: true })
      await $.session.start({ cwd: w.root, ...START })
      await $.tool.call({ tool: 'Write', file_path: `${w.root}/a.txt`, content: 'a\n' })

      const ui = await $.ui.mount(pane(surface))
      const text = screen(await ui.drawn())
      expect(text[1]).toBe('~')
      expect(text[text.length - 1]).toBe('Shell tracking limited: the root is the home folder.')
      await ui.unmount()
    })

    test('no footer while shell tracking is on', async ($, on) => {
      const w = world(on, { isStateLive: true })
      await $.session.start({ cwd: w.root, ...START })
      await $.tool.call({ tool: 'Bash', command: 'ls' })

      const ui = await $.ui.mount(pane(surface))
      expect(await ui.find({ type: 'Text', text: /Shell tracking/ })).toBeUndefined()
      await ui.unmount()
    })
  })
}

describe('/tdiff', () => {
  test('is registered immediate, opens and then closes the pane', async ($, on) => {
    const w = world(on)
    await $.session.start({ cwd: w.root, ...START })

    expect(w.commands).toEqual([expect.objectContaining({ name: 'tdiff', immediate: true })])
    expect(await $.command.run(TDIFF)).toEqual({ text: 'Tdiff opened.' })
    expect(w.panes.map(one => one.id)).toEqual(['tdiff'])
    expect(await $.command.run(TDIFF)).toEqual({ text: 'Tdiff closed.' })
    expect(w.panes).toEqual([])
  })

  test('closes a pane an earlier load of the module opened', async ($, on) => {
    const w = world(on)
    await $.session.start({ cwd: w.root, ...START })
    w.panes.push({ id: 'tdiff', title: 'Tdiff', isShown: true, isFocused: false, isPlaced: true })

    expect(await $.command.run(TDIFF)).toEqual({ text: 'Tdiff closed.' })
    expect(w.panes).toEqual([])
  })

  test('says when the pane waits to be placed', async ($, on) => {
    const w = world(on, { isPlaced: false })
    await $.session.start({ cwd: w.root, ...START })

    expect((await $.command.run(TDIFF)).text).toMatch(/^Tdiff is waiting/)
  })
})
