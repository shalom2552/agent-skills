export type Active = string[]

declare module 'claude-code' {
  interface PluginState {
    badges: { active: Active }
  }
}
