export type TapeStatus = 'running' | 'ok' | 'error' | 'denied'

export type TapeCall = {
  id: string
  turn: number
  tool: string
  target: string
  isAgent: boolean
  startedAt: number
  endedAt?: number
  status: TapeStatus
}

export type TapeTurn = { n: number; prompt: string }

declare module 'claude-code' {
  interface PluginState {
    tape: {
      calls: TapeCall[]
      turns: TapeTurn[]
      folds: Record<string, boolean>
      focused: string | null
      open: string | null
    }
  }
}
