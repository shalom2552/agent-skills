import { describe, expect, test } from 'claude-code/testing'

import type { Engine as TestEngine } from 'claude-code/testing'

import { MAX_WAIT_MS, SWITCH_POLL_MS } from '../hooks/core'
import { START, world } from './world'

type World = ReturnType<typeof world>

async function switchTo($: TestEngine, w: World, id: string, reason: 'clear' | 'resume') {
  const ended = w.session.id
  await $.session.end({ reason, sessionId: ended, resume: { id: ended } })
  w.session.id = id
  await w.clock.advance(SWITCH_POLL_MS)
}

const lines = (...list: string[]) => list.map(line => `${line}\n`).join('')

describe('tool writes', () => {
  test('Write creating a file shows as added, every line counted', async ($, on) => {
    const w = world(on)
    await $.session.start({ cwd: w.root, ...START })
    await $.tool.call({ tool: 'Write', file_path: `${w.root}/src/new.ts`, content: lines('a', 'b', 'c') })

    expect(w.rows()).toEqual([
      expect.objectContaining({ path: `${w.root}/src/new.ts`, kind: 'added', adds: 3, dels: 0, noText: null }),
    ])
    expect(w.text(`${w.dataDir()}/ledger.json`)).toContain(`${w.root}/src/new.ts`)
  })

  test('Edit counts are net, and an undone edit drops out', async ($, on) => {
    const w = world(on)
    const file = `${w.root}/a.txt`
    w.put(file, lines('one', 'two', 'three'))
    await $.session.start({ cwd: w.root, ...START })

    await $.tool.call({ tool: 'Edit', file_path: file, old_string: 'two', new_string: 'TWO' })
    await $.tool.call({ tool: 'Edit', file_path: file, old_string: 'three', new_string: 'THREE' })
    expect(w.rows()).toEqual([expect.objectContaining({ path: file, kind: 'modified', adds: 2, dels: 2 })])

    await $.tool.call({ tool: 'Edit', file_path: file, old_string: 'TWO', new_string: 'two' })
    expect(w.rows()).toEqual([expect.objectContaining({ adds: 1, dels: 1 })])

    await $.tool.call({ tool: 'Edit', file_path: file, old_string: 'THREE', new_string: 'three' })
    expect(w.rows()).toEqual([])
  })

  test('a subagent edit is listed', async ($, on) => {
    const w = world(on)
    w.put(`${w.root}/b.txt`, 'x\n')
    await $.session.start({ cwd: w.root, ...START })
    await $.tool.call({ tool: 'Edit', file_path: `${w.root}/b.txt`, old_string: 'x', new_string: 'y', agentId: 'a1' })

    expect(w.rows().map(row => row.path)).toEqual([`${w.root}/b.txt`])
  })

  test('notebook edits are listed', async ($, on) => {
    const w = world(on)
    await $.session.start({ cwd: w.root, ...START })
    await $.tool.call({ tool: 'NotebookEdit', notebook_path: `${w.root}/n.ipynb`, new_source: '{}\n' })

    expect(w.rows()).toEqual([expect.objectContaining({ path: `${w.root}/n.ipynb`, kind: 'added' })])
  })

  test('a denied or errored call leaves no row', async ($, on) => {
    const w = world(on)
    w.put(`${w.root}/keep.txt`, 'same\n')
    await $.session.start({ cwd: w.root, ...START })

    const denied = await $.tool.call({ tool: 'Edit', file_path: `${w.root}/keep.txt`, old_string: 'nope', new_string: 'y' })
    expect(denied.isError).toBe(true)
    expect(w.rows()).toEqual([])
  })

  test('a denied call records nothing', async ($, on) => {
    on('tool.call', { tool: 'Write' }, () => ({ deny: 'not allowed' }))
    const w = world(on)
    await $.session.start({ cwd: w.root, ...START })
    const ran = await $.tool.call({ tool: 'Write', file_path: `${w.root}/blocked.txt`, content: 'x\n' })

    expect(ran.deny).toBe('not allowed')
    expect(w.rows()).toEqual([])
    expect(w.text(`${w.dataDir()}/ledger.json`) ?? '').not.toContain('blocked.txt')
  })

  test('parallel edits to one file all land', async ($, on) => {
    const w = world(on)
    const file = `${w.root}/p.txt`
    w.put(file, lines('a', 'b', 'c', 'd'))
    await $.session.start({ cwd: w.root, ...START })

    await Promise.all(
      ['a', 'b', 'c', 'd'].map(letter =>
        $.tool.call({ tool: 'Edit', file_path: file, old_string: `${letter}\n`, new_string: `${letter.toUpperCase()}\n`, agentId: letter }),
      ),
    )

    expect(w.text(file)).toBe(lines('A', 'B', 'C', 'D'))
    expect(w.rows()).toEqual([expect.objectContaining({ adds: 4, dels: 4 })])
  })

  test('binary and oversized files are listed with no text diff', async ($, on) => {
    const w = world(on)
    await $.session.start({ cwd: w.root, ...START })
    await $.tool.call({ tool: 'Write', file_path: `${w.root}/img.bin`, content: 'a\0b' })
    w.put(`${w.root}/big.log`, 'x', 5 * 1024 * 1024)
    await $.tool.call({ tool: 'Write', file_path: `${w.root}/big.log`, content: 'y' })
    w.put(`${w.root}/big.log`, 'y', 6 * 1024 * 1024)
    await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' })

    w.seedOpen(`${w.root}/img.bin`)
    await $.tool.call({ tool: 'Write', file_path: `${w.root}/img.bin`, content: 'a\0c' })

    const byPath = Object.fromEntries(w.rows().map(row => [row.path.split('/').pop(), row]))
    expect(byPath['img.bin']).toEqual(expect.objectContaining({ kind: 'added', noText: 'binary', adds: 0, dels: 0 }))
    expect(byPath['big.log']).toEqual(expect.objectContaining({ noText: 'too-large', adds: 0 }))
    expect(w.open()).toEqual({ path: `${w.root}/img.bin`, diff: null, note: 'binary' })
  })

  test('a failure inside the mod passes the call through', async ($, on) => {
    const w = world(on)
    await $.session.start({ cwd: w.root, ...START })
    w.faults.fs = true
    const ran = await $.tool.call({ tool: 'Write', file_path: `${w.root}/still.txt`, content: 'ok\n' })

    expect(ran.result).toBe('written')
    expect(w.text(`${w.root}/still.txt`)).toBe('ok\n')
  })
})

describe('open diff and edited since', () => {
  test('the open file shows its hunks and refreshes on a new edit', async ($, on) => {
    const w = world(on)
    const file = `${w.root}/o.txt`
    w.put(file, lines('one', 'two'))
    await $.session.start({ cwd: w.root, ...START })
    w.seedOpen(file)

    await $.tool.call({ tool: 'Edit', file_path: file, old_string: 'one', new_string: 'uno' })
    expect(w.open()?.diff?.text).toContain('-one')
    expect(w.open()?.diff?.text).toContain('+uno')
    expect(w.open()?.diff?.text).not.toContain('+dos')

    await $.tool.call({ tool: 'Edit', file_path: file, old_string: 'two', new_string: 'dos' })
    expect(w.open()?.diff).toEqual(expect.objectContaining({ adds: 2, dels: 2 }))
    expect(w.open()?.diff?.text).toContain('+dos')
  })

  test('a row says edited since when disk differs from Claude’s version', async ($, on) => {
    const w = world(on)
    const file = `${w.root}/e.txt`
    const done = { answer: '', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' } as const
    await $.session.start({ cwd: w.root, ...START })
    await $.tool.call({ tool: 'Write', file_path: file, content: 'claude\n' })
    await $.turn.complete(done)
    expect(w.rows()[0]?.isEditedSince).toBe(false)

    await w.clock.advance(1_000)
    w.put(file, 'mine\n')
    await $.turn.complete(done)
    expect(w.rows()[0]).toEqual(expect.objectContaining({ isEditedSince: true, adds: 1 }))

    w.seedOpen(file)
    await w.clock.advance(1_000)
    w.put(file, 'claude\n')
    await $.turn.complete(done)
    expect(w.rows()[0]?.isEditedSince).toBe(false)
  })
})

describe('shell writes', () => {
  test('a Bash call in a non-git root lists what the shadow trees show, with bases', async ($, on) => {
    const w = world(on)
    w.put(`${w.root}/keep.txt`, 'same\n')
    w.put(`${w.root}/mod.txt`, lines('one', 'two'))
    w.put(`${w.root}/gone.txt`, 'bye\n')
    w.put(`${w.root}/node_modules/pkg/index.js`, 'old\n')
    await $.session.start({ cwd: w.root, ...START })
    w.seedOpen(`${w.root}/mod.txt`)

    w.bash.effect = () => {
      w.put(`${w.root}/mod.txt`, lines('one', 'TWO'))
      w.put(`${w.root}/made.txt`, lines('x', 'y'))
      w.files.delete(`${w.root}/gone.txt`)
      w.put(`${w.root}/node_modules/pkg/index.js`, 'new\n')
    }
    await $.tool.call({ tool: 'Bash', command: 'npm run gen' })

    expect(w.rows().map(row => [row.path.slice(w.root.length + 1), row.kind, row.adds, row.dels])).toEqual([
      ['gone.txt', 'deleted', 0, 1],
      ['made.txt', 'added', 2, 0],
      ['mod.txt', 'modified', 1, 1],
    ])
    expect(w.open()?.diff?.text).toContain('-two')
    expect(w.shell()).toEqual({ status: 'on', reason: null })
  })

  test('shell edits after a tool edit keep the first base', async ($, on) => {
    const w = world(on)
    const file = `${w.root}/f.txt`
    w.put(file, 'v1\n')
    await $.session.start({ cwd: w.root, ...START })
    await $.tool.call({ tool: 'Write', file_path: file, content: 'v2\n' })
    w.seedOpen(file)
    w.bash.effect = () => void w.put(file, 'v3\n')
    await $.tool.call({ tool: 'Bash', command: 'sed -i s/2/3/ f.txt' })

    expect(w.open()?.diff?.text).toContain('-v1')
    expect(w.open()?.diff?.text).toContain('+v3')
    expect(w.open()?.diff?.text).not.toContain('v2')
  })

  test('the first snapshot runs in the background at start, and git stays in the data dir', async ($, on) => {
    const w = world(on)
    await $.session.start({ cwd: w.root, ...START })
    await $.tool.call({ tool: 'Bash', command: 'ls' })

    const subs = w.gitCalls.map(call => call.argv.find(arg => !arg.startsWith('-') && arg !== 'git' && !arg.includes('=')))
    expect(subs.slice(0, 4)).toEqual([undefined, 'init', 'add', 'write-tree'])
    const gitDir = w.gitCalls[1]?.argv.find(arg => arg.startsWith('--git-dir='))?.slice(10) ?? ''
    expect(gitDir.startsWith(w.shadowDir)).toBe(true)
    for (const call of w.gitCalls.slice(1)) {
      expect(call.argv).toContain(`--git-dir=${gitDir}`)
      expect(call.env.GIT_INDEX_FILE?.startsWith(`${w.dataDir()}/index-`)).toBe(true)
    }
    expect(w.text(`${gitDir}/info/exclude`)).toContain('node_modules/')
  })

  test('sessions in one root share the object store and keep their own index', async ($, on) => {
    const w = world(on)
    const first = w.session.id
    await $.session.start({ cwd: w.root, ...START })
    await switchTo($, w, `${first}-b`, 'clear')
    await $.tool.call({ tool: 'Bash', command: 'ls' })

    const adds = w.gitCalls.filter(call => call.argv.includes('add'))
    const dirs = new Set(adds.map(call => call.argv.find(arg => arg.startsWith('--git-dir='))))
    expect(dirs.size).toBe(1)
    const indexes = [...new Set(adds.map(call => call.env.GIT_INDEX_FILE ?? ''))].sort()
    expect(indexes).toHaveLength(2)
    expect(indexes.some(index => index.startsWith(`${w.dataDir(first)}/index-`))).toBe(true)
    expect(indexes.some(index => index.startsWith(`${w.dataDir()}/index-`))).toBe(true)
    expect(w.gitCalls.filter(call => call.argv.includes('init'))).toHaveLength(1)
  })

  test('a command naming outside paths tracks them', async ($, on) => {
    const w = world(on)
    w.put(`${w.root}/a.txt`, 'a\n')
    w.put(`${w.home}/.config/tool/conf`, 'old\n')
    await $.session.start({ cwd: w.root, ...START })

    w.bash.effect = () => {
      w.put(`${w.home}/.config/tool/conf`, 'a\n')
      w.put('/tmp/out/z.log', 'hi\n')
      w.put('/var/tmp/unnamed', 'not in the command\n')
    }
    await $.tool.call({ tool: 'Bash', command: 'cp a.txt ~/.config/tool/conf && echo "hi" > /tmp/out/z.log 2>&1' })

    expect(w.rows().map(row => [row.path, row.kind])).toEqual([
      [`${w.home}/.config/tool/conf`, 'modified'],
      ['/tmp/out/z.log', 'added'],
    ])
    expect(w.where()).toEqual({ root: w.root, home: w.home })
  })

  const parsed: [string, string[]][] = [
    ['sed -i "s/a/b/" /o/one.txt', ['/o/one.txt']],
    ["sed -i '' -e 's/a/b/' /o/one.txt /o/two.txt", ['/o/one.txt', '/o/two.txt']],
    ['cat x | tee -a /o/one.txt >/dev/null', ['/o/one.txt']],
    ['mv /o/one.txt /o/two.txt', ['/o/one.txt', '/o/two.txt']],
    ['rm -f /o/one.txt; touch "$HOME/two.txt"', ['/o/one.txt', '~/two.txt']],
    ['printf x >> /o/one.txt; cat /o/two.txt > /dev/null', ['/o/one.txt']],
    ['cat <<EOF > /o/one.txt\nrm /o/two.txt\nEOF', ['/o/one.txt']],
    ['echo $X > /o/$NAME.txt; ls /o/*.txt', []],
    ['dd if=/dev/zero of=/o/one.txt count=1', ['/o/one.txt']],
  ]
  for (const [command, expected] of parsed) {
    test(`command text: ${command.split('\n')[0]}`, async ($, on) => {
      const w = world(on)
      const named = ['/o/one.txt', '/o/two.txt', `${w.home}/two.txt`]
      for (const path of named) w.put(path, 'before\n')
      await $.session.start({ cwd: w.root, ...START })
      w.bash.effect = () => {
        for (const path of named) w.put(path, 'after\n')
      }
      await $.tool.call({ tool: 'Bash', command })

      const want = expected.map(path => path.replace(/^~/, w.home)).sort()
      expect(w.rows().map(row => row.path)).toEqual(want)
    })
  }
})

describe('shell guards', () => {
  test('a home-folder root turns shadow snapshots off and keeps command-text tracking', async ($, on) => {
    const w = world(on, { root: '/home/test' })
    await $.session.start({ cwd: w.root, ...START })
    w.bash.effect = () => {
      w.put(`${w.root}/named.txt`, 'x\n')
      w.put(`${w.root}/other.txt`, 'y\n')
    }
    await $.tool.call({ tool: 'Bash', command: 'echo x > named.txt' })

    expect(w.shell()).toEqual({ status: 'limited', reason: 'root-is-home' })
    expect(w.gitCalls).toEqual([])
    expect(w.rows().map(row => row.path)).toEqual([`${w.root}/named.txt`])
  })

  test('a filesystem root turns shadow snapshots off', async ($, on) => {
    const w = world(on, { root: '/' })
    await $.session.start({ cwd: w.root, ...START })
    await $.tool.call({ tool: 'Bash', command: 'ls' })
    expect(w.shell()).toEqual({ status: 'limited', reason: 'root-is-fs-root' })
  })

  test('missing git turns shadow snapshots off', async ($, on) => {
    const w = world(on, { git: 'missing' })
    await $.session.start({ cwd: w.root, ...START })
    w.bash.effect = () => void w.put(`${w.root}/t.txt`, 'x\n')
    await $.tool.call({ tool: 'Bash', command: 'touch t.txt' })

    expect(w.shell()).toEqual({ status: 'limited', reason: 'no-git' })
    expect(w.rows().map(row => row.path)).toEqual([`${w.root}/t.txt`])
  })

  test('a snapshot past the time budget is killed, and that session never retries', async ($, on) => {
    const w = world(on, { gitDelayMs: 6_000 })
    const first = w.session.id
    await $.session.start({ cwd: w.root, ...START })
    await $.tool.call({ tool: 'Bash', command: 'ls' })

    const add = w.gitCalls.find(call => call.argv.includes('add'))
    expect(add?.timeoutMs).toBe(5_000)
    expect(w.clock.now() - 1_000).toBe(5_000)
    expect(w.shell()).toEqual({ status: 'limited', reason: 'too-slow' })
    const callsAfterKill = w.gitCalls.length

    w.bash.effect = () => void w.put(`${w.root}/named.txt`, 'x\n')
    await $.tool.call({ tool: 'Bash', command: 'echo x > named.txt' })
    expect(w.gitCalls).toHaveLength(callsAfterKill)
    expect(w.rows().map(row => row.path)).toEqual([`${w.root}/named.txt`])

    await switchTo($, w, `${first}-b`, 'clear')
    await switchTo($, w, first, 'resume')
    expect(w.shell()).toEqual({ status: 'limited', reason: 'too-slow' })
    const ownAdds = w.gitCalls.filter(call => call.argv.includes('add') && call.env.GIT_INDEX_FILE === add?.env.GIT_INDEX_FILE)
    expect(ownAdds).toHaveLength(1)
  })
})

describe('sessions on disk', () => {
  test('data on disk for the session id shows at start with no tool calls', async ($, on) => {
    const w = world(on)
    const file = `${w.root}/saved.txt`
    const record = {
      path: file,
      hash: 'h1',
      base: { state: 'text', sig: 'one' },
      latest: { state: 'text', sig: 'two' },
      latestStat: { mtimeMs: 5, size: 4 },
      adds: 1,
      dels: 1,
      changedAt: 5,
      isEditedSince: false,
    }
    w.put(`${w.dataDir()}/ledger.json`, JSON.stringify({ shape: 'tdiff-ledger-1', files: [record] }))
    w.put(`${w.dataDir()}/base/h1`, 'one\n')
    w.put(`${w.dataDir()}/latest/h1`, 'two\n')
    w.put(file, 'two\n')
    w.files.set(file, { text: 'two\n', mtimeMs: 5 })
    w.seedOpen(file)
    await $.session.start({ cwd: w.root, ...START })

    expect(w.rows()).toEqual([expect.objectContaining({ path: file, kind: 'modified', adds: 1, dels: 1, isEditedSince: false })])
    expect(w.open()?.diff?.text).toContain('+two')
  })

  test('a ledger of another shape is declined', async ($, on) => {
    const w = world(on)
    w.put(`${w.dataDir()}/ledger.json`, JSON.stringify({ shape: 'old', files: [{ path: '/x', hash: 'h', base: {} }] }))
    await $.session.start({ cwd: w.root, ...START })
    expect(w.rows()).toEqual([])
  })

  test('resume switches to that session’s data, clear starts empty, old folders stay', async ($, on) => {
    const w = world(on)
    const first = w.session.id
    await $.session.start({ cwd: w.root, ...START })
    await $.tool.call({ tool: 'Write', file_path: `${w.root}/one.txt`, content: '1\n' })

    await switchTo($, w, `${first}-b`, 'clear')
    expect(w.rows()).toEqual([])
    await $.tool.call({ tool: 'Write', file_path: `${w.root}/two.txt`, content: '2\n' })
    expect(w.rows().map(row => row.path)).toEqual([`${w.root}/two.txt`])

    await switchTo($, w, first, 'resume')
    expect(w.rows().map(row => row.path)).toEqual([`${w.root}/one.txt`])
    expect(w.text(`${w.dataDir(`${first}-b`)}/ledger.json`)).toContain('two.txt')
  })
})

describe('hardening', () => {
  test('on a fresh cache the shadow store and session folder exist before git needs them', async ($, on) => {
    const w = world(on)
    expect([...w.files.keys()]).toEqual([])
    await $.session.start({ cwd: w.root, ...START })
    await $.tool.call({ tool: 'Bash', command: 'ls' })

    expect(w.shell()).toEqual({ status: 'on', reason: null })
    const gitDir = w.gitCalls[1]?.argv.find(arg => arg.startsWith('--git-dir='))?.slice(10) ?? ''
    expect(w.text(`${gitDir}/info/attributes`)).toBe('* -text -eol -filter -ident -working-tree-encoding\n')
    expect(w.text(`${gitDir}/empty-config`)).toBe('')
    expect(w.files.has(`${w.dataDir()}/ledger.json`)).toBe(true)
  })

  test('every shadow git call pins its own dirs over anything inherited', async ($, on) => {
    const w = world(on)
    await $.session.start({ cwd: w.root, ...START })
    await $.tool.call({ tool: 'Bash', command: 'ls' })

    const calls = w.gitCalls.slice(1)
    expect(calls.length).toBeGreaterThan(2)
    for (const call of calls) {
      const gitDir = call.argv.find(arg => arg.startsWith('--git-dir='))?.slice(10) ?? ''
      expect(gitDir.startsWith(w.shadowDir)).toBe(true)
      expect(call.argv).toContain(`--work-tree=${w.root}`)
      expect(call.env).toEqual(
        expect.objectContaining({
          GIT_DIR: gitDir,
          GIT_WORK_TREE: w.root,
          GIT_OBJECT_DIRECTORY: `${gitDir}/objects`,
          GIT_COMMON_DIR: gitDir,
          GIT_ALTERNATE_OBJECT_DIRECTORIES: '',
          GIT_CONFIG_NOSYSTEM: '1',
          GIT_CONFIG_GLOBAL: `${gitDir}/empty-config`,
          GIT_CONFIG_COUNT: '0',
          GIT_CONFIG_PARAMETERS: '',
          GIT_NAMESPACE: '',
          GIT_ATTR_NOSYSTEM: '1',
        }),
      )
    }
  })

  test('a /clear seen before the id moves switches once the id changes', async ($, on) => {
    const w = world(on)
    const first = w.session.id
    await $.session.start({ cwd: w.root, ...START })
    await $.tool.call({ tool: 'Write', file_path: `${w.root}/one.txt`, content: '1\n' })

    await $.session.end({ reason: 'clear', sessionId: first, resume: { id: first } })
    expect(w.rows()).toHaveLength(1)
    w.session.id = `${first}-b`
    await w.clock.advance(SWITCH_POLL_MS)
    expect(w.rows()).toEqual([])
  })

  test('a new turn picks up a moved session id too', async ($, on) => {
    const w = world(on)
    const first = w.session.id
    await $.session.start({ cwd: w.root, ...START })
    await $.tool.call({ tool: 'Write', file_path: `${w.root}/one.txt`, content: '1\n' })

    w.session.id = `${first}-b`
    await $.turn.start({ text: 'next', turnId: 't2' })
    expect(w.rows()).toEqual([])
  })

  test('a call stuck behind the mod runs at once, once, untracked', async ($, on) => {
    const w = world(on)
    const slow = `${w.root}/slow.txt`
    const quick = `${w.root}/quick.txt`
    const done = { answer: '', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' } as const
    await $.session.start({ cwd: w.root, ...START })
    await $.tool.call({ tool: 'Write', file_path: slow, content: 'a\n' })

    const release = w.gate(slow)
    const blocked = $.turn.complete(done)
    const call = $.tool.call({ tool: 'Write', file_path: quick, content: 'q\n' })
    await w.clock.advance(MAX_WAIT_MS)
    expect((await call).result).toBe('written')
    expect(w.toolRuns.filter(run => run.endsWith('quick.txt'))).toHaveLength(1)

    release()
    await blocked
    expect(w.rows().map(row => row.path)).toEqual([slow])

    w.seedOpen(quick)
    await $.tool.call({ tool: 'Write', file_path: quick, content: 'r\n' })
    expect(w.open()?.diff?.text).toContain('-q')
    expect(w.open()?.diff?.text).toContain('+r')
  })

  test('a root that holds the home folder turns shadow snapshots off', async ($, on) => {
    const w = world(on, { root: '/home' })
    await $.session.start({ cwd: w.root, ...START })
    await $.tool.call({ tool: 'Bash', command: 'ls' })
    expect(w.shell()).toEqual({ status: 'limited', reason: 'root-is-home' })
    expect(w.gitCalls).toEqual([])
  })

  test('a failed first touch still releases the file for a later denied call', async ($, on) => {
    on('tool.call', { tool: 'Edit', old_string: 'deny' }, () => ({ deny: 'no' }))
    const w = world(on)
    const file = `${w.root}/r.txt`
    w.put(file, 'v0\n')
    await $.session.start({ cwd: w.root, ...START })

    w.faults.baseWrites = 1
    await $.tool.call({ tool: 'Edit', file_path: file, old_string: 'v0', new_string: 'v1' })
    expect(w.text(file)).toBe('v1\n')
    await $.tool.call({ tool: 'Edit', file_path: file, old_string: 'deny', new_string: 'x' })

    await w.clock.advance(1_000)
    w.put(file, 'mine\n')
    w.seedOpen(file)
    await $.tool.call({ tool: 'Edit', file_path: file, old_string: 'mine', new_string: 'v2' })
    expect(w.open()?.diff?.text).toContain('-mine')
    expect(w.open()?.diff?.text).not.toContain('v1')
  })

  test('a literal cd moves where later relative paths land', async ($, on) => {
    const w = world(on, { git: 'missing' })
    await $.session.start({ cwd: w.root, ...START })
    w.bash.effect = () => void w.put('/elsewhere/out.txt', 'x\n')
    await $.tool.call({ tool: 'Bash', command: 'cd /elsewhere && echo x > out.txt' })
    expect(w.rows().map(row => row.path)).toEqual(['/elsewhere/out.txt'])
  })

  test('the reference root is the session root, not a shell cd', async ($, on) => {
    const w = world(on)
    w.session.cwd = `${w.root}/sub`
    await $.session.start({ cwd: w.session.cwd, ...START })
    expect(w.where()).toEqual({ root: w.root, home: w.home })
  })
})

describe('command text variables', () => {
  test('paths written through a variable outside the root are listed', async ($, on) => {
    const w = world(on)
    await $.session.start({ cwd: w.root, ...START })
    w.bash.effect = () => {
      w.put('/tmp/demo/notes.txt', 'hi\n')
      w.put('/tmp/demo/gen/f1', '1\n')
    }
    await $.tool.call({ tool: 'Bash', command: 'd=/tmp/demo; echo hi > "$d/notes.txt"; for i in 1; do echo $i > $d/gen/f$i; done' })
    expect(w.rows().map(row => row.path)).toEqual(['/tmp/demo/notes.txt'])
  })
})
