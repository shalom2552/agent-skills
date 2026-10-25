export function normalize(path: string) {
  const isAbsolute = path.startsWith('/')
  const parts: string[] = []
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      if (parts.length > 0 && parts[parts.length - 1] !== '..') parts.pop()
      else if (!isAbsolute) parts.push('..')
      continue
    }
    parts.push(part)
  }
  const joined = parts.join('/')
  return isAbsolute ? `/${joined}` : joined || '.'
}

export function resolve(base: string, path: string) {
  return normalize(path.startsWith('/') ? path : `${base}/${path}`)
}

export function isUnder(path: string, root: string) {
  return root === '/' ? path.startsWith('/') : path === root || path.startsWith(`${root}/`)
}

export function relative(path: string, root: string) {
  if (path === root) return '.'
  return root === '/' ? path.slice(1) : path.slice(root.length + 1)
}

export function displayPath(path: string, where: { root: string; home: string }) {
  if (isUnder(path, where.root) && path !== where.root) {
    return { isUnderRoot: true, label: relative(path, where.root) }
  }
  if (where.home !== '' && where.home !== '/' && isUnder(path, where.home)) {
    return { isUnderRoot: false, label: path === where.home ? '~' : `~/${relative(path, where.home)}` }
  }
  return { isUnderRoot: false, label: path }
}
