import { atom, read, update } from 'claude-code'
import {
  BAR_HEIGHT,
  BAR_TRACK,
  COLORS,
  LOGO_SIZE,
  TODO_ICONS,
  applyInstruction,
  applySkill,
  applyToolUse,
  barSegments,
  connectorLook,
  contextBarSvg,
  contextOf,
  countLabel,
  emptyInventory,
  formatTokens,
  inventoryFromMessages,
  logoSvg,
  shareLabel,
  splitPath,
} from './format.js'

const PANE = 'session-pane'

// $.state survives a module reload. Null until the mod reads the transcript.
// Change the shape tag when the inventory's fields change.
const inventory = atom({ plugin: 'session-pane', key: 'inventory' }, null, { shape: 'inventory-1' })

// The context window by category, as the session pane of the Desktop app shows it. Null until read.
const context = atom({ plugin: 'session-pane', key: 'context' }, null, { shape: 'context-1' })

// The titles of the sections that show only their header (Context: its bar too)
const collapsed = atom({ plugin: 'session-pane', key: 'collapsed' }, [])

// One step smaller than the default, as the session pane of the Desktop app draws its text
const SIZE = 'footnote'
const SMALL = 'caption'
// The border of a section, as light as the session pane's
const BORDER = '#3a3a3a'

// A subagent's to-do list is not the session's
const TODO_TOOLS = ['TodoWrite', 'TaskCreate', 'TaskUpdate', 'mcp__ccd_turn__update_plan', 'mcp__ccd_turn__wrap_up']

async function rebuild($) {
  const messages = await $.session.messages()
  await update($, inventory, () => inventoryFromMessages(messages))
}

// 'summary' estimates locally and sends no token-count requests
async function readContext($) {
  const usage = await $.session.usage({ breakdown: 'summary' })
  const breakdown = usage.context.breakdown
  if (breakdown) await update($, context, () => contextOf(breakdown))
}

function change($, fn) {
  return update($, inventory, (inv) => fn(inv ?? emptyInventory()))
}

// In the Desktop app, shows a file in the app's Files pane. Elsewhere, or for a file outside
// the session's folders, opens it in its default app. A toast says if it did.
async function openFile($, path, surface) {
  if (surface === 'desktop') {
    const shown = await $.tool.call({ tool: 'mcp__ccd_view__show_pane', pane: 'file', path }).catch(() => null)
    if (shown && shown.deny === undefined && !shown.isError) return
  }
  const run = (argv) => $.process.run(argv).catch((error) => ({ exitCode: 1, stderr: String(error) }))
  let result = await run(['open', path])
  if (result.exitCode !== 0) result = await run(['xdg-open', path])
  const name = path.slice(path.lastIndexOf('/') + 1)
  $.ui.toast(result.exitCode === 0 ? 'Opened ' + name : 'Could not open ' + name + ': ' + result.stderr.trim())
}

function toggleSection($, title) {
  return update($, collapsed, (titles) => (titles.includes(title) ? titles.filter((t) => t !== title) : [...titles, title]))
}

function openPane($) {
  return $.ui.open({ id: PANE, title: 'Session Pane' })
}

// A card with a header that collapses it. `ui` holds the surface's elements, the collapsed
// titles, and `toggle(title)`. `keep` shows also when the card is collapsed.
function section(ui, title, count, children, keep = []) {
  const { Box, Button, Text } = ui
  const isCollapsed = ui.collapsed.includes(title)
  const toggle = Button({
    key: 'toggle-' + title,
    plain: true,
    label: (isCollapsed ? '▸ ' : '▾ ') + title,
    children: [Text({ size: SIZE, children: [(isCollapsed ? '▸ ' : '▾ ') + title] })],
    onPress: () => ui.toggle(title),
  })
  return Box({
    key: 'section-' + title,
    flexDirection: 'column',
    gap: 'xs',
    borderStyle: 'round',
    borderColor: BORDER,
    paddingX: 1,
    children: [
      Box({
        flexDirection: 'row',
        justifyContent: 'space-between',
        children: [toggle, Text({ size: SIZE, dimColor: true, children: [count] })],
      }),
      ...keep,
      ...(isCollapsed ? [] : children),
    ],
  })
}

function none(ui) {
  return ui.Text({ dimColor: true, size: SMALL, children: ['None yet.'] })
}

// A row with a main text, a dim line under it, and a dim value at the right
function row(ui, key, lead, title, subtitle, right) {
  const { Box, Text } = ui
  const main = Text({ size: SIZE, wrap: 'truncate-end', children: [title] })
  return Box({
    key,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 'sm',
    children: [
      ...(lead ? [lead] : []),
      Box({
        flexDirection: 'column',
        flexGrow: 1,
        flexShrink: 1,
        children: [main, ...(subtitle ? [Text({ dimColor: true, size: SMALL, mono: true, wrap: 'wrap', children: [subtitle] })] : [])],
      }),
      ...(right ? [Text({ dimColor: true, size: SMALL, children: [right] })] : []),
    ],
  })
}

// A file: an optional mark, then its name, its folder, and its status, one under the other.
// The name is a plain button that opens the file. A graphical surface draws a button's label
// a little in from its edge, so the folder and status lines move in by as much.
function fileRow(ui, key, mark, name, folder, status, onPress) {
  const { Box, Button, Text } = ui
  const inset = ui.surface === 'terminal' ? 0 : 'xs'
  const line = (text) => Box({ paddingLeft: inset, children: [text] })
  return Box({
    key,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 'sm',
    children: [
      ...(mark ? [mark] : []),
      Box({
        flexDirection: 'column',
        flexGrow: 1,
        flexShrink: 1,
        children: [
          Button({ key: 'open-' + key, plain: true, label: name, onPress }),
          ...(folder ? [line(Text({ dimColor: true, size: SMALL, mono: true, wrap: 'wrap', children: [folder] }))] : []),
          ...(status ? [line(Text({ dimColor: true, size: SMALL, children: [status] }))] : []),
        ],
      }),
    ],
  })
}

function todoSection(ui, inv) {
  const { Text } = ui
  const done = inv.todos.filter((t) => t.status === 'completed').length
  const rows = inv.todos.map((t) =>
    ui.Box({
      key: 'todo-' + t.id,
      flexDirection: 'row',
      gap: 'sm',
      children: [
        Text({ size: SIZE, color: t.status === 'completed' ? COLORS.done : t.status === 'in_progress' ? COLORS.active : COLORS.waiting, children: [TODO_ICONS[t.status] ?? '○'] }),
        Text({
          size: SIZE,
          wrap: 'wrap',
          strikethrough: t.status === 'completed',
          dimColor: t.status === 'completed',
          weight: t.status === 'in_progress' ? 'semibold' : 'regular',
          children: [t.content],
        }),
      ],
    }),
  )
  return section(ui, 'To-do', inv.todos.length ? done + ' of ' + inv.todos.length : '0', rows.length ? rows : [none(ui)])
}

function connectorSection(ui, inv, surface) {
  const rows = inv.connectors.map((c) => {
    const look = connectorLook(c.server, c.tools)
    const logo =
      surface === 'terminal'
        ? ui.Text({ size: SIZE, color: look.color, children: ['■'] })
        : ui.Svg({ source: logoSvg(look), alt: look.label, width: LOGO_SIZE, height: LOGO_SIZE })
    return row(ui, 'connector-' + c.server, logo, look.label, c.tools.join(', '), countLabel(c.calls, 'call'))
  })
  return section(ui, 'Connectors', String(inv.connectors.length), rows.length ? rows : [none(ui)])
}

function contextSection(ui, inv, places, open) {
  const { Text } = ui
  const auto = inv.contextFiles.map((f) => {
    const { name, folder } = splitPath(f.path, places.home, places.root)
    return fileRow(ui, 'context-' + f.path, null, name, folder, 'auto', (press) => open(f.path, press.surface))
  })
  const reads = inv.filesRead.map((f) => {
    const { name, folder } = splitPath(f.path, places.home, places.root)
    return fileRow(ui, 'read-' + f.path, null, name, folder, f.reads > 1 ? countLabel(f.reads, 'read') : '', (press) => open(f.path, press.surface))
  })
  return section(ui, 'Context files', String(inv.contextFiles.length + inv.filesRead.length), [
    ...auto,
    ui.Box({
      flexDirection: 'row',
      justifyContent: 'space-between',
      children: [Text({ size: SIZE, dimColor: true, children: ['Files read'] }), Text({ size: SIZE, dimColor: true, children: [String(inv.filesRead.length)] })],
    }),
    ...reads,
  ])
}

const BAR_CELLS = 30

function usageSection(ui, ctx, surface) {
  const { Box, Text } = ui
  if (!ctx) return section(ui, 'Context', '', [Text({ dimColor: true, size: SMALL, children: ['Not measured yet.'] })])

  const segments = barSegments(ctx)
  let bar
  if (surface === 'terminal') {
    const cells = segments.map((s) => Math.max(1, Math.round((s.percent / 100) * BAR_CELLS)))
    const used = cells.reduce((n, c) => n + c, 0)
    bar = Box({
      flexDirection: 'row',
      children: [
        ...segments.map((s, i) => Text({ size: SIZE, color: s.color, children: ['█'.repeat(cells[i])] })),
        Text({ size: SIZE, color: BAR_TRACK, children: ['█'.repeat(Math.max(0, BAR_CELLS - used))] }),
      ],
    })
  } else {
    bar = ui.Svg({ source: contextBarSvg(segments), alt: Math.round(ctx.percentage) + '% of the context window used', height: BAR_HEIGHT })
  }

  const summary = Box({
    flexDirection: 'row',
    justifyContent: 'space-between',
    children: [
      Text({ size: SIZE, children: [Math.round(ctx.percentage) + '% used'] }),
      Text({ size: SIZE, dimColor: true, tabular: true, children: [formatTokens(ctx.totalTokens) + ' / ' + formatTokens(ctx.maxTokens)] }),
    ],
  })

  const rows = ctx.categories.map((c) =>
    Box({
      key: 'context-' + c.name,
      flexDirection: 'row',
      gap: 'sm',
      children: [
        Text({ size: SIZE, color: c.color, children: ['■'] }),
        Box({ flexGrow: 1, flexShrink: 1, children: [Text({ size: SIZE, dimColor: true, wrap: 'truncate-end', children: [c.name] })] }),
        Text({ size: SIZE, dimColor: true, tabular: true, children: [formatTokens(c.tokens)] }),
        Text({ size: SIZE, tabular: true, children: [shareLabel(c, ctx.maxTokens)] }),
      ],
    }),
  )
  return section(ui, 'Context', '', rows, [summary, bar])
}

function madeSection(ui, inv, places, open) {
  const rows = inv.filesMade.map((f) => {
    const { name, folder } = splitPath(f.path, places.home, places.root)
    const badge = ui.Text({ size: SIZE, color: f.action === 'created' ? COLORS.done : COLORS.active, children: [f.action === 'created' ? '+' : '~'] })
    const right = (f.action === 'created' ? 'new' : 'edited') + (f.edits > 1 ? ', ' + countLabel(f.edits, 'change') : '')
    return fileRow(ui, 'made-' + f.path, badge, name, folder, right, (press) => open(f.path, press.surface))
  })
  return section(ui, 'Files created/edited', String(inv.filesMade.length), rows.length ? rows : [none(ui)])
}

function skillSection(ui, inv) {
  const rows = inv.skills.map((s) =>
    ui.Box({
      key: 'skill-' + s.name,
      flexDirection: 'row',
      justifyContent: 'space-between',
      children: [
        ui.Box({
          flexDirection: 'row',
          flexShrink: 1,
          children: [ui.Text({ size: SIZE, color: COLORS.active, children: ['/'] }), ui.Text({ size: SIZE, wrap: 'truncate-end', children: [s.name] })],
        }),
        ui.Text({ dimColor: true, size: SMALL, children: [countLabel(s.uses, 'use')] }),
      ],
    }),
  )
  return section(ui, 'Skills', String(inv.skills.length), rows.length ? rows : [none(ui)])
}

export function register(on) {
  on('session.start', async ($, e, next) => {
    void $.command.register({ name: 'session-pane', description: 'Show what this session used and made, in a side pane' })
    if ((await read($, inventory)) === null) await rebuild($)
    await readContext($).catch(() => {})
    // A pane opens unasked only where it docks beside the chat
    if (e.surface !== 'terminal') void openPane($)
    return next(e)
  })

  // /clear, /resume and /branch change the transcript, so read it again
  on('classic.SessionStart', { source: ['clear', 'resume', 'fork'] }, async ($, e, next) => {
    await rebuild($)
    return next(e)
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'session-pane' }, async ($) => {
    await openPane($)
    return { text: 'Opened the Session Pane.' }
  })

  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    if ('deny' in ran && ran.deny !== undefined) return ran
    if (ran.isError) return ran
    if (e.agentId && TODO_TOOLS.includes(e.tool)) return ran
    const { tool, tool_use_id, agentId, requestMeta, ...input } = e
    await change($, (inv) => applyToolUse(inv, { tool, input }, ran.result))
    return ran
  }).catch(($, e, next) => next(e))

  // The engine measures the session after each response: read the breakdown when the context moved
  on('session.measure', async ($, e, next) => {
    const result = await next(e)
    if (e.changed.includes('context')) await readContext($).catch(() => {})
    return result
  })

  // A skill typed as /name or run by the Skill tool
  on('skill.prompt', async ($, e, next) => {
    await change($, (inv) => applySkill(inv, e.skill))
    return next(e)
  })

  on('classic.InstructionsLoaded', async ($, e, next) => {
    await change($, (inv) => applyInstruction(inv, e.file_path))
    return next(e)
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const ui = { ...$.ui.resolve(e), surface: e.surface, collapsed: await read($, collapsed), toggle: (title) => toggleSection($, title) }
    const inv = (await read($, inventory)) ?? emptyInventory()
    const places = { home: (await $.env.get('HOME')) ?? '', root: await $.session.root() }
    return ui.Box({
      flexDirection: 'column',
      gap: 'sm',
      children: [
        todoSection(ui, inv),
        usageSection(ui, await read($, context), e.surface),
        connectorSection(ui, inv, e.surface),
        skillSection(ui, inv),
        contextSection(ui, inv, places, (path, surface) => openFile($, path, surface)),
        madeSection(ui, inv, places, (path, surface) => openFile($, path, surface)),
      ],
    })
  })
}
