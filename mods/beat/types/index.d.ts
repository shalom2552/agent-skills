export type BeatTokens = { input: number; output: number; cacheRead: number; cacheCreation: number }

export type BeatTurn = { durationMs: number; think: number; tools: number; write: number; other: number; tokens?: BeatTokens; costUsd?: number; contextPercent?: number; startedAt?: number }

export type BeatSaved = { turns: BeatTurn[]; rows: Record<string, BeatTurn> }

declare module 'claude-code' {
  interface PluginState {
    beat: { turns: BeatTurn[]; busy: boolean }
  }
}
