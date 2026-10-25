import type { TdiffRow } from '../types'

export const COLLAPSE_OVER = 20

export type Dir = {
  kind: 'dir'
  key: string
  name: string
  adds: number
  dels: number
  count: number
  children: TreeNode[]
}

export type Leaf = { kind: 'file'; name: string; row: TdiffRow }

export type TreeNode = Dir | Leaf

export type Line = { depth: number; node: Leaf } | { depth: number; node: Dir; isCollapsed: boolean }

type Trie = { dirs: Map<string, Trie>; files: Leaf[] }

const byName = (a: { name: string }, b: { name: string }) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)

function toNodes(trie: Trie, prefix: string): TreeNode[] {
  const dirs = [...trie.dirs].map(([segment, sub]) => {
    let name = `${segment}/`
    let at = sub
    while (at.files.length === 0 && at.dirs.size === 1) {
      const [[next, only]] = [...at.dirs] as [[string, Trie]]
      name += `${next}/`
      at = only
    }
    const children = toNodes(at, prefix + name)
    const files = children.flatMap(function leaves(node): Leaf[] {
      return node.kind === 'file' ? [node] : node.children.flatMap(leaves)
    })
    const dir: Dir = {
      kind: 'dir',
      key: prefix + name,
      name,
      adds: files.reduce((sum, leaf) => sum + leaf.row.adds, 0),
      dels: files.reduce((sum, leaf) => sum + leaf.row.dels, 0),
      count: files.length,
      children,
    }
    return dir
  })
  return [...dirs.sort(byName), ...[...trie.files].sort(byName)]
}

export function buildTree(items: readonly { row: TdiffRow; label: string }[], prefix: string): TreeNode[] {
  const top: Trie = { dirs: new Map(), files: [] }
  for (const { row, label } of items) {
    const segments = label.split('/')
    const name = segments.pop() ?? label
    let at = top
    for (const segment of segments) {
      let sub = at.dirs.get(segment)
      if (sub === undefined) {
        sub = { dirs: new Map(), files: [] }
        at.dirs.set(segment, sub)
      }
      at = sub
    }
    at.files.push({ kind: 'file', name, row })
  }
  return toNodes(top, prefix)
}

export function visibleLines(nodes: readonly TreeNode[], folds: Readonly<Record<string, boolean>>, depth = 0): Line[] {
  return nodes.flatMap((node): Line[] => {
    if (node.kind === 'file') return [{ depth, node }]
    const isCollapsed = folds[node.key] ?? node.count > COLLAPSE_OVER
    return [{ depth, node, isCollapsed }, ...(isCollapsed ? [] : visibleLines(node.children, folds, depth + 1))]
  })
}
