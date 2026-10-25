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
