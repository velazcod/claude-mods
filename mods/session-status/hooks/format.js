// Pure display logic for session-status. No mods API calls, so tests can import it directly.

export const TTL_5M_MS = 5 * 60 * 1000
export const TTL_1H_MS = 60 * 60 * 1000
// Until a response shows the session's TTL, assume the shorter one, so the timer never shows a cold cache as warm
export const DEFAULT_TTL_MS = TTL_5M_MS
// The longest TTL, for removing saved times that have expired whatever their TTL
export const MAX_TTL_MS = TTL_1H_MS

// Keep warm sends a ping when this much time is left, at most MAX_PINGS times after each request
export const PING_LEAD_MS = 60 * 1000
export const MAX_PINGS = 5

export const COLORS = {
  cache: '#3d8b5f',
  caution: '#c68a1e',
  warn: '#c8553d',
  cold: '#9ca2af',
  keepWarm: '#4a72b8',
}

// Time left as "m:ss", e.g. 3599000 -> "59:59"
export function formatClock(ms) {
  const total = Math.max(0, Math.floor(ms / 1000))
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return minutes + ':' + String(seconds).padStart(2, '0')
}

// Token count as "214k"
export function formatTokens(n) {
  return n >= 1000 ? Math.round(n / 1000) + 'k' : String(n)
}

// The cache timer: cold, or the time left, the part of the TTL left, and its color.
// The color changes at the last quarter (15 of 60 minutes) and the last sixth (10 of 60 minutes).
export function cacheStatus(lastRequestAt, now, ttlMs) {
  const remaining = lastRequestAt ? ttlMs - (now - lastRequestAt) : 0
  if (remaining <= 0) return { cold: true, remaining: 0, fraction: 0, color: COLORS.cold }
  const fraction = remaining / ttlMs
  const color = fraction <= 1 / 6 ? COLORS.warn : fraction <= 1 / 4 ? COLORS.caution : COLORS.cache
  return { cold: false, remaining, fraction, text: formatClock(remaining), color }
}

// The TTL of the last main-conversation response that wrote to the cache, from the end of a
// transcript (JSON lines). A response that only read the cache does not show it, so look further back.
// null when no such response is found.
export function ttlFromTranscript(text) {
  const lines = text.split('\n')
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].includes('"ephemeral_')) continue
    let entry
    try {
      entry = JSON.parse(lines[i])
    } catch {
      continue // the first line of a tail can be cut
    }
    if (entry.type !== 'assistant' || entry.isSidechain) continue
    const written = entry.message?.usage?.cache_creation
    if (written?.ephemeral_1h_input_tokens > 0) return TTL_1H_MS
    if (written?.ephemeral_5m_input_tokens > 0) return TTL_5M_MS
  }
  return null
}

// The second line while Keep warm is on
export function keepWarmLine({ cache, pings, lastPing, isPinging }) {
  const parts = ['Keeping warm']
  if (isPinging) parts.push('sending ping ' + (pings + 1))
  else if (cache.cold && pings >= MAX_PINGS) parts.push('stopped after ' + MAX_PINGS + ' pings', 'starts again after your next message')
  else if (cache.cold) parts.push('starts after the next response')
  else if (pings === 0) parts.push('first ping in ' + formatClock(cache.remaining - PING_LEAD_MS))
  else if (pings < MAX_PINGS) parts.push('ping ' + pings + ' of ' + MAX_PINGS, 'next in ' + formatClock(cache.remaining - PING_LEAD_MS))
  else parts.push('ping ' + pings + ' of ' + MAX_PINGS, 'no more pings')
  if (lastPing?.error) parts.push('last ping failed: ' + lastPing.error)
  else if (lastPing && pings > 0) parts.push('last ping read ' + formatTokens(lastPing.readTokens) + ' cached tokens')
  return parts.join(' · ')
}

// A hex color as rgb(), because a "#" in the markup ends the data URL an image is drawn from
export function svgColor(hex) {
  const n = parseInt(hex.slice(1), 16)
  return 'rgb(' + (n >> 16) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ')'
}

// A clock icon in the timer's color
export function clockSvg(color) {
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="' + svgColor(color) +
    '" stroke-width="1.5" stroke-linecap="round"><circle cx="8" cy="8" r="6.25"/><path d="M8 4.5V8l2.5 1.5"/></svg>'
  )
}

export const BAR_WIDTH = 240

// The part of the TTL left as a rounded bar on a faint track
export function barSvg(fraction, color) {
  const filled = fraction > 0 ? Math.max(6, Math.round(fraction * BAR_WIDTH)) : 0
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" width="' + BAR_WIDTH + '" height="6" viewBox="0 0 ' + BAR_WIDTH + ' 6">' +
    '<rect width="' + BAR_WIDTH + '" height="6" rx="3" fill="' + svgColor(COLORS.cold) + '" fill-opacity="0.25"/>' +
    (filled ? '<rect width="' + filled + '" height="6" rx="3" fill="' + svgColor(color) + '"/>' : '') +
    '</svg>'
  )
}
