import { expect, mock, test } from 'claude-code/testing'
import {
  collectRefs,
  composeHandoff,
  newSessionLink,
  proposalLimit,
  shouldPropose,
  slugify,
  splitTitle,
  stepRows,
  terminalScript,
} from '../hooks/format.js'

const NOW = 1_800_000_000_000
const HOME = '/Users/me'
const FOLDER = HOME + '/.claude/handoffs'
const PATH = FOLDER + '/2026-10-27-1432-ship-the-handoff-mod.md'

// What Claude Code passes to a ui.render hook for the band above the prompt
const BAND = {
  plugin: 'handoff',
  component: 'AbovePrompt',
  requestId: 'AbovePrompt',
  viewport: { columns: 120, rows: 40 },
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 115, scroll: { offset: 0, bodyRows: 9 }, view: {} },
} as const

const MESSAGES = [
  { role: 'user', text: 'Build the mod. Design: https://example.com/design.png.', toolUses: [] },
  {
    role: 'assistant',
    text: 'Reading the files.',
    toolUses: [
      { tool_use_id: '1', tool: 'Read', input: { file_path: '/work/a.js' } },
      { tool_use_id: '2', tool: 'Edit', input: { file_path: '/work/a.js' } },
      { tool_use_id: '3', tool: 'Write', input: { file_path: '/work/b.md' } },
      { tool_use_id: '4', tool: 'Skill', input: { skill: 'plugin-authoring' } },
      { tool_use_id: '5', tool: 'WebFetch', input: { url: 'https://docs.example.com/api' } },
      { tool_use_id: '6', tool: 'Read', input: { file_path: '/work/c.json' } },
    ],
  },
]

const REPLY = '# Ship the handoff mod\n\n## Goal\nShip it.\n\n## Next steps\n1. Test it.'
const USAGE = { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }

// Register the stubs every test needs: Claude Code's answers to the mod's calls
function stubSession(on, { tokens = 100_000, window = 1_000_000, fork = { isAnswered: true, text: REPLY, usage: USAGE } as object } = {}) {
  const clock = mock.clock(on, { now: NOW })
  const files = new Map<string, string>()
  const runs: string[][] = []
  const copies: string[] = []
  const fill = { tokens, window }
  on('session.id', () => ({ value: 'sess-1' }))
  on('session.root', () => ({ value: '/work' }))
  on('session.start', () => ({ cwd: '/work' }))
  on('session.messages', () => ({ value: MESSAGES }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { ...fill }, rateLimits: [] } }))
  on('env.get', ($, e) => ({ value: e.name === 'HOME' ? HOME : undefined }))
  on('command.register', () => ({ value: { command: 'handoff' } }))
  on('tool.register', () => ({ value: { tool: 'mcp__handoff__handoff' } }))
  on('model.fork', () => ({ value: fork }))
  on('fs.write', ($, e) => (files.set(e.path, e.text), { value: undefined }))
  on('fs.read', ($, e) => ({ value: files.get(e.path) }))
  on('process.run', ($, e) => {
    runs.push([...e.argv])
    return { value: { exitCode: 0, stdout: e.argv[0] === 'date' ? '2026-10-27-1432\n' : '', stderr: '' } }
  })
  on('ui.copy', ($, e) => (copies.push(e.text), { value: { isCopied: true } }))
  on('ui.toast', () => ({ value: undefined }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: 'ok' }))
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['drawn by Claude Code'] }))
  on('turn.step', async function* ($, e) {
    return { turnId: e.turnId, index: 0, answer: 'ok', toolUses: [], stopReason: 'end_turn', usage: { ...USAGE, model: 'claude-test' } }
  })
  const setTokens = (n: number) => {
    fill.tokens = n
  }
  return { clock, files, runs, copies, setTokens }
}

const start = ($) => $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/work' })

// One main-conversation request, so the mod reads the context fill
async function step($) {
  const stream = $.turn.step({ turnId: 't', index: 0, model: 'claude-test', messageCount: 1 })
  let next = await stream.next()
  while (next.done !== true) next = await stream.next()
}

// Draw the band once and read its texts
async function band($, surface: 'desktop' | 'terminal' = 'desktop') {
  const ui = await $.ui.mount({ ...BAND, surface })
  const texts = (await ui.findAll({ type: 'Text' })).map((t) => t.text)
  const buttons = (await ui.findAll({ type: 'Button' })).map((b) => b.props.label)
  await ui.unmount()
  return { texts, buttons }
}

async function press($, key: string, surface: 'desktop' | 'terminal' = 'desktop') {
  const ui = await $.ui.mount({ ...BAND, surface })
  await ui.press({ key })
  await ui.unmount()
}

test('collects files, skills, tools and links, and writes the handoff file', () => {
  const refs = collectRefs(MESSAGES)
  expect(refs.files).toEqual([
    { path: '/work/a.js', actions: ['read', 'edited'] },
    { path: '/work/b.md', actions: ['written'] },
    { path: '/work/c.json', actions: ['read'] },
  ])
  expect(refs.skills).toEqual(['plugin-authoring'])
  expect(refs.tools).toEqual([
    { name: 'Read', count: 2 },
    { name: 'Edit', count: 1 },
    { name: 'Write', count: 1 },
    { name: 'Skill', count: 1 },
    { name: 'WebFetch', count: 1 },
  ])
  expect(refs.links).toEqual(['https://example.com/design.png', 'https://docs.example.com/api'])

  expect(splitTitle(REPLY)).toEqual({ title: 'Ship the handoff mod', body: '## Goal\nShip it.\n\n## Next steps\n1. Test it.' })
  expect(splitTitle('No title')).toEqual({ title: 'Handoff', body: 'No title' })
  expect(slugify('Acme: Onboarding Pack!')).toBe('acme-onboarding-pack')
  expect(slugify('!!!')).toBe('handoff')

  const text = composeHandoff({ title: 'T', body: 'B', refs, root: '/work', sessionId: 's', createdAt: '2026-10-27 14:32' })
  expect(text).toContain('# T\n')
  expect(text).toContain('- `/work/a.js`: read, edited')
  expect(text).toContain('### Skills (1)\n- plugin-authoring')
  expect(text).toContain('- Read (2)')
  expect(text).toContain('### Links (2)')
})

test('the proposal limit is the threshold, or 80% of a smaller window, and Hide snoozes it by 50k', () => {
  expect(proposalLimit(400_000, 1_000_000)).toBe(400_000)
  expect(proposalLimit(400_000, 200_000)).toBe(160_000)
  expect(shouldPropose(null, 400_000, null)).toBe(false)
  expect(shouldPropose({ tokens: 399_999, window: 1_000_000 }, 400_000, null)).toBe(false)
  expect(shouldPropose({ tokens: 400_000, window: 1_000_000 }, 400_000, null)).toBe(true)
  expect(shouldPropose({ tokens: 449_999, window: 1_000_000 }, 400_000, 400_000)).toBe(false)
  expect(shouldPropose({ tokens: 450_000, window: 1_000_000 }, 400_000, 400_000)).toBe(true)
})

test('the new session link carries the prompt, or the path when the prompt is too long', () => {
  const link = newSessionLink('Do it & ship', '/h/x.md', '/work dir')
  expect(link).toBe('claude://code/new?q=Do%20it%20%26%20ship&folder=%2Fwork%20dir')
  expect(newSessionLink('x'.repeat(14_337), '/h/x.md', '/w')).toContain(encodeURIComponent('Read the handoff in /h/x.md'))
  expect(terminalScript("/h/it's.md", '/w')).toBe(
    'tell application "Terminal" to do script "cd \'/w\' && claude \\"$(cat \'/h/it\'\\\\\'\'s.md\')\\""',
  )
})

test('the step rows show done, running and waiting steps', () => {
  const rows = stepRows({ status: 'running', step: 3, details: ['186 messages', '14 files', '2 skills, 3 links'], stepStartedAt: 0 }, 30_000)
  expect(rows.map((r) => r.state)).toEqual(['done', 'done', 'done', 'active', 'waiting'])
  expect(Math.round(rows[3].fraction * 100)).toBe(65)
  expect(stepRows({ status: 'failed', step: 3, details: [], stepStartedAt: 0 }, 0)[3].state).toBe('failed')
})

for (const surface of ['desktop', 'terminal'] as const) {
  test(`${surface}: the band proposes a handoff at the threshold, and Hide snoozes it`, async ($, on) => {
    const { setTokens } = stubSession(on, { tokens: 399_000 })
    await start($)
    expect((await band($, surface)).buttons).toEqual([])

    setTokens(412_000)
    await step($)
    const shown = await band($, surface)
    expect(shown.texts).toContain('Context at 412k. Handoff moves this work to a new chat with everything it needs.')
    expect(shown.texts).toContain('drawn by Claude Code')
    expect(shown.buttons).toEqual(['Handoff', 'Hide'])

    await press($, 'hide', surface)
    expect((await band($, surface)).buttons).toEqual([])
    setTokens(462_000)
    await step($)
    expect((await band($, surface)).buttons).toEqual(['Handoff', 'Hide'])
  })
}

test('a 200k window proposes at 160k', async ($, on) => {
  stubSession(on, { tokens: 170_000, window: 200_000 })
  await start($)
  expect((await band($)).texts).toContain('Context at 170k. Handoff moves this work to a new chat with everything it needs.')
})

test('Handoff writes the handoff, shows each step, and saves the file', async ($, on) => {
  const { clock, files } = stubSession(on, { tokens: 412_000 })
  await start($)
  await press($, 'handoff')
  expect((await band($)).texts).toContain('Handing off: building your handoff')

  await clock.advance(1)
  const done = await band($)
  const text = files.get(PATH)
  expect(text).toContain('# Ship the handoff mod')
  expect(text).toContain('> Handoff from Claude Code session sess-1, created 2026-10-27 14:32 in `/work`.')
  expect(text).toContain('### Files used (3)')
  expect(done.texts).toContain('Handoff ready: ' + text!.split(/\s+/).filter(Boolean).length + ' words')
  expect(done.texts).toContain('2 messages')
  expect(done.texts).toContain('3 files')
  expect(done.texts).toContain('1 skill, 2 links')
  expect(done.texts).toContain('saved, checked')
  expect(done.texts).toContain('Saved to ~/.claude/handoffs/2026-10-27-1432-ship-the-handoff-mod.md')
  expect(done.buttons).toEqual(['Copy handoff prompt', 'Start new chat with it', 'Open file', 'Close'])
  // What other plugins draw in the band stays, first
  expect(done.texts[0]).toBe('drawn by Claude Code')
})

test('the done card copies the prompt, opens a new session and the file, and closes', async ($, on) => {
  const { clock, files, runs, copies } = stubSession(on, { tokens: 412_000 })
  await start($)
  expect((await $.command.run({ command: 'handoff', args: '' })).text).toBe('Writing the handoff. The card above the prompt shows its progress.')
  await clock.advance(1)
  const text = files.get(PATH)!

  await press($, 'copy')
  expect(copies).toEqual([text])

  await press($, 'new-chat')
  expect(runs.at(-1)).toEqual(['open', newSessionLink(text, PATH, '/work')])
  await press($, 'new-chat', 'terminal')
  expect(runs.at(-1)).toEqual(['osascript', '-e', terminalScript(PATH, '/work')])

  await press($, 'open')
  expect(runs.at(-1)).toEqual(['open', PATH])

  await press($, 'close')
  expect((await band($)).buttons).toEqual([])
})

test('the model tool queues the handoff until its turn ends', async ($, on) => {
  const { clock, files } = stubSession(on)
  await start($)
  await $.turn.start({ turnId: 't1', text: 'work, then call handoff' })
  const called = await $.tool.call({ tool: 'mcp__handoff__handoff' })
  expect(called.result).toBe('The handoff starts when this turn ends. The card above the prompt shows its progress.')
  expect((await band($)).texts).toContain('● Handoff queued: it starts when this turn ends.')

  await $.turn.complete({ turnId: 't1', answer: 'done' })
  await clock.advance(1)
  expect(files.has(PATH)).toBe(true)
  expect((await band($)).buttons).toEqual(['Copy handoff prompt', 'Start new chat with it', 'Open file', 'Close'])
})

test('a fork with nothing to hand off fails with the reason and can be tried again', async ($, on) => {
  const { clock } = stubSession(on, { fork: { isAnswered: false, reason: 'nothing-to-fork' } })
  await start($)
  await $.command.run({ command: 'handoff', args: '' })
  await clock.advance(1)
  const failed = await band($)
  expect(failed.texts).toContain('Handoff failed: there is no finished turn to hand off yet')
  expect(failed.buttons).toEqual(['Try again', 'Close'])
})
