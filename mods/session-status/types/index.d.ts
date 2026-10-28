declare module 'claude-code' {
  interface PluginState {
    'session-status': {
      lastRequestAt: number
      cacheTtlMs: number | null
      keepWarm: boolean
      pings: number
      lastPing: { readTokens: number } | { error: string } | null
    }
  }
}
