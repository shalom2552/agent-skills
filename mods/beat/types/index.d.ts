export type BeatTokens = { input: number; output: number; cacheRead: number }

export type BeatTurn = { durationMs: number; think: number; tools: number; write: number; other: number; tokens?: BeatTokens; costUsd?: number; contextPercent?: number }

declare module 'claude-code' {
  interface PluginState {
    beat: { turns: BeatTurn[] }
  }
}
