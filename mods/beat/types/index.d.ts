export type BeatTurn = { durationMs: number; think: number; tools: number; write: number; other: number }

declare module 'claude-code' {
  interface PluginState {
    beat: { turns: BeatTurn[] }
  }
}
