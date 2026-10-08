export type Mode = 'off' | 'read-only' | 'apply'

declare module 'claude-code' {
  interface PluginState {
    'read-only': { mode: Mode }
  }
}
