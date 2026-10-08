import type { Register } from 'claude-code'

export const WORDS = [
  'Cooking', 'Slaying', 'Edging', 'Aura-farming', 'Rotting',
  'Doomscrolling', 'Vibing', 'Lock-in', 'Crashing-out', 'Coping',
  'Tweaking', 'Grinding', 'Drifting', 'Floating', 'Farming',
  'Min-maxing', 'Touching-grass', 'Glitching', 'Buffering', 'Lagging'
]

// keyed on the engine's word, so it changes per turn and not per redraw
export const pick = (word: string): string => {
  let h = 0
  for (const c of word) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return WORDS[h % WORDS.length]
}

export const register: Register = on => {
  on('ui.render', { component: 'Spinner' }, ($, e, next) =>
    next({ ...e, props: { ...e.props, word: pick(e.props.word) } }),
  )
}
