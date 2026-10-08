export type Mode = 'off' | 'intake' | 'coach' | 'interview'

declare module 'claude-code' {
  interface PluginState {
    'walk-with-me': { mode: Mode }
  }
}
