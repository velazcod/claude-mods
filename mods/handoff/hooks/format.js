// Pure logic for handoff. No mods API calls, so tests can import it directly.

// The proposal shows at the configured token count, or at this part of the window if that is lower
export const WINDOW_FRACTION = 0.8
// After Hide or Close, the proposal shows again when the context grows by this much
export const SNOOZE_TOKENS = 50_000
// The longest prompt the Desktop app takes in a claude://code/new link
export const DEEP_LINK_PROMPT_MAX = 14_336

export const COLORS = {
  done: '#3d8b5f',
  active: '#d97757',
  failed: '#c8553d',
  waiting: '#9ca2af',
}

export const STEPS = [
  'Reading the conversation',
  'Finding the files you used',
  'Listing skills, tools and links',
  'Writing the handoff',
  'Saving and checking',
]

// The token count at which to propose a handoff
export function proposalLimit(thresholdTokens, window) {
  return Math.min(thresholdTokens, Math.floor(window * WINDOW_FRACTION))
}

// Show the proposal: the context is over the limit, and has grown past the snooze since Hide or Close
export function shouldPropose(context, thresholdTokens, snoozedAt) {
  if (!context) return false
  if (context.tokens < proposalLimit(thresholdTokens, context.window)) return false
  return snoozedAt === null || context.tokens >= snoozedAt + SNOOZE_TOKENS
}

// Token count as "214k"
export function formatTokens(n) {
  return n >= 1000 ? Math.round(n / 1000) + 'k' : String(n)
}

const FILE_ACTIONS = { Read: 'read', Edit: 'edited', MultiEdit: 'edited', Write: 'written', NotebookEdit: 'edited' }
const URL_PATTERN = /https?:\/\/[^\s<>()[\]{}"'`]+/g

function plural(n, word) {
  return n + ' ' + word + (n === 1 ? '' : 's')
}

// The files, skills, tools and links of a transcript ($.session.messages() rows)
export function collectRefs(messages) {
  const files = new Map()
  const skills = new Set()
  const tools = new Map()
  const links = new Set()
  for (const message of messages) {
    for (const use of message.toolUses ?? []) {
      tools.set(use.tool, (tools.get(use.tool) ?? 0) + 1)
      const input = use.input ?? {}
      const path = input.file_path ?? input.notebook_path
      if (typeof path === 'string') {
        if (!files.has(path)) files.set(path, new Set())
        files.get(path).add(FILE_ACTIONS[use.tool] ?? 'used')
      }
      if (use.tool === 'Skill' && typeof input.skill === 'string') skills.add(input.skill)
      if (typeof input.url === 'string') links.add(input.url)
    }
    for (const url of message.text.match(URL_PATTERN) ?? []) links.add(url.replace(/[.,;:!?*]+$/, ''))
  }
  return {
    files: [...files].map(([path, actions]) => ({ path, actions: [...actions] })),
    skills: [...skills],
    tools: [...tools].map(([name, count]) => ({ name, count })),
    links: [...links],
  }
}

// The detail text of steps 2 and 3
export function filesDetail(refs) {
  return plural(refs.files.length, 'file')
}

export function refsDetail(refs) {
  return plural(refs.skills.length, 'skill') + ', ' + plural(refs.links.length, 'link')
}

// The question the forked model answers over the whole conversation
export function forkPrompt(refs) {
  const files = refs.files.map((f) => '- ' + f.path + ' (' + f.actions.join(', ') + ')')
  return [
    'Write a handoff so that a new Claude Code session can continue this work. The new session cannot see this conversation.',
    'Write it in Markdown, to the next session as "you". The first line is "# " and a title of 3 to 6 words for the work. Then these sections:',
    '## Goal: what the user wants, in their words where it matters.',
    '## Current state: what is done, what works, and what was verified and how.',
    '## Decisions and constraints: the choices made and why, the preferences of the user, and what to avoid.',
    '## Next steps: the open work in order, each step concrete.',
    '## Open questions: what is not decided or needs the user.',
    '## Key files: the files that matter most, each with one line about its role.',
    'Be specific: names, paths, commands and values. Do not invent facts. Use fewer than 1200 words. Reply with the handoff only.',
    '',
    'Files used in this session:',
    ...(files.length ? files : ['- none']),
    'Skills used: ' + (refs.skills.join(', ') || 'none'),
  ].join('\n')
}

// The title and the body of the model's reply; the title line is removed from the body
export function splitTitle(reply) {
  const text = reply.trim()
  const match = text.match(/^#\s+(.+)\n?/)
  if (!match) return { title: 'Handoff', body: text }
  return { title: match[1].trim(), body: text.slice(match[0].length).trim() }
}

export function slugify(title) {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50)
    .replace(/-+$/, '')
  return slug || 'handoff'
}

// The saved file: the title, where it came from, the model's body, and the lists the mod collected
export function composeHandoff({ title, body, refs, root, sessionId, createdAt }) {
  const lines = [
    '# ' + title,
    '',
    '> Handoff from Claude Code session ' + sessionId + ', created ' + createdAt + ' in `' + root + '`.',
    '> Continue the work it describes. Read the key files before you change them.',
    '',
    body,
    '',
    '## Reference',
  ]
  const section = (heading, items) => {
    if (items.length) lines.push('', '### ' + heading + ' (' + items.length + ')', ...items)
  }
  section('Files used', refs.files.map((f) => '- `' + f.path + '`: ' + f.actions.join(', ')))
  section('Skills', refs.skills.map((s) => '- ' + s))
  section('Tools', refs.tools.map((t) => '- ' + t.name + ' (' + t.count + ')'))
  section('Links', refs.links.map((l) => '- ' + l))
  return lines.join('\n') + '\n'
}

export function countWords(text) {
  return text.split(/\s+/).filter(Boolean).length
}

// A path with the home folder as "~"
export function tildePath(path, home) {
  return home && path.startsWith(home + '/') ? '~' + path.slice(home.length) : path
}

// The Desktop app's link that opens a new Code session in the folder, with the handoff as its prompt.
// A handoff too long for the link is named by its path instead.
export function newSessionLink(text, path, folder) {
  const prompt = text.length <= DEEP_LINK_PROMPT_MAX ? text : 'Read the handoff in ' + path + ', then continue the work it describes.'
  return 'claude://code/new?q=' + encodeURIComponent(prompt) + '&folder=' + encodeURIComponent(folder)
}

// The AppleScript that opens a Terminal window and starts `claude` in the folder with the handoff as its prompt
export function terminalScript(path, folder) {
  const quote = (s) => "'" + s.replace(/'/g, "'\\''") + "'"
  const command = 'cd ' + quote(folder) + ' && claude "$(cat ' + quote(path) + ')"'
  return 'tell application "Terminal" to do script "' + command.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"'
}

// The five step rows of a run: state, detail, and the part of the bar to fill.
// The bar of the running step grows with its time, up to 90% after one minute.
export function stepRows(run, now) {
  return STEPS.map((label, i) => {
    if (i < run.step) return { label, state: 'done', detail: run.details[i], fraction: 1 }
    if (i === run.step && run.status === 'running') {
      const fraction = Math.min(0.9, 0.15 + (now - run.stepStartedAt) / 60_000)
      return { label, state: 'active', detail: '', fraction }
    }
    if (i === run.step && run.status === 'failed') return { label, state: 'failed', detail: '', fraction: 0 }
    return { label, state: 'waiting', detail: '', fraction: 0 }
  })
}

export const STEP_ICONS = { done: '✓', active: '◐', failed: '✕', waiting: '○' }

export const BAR_WIDTH = 160

// A hex color as rgb(), because a "#" in the markup ends the data URL an image is drawn from
export function svgColor(hex) {
  const n = parseInt(hex.slice(1), 16)
  return 'rgb(' + (n >> 16) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ')'
}

// A step's bar on a faint track
export function barSvg(fraction, color) {
  const filled = fraction > 0 ? Math.max(4, Math.round(fraction * BAR_WIDTH)) : 0
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" width="' + BAR_WIDTH + '" height="3" viewBox="0 0 ' + BAR_WIDTH + ' 3">' +
    '<rect width="' + BAR_WIDTH + '" height="3" rx="1.5" fill="' + svgColor(COLORS.waiting) + '" fill-opacity="0.3"/>' +
    (filled ? '<rect width="' + filled + '" height="3" rx="1.5" fill="' + svgColor(color) + '"/>' : '') +
    '</svg>'
  )
}

// A step's bar in text, for the terminal
export function barText(fraction, width = 16) {
  const filled = Math.round(fraction * width)
  return '━'.repeat(filled) + '─'.repeat(width - filled)
}
