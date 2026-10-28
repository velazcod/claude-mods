import { atom, read, update } from 'claude-code'
import {
  BAR_WIDTH,
  COLORS,
  STEP_ICONS,
  barSvg,
  barText,
  collectRefs,
  composeHandoff,
  countWords,
  filesDetail,
  forkPrompt,
  formatTokens,
  newSessionLink,
  refsDetail,
  shouldPropose,
  slugify,
  splitTitle,
  stepRows,
  terminalScript,
  tildePath,
} from './format.js'

// $.state survives a module reload
// The context fill after the last main-conversation response: { tokens, window }, or null until one
const context = atom({ plugin: 'handoff', key: 'context' }, null)
// The token count when the person pressed Hide or Close; null when the proposal was not dismissed
const snoozedAt = atom({ plugin: 'handoff', key: 'snoozedAt' }, null)
// A handoff was asked for while a turn ran; it starts when the turn ends
const isPending = atom({ plugin: 'handoff', key: 'isPending' }, false)
// The handoff being built or built last, until Close
const run = atom({ plugin: 'handoff', key: 'run' }, null)

const TOOL = 'mcp__handoff__handoff'
const TOOL_DESCRIPTION =
  'Write a handoff of this session: a Markdown prompt with the goal, state, decisions, next steps, ' +
  'and the files, skills, tools and links used, saved under ~/.claude/handoffs/, so a new session can ' +
  'continue the work. Call it only when the user asks for a handoff, for example "when done, call handoff". ' +
  'The handoff is written after your turn ends, so end your turn right after this call with a short summary.'

// A main-conversation turn is running
let isTurnRunning = false
// A handoff is being built in this module instance
let isBuilding = false

// Declare /handoff and the model's tool. A /reload-plugins may not raise session.start again,
// so the band and the turn hooks call this too.
let isDeclared = false
function declare($) {
  if (isDeclared) return
  isDeclared = true
  void $.command.register({
    name: 'handoff',
    description: 'Write a handoff of this session that a new session can continue from',
  })
  void $.tool.register({
    name: 'handoff',
    description: TOOL_DESCRIPTION,
    inputSchema: { type: 'object', properties: {} },
    isDeferred: false,
  })
}

async function readContext($) {
  const { context: fill } = await $.session.usage()
  const value = fill.tokens === undefined ? null : { tokens: fill.tokens, window: fill.window }
  await update($, context, () => value)
}

async function home($) {
  return (await $.env.get('HOME')) ?? ''
}

async function handoffFolder($) {
  const configDir = await $.env.get('CLAUDE_CONFIG_DIR')
  return (configDir ?? (await home($)) + '/.claude') + '/handoffs'
}

// Start a handoff now, or when the running turn ends. Returns what to tell the person or the model.
async function requestHandoff($) {
  if (isBuilding) return 'A handoff is already being written.'
  if (isTurnRunning) {
    await update($, isPending, () => true)
    return 'The handoff starts when this turn ends. The card above the prompt shows its progress.'
  }
  isBuilding = true
  const at = await $.clock.now()
  await update($, isPending, () => false)
  await update($, run, () => ({ status: 'running', step: 0, details: [], stepStartedAt: at, words: 0, path: '', error: '' }))
  // A timer, so the work outlives the press, command or turn that asked for it
  $.clock.after(0, () => build($))
  return 'Writing the handoff. The card above the prompt shows its progress.'
}

// The five steps. Each one updates the card.
async function build($) {
  const ticker = $.clock.every(1000, () => $.ui.invalidate('ui.render'))
  const details = []
  const finishStep = async (detail) => {
    details.push(detail)
    const at = await $.clock.now()
    await update($, run, (r) => ({ ...r, step: details.length, details: [...details], stepStartedAt: at }))
  }
  try {
    const messages = await $.session.messages()
    await finishStep(messages.length + ' messages')

    const refs = collectRefs(messages)
    await finishStep(filesDetail(refs))
    await finishStep(refsDetail(refs))

    const forkedAt = await $.clock.now()
    const reply = await $.model.fork({ prompt: forkPrompt(refs) })
    if (!reply.isAnswered) {
      const reason = { 'nothing-to-fork': 'there is no finished turn to hand off yet', 'api-error': 'API error ' + reply.status }
      throw new Error(reason[reply.reason] ?? reply.reason)
    }
    await finishStep(Math.round(((await $.clock.now()) - forkedAt) / 1000) + ' s')

    const { title, body } = splitTitle(reply.text)
    const stamp = (await $.process.run(['date', '+%Y-%m-%d-%H%M'])).stdout.trim()
    const createdAt = stamp.slice(0, 10) + ' ' + stamp.slice(11, 13) + ':' + stamp.slice(13, 15)
    const root = await $.session.root()
    const text = composeHandoff({ title, body, refs, root, sessionId: await $.session.id(), createdAt })
    const path = (await handoffFolder($)) + '/' + stamp + '-' + slugify(title) + '.md'
    await $.fs.write(path, text)
    if ((await $.fs.read(path)) !== text) throw new Error('the saved file does not match the handoff')
    await finishStep('saved, checked')
    await update($, run, (r) => ({ ...r, status: 'done', words: countWords(text), path }))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await update($, run, (r) => ({ ...r, status: 'failed', error: message }))
  } finally {
    ticker()
    isBuilding = false
    $.ui.invalidate('ui.render')
  }
}

// Stop showing the proposal until the context grows by SNOOZE_TOKENS
async function snooze($) {
  const fill = await read($, context)
  await update($, snoozedAt, () => fill?.tokens ?? 0)
}

async function closeCard($) {
  await update($, run, () => null)
  await snooze($)
}

async function copyPrompt($, press) {
  const { path } = await read($, run)
  const text = await $.fs.read(path)
  const copied = await $.ui.copy({ text, surface: press.surface })
  if (!copied.isCopied) await $.process.run(['pbcopy'], { stdin: text })
  $.ui.toast('Handoff prompt copied.')
}

// A new session with the handoff as its prompt: a new Code session in the Desktop app, or a
// Terminal window that runs `claude`. This session stays as it is.
async function startNewChat($, press) {
  const { path } = await read($, run)
  const folder = await $.session.root()
  const argv =
    press.surface === 'terminal'
      ? ['osascript', '-e', terminalScript(path, folder)]
      : ['open', newSessionLink(await $.fs.read(path), path, folder)]
  const result = await $.process.run(argv).catch((error) => ({ exitCode: 1, stderr: String(error) }))
  $.ui.toast(result.exitCode === 0 ? 'Opened a new session with the handoff.' : 'Could not open a new session: ' + result.stderr.trim())
}

async function openFile($) {
  const { path } = await read($, run)
  const result = await $.process.run(['open', path]).catch(() => null)
  if (result?.exitCode !== 0) await $.process.run(['xdg-open', path]).catch(() => null)
}

function header(Text, color, children) {
  return Text({ color, weight: 'semibold', children })
}

// The card for a handoff that is queued, running, done or failed
async function drawRun($, e, current) {
  const { Box, Button, Svg, Text } = $.ui.resolve(e)
  const now = await $.clock.now()
  const lines = []
  if (current.status === 'running') lines.push(header(Text, COLORS.active, ['Handing off: building your handoff']))
  if (current.status === 'done') lines.push(header(Text, COLORS.done, ['Handoff ready: ' + current.words + ' words']))
  if (current.status === 'failed') lines.push(header(Text, COLORS.failed, ['Handoff failed: ' + current.error]))

  stepRows(current, now).forEach((row, i) => {
    const color = COLORS[row.state]
    const bar =
      e.surface === 'terminal'
        ? Text({ color, children: [barText(row.fraction)] })
        : Svg({ source: barSvg(row.fraction, color), alt: Math.round(row.fraction * 100) + '%', width: BAR_WIDTH, height: 3 })
    lines.push(
      Box({
        key: 'step-' + i,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 'sm',
        children: [
          Box({
            width: '40%',
            flexShrink: 0,
            flexDirection: 'row',
            gap: 'sm',
            children: [
              Text({ color, children: [STEP_ICONS[row.state]] }),
              Text({ dimColor: row.state === 'waiting', wrap: 'truncate-end', children: [i + 1 + '. ' + row.label] }),
            ],
          }),
          bar,
          Box({ flexGrow: 1, children: [Text({ dimColor: true, wrap: 'truncate-end', children: [row.detail] })] }),
        ],
      }),
    )
  })

  if (current.status === 'done') {
    lines.push(Text({ dimColor: true, size: 'footnote', children: ['Saved to ' + tildePath(current.path, await home($))] }))
    lines.push(
      Box({
        flexDirection: 'row',
        gap: 'sm',
        children: [
          Button({ key: 'copy', label: 'Copy handoff prompt', variant: 'primary', onPress: (press) => copyPrompt($, press) }),
          Button({ key: 'new-chat', label: 'Start new chat with it', variant: 'secondary', onPress: (press) => startNewChat($, press) }),
          Button({ key: 'open', label: 'Open file', variant: 'secondary', onPress: () => openFile($) }),
          Button({ key: 'close', label: 'Close', variant: 'secondary', onPress: () => closeCard($) }),
        ],
      }),
    )
  }
  if (current.status === 'failed') {
    lines.push(
      Box({
        flexDirection: 'row',
        gap: 'sm',
        children: [
          Button({ key: 'retry', label: 'Try again', variant: 'primary', onPress: () => requestHandoff($) }),
          Button({ key: 'close', label: 'Close', variant: 'secondary', onPress: () => closeCard($) }),
        ],
      }),
    )
  }
  return Box({ key: 'handoff', flexDirection: 'column', gap: 'xs', children: lines })
}

export function register(on, options) {
  const thresholdTokens = options.thresholdTokens

  on('session.start', async ($, e, next) => {
    declare($)
    await readContext($)
    return next(e)
  })

  // /clear, /resume and /branch reset $.state and can change the session, so read the context again
  on('classic.SessionStart', { source: ['clear', 'resume', 'fork'] }, async ($, e, next) => {
    await readContext($)
    return next(e)
  })

  on('command.run', { command: 'handoff' }, async ($) => ({ text: await requestHandoff($) }))

  on('tool.call', { tool: TOOL }, async ($) => ({ result: await requestHandoff($) }))

  on('turn.start', async ($, e, next) => {
    declare($)
    if (!e.agentId) isTurnRunning = true
    return next(e)
  })

  // A handoff asked for during the turn starts now, so it reads the whole turn
  on('turn.complete', async ($, e, next) => {
    if (!e.agentId) {
      isTurnRunning = false
      if (await read($, isPending)) await requestHandoff($)
    }
    return next(e)
  })

  // Read the context fill after each main-conversation request
  on('turn.step', async function* ($, e, next) {
    const result = yield* next(e)
    if (!e.agentId) await readContext($)
    return result
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    declare($)
    // A survey holds the band while it shows
    if (e.props.hasSurvey) return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    const current = await read($, run)
    const fill = await read($, context)
    let card = null

    if (current) card = await drawRun($, e, current)
    else if (await read($, isPending)) {
      card = Text({ color: COLORS.active, children: ['● Handoff queued: it starts when this turn ends.'] })
    } else if (shouldPropose(fill, thresholdTokens, await read($, snoozedAt))) {
      card = Box({
        key: 'handoff',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 'sm',
        children: [
          Box({
            flexDirection: 'row',
            gap: 'sm',
            flexGrow: 1,
            children: [
              Text({ color: COLORS.active, children: ['●'] }),
              Text({ children: ['Context at ' + formatTokens(fill.tokens) + '. Handoff moves this work to a new chat with everything it needs.'] }),
            ],
          }),
          Button({ key: 'handoff', label: 'Handoff', variant: 'primary', onPress: () => requestHandoff($) }),
          Button({ key: 'hide', label: 'Hide', variant: 'secondary', onPress: () => snooze($) }),
        ],
      })
    }

    const others = await next(e)
    if (!card) return others
    // The other plugins' rows go first, so a tall card that scrolls never hides them
    return Box({ flexDirection: 'column', gap: 'sm', children: others ? [others, card] : [card] })
  })
}
