export type Todo = { id: string; content: string; status: 'pending' | 'in_progress' | 'completed' }

export type Inventory = {
  todos: Todo[]
  connectors: { server: string; calls: number; tools: string[] }[]
  skills: { name: string; uses: number }[]
  contextFiles: { path: string }[]
  filesRead: { path: string; reads: number }[]
  filesMade: { path: string; action: 'created' | 'modified'; edits: number }[]
}

export type ContextUsage = {
  percentage: number
  totalTokens: number
  maxTokens: number
  categories: { name: string; tokens: number; color: string; kind: 'used' | 'free' | 'buffer' | 'deferred' }[]
}

declare module 'claude-code' {
  interface PluginState {
    'session-pane': {
      inventory: Shaped<Inventory | null>
      context: Shaped<ContextUsage | null>
      // The titles of the sections that show only their header (Context: its bar too)
      collapsed: string[]
    }
  }
}
