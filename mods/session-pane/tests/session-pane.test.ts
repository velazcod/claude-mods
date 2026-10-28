import { expect, test } from 'claude-code/testing'
import { applyToolUse, barSegments, connectorLook, contextOf, emptyInventory, formatTokens, inventoryFromMessages, shareLabel, splitPath } from '../hooks/format.js'

const BREAKDOWN = {
  categories: [
    { name: 'MCP tools (deferred)', tokens: 370_200, color: 'inactive', isDeferred: true, kind: 'deferred' },
    { name: 'System prompt', tokens: 8_900, color: 'inactive', isDeferred: false, kind: 'used' },
    { name: 'Free space', tokens: 754_300, color: 'inactive', isDeferred: false, kind: 'free' },
    { name: 'Messages', tokens: 155_700, color: 'promptBorder', isDeferred: false, kind: 'used' },
    { name: 'System tools (deferred)', tokens: 25_000, color: 'inactive', isDeferred: true, kind: 'deferred' },
    { name: 'System tools', tokens: 17_800, color: 'permission', isDeferred: false, kind: 'used' },
    { name: 'Autocompact buffer', tokens: 33_000, color: 'inactive', isDeferred: false, kind: 'buffer' },
  ],
  totalTokens: 212_500,
  maxTokens: 1_000_000,
  rawMaxTokens: 1_000_000,
  percentage: 21,
}

const HOME = '/Users/me'

const MESSAGES = [
  { role: 'user', text: '# Prep for the Brightline call\nUse the calendar first.', toolUses: [] },
  {
    role: 'assistant',
    text: 'Planning.',
    toolUses: [
      {
        tool_use_id: '1',
        tool: 'mcp__ccd_turn__update_plan',
        input: {
          items: [
            { content: 'Find the call in Google Calendar', status: 'in_progress' },
            { content: 'Read past calls in Fireflies', status: 'pending' },
            { content: 'Write the one-page brief', status: 'pending' },
          ],
        },
      },
      { tool_use_id: '2', tool: 'mcp__34f969f8-ebbb-4599-86c9-502ba0eccc53__list_events', input: {} },
      { tool_use_id: '3', tool: 'mcp__ccd_turn__update_plan', input: { advance: true } },
      { tool_use_id: '4', tool: 'mcp__fireflies__get_transcript', input: {} },
      { tool_use_id: '5', tool: 'mcp__fireflies__get_transcript', input: {} },
      { tool_use_id: '6', tool: 'Skill', input: { skill: 'call-prep' } },
      { tool_use_id: '7', tool: 'Read', input: { file_path: HOME + '/notes/brightline.md' } },
      { tool_use_id: '8', tool: 'Write', input: { file_path: HOME + '/briefs/brightline.md' } },
      { tool_use_id: '9', tool: 'Edit', input: { file_path: HOME + '/notes/brightline.md' } },
    ],
  },
]

// What Claude Code passes to a ui.render hook for one of the mod's panes
function pane(requestId: string, surface: 'desktop' | 'terminal') {
  return {
    plugin: 'session-pane',
    component: 'Pane',
    requestId,
    surface,
    props: { title: requestId, isFocused: false, bodyColumns: 40, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
  } as const
}

function stubSession(on, messages: object[] = MESSAGES) {
  const opened: string[] = []
  const runs: string[][] = []
  on('process.run', (_, e) => (runs.push([...e.argv]), { value: { exitCode: 0, stdout: '', stderr: '' } }))
  on('session.messages', () => ({ value: messages }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.root', () => ({ value: HOME + '/work' }))
  on('env.get', (_, e) => ({ value: e.name === 'HOME' ? HOME : undefined }))
  on('command.register', () => ({ value: { command: 'session-pane' } }))
  on('ui.open', (_, e) => (opened.push(e.title), { value: { isPlaced: true } }))
  const shown: string[] = []
  on('tool.call', (_, e) => {
    if (e.tool === 'mcp__ccd_view__show_pane') {
      if (!e.path.startsWith('/work/')) return { result: 'outside the session folders', isError: true }
      shown.push(e.path)
    }
    return { result: e.tool === 'Write' ? { type: 'create', filePath: e.file_path } : {} }
  })
  on('skill.prompt', (_, e) => ({ text: e.text }))
  on('ui.toast', () => ({ value: undefined }))
  on('session.usage', (_, e) => ({
    value: { startedAt: 0, rateLimits: [], context: { tokens: 212_500, window: 1_000_000, ...(e.breakdown ? { breakdown: BREAKDOWN } : {}) } },
  }))
  on('classic.InstructionsLoaded', () => ({}))
  return { opened, runs, shown }
}

// The chevron after each section title, by title: 'open' or 'collapsed'
const SECTIONS = ['To-do', 'Context', 'Connectors', 'Skills', 'Context files', 'Files created/edited']
async function chevrons($, surface: 'desktop' | 'terminal') {
  const ui = await $.ui.mount(pane('session-pane', surface))
  const marks = {}
  for (const title of SECTIONS) {
    const label = (await ui.find({ type: 'Button', key: 'chevron-' + title }))?.props.label
    marks[title] = label === '▸' ? 'collapsed' : label === '▾' ? 'open' : undefined
  }
  await ui.unmount()
  return marks
}

async function texts($, requestId: string, surface: 'desktop' | 'terminal') {
  const ui = await $.ui.mount(pane(requestId, surface))
  const all = (await ui.findAll({ type: 'Text' })).map((t) => t.text)
  // File names are buttons
  all.push(...(await ui.findAll({ type: 'Button' })).map((b) => b.props.label))
  await ui.unmount()
  return all
}

test('reads the to-do list, connectors, skills and files from a transcript', () => {
  const inv = inventoryFromMessages(MESSAGES)
  expect(inv.todos.map((t) => t.status)).toEqual(['completed', 'in_progress', 'pending'])
  expect(inv.connectors).toEqual([
    { server: '34f969f8-ebbb-4599-86c9-502ba0eccc53', calls: 1, tools: ['list_events'] },
    { server: 'fireflies', calls: 2, tools: ['get_transcript'] },
  ])
  expect(inv.skills).toEqual([{ name: 'call-prep', uses: 1 }])
  expect(inv.filesRead).toEqual([{ path: HOME + '/notes/brightline.md', reads: 1 }])
  expect(inv.filesMade).toEqual([
    { path: HOME + '/briefs/brightline.md', action: 'created', edits: 1 },
    { path: HOME + '/notes/brightline.md', action: 'modified', edits: 1 },
  ])
})

test('names connectors, also a desktop connector with a UUID name', () => {
  expect(connectorLook('34f969f8-ebbb-4599-86c9-502ba0eccc53', ['list_events']).label).toBe('Google Calendar')
  expect(connectorLook('claude_ai_Gmail', []).label).toBe('Gmail')
  expect(connectorLook('1a59c906-04da-521d-bda7-7f71b9f9e01c', ['batch']).label).toBe('Connector 1a59c906')
  expect(connectorLook('my_server', []).label).toBe('my server')
})

test('wrap_up checks off the whole task list', () => {
  let inv = applyToolUse(emptyInventory(), {
    tool: 'mcp__ccd_turn__update_plan',
    input: { items: [{ content: 'A', status: 'in_progress' }, { content: 'B', status: 'pending' }, { content: 'C', status: 'pending' }] },
  })
  inv = applyToolUse(inv, { tool: 'mcp__ccd_turn__wrap_up', input: { recap: 'done' } })
  expect(inv.todos.map((t) => t.status)).toEqual(['completed', 'completed', 'completed'])
})

test('paths show relative to the project, else under ~', () => {
  expect(splitPath(HOME + '/work/mods/a/hooks/x.js', HOME, HOME + '/work')).toEqual({ name: 'x.js', folder: 'mods/a/hooks' })
  expect(splitPath(HOME + '/work/README.md', HOME, HOME + '/work')).toEqual({ name: 'README.md', folder: '' })
  expect(splitPath(HOME + '/notes/n.md', HOME, HOME + '/work')).toEqual({ name: 'n.md', folder: '~/notes' })
})

test('tracks tasks and todo lists', () => {
  let inv = applyToolUse(emptyInventory(), { tool: 'TaskCreate', input: { subject: 'A' } }, { task: { id: '1', subject: 'A' } })
  inv = applyToolUse(inv, { tool: 'TaskCreate', input: { subject: 'B' } }, { task: { id: '2', subject: 'B' } })
  inv = applyToolUse(inv, { tool: 'TaskUpdate', input: { taskId: '1', status: 'completed' } })
  inv = applyToolUse(inv, { tool: 'TaskUpdate', input: { taskId: '2', status: 'deleted' } })
  expect(inv.todos).toEqual([{ id: '1', content: 'A', status: 'completed' }])

  inv = applyToolUse(inv, { tool: 'TodoWrite', input: { todos: [{ content: 'X', status: 'pending', activeForm: 'Xing' }] } })
  expect(inv.todos).toEqual([{ id: '1', content: 'X', status: 'pending' }])

  inv = applyToolUse(inv, { tool: 'mcp__ccd_turn__update_plan', input: { items: [{ content: 'P', status: 'pending' }, { content: 'Q', status: 'pending' }] } })
  inv = applyToolUse(inv, { tool: 'mcp__ccd_turn__update_plan', input: { done: [1], start: 2 } })
  expect(inv.todos.map((t) => t.status)).toEqual(['completed', 'in_progress'])
})

test('formats the context breakdown as the session pane does', () => {
  expect([155_700, 33_000, 1_000_000, 709, 212_500].map(formatTokens)).toEqual(['155.7k', '33k', '1M', '709', '212.5k'])
  const ctx = contextOf(BREAKDOWN)
  // The order and colors of the session pane of the Desktop app
  expect(ctx.categories.map((c) => c.name)).toEqual([
    'Messages',
    'System tools',
    'System prompt',
    'Autocompact buffer',
    'Free space',
    'MCP tools (deferred)',
    'System tools (deferred)',
  ])
  expect(ctx.categories.slice(0, 3).map((c) => c.color)).toEqual(['#4f7ff0', '#e2703a', '#a3a3a3'])
  expect(shareLabel(ctx.categories[0], ctx.maxTokens)).toBe('15.6%')
  expect(shareLabel(ctx.categories[5], ctx.maxTokens)).toBe('—')
  expect(barSegments(ctx).map((s) => s.name)).toEqual(['Messages', 'System tools', 'System prompt'])
})

for (const surface of ['desktop', 'terminal'] as const) {
  test(`${surface}: the panes show the transcript and then live events`, async ($, on) => {
    const { opened } = stubSession(on)
    await $.session.start({ cwd: '/work', surface, isInteractive: true })
    expect(opened).toEqual(surface === 'terminal' ? [] : ['Session Pane'])

    let shown = await texts($, 'session-pane', surface)
    expect(shown).not.toContain('Prep for the Brightline call')
    expect(shown).toContain('1 of 3')
    expect(shown).toContain('Google Calendar')
    expect(shown).toContain('2 calls')
    expect(shown).toContain('call-prep')
    expect(shown).toContain('21% used')
    expect(shown).toContain('212.5k / 1M')
    expect(shown).toContain('15.6%')

    await $.tool.call({ tool: 'mcp__fireflies__get_transcript' })
    await $.skill.prompt({ skill: 'commit', text: 'x' })
    await $.classic.InstructionsLoaded({ file_path: HOME + '/work/CLAUDE.md', memory_type: 'Project', load_reason: 'session_start' })
    shown = await texts($, 'session-pane', surface)
    expect(shown).toContain('3 calls')
    expect(shown).toContain('commit')
    expect(shown).toContain('CLAUDE.md')
    // A file in the project shows no folder; one outside it shows its folder under ~
    expect(shown).not.toContain('~/work')

    await $.tool.call({ tool: 'Write', file_path: HOME + '/out/new.md', content: 'x' })
    const made = await texts($, 'session-pane', surface)
    expect(made).toContain('new.md')
    expect(made).not.toContain('2 new, 1 edited')
    expect(made).toContain('3')
  })
}

for (const surface of ['desktop', 'terminal'] as const) {
  test(`${surface}: pressing a context file or a made file outside the session folders opens it in its app`, async ($, on) => {
    const { runs } = stubSession(on)
    await $.session.start({ cwd: '/work', surface, isInteractive: true })
    await $.classic.InstructionsLoaded({ file_path: HOME + '/work/CLAUDE.md', memory_type: 'Project', load_reason: 'session_start' })

    let ui = await $.ui.mount(pane('session-pane', surface))
    await ui.press({ key: 'open-context-' + HOME + '/work/CLAUDE.md' })
    await ui.press({ key: 'open-read-' + HOME + '/notes/brightline.md' })
    await ui.unmount()

    ui = await $.ui.mount(pane('session-pane', surface))
    await ui.press({ key: 'open-made-' + HOME + '/briefs/brightline.md' })
    await ui.unmount()

    expect(runs).toEqual([
      ['open', HOME + '/work/CLAUDE.md'],
      ['open', HOME + '/notes/brightline.md'],
      ['open', HOME + '/briefs/brightline.md'],
    ])
  })
}

test('desktop: a file in the session folders opens in the Files pane, another in its app', async ($, on) => {
  const { runs, shown } = stubSession(on, [
    { role: 'assistant', text: '', toolUses: [{ tool_use_id: '1', tool: 'Read', input: { file_path: '/work/a.md' } }, { tool_use_id: '2', tool: 'Read', input: { file_path: '/elsewhere/b.md' } }] },
  ])
  await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount(pane('session-pane', 'desktop'))
  await ui.press({ key: 'open-read-/work/a.md' })
  await ui.press({ key: 'open-read-/elsewhere/b.md' })
  await ui.unmount()
  expect(shown).toEqual(['/work/a.md'])
  expect(runs).toEqual([['open', '/elsewhere/b.md']])
})

for (const surface of ['desktop', 'terminal'] as const) {
  test(`${surface}: the Context toggle hides the rows and keeps the bar`, async ($, on) => {
    stubSession(on)
    await $.session.start({ cwd: '/work', surface, isInteractive: true })
    expect(await texts($, 'session-pane', surface)).toContain('Messages')

    let ui = await $.ui.mount(pane('session-pane', surface))
    await ui.press({ key: 'toggle-Context' })
    await ui.unmount()
    let shown = await texts($, 'session-pane', surface)
    expect((await chevrons($, surface))['Context']).toBe('collapsed')
    expect(shown).toContain('21% used')
    expect(shown).not.toContain('Messages')

    ui = await $.ui.mount(pane('session-pane', surface))
    await ui.press({ key: 'toggle-Context' })
    await ui.unmount()
    shown = await texts($, 'session-pane', surface)
    expect((await chevrons($, surface))['Context']).toBe('open')
    expect(shown).toContain('Messages')
  })
}

for (const surface of ['desktop', 'terminal'] as const) {
  test(`${surface}: every section collapses to its header`, async ($, on) => {
    stubSession(on)
    await $.session.start({ cwd: '/work', surface, isInteractive: true })
    const ui = await $.ui.mount(pane('session-pane', surface))
    for (const title of ['To-do', 'Connectors', 'Skills', 'Context files', 'Files created/edited']) await ui.press({ key: 'toggle-' + title })
    await ui.unmount()
    const shown = await texts($, 'session-pane', surface)
    const marks = await chevrons($, surface)
    for (const title of ['To-do', 'Connectors', 'Skills', 'Context files', 'Files created/edited']) expect(marks[title]).toBe('collapsed')
    expect(marks['Context']).toBe('open')
    expect(shown).toContain('1 of 3')
    for (const hidden of ['Google Calendar', 'call-prep', 'brightline.md', 'Files read']) expect(shown).not.toContain(hidden)
  })
}

test('the sections come in order, the files the session made among them', async ($, on) => {
  stubSession(on)
  await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: true })
  const shown = await texts($, 'session-pane', 'desktop')
  const order = ['To-do', 'Context', 'Connectors', 'Skills', 'Context files', 'Files created/edited'].map((t) => shown.indexOf(t))
  expect(order.every((i) => i >= 0)).toBe(true)
  expect([...order].sort((a, b) => a - b)).toEqual(order)
})

test('/session-pane opens the pane, and an empty session shows None yet', async ($, on) => {
  const { opened } = stubSession(on, [])
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  expect((await $.command.run({ command: 'session-pane', args: '' })).text).toBe('Opened the Session Pane.')
  expect(opened).toEqual(['Session Pane'])
  expect(await texts($, 'session-pane', 'desktop')).toContain('None yet.')
})
