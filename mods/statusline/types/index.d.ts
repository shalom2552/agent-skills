export type StatuslineLimit = { kind: string; percent: number; resetsAt?: number }

export type StatuslineDiff = { added: number; removed: number }

export type StatuslineSnap = {
  model?: string
  effort?: string
  isFast: boolean
  branch?: string
  isDirty: boolean
  cost?: number
  tokens?: number
  percent?: number
  window?: number
  limits: StatuslineLimit[]
  minute: number
}

declare module 'claude-code' {
  interface PluginState {
    statusline: { snap: StatuslineSnap; diff: StatuslineDiff }
  }
}
