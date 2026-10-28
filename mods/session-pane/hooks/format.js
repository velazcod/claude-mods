// The inventory logic. This file has no $ calls, so tests can import it.

export const COLORS = {
  done: '#3d8b5f',
  active: '#d97757',
  waiting: '#9ca2af',
}

export const TODO_ICONS = { completed: '✓', in_progress: '◉', pending: '○' }

export function emptyInventory() {
  return { todos: [], connectors: [], skills: [], contextFiles: [], filesRead: [], filesMade: [] }
}

// The server part of mcp__<server>__<tool>. Null for a built-in tool and for the desktop app's own tools.
export function splitMcpTool(tool) {
  const match = /^mcp__(.+?)__(.+)$/.exec(tool)
  if (!match || match[1].startsWith('ccd_')) return null
  return { server: match[1], name: match[2] }
}

// Known services: a word in the server name, the name to show, and a logo color
const BRANDS = [
  ['gmail', 'Gmail', '#ea4335'],
  ['calendar', 'Google Calendar', '#4285f4'],
  ['drive', 'Google Drive', '#0f9d58'],
  ['slack', 'Slack', '#4a154b'],
  ['github', 'GitHub', '#24292f'],
  ['notion', 'Notion', '#191919'],
  ['linear', 'Linear', '#5e6ad2'],
  ['attio', 'Attio', '#1f2937'],
  ['fireflies', 'Fireflies', '#e1306c'],
  ['figma', 'Figma', '#a259ff'],
  ['atlassian', 'Atlassian', '#0052cc'],
  ['jira', 'Jira', '#0052cc'],
  ['hubspot', 'HubSpot', '#ff7a59'],
  ['salesforce', 'Salesforce', '#00a1e0'],
  ['context7', 'Context7', '#059669'],
  ['exa', 'Exa', '#1e40af'],
  ['cloudflare', 'Cloudflare', '#f38020'],
  ['render', 'Render', '#6d28d9'],
  ['chrome', 'Chrome', '#1a73e8'],
  ['computer-use', 'Computer use', '#d97757'],
]

// Desktop connectors have a UUID as the server name. These tool names identify the service.
const TOOL_SIGNATURES = [
  [['list_events', 'create_event', 'suggest_time', 'list_calendars'], 'calendar'],
  [['search_threads', 'get_thread', 'create_draft', 'list_labels'], 'gmail'],
  [['search_files', 'read_file_content', 'list_recent_files', 'get_file_metadata'], 'drive'],
]

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const FALLBACK_COLORS = ['#d97757', '#3b82f6', '#10b981', '#8b5cf6', '#f59e0b', '#ec4899']

// The name, logo letter and logo color of a connector
export function connectorLook(server, toolNames) {
  let key = server.toLowerCase()
  if (UUID.test(server)) {
    const signature = TOOL_SIGNATURES.find(([names]) => toolNames.some((n) => names.includes(n)))
    if (signature) key = signature[1]
  }
  const brand = BRANDS.find(([word]) => key.includes(word))
  if (brand) return { label: brand[1], letter: brand[1][0], color: brand[2] }
  const label = UUID.test(server) ? 'Connector ' + server.slice(0, 8) : server.replace(/^claude_ai_/, '').replace(/_/g, ' ')
  const hash = [...server].reduce((sum, c) => sum + c.charCodeAt(0), 0)
  return { label, letter: label[0].toUpperCase(), color: FALLBACK_COLORS[hash % FALLBACK_COLORS.length] }
}

// A hex color as rgb(), because a "#" in the markup ends the data URL that an image is drawn from
function svgColor(hex) {
  const n = parseInt(hex.slice(1), 16)
  return 'rgb(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ')'
}

export const LOGO_SIZE = 22

export function logoSvg({ letter, color }) {
  const s = LOGO_SIZE
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" width="' + s + '" height="' + s + '" viewBox="0 0 ' + s + ' ' + s + '">' +
    '<rect width="' + s + '" height="' + s + '" rx="5" fill="' + svgColor(color) + '"/>' +
    '<text x="50%" y="50%" dy="0.35em" text-anchor="middle" font-family="-apple-system,Helvetica,Arial,sans-serif" ' +
    'font-size="12" font-weight="600" fill="white">' + letter.replace(/[<>&"]/g, '') + '</text></svg>'
  )
}

function upsert(list, match, create, change) {
  const i = list.findIndex(match)
  if (i === -1) return [...list, change(create())]
  return list.map((item, j) => (j === i ? change(item) : item))
}

function applyConnector(inv, server, name) {
  const connectors = upsert(
    inv.connectors,
    (c) => c.server === server,
    () => ({ server, calls: 0, tools: [] }),
    (c) => ({ ...c, calls: c.calls + 1, tools: c.tools.includes(name) ? c.tools : [...c.tools, name] }),
  )
  return { ...inv, connectors }
}

export function applySkill(inv, name) {
  const skills = upsert(inv.skills, (s) => s.name === name, () => ({ name, uses: 0 }), (s) => ({ ...s, uses: s.uses + 1 }))
  return { ...inv, skills }
}

export function applyInstruction(inv, path) {
  if (inv.contextFiles.some((f) => f.path === path)) return inv
  return { ...inv, contextFiles: [...inv.contextFiles, { path }] }
}

function applyRead(inv, path) {
  const filesRead = upsert(inv.filesRead, (f) => f.path === path, () => ({ path, reads: 0 }), (f) => ({ ...f, reads: f.reads + 1 }))
  return { ...inv, filesRead }
}

// isCreated: true for a new file, false for a changed one, null when not known
function applyMade(inv, path, isCreated) {
  const filesMade = upsert(
    inv.filesMade,
    (f) => f.path === path,
    () => ({ path, action: isCreated ? 'created' : 'modified', edits: 0 }),
    (f) => ({ ...f, edits: f.edits + 1 }),
  )
  return { ...inv, filesMade }
}

function applyPlan(todos, input) {
  if (Array.isArray(input.items)) {
    return input.items.map((item, i) => ({ id: String(i + 1), content: String(item.content), status: item.status }))
  }
  let next = todos
  const done = new Set(input.done ?? [])
  if (input.advance) {
    const current = next.findIndex((t) => t.status === 'in_progress')
    if (current !== -1) done.add(current + 1)
  }
  next = next.map((t, i) => (done.has(i + 1) ? { ...t, status: 'completed' } : t))
  let start = input.start
  if (input.advance && start === undefined) {
    const pending = next.findIndex((t) => t.status === 'pending')
    if (pending !== -1) start = pending + 1
  }
  if (start !== undefined) next = next.map((t, i) => (i + 1 === start ? { ...t, status: 'in_progress' } : t))
  return next
}

// One tool call. `result` is the tool's output when known.
export function applyToolUse(inv, use, result) {
  const input = use.input ?? {}
  switch (use.tool) {
    case 'TodoWrite':
      return { ...inv, todos: (input.todos ?? []).map((t, i) => ({ id: String(i + 1), content: t.content, status: t.status })) }
    case 'TaskCreate': {
      const id = result?.task?.id ?? String(inv.todos.length + 1)
      return { ...inv, todos: [...inv.todos, { id, content: input.subject, status: 'pending' }] }
    }
    case 'TaskUpdate': {
      if (input.status === 'deleted') return { ...inv, todos: inv.todos.filter((t) => t.id !== input.taskId) }
      const todos = inv.todos.map((t) =>
        t.id === input.taskId ? { ...t, content: input.subject ?? t.content, status: input.status ?? t.status } : t,
      )
      return { ...inv, todos }
    }
    case 'mcp__ccd_turn__update_plan':
      return { ...inv, todos: applyPlan(inv.todos, input) }
    // The desktop app's wrap_up checks off the whole task list
    case 'mcp__ccd_turn__wrap_up':
      return { ...inv, todos: inv.todos.map((t) => ({ ...t, status: 'completed' })) }
    case 'Read':
      return input.file_path ? applyRead(inv, input.file_path) : inv
    case 'Write': {
      if (!input.file_path) return inv
      const known = inv.filesRead.some((f) => f.path === input.file_path) || inv.filesMade.some((f) => f.path === input.file_path)
      return applyMade(inv, input.file_path, result?.type ? result.type === 'create' : !known)
    }
    case 'Edit':
      return input.file_path ? applyMade(inv, input.file_path, false) : inv
    case 'NotebookEdit':
      return input.notebook_path ? applyMade(inv, input.notebook_path, false) : inv
  }
  const mcp = splitMcpTool(use.tool)
  return mcp ? applyConnector(inv, mcp.server, mcp.name) : inv
}

// The inventory of a transcript: for a mod that loads in a running or resumed session
export function inventoryFromMessages(messages) {
  let inv = emptyInventory()
  for (const message of messages) {
    for (const use of message.toolUses ?? []) {
      inv = use.tool === 'Skill' && use.input?.skill ? applySkill(inv, use.input.skill) : applyToolUse(inv, use)
    }
  }
  return inv
}

export function tildePath(path, home) {
  return home && path.startsWith(home + '/') ? '~' + path.slice(home.length) : path
}

// The file name, and the folder that holds it: relative to the project root, else to the home folder
export function splitPath(path, home, root = '') {
  const short = root && path.startsWith(root + '/') ? path.slice(root.length + 1) : tildePath(path, home)
  const i = short.lastIndexOf('/')
  return i === -1 ? { name: short, folder: '' } : { name: short.slice(i + 1), folder: short.slice(0, i) || '/' }
}

export function countLabel(n, word) {
  return n + ' ' + word + (n === 1 ? '' : 's')
}

// 155700 → 155.7k, 33000 → 33k, 1000000 → 1M, 709 → 709
export function formatTokens(n) {
  const short = (value, unit) => (Math.round(value * 10) / 10).toString() + unit
  if (n >= 1_000_000) return short(n / 1_000_000, 'M')
  if (n >= 1_000) return short(n / 1_000, 'k')
  return String(Math.round(n))
}

// The colors of the session pane of the Desktop app. It colors four categories; the others are gray.
const CONTEXT_COLORS = {
  Messages: '#4f7ff0',
  'System tools': '#e2703a',
  Skills: '#3aa57a',
  'MCP tools': '#d9a13b',
}
const KIND_COLORS = { used: '#a3a3a3', buffer: '#6b6b6b', free: '#3d3d3d', deferred: '#5c5c5c' }
// The bar's empty part
export const BAR_TRACK = '#3d3d3d'

// The parts of a context breakdown that the pane draws, in the order of the session pane of the
// Desktop app: the used categories largest first, then the buffer, the free space, and the
// deferred tool schemas (not in the window) largest first.
export function contextOf(breakdown) {
  const KIND_ORDER = ['used', 'buffer', 'free', 'deferred']
  const categories = breakdown.categories
    .map(({ name, tokens, kind }) => ({ name, tokens, kind, color: (kind === 'used' && CONTEXT_COLORS[name]) || KIND_COLORS[kind] || KIND_COLORS.used }))
    .sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || b.tokens - a.tokens)
  return { percentage: breakdown.percentage, totalTokens: breakdown.totalTokens, maxTokens: breakdown.rawMaxTokens, categories }
}

// The share of the window, as "15.6%"; a dash for a row that is not in the window
export function shareLabel(category, maxTokens) {
  if (category.kind === 'deferred' || maxTokens <= 0) return '—'
  return (Math.round((category.tokens / maxTokens) * 1000) / 10).toFixed(1) + '%'
}

// The used categories as parts of a bar, each a percentage of the window
export function barSegments(context) {
  if (context.maxTokens <= 0) return []
  return context.categories
    .filter((c) => c.kind === 'used' && c.tokens > 0)
    .map((c) => ({ name: c.name, color: c.color, percent: (c.tokens / context.maxTokens) * 100 }))
}

export const BAR_HEIGHT = 6

// The bar as an SVG that stretches to the width of the pane
export function contextBarSvg(segments) {
  let x = 0
  const parts = segments.map((s) => {
    const rect = '<rect x="' + x.toFixed(2) + '" width="' + (s.percent * 10).toFixed(2) + '" height="' + BAR_HEIGHT + '" fill="' + svgColor(s.color) + '"/>'
    x += s.percent * 10
    return rect
  })
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="' + BAR_HEIGHT + '" viewBox="0 0 1000 ' + BAR_HEIGHT + '" preserveAspectRatio="none">' +
    '<rect width="1000" height="' + BAR_HEIGHT + '" fill="' + svgColor(BAR_TRACK) + '"/>' + parts.join('') + '</svg>'
  )
}
