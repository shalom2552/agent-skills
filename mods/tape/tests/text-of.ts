export function textOf(tree: unknown): string {
  if (typeof tree === 'string' || typeof tree === 'number') return String(tree)
  if (Array.isArray(tree)) return tree.map(textOf).join('')
  if (typeof tree !== 'object' || tree === null) return ''
  const props: unknown = Reflect.get(tree, 'props')
  const label = typeof props === 'object' && props !== null ? Reflect.get(props, 'label') : undefined
  return `${typeof label === 'string' ? label : ''}${textOf(Reflect.get(tree, 'children') ?? [])}`
}

export function hiddenTextOf(tree: unknown): string {
  if (Array.isArray(tree)) return tree.map(hiddenTextOf).join('')
  if (typeof tree !== 'object' || tree === null) return ''
  const props: unknown = Reflect.get(tree, 'props')
  const display = typeof props === 'object' && props !== null ? Reflect.get(props, 'display') : undefined
  const children = Reflect.get(tree, 'children') ?? []
  return display === 'none' ? textOf(children) : hiddenTextOf(children)
}
