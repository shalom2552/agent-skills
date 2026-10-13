export type FrameStamp = { n?: number; at: number; texts: string[] }

declare module 'claude-code' {
  interface PluginState {
    frame: { stamps: Record<string, FrameStamp>; count: number; offsetMs: number | null }
  }
}
