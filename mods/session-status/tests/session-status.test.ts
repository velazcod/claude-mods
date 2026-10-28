import { expect, mock, test } from 'claude-code/testing'
import { barSvg, cacheStatus, clockSvg, formatClock, keepWarmLine, svgColor, ttlFromTranscript } from '../hooks/format.js'

const SEC = 1000
const MIN = 60 * SEC
const NOW = 10 * 60 * MIN

// What Claude Code passes to a ui.render hook for the band above the prompt
const BAND = {
  plugin: 'session-status',
  component: 'AbovePrompt',
  requestId: 'AbovePrompt',
  viewport: { columns: 120, rows: 40 },
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 115, scroll: { offset: 0, bodyRows: 9 }, view: {} },
} as const

// One transcript line of a main-conversation response that wrote to the cache with the given TTL
const response = (ttl: '5m' | '1h', extra = {}) =>
  JSON.stringify({
    type: 'assistant',
    ...extra,
    message: { usage: { cache_creation: { ephemeral_5m_input_tokens: ttl === '5m' ? 10 : 0, ephemeral_1h_input_tokens: ttl === '1h' ? 10 : 0 } } },
  })
const readOnly = JSON.stringify({ type: 'assistant', message: { usage: { cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 0 } } } })

const USAGE = { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 214_000, cache_creation_input_tokens: 0 }

// Register the stubs every test needs: Claude Code's answers to the mod's calls.
// `store` stands for $.store, `session.id` answers with `sid`, and `transcript` is what `tail` prints.
function stubSession(on, { store = new Map<string, unknown>(), sid = 'sess-1', transcript = '' } = {}) {
  const clock = mock.clock(on, { now: NOW })
  const forks: string[] = []
  const files = new Map<string, string>()
  on('session.id', () => ({ value: sid }))
  on('session.start', () => ({ cwd: '/work' }))
  on('classic.SessionStart', () => ({}))
  on('classic.Stop', () => ({}))
  on('classic.UserPromptSubmit', () => ({}))
  on('store.get', ($, e) => ({ value: store.get(e.key) }))
  on('store.set', ($, e) => (store.set(e.key, e.value), { value: undefined }))
  on('store.keys', () => ({ value: [...store.keys()] }))
  on('store.delete', ($, e) => (store.delete(e.key), { value: undefined }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: transcript, stderr: '' } }))
  on('command.register', () => ({ value: { command: 'keep-warm' } }))
  on('fs.write', ($, e) => (files.set(e.path, e.text), { value: undefined }))
  on('model.fork', ($, e) => (forks.push(e.prompt), { value: { isAnswered: true, text: 'ok', usage: USAGE } }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: 'ok' }))
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['drawn by Claude Code'] }))
  on('turn.step', async function* ($, e) {
    return { turnId: e.turnId, index: e.index, answer: 'ok', toolUses: [], stopReason: 'end_turn', usage: { ...USAGE, model: 'claude-test' } }
  })
  return { clock, forks, files }
}

const start = ($) => $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/work' })

// Send one request through the mod's turn.step hook and read the stream to its end
async function step($, agentId?: string) {
  const stream = $.turn.step({ turnId: 't', index: 0, model: 'claude-test', messageCount: 1, ...(agentId ? { agentId } : {}) })
  let next = await stream.next()
  while (next.done !== true) next = await stream.next()
}

// One full main-conversation turn: its request, then the Stop hook that reads the TTL
async function turn($) {
  await step($)
  await $.classic.Stop({ stop_hook_active: false, transcript_path: '/work/t.jsonl' })
}

// Draw the band once and read what it shows
async function band($, surface = 'desktop') {
  const ui = await $.ui.mount({ ...BAND, surface })
  const label = (await ui.find({ type: 'Text', text: /^Cache (warm|cold)$/ }))?.text
  const time = await ui.find({ type: 'Text', text: /^\d+:\d\d$/ })
  const keepWarm = (await ui.find({ type: 'Text', text: /^Keeping warm/ }))?.text
  const others = (await ui.find({ type: 'Text', text: 'drawn by Claude Code' })) !== undefined
  const hasContext = (await ui.find({ type: 'Text', text: /\/1000k|█/ })) !== undefined
  await ui.unmount()
  return { label, time: time?.text, color: time?.props.color, keepWarm, others, hasContext }
}

async function pressKeepWarm($) {
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await ui.press({ key: 'keep-warm' })
  await ui.unmount()
}

test('formats the clock, the thresholds, the TTL, and the Keep warm line', () => {
  expect(formatClock(3_599_000)).toBe('59:59')
  expect(cacheStatus(0, 1000, 60 * MIN)).toMatchObject({ cold: true, fraction: 0 })
  expect(cacheStatus(1, 1 + 60 * MIN, 60 * MIN)).toMatchObject({ cold: true })
  expect(cacheStatus(1, 1 + 45 * MIN - SEC, 60 * MIN).color).toBe('#3d8b5f')
  expect(cacheStatus(1, 1 + 45 * MIN, 60 * MIN)).toMatchObject({ text: '15:00', color: '#c68a1e' })
  expect(cacheStatus(1, 1 + 50 * MIN, 60 * MIN)).toMatchObject({ text: '10:00', color: '#c8553d' })
  expect(cacheStatus(1, 1 + 4 * MIN, 5 * MIN)).toMatchObject({ text: '1:00', color: '#c68a1e' })

  expect(svgColor('#3d8b5f')).toBe('rgb(61,139,95)')
  expect(clockSvg('#3d8b5f') + barSvg(0.5, '#3d8b5f')).not.toContain('#')

  expect(ttlFromTranscript([response('5m'), response('1h'), readOnly, ''].join('\n'))).toBe(60 * MIN)
  expect(ttlFromTranscript([response('1h'), response('5m')].join('\n'))).toBe(5 * MIN)
  expect(ttlFromTranscript([response('5m'), response('1h', { isSidechain: true })].join('\n'))).toBe(5 * MIN)
  expect(ttlFromTranscript('{"cut line "ephemeral_1h\n' + readOnly)).toBe(null)

  const warm = cacheStatus(1, 1 + 55 * SEC, 60 * MIN)
  expect(keepWarmLine({ cache: warm, pings: 0, lastPing: null, isPinging: false })).toBe('Keeping warm · first ping in 58:05')
  expect(keepWarmLine({ cache: warm, pings: 1, lastPing: { readTokens: 214_000 }, isPinging: false })).toBe(
    'Keeping warm · ping 1 of 5 · next in 58:05 · last ping read 214k cached tokens',
  )
  expect(keepWarmLine({ cache: warm, pings: 2, lastPing: { error: 'API error 529' }, isPinging: false })).toBe(
    'Keeping warm · ping 2 of 5 · next in 58:05 · last ping failed: API error 529',
  )
  expect(keepWarmLine({ cache: cacheStatus(0, 1, 60 * MIN), pings: 5, lastPing: { readTokens: 900 }, isPinging: false })).toBe(
    'Keeping warm · stopped after 5 pings · starts again after your next message · last ping read 900 cached tokens',
  )
})

test('the Desktop band shows cold, then counts down from the TTL the transcript shows', async ($, on) => {
  const { clock } = stubSession(on, { transcript: response('1h') })
  await start($)

  expect(await band($)).toMatchObject({ label: 'Cache cold', time: undefined, hasContext: false, others: true })

  await turn($)
  const checks = [
    [0, 'Cache warm', '60:00', '#3d8b5f'],
    [46 * MIN, 'Cache warm', '14:00', '#c68a1e'],
    [5 * MIN, 'Cache warm', '9:00', '#c8553d'],
    [10 * MIN, 'Cache cold', undefined, undefined],
  ] as const
  for (const [advance, label, time, color] of checks) {
    await clock.advance(advance)
    const now = await band($)
    expect([now.label, now.time, now.color]).toEqual([label, time, color])
  }
})

test('a session whose responses write 5-minute entries counts down from 5:00', async ($, on) => {
  stubSession(on, { transcript: response('5m') })
  await start($)
  await turn($)
  expect((await band($)).time).toBe('5:00')
})

test('the terminal keeps its own band, because the status line shows the timer there', async ($, on) => {
  stubSession(on)
  await start($)
  await step($)
  expect(await band($, 'terminal')).toMatchObject({ label: undefined, others: true })
})

test('within a long turn, a request reads the TTL from the transcript the prompt named', async ($, on) => {
  stubSession(on, { transcript: response('1h') })
  await start($)
  await $.classic.UserPromptSubmit({ prompt: 'hi', transcript_path: '/work/t.jsonl' })
  await step($)
  expect((await band($)).time).toBe('60:00')
})

test('a request and its TTL are saved for the session, and a resumed session loads them', async ($, on) => {
  const store = new Map<string, unknown>([
    ['lastRequestAt:sess-1', NOW - 40 * MIN],
    ['cacheTtlMs:sess-1', 60 * MIN],
  ])
  stubSession(on, { store })
  await $.classic.SessionStart({ source: 'resume', transcript_path: '/work/t.jsonl' })
  expect((await band($)).time).toBe('20:00')
  await step($)
  expect(store.get('lastRequestAt:sess-1')).toBe(NOW)
})

test('a resumed session reads its TTL from the transcript', async ($, on) => {
  const store = new Map<string, unknown>([['lastRequestAt:sess-1', NOW - 40 * MIN]])
  stubSession(on, { store, transcript: response('1h') })
  await $.classic.SessionStart({ source: 'resume', transcript_path: '/work/t.jsonl' })
  expect((await band($)).time).toBe('20:00')
  expect(store.get('cacheTtlMs:sess-1')).toBe(60 * MIN)
})

test('a new session after a restart loads its saved time and removes expired ones', async ($, on) => {
  const store = new Map<string, unknown>([
    ['lastRequestAt:sess-1', NOW - 40 * MIN],
    ['cacheTtlMs:sess-1', 60 * MIN],
    ['lastRequestAt:old', NOW - 61 * MIN],
    ['cacheTtlMs:old', 60 * MIN],
    ['other-key', 1],
  ])
  stubSession(on, { store })
  await start($)
  expect((await band($)).time).toBe('20:00')
  expect([...store.keys()].sort()).toEqual(['cacheTtlMs:sess-1', 'lastRequestAt:sess-1', 'other-key'])
})

test('a subagent request does not start or save the timer', async ($, on) => {
  const store = new Map<string, unknown>()
  stubSession(on, { store })
  await start($)
  await step($, 'agent-1')
  expect((await band($)).label).toBe('Cache cold')
  expect(store.size).toBe(0)
})

test('Keep warm pings when one minute is left, at most 5 times, and a request starts a new round', async ($, on) => {
  const { clock, forks } = stubSession(on, { transcript: response('5m') })
  await start($)
  await turn($)

  expect((await band($)).keepWarm).toBe(undefined)
  await pressKeepWarm($)
  expect((await band($)).keepWarm).toBe('Keeping warm · first ping in 4:00')

  // No ping while more than a minute is left
  await clock.advance(4 * MIN - SEC)
  expect(forks.length).toBe(0)
  await clock.advance(SEC)
  expect(forks.length).toBe(1)
  const pinged = await band($)
  expect([pinged.time, pinged.keepWarm]).toEqual(['5:00', 'Keeping warm · ping 1 of 5 · next in 4:00 · last ping read 214k cached tokens'])

  // Four more pings keep it warm, then it stops and the cache goes cold
  await clock.advance(4 * 4 * MIN)
  expect(forks.length).toBe(5)
  await clock.advance(5 * MIN)
  expect(forks.length).toBe(5)
  const stopped = await band($)
  expect([stopped.label, stopped.keepWarm]).toEqual([
    'Cache cold',
    'Keeping warm · stopped after 5 pings · starts again after your next message · last ping read 214k cached tokens',
  ])

  await turn($)
  expect((await band($)).keepWarm).toBe('Keeping warm · first ping in 4:00')
  await clock.advance(4 * MIN)
  expect(forks.length).toBe(6)
})

test('Keep warm does not ping while a turn runs, and stops when turned off', async ($, on) => {
  const { clock, forks } = stubSession(on, { transcript: response('5m') })
  await start($)
  await turn($)
  await pressKeepWarm($)

  await $.turn.start({ turnId: 't2', text: 'hi' })
  await clock.advance(4 * MIN)
  expect(forks.length).toBe(0)
  await $.turn.complete({ turnId: 't2', answer: 'ok' })

  await pressKeepWarm($)
  await clock.advance(30 * SEC)
  expect(forks.length).toBe(0)
})

test('after a reload with no session.start, the band starts the countdown and Keep warm', async ($, on) => {
  const { clock, forks } = stubSession(on, { transcript: response('5m') })
  await $.classic.Stop({ stop_hook_active: false, transcript_path: '/work/t.jsonl' })
  await pressKeepWarm($)
  await turn($)
  await clock.advance(4 * MIN)
  expect(forks.length).toBe(1)
})

test('/keep-warm turns Keep warm on and off, and the terminal files show it and each ping', async ($, on) => {
  const { clock, forks, files } = stubSession(on, { transcript: response('5m') })
  await start($)
  await turn($)

  expect((await $.command.run({ command: 'keep-warm', args: '' })).text).toBe('Keeping warm · first ping in 4:00')
  expect(files.get('/tmp/.claude_keep_warm.sess-1')).toBe('on 0\n')
  expect((await band($)).keepWarm).toBe('Keeping warm · first ping in 4:00')

  await clock.advance(4 * MIN)
  expect(forks.length).toBe(1)
  expect(files.get('/tmp/.claude_keep_warm.sess-1')).toBe('on 1\n')
  expect(files.get('/tmp/.claude_cache_ts.sess-1')).toBe(String(Math.floor((NOW + 4 * MIN) / 1000)) + '\n')

  await turn($)
  expect(files.get('/tmp/.claude_keep_warm.sess-1')).toBe('on 0\n')

  expect((await $.command.run({ command: 'keep-warm', args: 'off' })).text).toBe('Keep warm is off.')
  expect(files.get('/tmp/.claude_keep_warm.sess-1')).toBe('off\n')
  expect((await band($)).keepWarm).toBe(undefined)
  expect((await $.command.run({ command: 'keep-warm', args: 'maybe' })).text).toBe('Usage: /keep-warm [on|off]')
})

test('the band steps aside for a survey', async ($, on) => {
  stubSession(on)
  await start($)
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop', props: { ...BAND.props, hasSurvey: true } })
  expect(await ui.find({ type: 'Text', text: /Cache/ })).toBe(undefined)
  expect(await ui.find({ type: 'Text', text: 'drawn by Claude Code' })).toBeDefined()
})
