export type TapeStatus = 'running' | 'ok' | 'error' | 'denied'

export type TapeCall = {
  id: string
  turn: number
  tool: string
  target: string
  agentId?: string
  startedAt: number
  endedAt?: number
  status: TapeStatus
}

export type TapeTurn = { n: number; prompt: string }

export type TapeAgent = {
  id: string
  description: string
  type: string
  toolUseId?: string
  spawnTurn: number
  endTurn?: number
  startedAt: number
  endedAt?: number
  status: TapeStatus
}

declare module 'claude-code' {
  interface PluginState {
    tape: {
      calls: TapeCall[]
      turns: TapeTurn[]
      agents: TapeAgent[]
      folds: Record<string, boolean>
      focused: string | null
      open: string | null
    }
  }
}
