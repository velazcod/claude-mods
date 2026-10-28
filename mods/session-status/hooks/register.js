import { atom, read, update } from 'claude-code'
import {
  COLORS,
  DEFAULT_TTL_MS,
  MAX_PINGS,
  MAX_TTL_MS,
  PING_LEAD_MS,
  BAR_WIDTH,
  barSvg,
  cacheStatus,
  clockSvg,
  keepWarmLine,
  ttlFromTranscript,
} from './format.js'

// $.state survives a module reload
// When the main conversation last sent a request, or a ping refreshed the cache
const lastRequestAt = atom({ plugin: 'session-status', key: 'lastRequestAt' }, 0)
// The session's cache TTL, as the last response that wrote to the cache shows it
const cacheTtlMs = atom({ plugin: 'session-status', key: 'cacheTtlMs' }, DEFAULT_TTL_MS)
// Keep warm is on, the pings sent since the last request, and what the last ping read
const keepWarm = atom({ plugin: 'session-status', key: 'keepWarm' }, false)
const pings = atom({ plugin: 'session-status', key: 'pings' }, 0)
const lastPing = atom({ plugin: 'session-status', key: 'lastPing' }, null)

// $.store keeps the time and the TTL per session, so a restarted or resumed session finds them.
// Each session writes only its own keys, so sessions don't overwrite each other.
const TIME_PREFIX = 'lastRequestAt:'
const TTL_PREFIX = 'cacheTtlMs:'

// The terminal status line script reads these files, keyed by session id: the request time
// (seconds, also written by the settings hooks) and the Keep warm state ("on <pings>" or "off")
const TERMINAL_TIME_FILE = '/tmp/.claude_cache_ts.'
const TERMINAL_KEEP_WARM_FILE = '/tmp/.claude_keep_warm.'

// The ping reads the session's cached prefix, which refreshes its TTL
const PING_PROMPT = 'This is an automatic prompt cache keep-alive ping. Reply with only: ok'

// A main-conversation turn is running, so its own requests keep the cache warm
let isTurnRunning = false
// A ping is out
let isPinging = false
// This session's transcript, from the last classic hook that named it
let transcriptPath = null
// The one-second timer of this module instance; a reload drops it
let ticker = null

// Redraw once a second so the countdown moves, and send a ping when one is due; declare /keep-warm.
// A /reload-plugins may not raise session.start again, so the band and the turn hooks start it too.
function startTicker($) {
  if (ticker) return
  ticker = $.clock.every(1000, () => {
    $.ui.invalidate('ui.render')
    return keepCacheWarm($)
  })
  void $.command.register({
    name: 'keep-warm',
    description: 'Ping the prompt cache when one minute is left, up to 5 times after each request',
    argumentHint: '[on|off]',
    immediate: true,
  })
}

// Show the Keep warm state in the terminal status line
async function writeKeepWarmFile($) {
  const text = (await read($, keepWarm)) ? 'on ' + (await read($, pings)) : 'off'
  await $.fs.write(TERMINAL_KEEP_WARM_FILE + (await $.session.id()), text + '\n').catch(() => {})
}

async function setKeepWarm($, isOn) {
  await update($, keepWarm, () => isOn)
  await writeKeepWarmFile($)
}

// Copy this session's saved time and TTL into $.state; 0 (cold) and the default TTL when none are saved
async function loadSaved($) {
  const sid = await $.session.id()
  const saved = Number((await $.store.get(TIME_PREFIX + sid)) ?? 0)
  const ttl = Number((await $.store.get(TTL_PREFIX + sid)) ?? DEFAULT_TTL_MS)
  await update($, lastRequestAt, () => saved)
  await update($, cacheTtlMs, () => ttl)
}

// Delete saved times whose cache has expired, with their TTLs
async function pruneStore($) {
  const now = await $.clock.now()
  for (const key of await $.store.keys()) {
    if (key.startsWith(TIME_PREFIX) && now - Number(await $.store.get(key)) > MAX_TTL_MS) {
      await $.store.delete(key)
      await $.store.delete(TTL_PREFIX + key.slice(TIME_PREFIX.length))
    }
  }
}

async function saveRequest($, at) {
  await update($, lastRequestAt, () => at)
  await $.store.set(TIME_PREFIX + (await $.session.id()), at)
}

// Read the TTL from the end of the transcript; keep the current one when no response shows it
async function detectTtl($, path) {
  if (!path) return
  transcriptPath = path
  const tail = await $.process.run(['tail', '-c', '1048576', path]).catch(() => null)
  const ttl = tail?.exitCode === 0 ? ttlFromTranscript(tail.stdout) : null
  if (ttl === null) return
  await update($, cacheTtlMs, () => ttl)
  await $.store.set(TTL_PREFIX + (await $.session.id()), ttl)
}

// Send one ping when Keep warm is on, the session is idle, and a minute or less is left
async function keepCacheWarm($) {
  if (isPinging || isTurnRunning || !(await read($, keepWarm))) return
  const sent = await read($, pings)
  if (sent >= MAX_PINGS) return
  const sentAt = await $.clock.now()
  const cache = cacheStatus(await read($, lastRequestAt), sentAt, await read($, cacheTtlMs))
  if (cache.cold || cache.remaining > PING_LEAD_MS) return

  isPinging = true
  $.ui.invalidate('ui.render')
  try {
    const reply = await $.model.fork({ prompt: PING_PROMPT })
    if (reply.usage) {
      const { cache_read_input_tokens: readTokens, cache_creation_input_tokens: written } = reply.usage
      // The request reached the cache: it read the prefix, or wrote it again after it lapsed
      if (readTokens + written > 0) {
        await saveRequest($, sentAt)
        const seconds = String(Math.floor(sentAt / 1000)) + '\n'
        await $.fs.write(TERMINAL_TIME_FILE + (await $.session.id()), seconds).catch(() => {})
      }
    }
    const failed = reply.reason === 'api-error' ? 'API error ' + reply.status : reply.reason === 'empty-reply' ? null : reply.reason
    await update($, lastPing, () => (failed ? { error: failed } : { readTokens: reply.usage.cache_read_input_tokens }))
  } finally {
    // A failed ping counts too, so a failing API is not asked every second
    await update($, pings, (n) => n + 1)
    await writeKeepWarmFile($)
    isPinging = false
    $.ui.invalidate('ui.render')
  }
}

export function register(on) {
  on('session.start', async ($, e, next) => {
    await pruneStore($)
    await loadSaved($)
    startTicker($)
    return next(e)
  })

  // /clear, /resume, and /branch reset $.state and can change the session, so load again.
  // A resumed or branched transcript also shows the TTL.
  on('classic.SessionStart', { source: ['clear', 'resume', 'fork'] }, async ($, e, next) => {
    await loadSaved($)
    if (e.source !== 'clear') await detectTtl($, e.transcript_path)
    return next(e)
  })

  // A turn starts: the transcript holds the earlier responses, and naming it lets each request read it
  on('classic.UserPromptSubmit', async ($, e, next) => {
    await detectTtl($, e.transcript_path)
    return next(e)
  })

  // The main conversation's turn ended: its last response is in the transcript
  on('classic.Stop', async ($, e, next) => {
    await detectTtl($, e.transcript_path)
    return next(e)
  })

  // /keep-warm turns it on or off; with no argument it switches
  on('command.run', { command: 'keep-warm' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg && arg !== 'on' && arg !== 'off') return { text: 'Usage: /keep-warm [on|off]' }
    const isOn = arg ? arg === 'on' : !(await read($, keepWarm))
    await setKeepWarm($, isOn)
    if (!isOn) return { text: 'Keep warm is off.' }
    const cache = cacheStatus(await read($, lastRequestAt), await $.clock.now(), await read($, cacheTtlMs))
    return { text: keepWarmLine({ cache, pings: await read($, pings), lastPing: await read($, lastPing), isPinging }) }
  })

  on('turn.start', async ($, e, next) => {
    if (!e.agentId) isTurnRunning = true
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (!e.agentId) isTurnRunning = false
    return next(e)
  })

  // Record when each main-conversation request was sent; subagent requests use their own cache.
  // A request starts a new round of up to MAX_PINGS pings. The transcript may not hold this
  // response yet, so reading it here shows the TTL by the next request of a long turn at the latest.
  on('turn.step', async function* ($, e, next) {
    startTicker($)
    const sentAt = await $.clock.now()
    const result = yield* next(e)
    if (!e.agentId && !isPinging && result.usage) {
      await saveRequest($, sentAt)
      await update($, pings, () => 0)
      await update($, lastPing, () => null)
      if (await read($, keepWarm)) await writeKeepWarmFile($)
      await detectTtl($, transcriptPath)
    }
    return result
  })

  // Draw the cache timer in the band above the prompt in the Desktop app. The terminal keeps the
  // shell status line, which shows the same timer.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    startTicker($)
    // A survey holds the band while it shows
    if (e.surface === 'terminal' || e.props.hasSurvey) return next(e)
    const { Box, Button, Svg, Text } = $.ui.resolve(e)
    const cache = cacheStatus(await read($, lastRequestAt), await $.clock.now(), await read($, cacheTtlMs))
    const isKeepingWarm = await read($, keepWarm)

    const timer = [
      Svg({ source: clockSvg(cache.color), alt: 'Clock', width: 16, height: 16 }),
      Text({ color: cache.color, weight: 'medium', children: [cache.cold ? 'Cache cold' : 'Cache warm'] }),
    ]
    if (!cache.cold) timer.push(Text({ color: cache.color, weight: 'bold', tabular: true, children: [cache.text] }))
    timer.push(Svg({ source: barSvg(cache.fraction, cache.color), alt: 'Time left', width: BAR_WIDTH, height: 6 }))

    const row = Box({
      key: 'session-status',
      flexDirection: 'row',
      alignItems: 'center',
      gap: 'sm',
      children: [
        Box({ flexDirection: 'row', alignItems: 'center', gap: 'sm', flexGrow: 1, children: timer }),
        Button({
          key: 'keep-warm',
          label: isKeepingWarm ? 'Stop keeping warm' : 'Keep warm',
          variant: 'secondary',
          onPress: () => setKeepWarm($, !isKeepingWarm),
        }),
      ],
    })
    const lines = [row]
    if (isKeepingWarm) {
      const text = keepWarmLine({ cache, pings: await read($, pings), lastPing: await read($, lastPing), isPinging })
      lines.push(Text({ color: COLORS.keepWarm, size: 'footnote', children: [text] }))
    }

    const others = await next(e)
    if (others) lines.push(others)
    return Box({ flexDirection: 'column', children: lines })
  })
}
