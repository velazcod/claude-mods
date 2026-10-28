declare module 'claude-code' {
  interface PluginState {
    handoff: {
      context: { tokens: number; window: number } | null
      snoozedAt: number | null
      isPending: boolean
      run: {
        status: 'running' | 'done' | 'failed'
        step: number
        details: string[]
        stepStartedAt: number
        words: number
        path: string
        error: string
      } | null
    }
  }
}
