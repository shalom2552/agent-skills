import { describe, expect, test } from 'claude-code/testing'

import { commandPaths } from '../hooks/parse'

const WHERE = { cwd: '/work/app', home: '/home/test' }
const paths = (command: string) => commandPaths(command, WHERE).sort()

describe('command text variables', () => {
  test('a plain assignment feeds later references', () => {
    expect(paths('d=/tmp/x; sed -i s/a/b/ $d/src/app.ts')).toEqual(['/tmp/x/src/app.ts'])
  })

  test('braced and double-quoted references resolve', () => {
    expect(paths('d=/tmp/x && echo hi > "$d/notes.txt" && cp a ${d}/logo.bin')).toEqual([
      '/tmp/x/logo.bin',
      '/tmp/x/logo.bin/a',
      '/tmp/x/notes.txt',
    ])
  })

  test('export and quoted values resolve', () => {
    expect(paths(`export OUT="/tmp/my dir"; touch "$OUT/a"`)).toEqual(['/tmp/my dir/a'])
    expect(paths(`OUT='/tmp/q'; rm $OUT/b`)).toEqual(['/tmp/q/b'])
  })

  test('tilde and known variables inside a value resolve', () => {
    expect(paths('base=~/demo; d=$base/out; echo > $d/x')).toEqual(['/home/test/demo/out/x'])
    expect(paths('d="$HOME/y"; tee $d/z < /dev/null')).toEqual(['/home/test/y/z'])
  })

  test('assignments on separate lines work', () => {
    expect(paths('d=/tmp/x\nmkdir -p $d\necho > $d/one')).toEqual(['/tmp/x/one'])
  })

  test('the user demo lists what it can and skips the loop paths', () => {
    const demo = [
      'd=/tmp/tdiff-demo',
      'mkdir -p $d/src $d/gen',
      'echo hi > "$d/notes.txt"',
      'printf "\\x89PNG" > $d/logo.bin',
      'sed -i s/a/b/ $d/src/app.ts',
      'for i in 1 2; do echo $i > $d/gen/f$i; done',
    ].join('\n')
    expect(paths(demo)).toEqual(['/tmp/tdiff-demo/logo.bin', '/tmp/tdiff-demo/notes.txt', '/tmp/tdiff-demo/src/app.ts'])
  })

  test('a variable prefixed to one command does not leak into its own arguments', () => {
    expect(paths('d=/tmp/x cp a $d/f')).toEqual([])
  })
})

describe('copy and move into a folder', () => {
  test('a trailing slash puts each source inside', () => {
    expect(paths('N=~/.local/share/notes/config; mv INDEX.md "$N"/')).toEqual([
      '/home/test/.local/share/notes/config/INDEX.md',
      '/work/app/INDEX.md',
    ])
    expect(paths('cp src/a.txt b.txt /tmp/out/')).toEqual(['/tmp/out/a.txt', '/tmp/out/b.txt'])
  })

  test('a bare destination may be a file or a folder', () => {
    expect(paths('cp a.txt /tmp/out')).toEqual(['/tmp/out', '/tmp/out/a.txt'])
  })

  test('target directory flags', () => {
    expect(paths('mv -t /tmp/out a b')).toEqual(['/tmp/out/a', '/tmp/out/b', '/work/app/a', '/work/app/b'])
    expect(paths('cp --target-directory=/tmp/out a')).toEqual(['/tmp/out/a'])
    expect(paths('cp -T a /tmp/out')).toEqual(['/tmp/out'])
  })

  test('landed files win over sources under the path cap', () => {
    const names = Array.from({ length: 30 }, (_, i) => `f${i}`)
    const landed = names.map(name => `/tmp/out/${name}`)
    const found = paths(`mv ${names.join(' ')} /tmp/out/`)
    expect(found).toHaveLength(50)
    expect(landed.filter(path => !found.includes(path))).toEqual([])
    const viaFlag = paths(`mv -t /tmp/out ${names.join(' ')}`)
    expect(landed.filter(path => !viaFlag.includes(path))).toEqual([])
  })
})

describe('command text skips what it cannot resolve', () => {
  test('command substitution in a value', () => {
    expect(paths('d=$(mktemp -d); echo > $d/f')).toEqual([])
    expect(paths('d=`mktemp -d`; echo > $d/f')).toEqual([])
  })

  test('unknown variables and positional or special parameters', () => {
    expect(paths('echo > $TMPDIR/f; echo > $1/g; echo > $$/h')).toEqual([])
  })

  test('globs', () => {
    expect(paths('d=/tmp/x; rm $d/*.log')).toEqual([])
  })

  test('loop variables, even when the name was assigned before', () => {
    expect(paths('d=/tmp/x; for d in a b; do echo > $d/f; done')).toEqual([])
    expect(paths('while read -r d; do echo > $d/f; done')).toEqual([])
  })

  test('arithmetic and parameter operators', () => {
    expect(paths('n=1; echo > /tmp/f$((n+1)); echo > ${d:-/tmp}/g')).toEqual([])
  })

  test('a value built from something unknown, and an unset name', () => {
    expect(paths('d=$X/y; echo > $d/f')).toEqual([])
    expect(paths('d=/tmp/x; unset d; echo > $d/f')).toEqual([])
  })

  test('single quotes keep a dollar literal', () => {
    expect(paths(`d=/tmp/x; echo > '$d'`)).toEqual(['/work/app/$d'])
  })
})
