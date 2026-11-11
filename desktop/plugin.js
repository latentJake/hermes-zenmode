/**
 * Zed Mode.
 *
 * ⌘⌥Z opens ONE stack of your conversations, receding into the screen,
 * ordered like an inbox. Front to back:
 *   failed · needs you (approval / question) · working · process still running · unread
 *   · pinned · everything else, most recent first
 * So from a clean slate the front of the stack is your pins; walk away with five agents going
 * and what you come back to is whatever needs you, most urgent first.
 *
 * ⇧⏎ HOLDS the front card: the stack steps down-left and gets a little smaller, and the
 * conversation floats in on the right (a little higher), as a thread:
 *   - each user prompt starts a CHAPTER; its prompt sticks to the top while you scroll what
 *     the agent did, which sits a layer further back
 *   - a prompt RAIL on the right edge, a composer at the bottom
 *   (PAPER, a 3D version of the thread, is on ice: hidden unless the experimental dial is on.)
 * ← → pick the half the keys act on. Walk the stack while a thread is held and it follows.
 * ⇧⏎ again brings the conversation to the FOREGROUND (the stack falls away); esc steps back
 * one level at a time: foreground → stack + thread → the stack.
 *
 * Only the cards near you are drawn, and far cards curve up and away, so the stack stays light
 * and readable with hundreds of conversations. Drag the grip on the front card to place the
 * stack; it can never be dragged under the thread.
 *
 * Where states come from: the app's own SessionStatusDot (needs-input / working / stalled /
 * background / unread), so Zed Mode agrees with the sidebar; "failed" from the gateway's turn events.
 *
 * Keys (outside text fields):
 *   ↑↓ walk the stack (↑ deeper) · ⌘⏎ open natively · ⇧⏎ hold, ⇧⏎ again foreground · i write · esc back one level
 *
 * Rules (docs/04): no JSX syntax; imports only @hermes/plugin-sdk, react, react/jsx-runtime;
 * colours only var(--ui-*). No layout pane: closing a plugin's only pane disables the plugin.
 */

import {
  host,
  haptic,
  relativeTime,
  useQuery,
  queryClient,
  useValue,
  Codicon,
  MessageTextContent,
  SessionStatusDot,
  ackStoredSessionId,
  ModelCatalogMenu,
  ModelMenuCloseContext,
  ConfirmDialog,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  composerSurfaceRing,
  composerInputBacking,
  GHOST_ICON_BTN,
  PRIMARY_ICON_BTN,
  PALETTE_AREA,
  KEYBINDS_AREA,
  ROUTES_AREA,
  SIDEBAR_NAV_AREA,
  TRANSCRIPT_DIRECTIVE_AREA
} from '@hermes/plugin-sdk'
import { Component, memo as pure, useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'

const ID = 'zedmode' // must equal the folder name under desktop-plugins/
const ROUTE = '/zedmode'
const TITLEBAR_TOOLS_RIGHT = 'titleBar.tools.right' // native titlebar buttons, left of Settings/Layout/HUD

let CTX = null // set in register(); used for ctx.rest / ctx.os
const zedApi = { hold: null } // set by the mounted Zed Mode view: bring a session up beside the stack

// ── TUNE: every feel-dial in one place ──────
// Values live here, persist in ctx.storage, drive CSS through --hz-* variables on the Zed Mode root
// (and a few JS readers), and can be saved as presets or shared as a "zed1.…" code.
const TUNE = [
  { key: 'paper', group: 'Experimental', label: 'PAPER thread toggle', min: 0, max: 1, step: 1, def: 0, unit: '' },
  { key: 'lift', group: 'Experimental', label: 'Prompt lift', min: 0, max: 120, step: 1, def: 34, unit: 'px' },
  { key: 'work', group: 'Experimental', label: 'Work depth', min: -160, max: 0, step: 1, def: -30, unit: 'px' },
  { key: 'persp', group: 'Experimental', label: 'Perspective', min: 500, max: 3000, step: 50, def: 1300, unit: 'px' },
  { key: 'curve', group: 'Experimental', label: 'Scroll curve', min: 0, max: 40, step: 1, def: 14, unit: '°' },
  { key: 'parallax', group: 'Experimental', label: 'Pointer parallax', min: 0, max: 40, step: 1, def: 14, unit: '%' },
  { key: 'ease', group: 'Experimental', label: 'Parallax ease', min: 0.02, max: 0.5, step: 0.01, def: 0.14, unit: '' },
  { key: 'dive', group: 'Motion', label: 'Hold speed', min: 150, max: 1500, step: 10, def: 520, unit: 'ms' },
  { key: 'zedMs', group: 'Motion', label: 'Enter / exit speed', min: 0, max: 950, step: 10, def: 450, unit: 'ms' },
  { key: 'scrollPx', group: 'Motion', label: 'Scroll per card', min: 30, max: 400, step: 5, def: 110, unit: 'px' },
  { key: 'hoverLift', group: 'Motion', label: 'Hover lift', min: 0, max: 60, step: 1, def: 16, unit: 'px' },
  { key: 'bounce', group: 'Motion', label: 'Needs-you bounce', min: 0, max: 60, step: 1, def: 22, unit: 'px' },
  { key: 'depth', group: 'Stack', label: 'Cards in view', min: 3, max: 24, step: 1, def: 8, unit: '' },
  { key: 'cardZ', group: 'Stack', label: 'Card depth step', min: 0, max: 200, step: 1, def: 90, unit: 'px' },
  { key: 'cardY', group: 'Stack', label: 'Card rise step', min: 0, max: 60, step: 1, def: 30, unit: 'px' },
  { key: 'arcAt', group: 'Stack', label: 'Curve starts at card', min: 0, max: 16, step: 1, def: 3, unit: '' },
  { key: 'arcUp', group: 'Stack', label: 'Curve up', min: 0, max: 30, step: 0.5, def: 5, unit: 'px' },
  { key: 'arcTilt', group: 'Stack', label: 'Curve tilt (− toward you)', min: -20, max: 20, step: 0.5, def: 0, unit: '°' },
  { key: 'backTilt', group: 'Stack', label: 'Back card tilt (− toward you)', min: -30, max: 30, step: 1, def: 0, unit: '°' },
  { key: 'driftX', group: 'Stack', label: 'Sideways drift per card', min: -40, max: 40, step: 1, def: 0, unit: 'px' },
  { key: 'dim', group: 'Stack', label: 'Dim per card', min: 0, max: 0.2, step: 0.01, def: 0.08, unit: '' },
  { key: 'stackPersp', group: 'Stack', label: 'Stack perspective', min: 500, max: 3000, step: 50, def: 1300, unit: 'px' },
  { key: 'eyeY', group: 'Stack', label: 'Eye height', min: -40, max: 100, step: 1, def: 0, unit: '%' },
  { key: 'stackScale', group: 'Stack position', label: 'Size', min: 0.5, max: 1.4, step: 0.01, def: 1, unit: '×' },
  { key: 'stackX', group: 'Stack position', label: 'Left / right', min: -45, max: 45, step: 0.5, def: 0, unit: '%' },
  { key: 'stackY', group: 'Stack position', label: 'Up / down', min: -40, max: 30, step: 0.5, def: 0, unit: '%' },
  { key: 'splitScale', group: 'Hold', label: 'Stack size', min: 0.4, max: 1, step: 0.01, def: 0.72, unit: '×' },
  { key: 'splitX', group: 'Hold', label: 'Stack shift left', min: -45, max: 0, step: 0.5, def: -30, unit: '%' },
  { key: 'splitY', group: 'Hold', label: 'Stack shift down', min: -30, max: 30, step: 0.5, def: 0, unit: '%' },
  { key: 'fgInset', group: 'Hold', label: 'Focused margin', min: 0, max: 80, step: 1, def: 12, unit: 'px' },
  { key: 'splitMin', group: 'Hold', label: 'Side by side from', min: 400, max: 1800, step: 10, def: 860, unit: 'px' },
  { key: 'diffLines', group: 'Content', label: 'Diff preview lines', min: 4, max: 60, step: 1, def: 14, unit: '' }
]
const TUNE_DEFAULTS = Object.fromEntries(TUNE.map(t => [t.key, t.def]))
const BUILTIN_PRESETS = {
  Default: {},
  Subtle: { lift: 16, work: -14, curve: 6, parallax: 6, cardZ: 54, cardY: 26, arcUp: 2, arcTilt: 2 },
  Deep: { lift: 70, work: -80, persp: 1100, curve: 22, parallax: 26, cardZ: 130, cardY: 38, depth: 14, arcUp: 9, arcTilt: 8, stackPersp: 1000 },
  // The Mac stack shape: cards face you, no tilt, each one drifts up and a little sideways.
  'Mac stack': { depth: 9, cardZ: 130, cardY: 34, arcUp: 0, arcTilt: 0, backTilt: 0, driftX: 10, dim: 0.07, stackPersp: 1100 },
  Wave: { depth: 12, cardZ: 100, cardY: 20, arcAt: 2, arcUp: 6, arcTilt: -5, backTilt: 8 },
  'No depth': { lift: 0, work: 0, curve: 0, parallax: 0, cardZ: 0, cardY: 30, arcUp: 0, arcTilt: 0, backTilt: 0 }
}

const tune = { ...TUNE_DEFAULTS } // read directly by JS (parallax, dive, tilt, …) without re-rendering
const tuneSubs = new Set()
let tuneVersion = 0
const clampTune = (key, v) => {
  const t = TUNE.find(x => x.key === key)
  const n = Number(v)
  return t && Number.isFinite(n) ? Math.min(t.max, Math.max(t.min, n)) : undefined
}
function setTune(patch, { persist = true } = {}) {
  for (const [k, v] of Object.entries(patch || {})) {
    const c = clampTune(k, v)
    if (c !== undefined) tune[k] = c
  }
  tuneVersion++
  if (persist) CTX?.storage?.set?.('tune', tuneDiff())
  tuneSubs.forEach(f => f())
}
const tuneDiff = () => Object.fromEntries(TUNE.filter(t => tune[t.key] !== t.def).map(t => [t.key, tune[t.key]]))
const useTune = () => useSyncExternalStore(cb => (tuneSubs.add(cb), () => tuneSubs.delete(cb)), () => tuneVersion)
const tuneVars = () => Object.fromEntries(TUNE.map(t => [`--hz-${t.key}`, String(tune[t.key])]))

// Shareable codes: "zed1." + base64(JSON of the values that differ from default).
const encodeTune = values => 'zed1.' + btoa(unescape(encodeURIComponent(JSON.stringify(values))))
function decodeTune(code) {
  const raw = String(code || '').trim()
  const body = raw.startsWith('zed1.') ? raw.slice(5) : raw
  const parsed = JSON.parse(raw.startsWith('{') ? raw : decodeURIComponent(escape(atob(body))))
  if (!parsed || typeof parsed !== 'object') throw new Error('not a Zed Mode code')
  return Object.fromEntries(Object.entries(parsed).filter(([k, v]) => clampTune(k, v) !== undefined))
}
const userPresets = () => CTX?.storage?.get?.('presets', {}) || {}
const savePreset = (name, values) => CTX?.storage?.set?.('presets', { ...userPresets(), [name]: values })
const deletePreset = name => {
  const p = { ...userPresets() }
  delete p[name]
  CTX?.storage?.set?.('presets', p)
}
const copyText = async text => {
  try {
    if (await CTX?.os?.writeClipboard?.(text)) return true
  } catch {}
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

function TunePanel({ embedded = false, onClose }) {
  useTune()
  const [, force] = useState(0)
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [msg, setMsg] = useState('')
  const presets = { ...BUILTIN_PRESETS, ...userPresets() }
  const say = m => {
    setMsg(m)
    setTimeout(() => setMsg(''), 2200)
  }
  const apply = values => setTune({ ...TUNE_DEFAULTS, ...values })
  const groups = [...new Set(TUNE.map(t => t.group))]
  const btn = (label, onClick, { key, ...extra } = {}) => jsx('button', { type: 'button', className: 'hstk-x', onClick, children: label, ...extra }, key)

  return jsxs('div', {
    className: 'hstk-tune' + (embedded ? ' embedded' : ''),
    onKeyDown: e => e.stopPropagation(),
    children: [
      jsxs('div', { className: 'hd', children: [jsx('b', { children: 'Zed Mode tuning' }, 'b'), jsx('span', { className: 'sp' }, 'sp'), !embedded && btn('✕', onClose, { title: 'Close (`)', key: 'x' })] }, 'hd'),
      jsxs(
        'div',
        {
          className: 'row presets',
          children: [
            ...Object.keys(presets).map(p =>
              jsxs(
                'span',
                {
                  className: 'chip',
                  children: [
                    jsx('button', { type: 'button', onClick: () => (apply(presets[p]), say(`Loaded “${p}”`)), children: p }, 'l'),
                    !BUILTIN_PRESETS[p] && jsx('button', { type: 'button', className: 'del', title: 'Delete preset', onClick: () => (deletePreset(p), force(x => x + 1)), children: '×' }, 'd')
                  ]
                },
                p
              )
            )
          ]
        },
        'presets'
      ),
      jsxs(
        'div',
        {
          className: 'row',
          children: [
            jsx('input', { className: 'txt', placeholder: 'Preset name', value: name, onChange: e => setName(e.target.value) }, 'n'),
            btn('Save', () => {
              const n = name.trim()
              if (!n) return say('Name it first')
              savePreset(n, tuneDiff())
              setName('')
              force(x => x + 1)
              say(`Saved “${n}”`)
            }, { key: 's' })
          ]
        },
        'save'
      ),
      ...groups.map(g =>
        jsxs(
          'div',
          {
            className: 'grp',
            children: [
              jsx('div', { className: 'gl', children: g }, 'gl'),
              ...TUNE.filter(t => t.group === g).map(t =>
                jsxs(
                  'label',
                  {
                    className: 'knob' + (tune[t.key] !== t.def ? ' changed' : ''),
                    children: [
                      jsx('span', { className: 'kl', children: t.label }, 'l'),
                      jsx('input', { type: 'range', min: t.min, max: t.max, step: t.step, value: tune[t.key], 'data-key': t.key, onChange: e => setTune({ [t.key]: e.target.value }) }, 'r'),
                      jsx('span', { className: 'kv', title: 'Double-click to reset', onDoubleClick: () => setTune({ [t.key]: t.def }), children: `${tune[t.key]}${t.unit}` }, 'v')
                    ]
                  },
                  t.key
                )
              )
            ]
          },
          g
        )
      ),
      jsxs(
        'div',
        {
          className: 'row',
          children: [
            btn('Copy code', async () => say((await copyText(encodeTune(tuneDiff()))) ? 'Code copied' : 'Could not copy'), { key: 'c' }),
            btn('Reset all', () => (apply({}), say('Back to defaults')), { key: 'r' })
          ]
        },
        'share'
      ),
      jsxs(
        'div',
        {
          className: 'row',
          children: [
            jsx('input', { className: 'txt', placeholder: 'Paste a zed1.… code', value: code, onChange: e => setCode(e.target.value) }, 'i'),
            btn('Apply', () => {
              try {
                apply(decodeTune(code))
                setCode('')
                say('Code applied')
              } catch {
                say('That isn’t a Zed Mode code')
              }
            }, { key: 'a' })
          ]
        },
        'import'
      ),
      jsx('div', { className: 'msg', children: msg || (embedded ? 'Changes apply live in Zed Mode.' : 'Double-click a value to reset it · ` closes') }, 'msg')
    ]
  })
}


// Zed Mode always opens on the front of the stack; only the thread style is remembered.
const memo = { threadMode: 'flat' }

// ── enter / exit ────────────────────────────────────────────────────────────
let returnTo = '/'
const inZed = () => (window.location.hash || '').startsWith('#' + ROUTE)
// Leaving Zed Mode (esc / Exit, or ⏎ into a native chat): the stack eases out first, then the app goes
// where you asked. `how` picks the direction: 'exit' settles back, 'open' moves through into the chat.
// Instant when the dial is 0, under reduced motion, or when there is no Zed Mode page on screen.
const calm = () => {
  try {
    return Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches)
  } catch {
    return false
  }
}
let leavingZed = false
function leaveThen(how, go) {
  const el = document.querySelector('.hstk[data-view]:not(.inline)')
  const ms = Math.round(tune.zedMs * 0.8)
  if (!el || !inZed() || ms <= 0 || calm()) return go()
  if (leavingZed) return // one departure at a time
  leavingZed = true
  el.dataset.leaving = how
  setTimeout(() => {
    leavingZed = false
    go()
    // If that didn't take the page away (the chat opened elsewhere), come back into view.
    setTimeout(() => el.isConnected && delete el.dataset.leaving, 250)
  }, ms)
}

function toggleZed() {
  haptic('open')
  if (inZed()) leaveThen('exit', () => host.navigate(returnTo || '/'))
  else {
    returnTo = (window.location.hash || '#/').slice(1) || '/'
    host.navigate(ROUTE)
  }
}

// ── helpers ─────────────────────────────────────────────────────────────────
const titleOf = s => s.title || (s.preview || '').slice(0, 70) || 'Untitled'
const ago = secs => {
  try {
    return secs ? relativeTime(secs * 1000) : ''
  } catch {
    return ''
  }
}
const enc = encodeURIComponent
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`
const typing = e => Boolean(e.target?.closest?.('textarea, input, [contenteditable="true"]'))
const oneLine = (s, n = 90) => {
  const t = (s || '').replace(/\s+/g, ' ').trim()
  return t.length > n ? t.slice(0, n - 1) + '…' : t
}

const openSession = (id, e) => {
  haptic('tap')
  if (e?.metaKey) return host.openSession(id, { intent: 'tab' }) // a new tab: Zed Mode stays where it is
  leaveThen('open', () => host.openSession(id, { intent: 'in-place' }))
}

// Send from Zed Mode.
//   Images are staged on the LIVE session first (image.attach_bytes), so a send that carries
//   them goes straight to the gateway on that same session and names the staged paths, exactly
//   as the native composer does. (Handing such a send to the chat's own composer lost them.)
//   Otherwise: the chat's own composer if one is mounted, else the gateway RPC for a live
//   session, else open the chat with the text in its draft.
async function sendPrompt(storedId, liveId, text, images = [], { openIfNeeded = false } = {}) {
  if (liveId && images.length) {
    await host.request('prompt.submit', { session_id: liveId, text, attachments: images.map(i => ({ path: i.path, mime: i.mime || 'image/png' })) })
    return 'sent'
  }
  try {
    if (host.composer?.submit?.(storedId, text)) return 'sent'
  } catch {}
  if (liveId) {
    await host.request('prompt.submit', { session_id: liveId, text })
    return 'sent'
  }
  if (!openIfNeeded) return 'not-live' // typing + ⏎ must never throw you into another view
  host.openSession(storedId)
  setTimeout(() => host.composer?.setDraft?.(storedId, text), 700)
  return 'opened'
}

// A fresh chat, without leaving Zed Mode. The same gateway call the app makes for a new chat
// (`session.create`, optionally in a folder); the answer names the new session and it comes up
// beside the stack with the caret in its composer. The gateway keeps an empty chat out of the
// session list until its first prompt (no "Untitled" litter), so Zed Mode remembers the ones it started
// and shows them as cards meanwhile. If the gateway refuses, the app's own New session opens.
const zedDrafts = new Map() // stored id → { cwd, at }
let startingChat = false
const folderName = p => String(p || '').replace(/\/+$/, '').split('/').pop() || String(p || '')
const workspaceCwd = () => {
  try {
    return host.state?.cwd?.get?.() || ''
  } catch {
    return ''
  }
}
async function newChat(cwd = '') {
  if (startingChat) return null
  startingChat = true
  try {
    const r = await host.request('session.create', { cols: 96, ...(cwd ? { cwd } : {}) })
    const id = r?.stored_session_id
    if (!id) throw new Error('the gateway did not name the new session')
    zedDrafts.set(id, { cwd, at: Date.now() / 1000 })
    haptic('open')
    await queryClient.invalidateQueries({ queryKey: [ID, 'live'] })
    if (zedApi.hold) zedApi.hold(id, true)
    else openSession(id)
    return id
  } catch (err) {
    host.notifyError?.(err, 'Could not start a chat here')
    leaveThen('open', () => (typeof host.newChat === 'function' ? host.newChat() : host.navigate('/')))
    return null
  } finally {
    startingChat = false
  }
}

// The round + at the top left. With somewhere to choose from (the open workspace, folders you
// have worked in), it asks where; otherwise one click starts the chat.
function NewChatButton({ folders }) {
  const [open, setOpen] = useState(false)
  const here = workspaceCwd()
  const places = [
    here && { key: 'here', cwd: here, label: folderName(here), hint: 'open workspace' },
    ...(folders || []).filter(f => f?.path && f.exists !== false && f.path !== here).map(f => ({ key: f.path, cwd: f.path, label: f.name || folderName(f.path), hint: '' })),
    { key: 'none', cwd: '', label: 'No folder', hint: '' }
  ].filter(Boolean)
  const button = extra =>
    jsx('button', { type: 'button', className: 'hstk-new', title: 'New chat, here in Zed Mode', 'aria-label': 'New chat', ...extra, children: Icon('add') })
  if (places.length < 2 || typeof DropdownMenu !== 'function' || typeof DropdownMenuItem !== 'function') return button({ onClick: () => newChat(places[0].cwd) })
  return jsxs(DropdownMenu, {
    open,
    onOpenChange: setOpen,
    children: [
      jsx(DropdownMenuTrigger, { asChild: true, children: button({}) }, 't'),
      jsxs(
        DropdownMenuContent,
        {
          align: 'start',
          className: 'w-64',
          children: [
            jsx('div', { className: 'hstk-newhd', children: 'New chat in…' }, 'h'),
            ...places.map(p =>
              jsxs(
                DropdownMenuItem,
                {
                  onSelect: () => (setOpen(false), newChat(p.cwd)),
                  children: [Icon(p.cwd ? 'folder' : 'comment'), jsx('span', { className: 'hstk-newnm', title: p.cwd, children: p.label }, 'n'), p.hint && jsx('span', { className: 'hstk-newht', children: p.hint }, 'ht')]
                },
                p.key
              )
            )
          ]
        },
        'c'
      )
    ]
  })
}

const SOURCE_ICON = { cli: 'terminal', tui: 'terminal', local: 'comment-discussion', desktop: 'comment-discussion', gui: 'comment-discussion' }
const TOOL_ICON = t =>
  /terminal|shell|process/.test(t)
    ? 'terminal'
    : /read|file/.test(t) && !/write/.test(t)
      ? 'file'
      : /write|patch|edit/.test(t)
        ? 'edit'
        : /search|grep|find/.test(t)
          ? 'search'
          : /web|browser|fetch|url/.test(t)
            ? 'globe'
            : 'tools'

// Render with the app's own markdown renderer; plain text if it can't mount here.
class Safe extends Component {
  constructor(p) {
    super(p)
    this.state = { failed: false }
  }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}
const Markdown = ({ text }) =>
  jsx(Safe, { fallback: jsx('div', { className: 'hstk-plain', children: text }), children: jsx(MessageTextContent, { text }) })

const Icon = (name, cls = '') => jsx(Codicon, { name, size: '12px', className: 'leading-none ' + cls })

// ── data ────────────────────────────────────────────────────────────────────
const q = (key, path, enabled = true, extra = {}) => ({
  queryKey: [ID, ...key],
  queryFn: () => CTX.rest(path),
  enabled: enabled && Boolean(CTX),
  staleTime: 5_000,
  retry: 0,
  ...extra
})

const useAllSessions = limit =>
  useQuery({
    queryKey: [ID, 'sessions', limit],
    queryFn: async () => ((await host.request('session.list', { limit }))?.sessions ?? []).filter(s => (s.message_count ?? 0) > 0),
    refetchInterval: 15_000,
    staleTime: 5_000
  })

// Live sessions in the gateway: { id (runtime), session_key (stored), status, title, last_active }.
const useLive = () =>
  useQuery({
    queryKey: [ID, 'live'],
    queryFn: async () => (await host.request('session.active_list', {}))?.sessions ?? [],
    refetchInterval: 3_000,
    staleTime: 1_000
  })

// A session's chapters. Two feeds:
//   live session  → the gateway's own `session.history` RPC (the projection the classic view
//                   uses on reconnect): no plugin backend, no restart, always current.
//   stored only   → this plugin's backend `/session` (state.db via SessionDB).
// Both normalise to { title, model, total_turns, turns: [{ user, steps, tools, assistant, ts }] }.
function historyToTurns(messages) {
  const out = []
  for (const m of messages || []) {
    if (m.role === 'user') {
      out.push({ user: m.text || '', steps: [], tools: [], assistant: '', ts: m.timestamp, row: m.row_id })
      continue
    }
    if (!out.length) out.push({ user: '', steps: [], tools: [], assistant: '', ts: m.timestamp })
    const t = out[out.length - 1]
    if (m.role === 'assistant' && m.row_id != null) t.row = m.row_id // the chapter ends at its last saved message
    if (m.role === 'assistant' && (m.text || '').trim()) t.steps.push({ k: 'text', text: m.text })
    else if (m.role === 'tool') {
      t.steps.push({ k: 'tool', name: m.name || 'tool', arg: m.context || '', diff: diffOf(m.name, m.content) })
      t.tools.push(m.name || 'tool')
    }
  }
  for (const t of out) t.assistant = t.steps.filter(s => s.k === 'text').map(s => s.text).join('\n\n')
  return { total_turns: out.length, turns: out.slice(-60), source: 'live' }
}

const useSession = (id, liveId, working) =>
  useQuery({
    queryKey: [ID, 'session', id, liveId || 'stored'],
    queryFn: async () => {
      if (liveId) {
        try {
          return historyToTurns((await host.request('session.history', { session_id: liveId }))?.messages)
        } catch {
          // live id went away between polls: fall through to the stored transcript
        }
      }
      return { ...(await CTX.rest(`/session?id=${enc(id)}`)), source: 'stored' }
    },
    enabled: Boolean(id) && Boolean(CTX),
    refetchInterval: working ? 2_500 : liveId ? 8_000 : 20_000,
    staleTime: 1_000,
    retry: 0
  })

// Text the agent is typing right now (between history snapshots), from the gateway event
// stream: message.start/delta/complete + tool.start. `settle` refetches the history.
function useLiveStream(liveId, settle) {
  const [s, setS] = useState({ text: '', tools: [], active: false })
  const [info, setInfo] = useState(null)
  const settleRef = useRef(settle)
  settleRef.current = settle
  useEffect(() => {
    if (!liveId || typeof host.onEvent !== 'function') return
    let timer = null
    const kick = () => {
      clearTimeout(timer)
      timer = setTimeout(() => settleRef.current?.(), 250)
    }
    const idle = { text: '', tools: [], active: false }
    const off = host.onEvent('*', ev => {
      if (!ev || ev.session_id !== liveId) return
      const p = ev.payload || {}
      if (ev.type === 'session.info' && (p.model || p.provider))
        setInfo({ model: p.model || '', provider: p.provider || '', effort: p.reasoning_effort || '', fast: Boolean(p.fast) })
      else if (ev.type === 'message.start') setS({ text: '', tools: [], active: true })
      else if (ev.type === 'message.delta' && typeof p.text === 'string') setS(x => ({ ...x, active: true, text: x.text + p.text }))
      else if (ev.type === 'tool.start') {
        setS(x => ({ ...x, active: true, tools: [...x.tools, { name: p.name || 'tool', arg: p.context || p.preview || '' }] }))
        kick()
      } else if (ev.type === 'tool.complete') kick()
      else if (ev.type === 'message.complete' || /^turn\.(end|complete|done|error)/.test(ev.type)) {
        setS(idle)
        kick()
      }
    })
    return () => {
      clearTimeout(timer)
      if (typeof off === 'function') off()
    }
  }, [liveId])
  return { ...s, info }
}

// The in-flight block: what's streaming in right now, shown after the last chapter.
const Inflight = ({ live, paper }) =>
  live.active &&
  jsxs('div', {
    className: paper ? 'hstk-pitem hstk-preply hstk-inflight' : 'hstk-inflight',
    children: [
      ...live.tools.slice(-6).map((s, i) => jsxs('div', { className: 'hstk-step', children: [Icon(TOOL_ICON(s.name)), jsx('span', { className: 'vb', children: VERB(s.name) }, 'v'), jsx('span', { className: 'tx', children: stepText(s) }, 't')] }, 't' + i)),
      jsxs('div', { className: paper ? 'sheet' : 'hstk-say', children: [live.text ? jsx('span', { className: 'hstk-plain', children: live.text }, 'x') : null, jsx('span', { className: 'hstk-caret' }, 'c')] }, 'txt')
    ]
  })

// When nothing could be loaded: say why. A gateway restart is offered only when the backend
// isn't loaded at all (404); any other error is shown as it is, because a restart won't fix it.
const NoFeed = ({ loading, error }) => {
  const msg = String(error?.message || error || '')
  const missing = !error || /404|not found/i.test(msg)
  return jsx('div', {
    className: 'hstk-empty',
    children: loading
      ? 'Loading…'
      : missing
        ? jsxs('div', {
            children: [
              jsx('div', { children: 'This chat isn’t live, and its stored transcript comes from the Zed Mode backend, which the running gateway hasn’t loaded yet.' }, 'a'),
              jsx('div', { style: { marginTop: 8 }, children: 'One gateway restart fixes it for good (later backend changes reload by themselves). It interrupts chats that are mid-reply.' }, 'b'),
              jsx('button', { className: 'hstk-x primary', style: { marginTop: 10 }, onClick: () => host.restartGateway?.(), children: 'Restart gateway' }, 'c')
            ]
          })
        : jsxs('div', {
            children: [
              jsx('div', { children: 'Couldn’t load this chat’s stored transcript:' }, 'a'),
              jsx('div', { className: 'hstk-plain', style: { marginTop: 6 }, children: oneLine(msg, 300) }, 'b'),
              jsx('div', { style: { marginTop: 8 }, children: 'Use Open to continue it in Hermes.' }, 'c')
            ]
          })
  })
}

// ── attention: the states the stack is ordered by ───────────────────────────
// Native states come from the app's own SessionStatusDot (see DotProbe), so Zed Mode can never
// disagree with the sidebar. "Failed" has no native state: it comes from the gateway's event
// stream (a turn that completed with status "error"), and clears when that session starts again.
const STATES = [
  { key: 'failed', label: 'Failed', icon: 'error', sum: n => `${n} failed` },
  { key: 'needs', label: 'Needs you', icon: 'bell-dot', sum: n => `${n} need${n === 1 ? 's' : ''} you` },
  { key: 'working', label: 'Working', icon: 'sync', sum: n => `${n} working` },
  { key: 'background', label: 'Process running', icon: 'server-process', sum: n => `${n} still running` },
  { key: 'unread', label: 'Unread', icon: 'mail', sum: n => `${n} unread` },
  { key: 'pinned', label: 'Pinned', icon: 'pinned' },
  { key: 'rest', label: '', icon: '' }
]
const STATE_BY_KEY = Object.fromEntries(STATES.map(s => [s.key, s]))
const STATE_RANK = Object.fromEntries(STATES.map((s, i) => [s.key, i]))

const failed = new Map() // live session id → { error, at }
const dotStates = new Map() // stored session id → the native dot's state
const attnSubs = new Set()
let attnVersion = 0
const bumpAttn = () => {
  attnVersion++
  attnSubs.forEach(f => f())
}
const useAttention = () => useSyncExternalStore(cb => (attnSubs.add(cb), () => attnSubs.delete(cb)), () => attnVersion)

function noteEvent(ev) {
  const sid = ev?.session_id
  if (!sid) return
  const p = ev.payload || {}
  if (ev.type === 'message.complete' && p.status === 'error') failed.set(sid, { error: oneLine(String(p.error || p.text || 'The turn failed.'), 400), at: Date.now() })
  else if (ev.type === 'error' && p.message) failed.set(sid, { error: oneLine(String(p.message), 400), at: Date.now() })
  else if ((ev.type === 'message.start' || ev.type === 'message.complete') && failed.has(sid)) failed.delete(sid)
  else return
  CTX?.storage?.set?.('failed', Object.fromEntries(failed))
  bumpAttn()
}

// How SessionStatusDot paints each state (app/chat/session-status-dot.tsx). Read, never written.
const DOT_CLASS = [
  [/amber/, 'needs-input'],
  [/bg-\(--ui-success\)/, 'unread'],
  [/bg-\(--ui-accent\)/, 'working'],
  [/border-\(--ui-accent\)/, 'stalled'],
  [/border-\(--ui-text-tertiary\)/, 'background']
]

// One state per conversation: `r` its row, `l` its live session (if it has one).
function stateOf(r, l) {
  const dot = dotStates.get(r.id)
  const busy = l && (l.status === 'working' || l.status === 'starting')
  if (l && failed.has(l.id) && !busy) return 'failed'
  if (l?.status === 'waiting' || dot === 'needs-input') return 'needs'
  if (busy || dot === 'working' || dot === 'stalled') return 'working'
  if (dot === 'background') return 'background'
  if (dot === 'unread') return 'unread'
  return r.pinned ? 'pinned' : 'rest'
}

// ── styles (scoped `hstk-`; colours are theme variables only) ───────────────
const CSS = `
.hstk{position:relative;height:100%;display:flex;flex-direction:column;outline:none;color:var(--ui-text-primary);min-height:0}
.hstk-bar{display:flex;align-items:center;gap:8px;padding:10px 14px 4px;font-size:11px;color:var(--ui-text-tertiary);min-width:0}
.hstk-bar b{font-weight:600;letter-spacing:.14em;color:var(--ui-text-secondary)}
.hstk-bar .sp{flex:1}
.hstk-crumbs{display:flex;gap:6px;align-items:center;min-width:0;overflow:hidden;white-space:nowrap}
.hstk-crumbs button{all:unset;cursor:pointer;color:var(--ui-text-tertiary);overflow:hidden;text-overflow:ellipsis;max-width:260px}
.hstk-crumbs button:hover{color:var(--ui-text-primary)}
.hstk-crumbs .cur{color:var(--ui-text-primary);overflow:hidden;text-overflow:ellipsis}
.hstk-seg{display:inline-flex;border:1px solid var(--ui-stroke-secondary);border-radius:6px;overflow:hidden;flex:none}
.hstk-seg button,.hstk-x{all:unset;cursor:pointer;padding:2px 8px;font-size:11px;color:var(--ui-text-tertiary);flex:none}
.hstk-seg button[data-on="1"]{background:var(--ui-control-active-background, var(--ui-bg-tertiary));color:var(--ui-text-primary)}
.hstk-x{border:1px solid var(--ui-stroke-secondary);border-radius:6px}
/* new chat: one round button at the top left, by the sidebar's own "New session" */
.hstk-new{all:unset;box-sizing:border-box;cursor:pointer;flex:none;display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:50%;
  border:1px solid var(--ui-stroke-secondary);background:var(--ui-bg-elevated);color:var(--ui-text-secondary);transition:color .15s,border-color .15s,scale .15s}
.hstk-new:hover,.hstk-new:focus-visible{color:var(--ui-text-primary);border-color:var(--ui-accent);scale:1.08}
.hstk-new:active{scale:.94}
.hstk-newhd{padding:6px 10px 4px;font-size:10.5px;letter-spacing:.04em;text-transform:uppercase;color:var(--ui-text-tertiary)}
.hstk-newnm{margin-left:8px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.hstk-newht{margin-left:auto;padding-left:10px;flex:none;font-size:10.5px;color:var(--ui-text-tertiary)}
.hstk-x:hover{color:var(--ui-text-primary);border-color:var(--ui-accent)}
.hstk-x.primary{color:var(--ui-text-primary);border-color:var(--ui-accent)}
.hstk-hint{padding:0 14px 4px;font-size:10.5px;color:var(--ui-text-quaternary, var(--ui-text-tertiary))}
.hstk-note{padding:0 20px 10px;font-size:11px;color:var(--ui-text-tertiary)}

/* thread viewport (a tile, or a held chat) */
.hstk-tv{position:relative;min-height:0;min-width:0;display:flex;flex-direction:column;border-radius:14px;overflow:hidden;
  border:1px solid var(--ui-stroke-secondary);background:var(--ui-bg-elevated);transition:border-color .2s,box-shadow .2s}
.hstk-tv[data-focus="1"]{border-color:var(--ui-accent);box-shadow:0 0 0 1px var(--ui-accent)}
.hstk-tv.solo{margin:6px 14px 14px;flex:1}
.hstk-tv.enter{animation:hstk-in .5s cubic-bezier(.2,.8,.2,1) both}
.hstk-tv.enter .hstk-ch-prompt{animation:hstk-drop .45s .14s cubic-bezier(.2,.8,.2,1) both}
.hstk-tv.enter .hstk-ch-work{animation:hstk-back .5s .2s cubic-bezier(.2,.8,.2,1) both}
.hstk-tv.enter .hstk-comp{animation:hstk-rise .45s .26s cubic-bezier(.2,.8,.2,1) both}
@keyframes hstk-in{from{opacity:0;transform:perspective(1200px) translateZ(-140px) scale(.94)}to{opacity:1;transform:none}}
@keyframes hstk-drop{from{opacity:0;transform:translateY(-16px)}to{opacity:1;transform:none}}
@keyframes hstk-back{from{opacity:0;transform:scale(.95)}to{opacity:.94;transform:scale(.985)}}
@keyframes hstk-rise{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}
.hstk-tvh{flex:none;display:flex;align-items:center;gap:7px;padding:7px 10px 7px 12px;font-size:11px;color:var(--ui-text-tertiary);
  border-bottom:1px solid var(--ui-stroke-tertiary, var(--ui-stroke-secondary))}
.hstk-tvh .t{font-size:12.5px;font-weight:600;color:var(--ui-text-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.hstk-tvh .sp{flex:1}
.hstk-live{width:8px;height:8px;border-radius:50%;flex:none;background:var(--ui-stroke-secondary)}
.hstk-live[data-s="working"],.hstk-live[data-s="starting"]{background:var(--ui-green);animation:hstk-pulse 1.2s ease-in-out infinite}
.hstk-live[data-s="waiting"]{background:var(--ui-yellow)}
.hstk-live[data-s="idle"]{background:color-mix(in oklab, var(--ui-green) 55%, transparent)}
@keyframes hstk-pulse{50%{opacity:.35}}
.hstk-tvb{position:relative;flex:1;min-height:0}
.hstk-tvs{position:absolute;inset:0;overflow-x:hidden;overflow-y:auto;overscroll-behavior:contain;padding:0 34px 18px 16px;scroll-behavior:auto}
.hstk-ch{position:relative;padding-top:2px}
.hstk-ch + .hstk-ch{margin-top:18px}
.hstk-ch-prompt{position:sticky;top:0;z-index:2;margin:0 -6px;padding:10px 6px 8px;cursor:pointer;
  background:var(--ui-bg-elevated)}
.hstk-ch-prompt .bub{display:flex;gap:8px;align-items:flex-start;padding:9px 12px;border-radius:12px;font-size:13px;line-height:1.5;
  background:var(--ui-chat-bubble-background, var(--ui-bg-tertiary));
  box-shadow:0 8px 18px -10px color-mix(in oklab, var(--ui-text-primary) 45%, transparent)}
.hstk-ch-prompt .n{flex:none;font-size:10px;color:var(--ui-text-tertiary);padding-top:2px;font-variant-numeric:tabular-nums}
.hstk-ch-prompt .p{white-space:pre-wrap;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;min-width:0}
.hstk-ch-prompt[data-open="1"] .p{-webkit-line-clamp:unset;display:block}
.hstk-ch-work{transform:scale(.985);transform-origin:50% 0;opacity:.94;padding:4px 4px 0 2px;
  border-left:1px solid var(--ui-stroke-tertiary, var(--ui-stroke-secondary));margin-left:6px;display:flex;flex-direction:column;gap:6px}
.hstk-step{display:flex;gap:8px;align-items:center;font-size:12.5px;line-height:1.5;color:var(--ui-text-tertiary);min-width:0}
.hstk-step .codicon{flex:none;opacity:.8}
.hstk-step .vb{flex:none;color:var(--ui-text-secondary)}
.hstk-step .tx{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.hstk-say{font-size:13px;line-height:1.55;color:var(--ui-text-primary);min-width:0}
.hstk-say.interim{font-size:12px;color:var(--ui-text-secondary)}
.hstk-empty{padding:30px 16px;color:var(--ui-text-tertiary);font-size:12px;line-height:1.5}
.hstk-inflight{display:flex;flex-direction:column;gap:6px;margin-top:14px}
.hstk-caret{display:inline-block;width:7px;height:14px;margin-left:2px;vertical-align:-2px;border-radius:1px;background:var(--ui-accent);animation:hstk-pulse 1s ease-in-out infinite}

/* prompt rail: one tick per prompt (chapter) */
.hstk-rail{position:absolute;right:6px;top:10px;bottom:10px;width:22px;display:flex;flex-direction:column;justify-content:center;
  align-items:flex-end;gap:5px;z-index:4;pointer-events:none}
.hstk-tick{all:unset;position:relative;display:block;height:2px;width:10px;border-radius:2px;cursor:pointer;pointer-events:auto;
  background:var(--ui-text-tertiary);opacity:.55;transition:width .15s,opacity .15s,background .15s;flex:0 1 2px;min-height:2px}
.hstk-tick::after{content:"";position:absolute;inset:-4px -4px}
.hstk-tick:hover{width:16px;opacity:1}
.hstk-tick[data-on="1"]{width:16px;opacity:1;background:var(--ui-text-primary)}
.hstk-tip{position:absolute;right:24px;top:50%;transform:translateY(-50%);width:max-content;max-width:280px;padding:6px 9px;border-radius:8px;
  font-size:11.5px;line-height:1.4;color:var(--ui-text-primary);background:var(--ui-bg-elevated);border:1px solid var(--ui-stroke-secondary);
  box-shadow:0 10px 24px -8px color-mix(in oklab, var(--ui-text-primary) 35%, transparent);opacity:0;pointer-events:none;transition:opacity .12s;white-space:normal}
.hstk-tip i{font-style:normal;color:var(--ui-text-tertiary);margin-right:6px}
.hstk-tick:hover .hstk-tip{opacity:1}

/* composer: the app's composer ring/backing classes + our layout */
.hstk-comp{flex:none;padding:8px 10px 10px;border-top:1px solid var(--ui-stroke-tertiary, var(--ui-stroke-secondary))}
.hstk-cbox{position:relative;isolation:isolate;display:flex;flex-direction:column;border-radius:16px;padding:6px 8px 6px 10px;transition:box-shadow .2s}
.hstk-cbox.drag{box-shadow:0 0 0 2px var(--ui-accent)}
.hstk-cbox textarea{display:block;box-sizing:border-box;width:100%;align-self:stretch;resize:none;min-height:44px;max-height:220px;margin:0;padding:6px 2px;border:0;outline:none;background:transparent;font:inherit;font-size:13px;line-height:1.45;text-align:left;color:var(--ui-text-primary);overflow-y:auto}
.hstk-cbar{display:flex;align-items:center;flex-wrap:wrap;gap:6px;min-height:28px;min-width:0}
.hstk-cbar .sp{flex:1}
.hstk-cbtn{all:unset;box-sizing:border-box;display:inline-flex;align-items:center;gap:4px;height:24px;padding:0 8px;border-radius:7px;cursor:pointer;
  font-size:11.5px;color:var(--ui-text-secondary);max-width:220px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.hstk-cbtn:hover{background:var(--chrome-action-hover, var(--ui-bg-tertiary));color:var(--ui-text-primary)}
.hstk-cbtn.icon{width:26px;padding:0;justify-content:center}
.hstk-cbtn.ghost{cursor:default}
.hstk-cnote{font-size:10.5px;color:var(--ui-text-tertiary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.hstk-csend{all:unset;box-sizing:border-box;display:grid;place-items:center;width:28px;height:28px;border-radius:50%;cursor:pointer;
  background:var(--ui-text-primary);color:var(--ui-bg-elevated)}
.hstk-csend:disabled{opacity:.35;cursor:default}
.hstk-imgs{display:flex;gap:6px;flex-wrap:wrap;padding:4px 0}
.hstk-img{position:relative;width:52px;height:52px;border-radius:8px;overflow:hidden;border:1px solid var(--ui-stroke-secondary);display:grid;place-items:center}
.hstk-img img{width:100%;height:100%;object-fit:cover}
.hstk-img button{all:unset;position:absolute;top:2px;right:2px;width:16px;height:16px;border-radius:50%;display:grid;place-items:center;cursor:pointer;
  background:var(--ui-bg-elevated);color:var(--ui-text-secondary)}
.hstk-refs{display:flex;gap:6px;flex-wrap:wrap;padding:4px 0}
.hstk-ref{display:inline-flex;align-items:center;gap:5px;max-width:240px;padding:2px 4px 2px 7px;border-radius:7px;font-size:11.5px;color:var(--ui-text-secondary);
  border:1px solid var(--ui-stroke-secondary);background:var(--ui-bg-tertiary, transparent)}
.hstk-ref .l{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.hstk-ref button{all:unset;cursor:pointer;display:grid;place-items:center;width:16px;height:16px;border-radius:4px;color:var(--ui-text-tertiary)}
.hstk-ref button:hover{color:var(--ui-text-primary)}
.hstk-urlbox{margin:4px 0;padding:5px 8px;border-radius:8px;border:1px solid var(--ui-stroke-secondary);background:transparent;color:var(--ui-text-primary);font:inherit;font-size:12.5px;outline:none}
.hstk-urlbox:focus{border-color:var(--ui-accent)}
.hstk-paper .hstk-cbox{max-width:820px;margin:0 auto;width:100%;box-sizing:border-box}

/* edits: diff summary + the app-rendered diff */
.hstk-diff{display:flex;flex-direction:column;min-width:0}
.hstk-diffsum{all:unset;box-sizing:border-box;cursor:pointer;display:flex;gap:7px;align-items:center;font-size:11.5px;color:var(--ui-text-tertiary);min-width:0}
.hstk-diffsum:hover .nm{color:var(--ui-text-primary)}
.hstk-diffsum .stat{margin-left:auto;display:flex;gap:6px;font-variant-numeric:tabular-nums;flex:none}
.hstk-diffsum .add{font-weight:500;color:var(--ui-diff-add-foreground, var(--ui-green))}
.hstk-diffsum .del{font-weight:500;color:var(--ui-diff-remove-foreground, var(--ui-red))}
.hstk-diffbody{margin:6px 0 4px;font-size:12px;min-width:0;overflow:auto;max-height:420px}

/* HOME: one Z stack, most urgent first. ⇧⏎ steps it down-left and floats the thread on the right. */
.hstk [data-state="failed"]{--hstk-c:var(--ui-red)}
.hstk [data-state="needs"]{--hstk-c:var(--ui-yellow)}
.hstk [data-state="working"]{--hstk-c:var(--ui-accent)}
.hstk [data-state="background"]{--hstk-c:var(--ui-text-tertiary)}
.hstk [data-state="unread"]{--hstk-c:var(--ui-success, var(--ui-green))}
.hstk [data-state="pinned"]{--hstk-c:var(--ui-accent)}
.hstk [data-state="rest"]{--hstk-c:var(--ui-text-tertiary)}
.hstk-home{position:relative;flex:1;min-height:0;overflow:hidden}
.hstk-stackpane{position:absolute;inset:0;display:flex;justify-content:center;transform-origin:50% 100%;
  transition:transform calc(var(--hz-dive,520) * 1ms) cubic-bezier(.2,.8,.2,1),opacity .4s}
.hstk-home.arranging .hstk-stackpane{transition:none}
.hstk-guides{position:absolute;inset:0;z-index:1;pointer-events:none}
.hstk-guides i{position:absolute;background:color-mix(in oklab, var(--ui-accent) 55%, transparent)}
.hstk-guides .v{left:50%;top:0;bottom:0;width:1px}
.hstk-guides .h{top:50%;left:0;right:0;height:1px}
.hstk-guides .lim{top:0;bottom:0;width:0;background:none;border-left:1px dashed var(--ui-yellow)}
.hstk-grip{all:unset;flex:none;display:grid;place-items:center;width:20px;height:20px;margin-right:-5px;border-radius:5px;cursor:grab;color:var(--ui-text-tertiary);touch-action:none}
.hstk-grip:hover{color:var(--ui-text-primary);background:var(--ui-bg-tertiary, transparent)}
.hstk-home.arranging .hstk-grip{cursor:grabbing;color:var(--ui-accent)}
.hstk-home[data-split="1"][data-half="thread"] .hstk-stackpane{opacity:.8}
.hstk-stackin{flex:none;width:min(700px,50%);min-width:0;min-height:0;display:flex;flex-direction:column}
/* the state counts: plain labels just under the front card (which sits at bottom:12% of the stage),
   inside the placed stack so they move and scale with it */
.hstk-stagewrap{position:relative;flex:1;min-height:260px;display:flex;flex-direction:column}
.hstk-sum{position:absolute;left:0;right:0;top:calc(88% + 12px);z-index:200;display:flex;flex-wrap:wrap;gap:4px 16px;justify-content:center;align-items:center;font-size:11px;color:var(--ui-text-tertiary);pointer-events:none}
.hstk-sum > *{pointer-events:auto}
.hstk-chip{all:unset;cursor:pointer;display:inline-flex;align-items:center;gap:6px;font-weight:500;color:var(--ui-text-secondary);transition:color .15s}
.hstk-chip i{width:6px;height:6px;border-radius:50%;background:var(--hstk-c)}
.hstk-chip:hover,.hstk-chip:focus-visible{color:var(--ui-text-primary)}
.hstk-count{flex:none;text-align:center;padding:0 0 10px;font-size:10.5px;color:var(--ui-text-tertiary);font-variant-numeric:tabular-nums}
.hstk-stage{position:relative;flex:1;min-height:260px;perspective:calc(var(--hz-stackPersp,1300) * 1px);perspective-origin:50% calc(var(--hz-eyeY,0) * 1%)}
.hstk-card{position:absolute;left:5%;right:5%;bottom:12%;aspect-ratio:16/10;max-height:64%;border-radius:14px;display:flex;flex-direction:column;
  border:1px solid var(--ui-stroke-secondary);background:var(--ui-bg-elevated);cursor:pointer;overflow:hidden;
  box-shadow:0 14px 34px color-mix(in oklab, var(--ui-text-primary) 16%, transparent);
  transform-origin:50% 100%;transition:transform .45s cubic-bezier(.2,.8,.2,1),opacity .45s,filter .45s,border-color .2s,box-shadow .3s,translate .22s cubic-bezier(.2,.8,.2,1)}
.hstk-card.sel{border-color:var(--ui-accent);box-shadow:0 0 0 1px var(--ui-accent),0 20px 44px color-mix(in oklab, var(--ui-accent) 22%, transparent)}
.hstk-card.ghost{border-style:dashed;background:transparent;box-shadow:none;cursor:default;justify-content:center;text-align:center}
/* states that want you wear their colour; a working card wears the app's own running arc instead */
.hstk-card[data-state="failed"],.hstk-card[data-state="needs"],.hstk-card[data-state="unread"]{border-color:var(--hstk-c);
  box-shadow:0 0 0 1px var(--hstk-c),0 18px 44px -12px color-mix(in oklab, var(--hstk-c) 40%, transparent)}
.hstk-card[data-state="working"]{border-color:var(--ui-stroke-secondary);box-shadow:0 18px 44px -12px color-mix(in oklab, var(--ui-text-primary) 30%, transparent)}
.hstk-card[data-state="background"]{border-style:dashed}
.hstk-card[data-state="pinned"]{border-top:2px solid var(--ui-accent)}
.hstk-arc{--arc-standoff:0px;--arc-radius:13px;--arc-width:1.5px;z-index:3}
.hstk-chrome{flex:none;height:30px;display:flex;align-items:center;gap:7px;padding:0 12px;font-size:11.5px;
  color:var(--ui-text-secondary);border-bottom:1px solid var(--ui-stroke-tertiary, var(--ui-stroke-secondary))}
.hstk-chrome .lab{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.hstk-card.sel .hstk-chrome .lab{color:var(--ui-text-tertiary)}
.hstk-ndot{flex:none;display:inline-flex;width:10px;justify-content:center}
.hstk-chrome .lab{margin-right:auto}
.hstk-state{flex:none;display:inline-flex;gap:4px;align-items:center;font-size:10.5px;font-weight:600;color:var(--hstk-c)}
.hstk-body{flex:1;padding:12px 14px 0;min-height:0;overflow:hidden;
  -webkit-mask-image:linear-gradient(to bottom, black calc(100% - 70px), transparent calc(100% - 40px));mask-image:linear-gradient(to bottom, black calc(100% - 70px), transparent calc(100% - 40px))}
.hstk-card.ghost .hstk-body{flex:none;-webkit-mask-image:none;mask-image:none;padding-bottom:12px}
.hstk-title{font-size:16px;font-weight:600;line-height:1.25;margin-bottom:6px;color:var(--ui-text-primary);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.hstk-prev{font-size:13px;line-height:1.45;color:var(--ui-text-secondary);white-space:pre-line;display:-webkit-box;-webkit-line-clamp:5;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere}
.hstk-lead{font-size:13px;line-height:1.45;margin-bottom:8px;color:var(--ui-text-secondary);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere}
.hstk-card[data-state="failed"] .hstk-lead{color:var(--ui-red)}
.hstk-plist{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:5px;font-size:13px;line-height:1.4;color:var(--ui-text-secondary)}
.hstk-plist li{display:flex;gap:8px;min-width:0}
.hstk-plist li i{flex:none;min-width:22px;font-style:normal;font-size:10.5px;padding-top:2px;color:var(--ui-text-tertiary);font-variant-numeric:tabular-nums}
.hstk-plist li span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.hstk-plist li:first-child{color:var(--ui-text-primary)}
.hstk-titlebox{display:block;box-sizing:border-box;width:100%;margin:-3px 0 3px -5px;padding:2px 4px;border-radius:6px;border:1px solid var(--ui-accent);background:transparent;outline:none;font:inherit;font-size:16px;font-weight:600}
.hstk-rename{all:unset;flex:none;display:grid;place-items:center;width:20px;height:20px;border-radius:5px;cursor:pointer;color:var(--ui-text-tertiary)}
.hstk-rename:hover{color:var(--ui-text-primary);background:var(--ui-bg-tertiary, transparent)}
.hstk-stage.scrolling .hstk-card{transition-duration:.09s;transition-timing-function:linear}
/* hover: a card behind the front one lifts toward you and lights up.
   The translate property is separate from the inline transform, so it adds to the card's place in the stack. */
.hstk-stage:not(.scrolling) .hstk-card:not(.sel):not(.ghost):hover{translate:0 calc(var(--hz-hoverLift,16) * -1px) calc(var(--hz-hoverLift,16) * 1.5px);filter:none !important;animation:none}
/* a conversation waiting on you hops like a Dock icon asking for attention: two bounces, then a rest */
@keyframes hstk-hop{0%,30%,100%{translate:0 0}7%{translate:0 calc(var(--hz-bounce,22) * -1px)}14%{translate:0 0}20%{translate:0 calc(var(--hz-bounce,22) * -.45px)}26%{translate:0 0}}
.hstk-home[data-split="0"] .hstk-card[data-state="needs"]{animation:hstk-hop 3.4s cubic-bezier(.3,0,.4,1) infinite}
@media (prefers-reduced-motion: reduce){.hstk-card[data-state="needs"]{animation:none !important}}
.hstk-meta{flex-wrap:nowrap;overflow:hidden;-webkit-mask-image:linear-gradient(to right, black calc(100% - 30px), transparent);mask-image:linear-gradient(to right, black calc(100% - 30px), transparent)}
.hstk-meta > *{flex:none}
.hstk-pill.fact{color:var(--ui-text-secondary)}
.hstk-pill.fact[data-fact="app"]{border-color:var(--ui-accent);color:var(--ui-text-primary)}
.hstk-pill.fact .add{font-weight:500;color:var(--ui-diff-add-foreground, var(--ui-green))}
.hstk-pill.fact .del{font-weight:500;color:var(--ui-diff-remove-foreground, var(--ui-red))}
/* a waiting card's request, and the buttons that answer it */
.hstk-ask{display:flex;flex-direction:column;gap:7px;margin:0 0 10px;padding:9px 10px;border-radius:10px;cursor:default;
  border:1px solid color-mix(in oklab, var(--ui-yellow) 55%, transparent);background:color-mix(in oklab, var(--ui-yellow) 7%, transparent)}
.hstk-ask .what{font-size:13px;line-height:1.4;color:var(--ui-text-primary);overflow-wrap:anywhere}
.hstk-ask .cmd{margin:0;padding:6px 8px;border-radius:7px;max-height:84px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;
  font-family:var(--font-mono, ui-monospace, monospace);font-size:12px;line-height:1.45;color:var(--ui-text-primary);background:var(--ui-bg-tertiary, var(--ui-bg-elevated))}
.hstk-ask .row{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.hstk-ask .hstk-x{padding:3px 10px;font-size:12px;color:var(--ui-text-secondary)}
.hstk-ask .hstk-x.primary{background:var(--ui-text-primary);color:var(--ui-bg-elevated);border-color:var(--ui-text-primary)}
.hstk-ask .hstk-x[data-choice="deny"]:hover{border-color:var(--ui-red);color:var(--ui-red)}
.hstk-ask .hstk-x:disabled{opacity:.5;cursor:default}
.hstk-ask .more{font-size:11px;color:var(--ui-text-tertiary)}
.hstk-ask .err{font-size:11.5px;color:var(--ui-red)}
.hstk-meta{position:absolute;left:10px;right:12px;bottom:9px;display:flex;gap:5px;align-items:center;font-size:10px;color:var(--ui-text-tertiary)}
.hstk-badge{flex:none;width:20px;height:20px;border-radius:50%;display:grid;place-items:center;color:var(--ui-text-secondary);
  background:var(--ui-bg-tertiary, var(--ui-bg-elevated));border:1px solid var(--ui-stroke-secondary)}
.hstk-card[data-state="pinned"] .hstk-badge{color:var(--ui-accent);border-color:var(--ui-accent)}
.hstk-pill{border:1px solid var(--ui-stroke-secondary);border-radius:99px;padding:1px 6px;white-space:nowrap}
.hstk-plain{white-space:pre-wrap}
/* the held conversation: right of the stack, sitting a little higher */
.hstk-float{position:absolute;top:8px;right:14px;bottom:calc(6% + 14px);left:41%;display:flex;min-width:0;min-height:0;border-radius:16px;
  opacity:0;transform:translate(48px,26px) scale(.97);pointer-events:none;
  transition:transform calc(var(--hz-dive,520) * 1ms) cubic-bezier(.2,.8,.2,1),opacity calc(var(--hz-dive,520) * .8ms),top calc(var(--hz-dive,520) * 1ms) cubic-bezier(.2,.8,.2,1),right calc(var(--hz-dive,520) * 1ms) cubic-bezier(.2,.8,.2,1),bottom calc(var(--hz-dive,520) * 1ms) cubic-bezier(.2,.8,.2,1),left calc(var(--hz-dive,520) * 1ms) cubic-bezier(.2,.8,.2,1);
  box-shadow:0 30px 80px -24px color-mix(in oklab, var(--ui-text-primary) 45%, transparent)}
.hstk-float[data-open="1"]{opacity:1;transform:none;pointer-events:auto}
/* foreground (⇧⏎ again, or any pane narrower than "Side by side from"): the thread grows to fill
   the pane, leaving only the "Focused margin" around it; the stack steps back behind it. */
.hstk-home[data-full="1"] .hstk-float{top:calc(var(--hz-fgInset,12) * 1px);right:calc(var(--hz-fgInset,12) * 1px);bottom:calc(var(--hz-fgInset,12) * 1px);left:calc(var(--hz-fgInset,12) * 1px)}
.hstk-home[data-narrow="1"] .hstk-float{border-radius:12px}
.hstk-home[data-narrow="1"] .hstk-tvh .meta{display:none}
.hstk-float > *{flex:1;min-width:0}
.hstk.inline{height:460px;border:1px solid var(--ui-stroke-secondary);border-radius:12px}
.hstk.inline .hstk-stackin{width:min(520px,86%)}

/* PAPER: the classic chat layout, 3D-ified */
.hstk-paper{position:relative;min-height:0;display:flex;flex-direction:column;border-radius:16px;overflow:hidden;
  border:1px solid var(--ui-stroke-secondary);background:var(--ui-bg-elevated)}
.hstk-pstrip{all:unset;box-sizing:border-box;flex:none;display:block;cursor:pointer;padding:8px 40px 8px 16px;
  border-bottom:1px solid var(--ui-stroke-tertiary, var(--ui-stroke-secondary));
  background:color-mix(in oklab, var(--ui-chat-bubble-background, var(--ui-bg-tertiary)) 70%, var(--ui-bg-elevated))}
.hstk-pstrip .in{display:flex;gap:8px;max-width:820px;margin:0 auto;font-size:12.5px;line-height:1.45}
.hstk-pstrip .n{flex:none;font-size:10px;color:var(--ui-text-tertiary);padding-top:2px}
.hstk-pstrip .p{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.hstk-pbody{position:relative;flex:1;min-height:0}
.hstk-pscroll{position:absolute;inset:0;overflow-x:hidden;overflow-y:auto;overscroll-behavior:contain;perspective:calc(var(--hz-persp,1300) * 1px);perspective-origin:50% 50%;padding:22px 40px 40px 20px}
.hstk-pcol{width:100%;min-width:0;max-width:820px;margin:0 auto;transform-style:preserve-3d;display:flex;flex-direction:column;gap:26px}
.hstk-pch{min-width:0;transform-style:preserve-3d;display:flex;flex-direction:column;gap:14px}
.hstk-pitem{transform-style:preserve-3d;transition:translate .7s cubic-bezier(.2,.8,.2,1),filter .7s,opacity .7s}
.hstk-puser{align-self:flex-end;max-width:80%}
.hstk-puser .sheet{display:flex;gap:8px;padding:10px 14px;border-radius:14px;font-size:14px;line-height:1.55;white-space:pre-wrap;
  background:var(--ui-chat-bubble-background, var(--ui-bg-tertiary))}
.hstk-puser .n{flex:none;font-size:10px;color:var(--ui-text-tertiary);padding-top:3px}
.hstk-preply .sheet{padding:0 2px;font-size:14px;line-height:1.65}
.hstk-pfold{align-self:stretch;margin:0}
.hstk-pfold .sum{all:unset;box-sizing:border-box;width:100%;display:flex;gap:6px;align-items:center;padding:2px 0;cursor:pointer;font-size:12.5px;color:var(--ui-text-tertiary)}
.hstk-pfold .sum:hover{color:var(--ui-text-secondary)}
.hstk-pfold .sum .tx{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.hstk-pfold .leaf{padding:6px 0 2px;display:flex;flex-direction:column;gap:5px;transform-origin:50% 0;animation:hstk-unfold .35s cubic-bezier(.2,.8,.2,1) both}
@keyframes hstk-unfold{from{opacity:0;transform:rotateX(-70deg)}to{opacity:1;transform:none}}
/* the layers lift apart once the dive lands */
.hstk-paper[data-phase="paper"] .hstk-puser{translate:0 0 calc(var(--hz-lift,34) * 1px)}
.hstk-paper[data-phase="paper"] .hstk-puser .sheet{box-shadow:0 16px 28px -18px color-mix(in oklab, var(--ui-text-primary) 50%, transparent)}
.hstk-paper[data-phase="paper"] .hstk-pfold{translate:0 0 calc(var(--hz-work,-30) * 1px);opacity:.9}
/* sheets curve away at the top and bottom edges of the viewport as you scroll */
@supports (animation-timeline: view()) {
  .hstk-paper[data-phase="paper"] .hstk-pitem{animation:hstk-curve linear both;animation-timeline:view()}
}
@keyframes hstk-curve{0%{transform:rotateX(calc(var(--hz-curve,14) * -1deg)) translateY(10px);opacity:.35}18%,82%{transform:none;opacity:1}100%{transform:rotateX(calc(var(--hz-curve,14) * 1deg)) translateY(-10px);opacity:.35}}
.hstk-paper .hstk-comp{background:var(--ui-bg-elevated)}
.hstk-paper .hstk-comp textarea{min-height:56px}
/* containment: long words, code, tables and images wrap or scroll inside their own box */
.hstk{min-width:0;overflow-x:hidden}
/* entering and leaving Zed Mode */
@keyframes hstk-zed-in{from{opacity:0;transform:scale(.965)}}
.hstk[data-view]:not(.inline){animation:hstk-zed-in calc(var(--hz-zedMs,450) * 1ms) cubic-bezier(.2,.8,.2,1);
  transition:opacity calc(var(--hz-zedMs,450) * .8ms) ease,transform calc(var(--hz-zedMs,450) * .8ms) cubic-bezier(.4,0,.2,1)}
.hstk[data-leaving]{opacity:0;pointer-events:none}
.hstk[data-leaving="exit"]{transform:scale(.97)}
.hstk[data-leaving="open"]{transform:scale(1.035)}
@media (prefers-reduced-motion: reduce){.hstk[data-view]:not(.inline){animation:none;transition:none}}
.hstk-tv,.hstk-paper,.hstk-float,.hstk-tvb,.hstk-pbody{min-width:0}
.hstk-pitem,.hstk-ch,.hstk-ch-work,.hstk-say,.hstk-preply .sheet,.hstk-inflight{min-width:0;max-width:100%}
.hstk-say,.hstk-preply .sheet,.hstk-puser .sheet,.hstk-ch-prompt .p,.hstk-pstrip .p,.hstk-plain,.hstk-cbox textarea{overflow-wrap:anywhere;word-break:break-word}
.hstk-puser{margin-right:14px}
.hstk-tvh .t{flex:0 1 auto}
.hstk-tvh .meta{flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.hstk-tv pre,.hstk-paper pre,.hstk-diffbody pre{max-width:100%;overflow-x:auto}
.hstk-tv table,.hstk-paper table{display:block;max-width:100%;overflow-x:auto}
.hstk-tv img,.hstk-paper img{max-width:100%;height:auto}
/* previews, canvases and players: never wider than the thread column, whatever width they ask for */
.hstk-tv iframe,.hstk-tv video,.hstk-tv canvas,.hstk-tv svg,.hstk-tv audio,.hstk-paper iframe,.hstk-paper video,.hstk-paper canvas,.hstk-paper svg{max-width:100%}
.hstk-say > *,.hstk-say [class*="max-w-"]{max-width:100% !important;min-width:0}
/* the work layer's slight shrink would blur an embedded frame: replies with embeds stay at 1:1 */
.hstk-ch-work:has(iframe),.hstk-ch-work:has(video),.hstk-ch-work:has(canvas),.hstk-tv.enter .hstk-ch-work:has(iframe),.hstk-tv.enter .hstk-ch-work:has(video),.hstk-tv.enter .hstk-ch-work:has(canvas){transform:none;opacity:1;animation:none}
.hstk-diffbody{max-width:100%}
.hstk-pstrip .in{min-width:0}
/* edits: native compact edit card (open, clamped, scrollable, tinted lines) */
.hstk-diff{display:flex;flex-direction:column;min-width:0;max-width:100%}
.hstk-sdiff{margin:4px 0 6px;min-width:0;max-width:100%;overflow:auto;border-radius:8px;border:1px solid var(--ui-stroke-tertiary, var(--ui-stroke-secondary));
  font-size:var(--conversation-tool-font-size, 12px)}
.hstk-sdiff.rich pre{margin:0 !important;border:0 !important;background:transparent !important;max-height:none !important;overflow:visible !important}
.hstk-sdiff.rich code > .line{display:inline-block;min-width:100%;padding:0 10px;box-sizing:border-box}
.hstk-sdiff.rich [class*="header"],.hstk-sdiff.rich button[aria-label*="opy"]{display:none}
.hstk-dlines{margin:0;padding:4px 0;font-family:var(--font-mono, ui-monospace, monospace);font-size:11.5px;line-height:20px;white-space:pre;color:var(--ui-text-secondary)}
.hstk-dlines .dl{display:block;min-width:max-content;padding:0 10px;border-left:2px solid transparent}
.hstk-dlines .dl.add{background:var(--ui-diff-add-background);border-left-color:var(--ui-diff-add-border);color:var(--ui-diff-add-foreground, var(--ui-text-primary))}
.hstk-dlines .dl.remove{background:var(--ui-diff-remove-background);border-left-color:var(--ui-diff-remove-border);color:var(--ui-diff-remove-foreground, var(--ui-text-primary))}
.hstk-dlines .dl.gap{height:8px;border-top:1px dashed var(--ui-stroke-tertiary, var(--ui-stroke-secondary));margin-top:4px}
.hstk-pfold .leaf.edits{animation:none}

/* Zed Mode tuning panel (dev) — also embedded in Settings → Plugins → Zed Mode */
.hstk-tune{position:absolute;top:44px;right:14px;z-index:60;width:300px;max-height:calc(100% - 60px);overflow:auto;padding:10px 12px;border-radius:12px;
  background:var(--ui-bg-elevated);border:1px solid var(--ui-stroke-secondary);box-shadow:0 20px 50px -18px color-mix(in oklab, var(--ui-text-primary) 45%, transparent);
  font-size:11.5px;color:var(--ui-text-secondary)}
.hstk-tune.embedded{position:static;width:auto;max-width:520px;max-height:none;box-shadow:none}
.hstk-tune .hd{display:flex;align-items:center;gap:6px;margin-bottom:6px;color:var(--ui-text-primary)}
.hstk-tune .hd .sp{flex:1}
.hstk-tune .row{display:flex;gap:6px;align-items:center;margin:6px 0;flex-wrap:wrap}
.hstk-tune .chip{display:inline-flex;border:1px solid var(--ui-stroke-secondary);border-radius:99px;overflow:hidden}
.hstk-tune .chip button{all:unset;cursor:pointer;padding:2px 8px}
.hstk-tune .chip button:hover{color:var(--ui-text-primary);background:var(--ui-bg-tertiary, transparent)}
.hstk-tune .chip .del{padding:2px 6px;border-left:1px solid var(--ui-stroke-secondary)}
.hstk-tune .txt{flex:1;min-width:0;padding:3px 7px;border-radius:6px;border:1px solid var(--ui-stroke-secondary);background:transparent;color:var(--ui-text-primary);font:inherit}
.hstk-tune .grp{margin:10px 0 4px}
.hstk-tune .gl{font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:var(--ui-text-tertiary);margin-bottom:2px}
.hstk-tune .knob{display:grid;grid-template-columns:110px 1fr 56px;gap:8px;align-items:center;padding:2px 0}
.hstk-tune .knob input{width:100%;accent-color:var(--ui-accent)}
.hstk-tune .knob .kv{text-align:right;font-variant-numeric:tabular-nums;cursor:default}
.hstk-tune .knob.changed .kl{color:var(--ui-text-primary)}
.hstk-tune .knob.changed .kv{color:var(--ui-accent)}
.hstk-tune .msg{margin-top:6px;color:var(--ui-text-tertiary);min-height:1.2em}
/* model pill: provider · model · effort, with its state (pending / deferred / failed / confirmed) */
.hstk-modelwrap{display:contents}
.hstk-model{all:unset;box-sizing:border-box;display:inline-flex;align-items:center;gap:5px;height:24px;padding:0 8px;border-radius:7px;cursor:pointer;
  font-size:11.5px;color:var(--ui-text-secondary);min-width:0;max-width:100%;white-space:nowrap;transition:background .2s,color .2s,box-shadow .3s}
.hstk-model:not(.ghost):hover{background:var(--chrome-action-hover, var(--ui-bg-tertiary));color:var(--ui-text-primary)}
/* no menu to offer: a plain label, not a button (no hover, no pointer). A chat that is not live gets .open instead: a button that opens it in Hermes */
.hstk-model.ghost{cursor:default}
.hstk-model.ghost .nm{color:var(--ui-text-secondary)}
.hstk-model.open .nm{color:var(--ui-text-secondary)}
.hstk-model.open:hover .nm{color:var(--ui-text-primary)}
.hstk-model .pv{color:var(--ui-text-tertiary);flex:none}
.hstk-model .pv::after{content:'·';margin-left:5px}
.hstk-model .nm{overflow:hidden;text-overflow:ellipsis;min-width:0;color:var(--ui-text-primary)}
.hstk-model .ef{flex:none;font-size:10px;padding:0 5px;border-radius:99px;border:1px solid var(--ui-stroke-secondary);color:var(--ui-text-tertiary)}
.hstk-model .st{display:inline-flex;flex:none}
.hstk-model[data-status="pending"] .nm{opacity:.7}
.hstk-model[data-status="deferred"] .st{color:var(--ui-yellow)}
.hstk-model[data-status="failed"] .st{color:var(--ui-red)}
.hstk-model.flash{box-shadow:0 0 0 1px var(--ui-accent);animation:hstk-mflash 1.2s ease-out}
@keyframes hstk-mflash{0%{background:color-mix(in oklab, var(--ui-accent) 22%, transparent)}100%{background:transparent}}
.hstk-mnote{order:20;flex:1 1 100%;display:flex;align-items:center;gap:6px;min-width:0;padding:2px 2px 0;font-size:10.5px;color:var(--ui-text-tertiary)}
.hstk-mhidden{display:flex;align-items:center;gap:8px;padding:7px 10px;font-size:11px;color:var(--ui-text-tertiary);border-top:1px solid var(--ui-stroke-tertiary, var(--ui-stroke-secondary))}
.hstk-mhidden .tx{flex:1;min-width:0}
.hstk-mhidden .fix{all:unset;flex:none;cursor:pointer;padding:1px 7px;border-radius:6px;border:1px solid currentColor}
.hstk-mnote .fix{all:unset;flex:none;cursor:pointer;padding:1px 7px;border-radius:6px;border:1px solid currentColor;font-size:10.5px}
.hstk-mnote .fix:hover{background:color-mix(in oklab, currentColor 12%, transparent)}
.hstk-mnote .tx{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.hstk-mnote[data-status="failed"]{color:var(--ui-red)}
.hstk-mnote[data-status="failed"] .tx{white-space:normal;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
.hstk-mnote button{all:unset;cursor:pointer;display:inline-flex;opacity:.7}
.hstk-mnote button:hover{opacity:1}
.hstk-model{flex:0 1 auto;min-width:84px;max-width:min(320px,60%)}
/* branch: from a prompt (shows on hover / focus) */
.hstk-ch-prompt .bub{position:relative}
.hstk-ch-prompt .br{all:unset;flex:none;align-self:flex-start;cursor:pointer;padding:1px 4px;border-radius:6px;color:var(--ui-text-tertiary);opacity:0;transition:opacity .15s}
.hstk-ch-prompt:hover .br,.hstk-ch-prompt .br:focus-visible{opacity:1}
.hstk-ch-prompt .br:hover:not(:disabled){color:var(--ui-text-primary);background:var(--chrome-action-hover, var(--ui-bg-tertiary))}
.hstk-ch-prompt .br:disabled{cursor:default}
`

// ── threads: shared state (data, scroll, chapters, rail, composer) ──────────
function Steps({ steps, assistant }) {
  const list = steps?.length ? steps : assistant ? [{ k: 'text', text: assistant }] : []
  const lastText = list.map(s => s.k).lastIndexOf('text')
  return list.map((s, i) =>
    s.k === 'tool'
      ? s.diff
        ? jsx(DiffStep, { s }, i)
        : jsxs('div', { className: 'hstk-step', title: s.arg || s.name, children: [Icon(TOOL_ICON(s.name)), jsx('span', { className: 'vb', children: VERB(s.name) }, 'v'), jsx('span', { className: 'tx', children: stepText(s) }, 't')] }, i)
      : jsx('div', { className: 'hstk-say' + (i === lastText ? '' : ' interim'), children: jsx(Markdown, { text: s.text }) }, i)
  )
}

// An edit the agent made, the way the native edit card shows it: open by default, clamped to a
// few lines and scrollable, file headers / @@ / +− dropped, each changed line tinted with the
// theme's diff colours and a 2px gutter accent. Syntax colours come from the app's own Markdown
// code block (Shiki) in the file's language, with per-line tints laid over its `.line` rows;
// until the block is on screen (or if Shiki's line structure isn't there) it shows the
// plain tinted rows, like the native card's own fallback.
const LANG_BY_EXT = { js: 'js', mjs: 'js', cjs: 'js', jsx: 'jsx', ts: 'ts', tsx: 'tsx', py: 'python', md: 'markdown', json: 'json', css: 'css', scss: 'scss', html: 'html', sh: 'bash', zsh: 'bash', bash: 'bash', yml: 'yaml', yaml: 'yaml', toml: 'toml', swift: 'swift', rs: 'rust', go: 'go', rb: 'ruby', java: 'java', kt: 'kotlin', c: 'c', h: 'c', cpp: 'cpp', sql: 'sql', gml: 'javascript' }
const langFor = path => LANG_BY_EXT[(String(path || '').split('.').pop() || '').toLowerCase()] || ''

function parseDiff(diff) {
  const out = []
  let inHeader = true
  for (const line of String(diff || '').split('\n')) {
    if (line.startsWith('@@')) {
      if (out.length) out.push({ kind: 'gap', text: '' })
      inHeader = false
      continue
    }
    if (inHeader && (/^(diff |index |--- |\+\+\+ |new file|deleted file|similarity|rename )/.test(line) || line.trim() === '')) continue
    inHeader = false
    if (line.startsWith('+') && !line.startsWith('+++')) out.push({ kind: 'add', text: line.slice(1) })
    else if (line.startsWith('-') && !line.startsWith('---')) out.push({ kind: 'remove', text: line.slice(1) })
    else if (line.startsWith('\\')) continue // "\ No newline at end of file"
    else out.push({ kind: 'context', text: line.startsWith(' ') ? line.slice(1) : line })
  }
  while (out.length && out[out.length - 1].kind === 'gap') out.pop()
  return out
}

let diffSeq = 0
function DiffStep({ s }) {
  useTune()
  const [open, setOpen] = useState(true)
  const lines = useMemoOnce(() => parseDiff(s.diff), s.diff)
  const add = lines.filter(l => l.kind === 'add').length
  const del = lines.filter(l => l.kind === 'remove').length
  const lang = langFor(s.arg)
  const id = useRef('d' + ++diffSeq).current
  const box = useRef(null)
  const [seen, setSeen] = useState(false)
  const [rich, setRich] = useState(true) // false once we know Shiki's .line rows aren't there

  // Highlight only once on screen (like the native card's useSeenOnce).
  useEffect(() => {
    if (!open || seen || !box.current) return
    if (typeof IntersectionObserver !== 'function') return setSeen(true)
    const io = new IntersectionObserver(es => es.some(e => e.isIntersecting) && (setSeen(true), io.disconnect()), { rootMargin: '200px' })
    io.observe(box.current)
    return () => io.disconnect()
  }, [open, seen])
  // If the highlighted block never produces per-line rows, fall back to the plain tinted rows.
  useEffect(() => {
    if (!seen || !lang) return
    const t = setTimeout(() => {
      if (box.current && !box.current.querySelector('code .line')) setRich(false)
    }, 1500)
    return () => clearTimeout(t)
  }, [seen, lang])

  const maxH = `${tune.diffLines * 20 + 12}px`
  const useShiki = seen && rich && lang
  const tints = useShiki
    ? lines
        .map((l, i) => (l.kind === 'add' || l.kind === 'remove' ? `.hstk-sdiff[data-id="${id}"] code > .line:nth-child(${i + 1}){background:var(--ui-diff-${l.kind}-background);box-shadow:inset 2px 0 0 var(--ui-diff-${l.kind}-border)}` : ''))
        .join('')
    : ''

  return jsxs('div', {
    className: 'hstk-diff',
    'data-open': open ? '1' : '0',
    children: [
      jsxs(
        'button',
        {
          className: 'hstk-step hstk-diffsum',
          onClick: e => (e.stopPropagation(), setOpen(!open)),
          children: [
            Icon('diff'),
            jsx('span', { className: 'vb', children: VERB(s.name) }, 'v'),
            jsx('span', { className: 'tx', children: stepText(s) }, 't'),
            jsxs('span', { className: 'stat', children: [jsx('b', { className: 'add', children: `+${add}` }, 'a'), jsx('b', { className: 'del', children: `−${del}` }, 'd')] }, 's'),
            Icon(open ? 'chevron-down' : 'chevron-right')
          ]
        },
        'sum'
      ),
      open &&
        jsx(
          'div',
          {
            ref: box,
            className: 'hstk-sdiff' + (useShiki ? ' rich' : ' plain'),
            'data-id': id,
            style: { maxHeight: maxH },
            children: useShiki
              ? [
                  jsx('style', { children: tints }, 'tints'),
                  jsx(Markdown, { text: '```' + lang + '\n' + lines.map(l => l.text).join('\n').replace(/```/g, '``\u200b`') + '\n```' }, 'code')
                ]
              : jsx('pre', {
                  className: 'hstk-dlines',
                  children: lines.map((l, i) => jsx('span', { className: 'dl ' + l.kind, children: l.text || ' ' }, i))
                })
          },
          'body'
        )
    ]
  })
}
// useMemo keyed on one value (kept local so the import list stays the SDK's).
function useMemoOnce(fn, key) {
  const r = useRef({ key: undefined, v: undefined })
  if (r.current.key !== key) r.current = { key, v: fn() }
  return r.current.v
}

// Native-style verbs for tool rows ("Ran grep …", "Read plugin.js", "Edited README.md").
const VERB = n =>
  /terminal|shell|process/.test(n || '')
    ? 'Ran'
    : /write|patch|edit/.test(n || '')
      ? 'Edited'
      : /read|file/.test(n || '')
        ? 'Read'
        : /search|grep|find/.test(n || '')
          ? 'Searched'
          : /web|browser|fetch|url/.test(n || '')
            ? 'Fetched'
            : n || 'tool'
const baseName = p => (p || '').split(/[\\/]/).filter(Boolean).pop() || p || ''
const stepText = s => (/^(Read|Edited)$/.test(VERB(s.name)) ? baseName(s.arg) || s.arg : s.arg) || ''

// One quiet line summarising a chapter's work, like the native "Explored x.tsx, ran 19 commands".
function summarizeWork(work) {
  const tools = work.filter(s => s.k === 'tool')
  const of = v => tools.filter(s => VERB(s.name) === v)
  const [reads, edits, searches, fetches, runs] = ['Read', 'Edited', 'Searched', 'Fetched', 'Ran'].map(of)
  const parts = []
  if (reads.length) parts.push(`explored ${baseName(reads[0].arg) || 'files'}${reads.length > 1 ? ` +${reads.length - 1}` : ''}`)
  if (edits.length) parts.push(`edited ${plural(edits.length, 'file')}`)
  if (searches.length) parts.push(`searched ${searches.length}×`)
  if (fetches.length) parts.push(`fetched ${plural(fetches.length, 'page')}`)
  if (runs.length) parts.push(`ran ${plural(runs.length, 'command')}`)
  const other = tools.length - reads.length - edits.length - searches.length - fetches.length - runs.length
  if (other) parts.push(plural(other, 'other step'))
  const notes = work.length - tools.length
  if (notes) parts.push(plural(notes, 'note'))
  const out = parts.join(', ')
  return out.charAt(0).toUpperCase() + out.slice(1)
}

// Edit tools return JSON with a unified diff; pull it out (both feeds use this).
function diffOf(name, content) {
  if (!/^(patch|write_file|edit_file|apply_patch)$/.test(name || '') || !content) return ''
  try {
    const j = typeof content === 'string' ? JSON.parse(content) : content
    return typeof j?.diff === 'string' ? j.diff.slice(0, 20000) : ''
  } catch {
    return ''
  }
}

// Split a turn into the agent's process (everything but the final reply) and the reply.
function splitTurn(t) {
  const steps = t.steps?.length ? t.steps : t.assistant ? [{ k: 'text', text: t.assistant }] : []
  const last = steps.map(s => s.k).lastIndexOf('text')
  const reply = last >= 0 && last === steps.length - 1 ? steps[last].text : last >= 0 ? steps[last].text : ''
  const work = steps.filter((_, i) => i !== last)
  return { work, reply }
}

// requestAnimationFrame with a timer fallback (jsdom / background tabs).
const raf = f => (typeof window.requestAnimationFrame === 'function' ? window.requestAnimationFrame(f) : setTimeout(f, 16))
const caf = id => (typeof window.cancelAnimationFrame === 'function' ? window.cancelAnimationFrame(id) : clearTimeout(id))
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())

function useThread({ storedId, liveId, status, registerApi }) {
  const working = status === 'working' || status === 'starting'
  const sq = useSession(storedId, liveId, working)
  const live = useLiveStream(liveId, () => sq.refetch?.())
  const d = sq.data
  const turns = d?.turns || []
  const first = (d?.total_turns || 0) - turns.length
  const scroller = useRef(null)
  const sections = useRef([])
  const refFns = useRef([])
  const input = useRef(null)
  const pinnedBottom = useRef(true)
  const scrollingUntil = useRef(0) // while scrolling, the paper viewpoint holds still
  const frame = useRef(0)
  const curRef = useRef(0)
  const [cur, setCurState] = useState(0)
  const setCur = c => {
    if (c === curRef.current) return // no re-render unless the chapter actually changed
    curRef.current = c
    setCurState(c)
  }
  // Stable ref callbacks per chapter, so memoised chapters don't re-render for a new function.
  const sectionRef = i => (refFns.current[i] ||= el => (sections.current[i] = el))

  // Land on the latest chapter; keep following new output while you're at the bottom.
  useEffect(() => {
    const sc = scroller.current
    if (sc && pinnedBottom.current) sc.scrollTop = sc.scrollHeight
    if (pinnedBottom.current && turns.length) setCur(turns.length - 1)
  }, [d, live.text, live.tools.length])

  // Scroll → at most one measurement per frame. Layout offsets (offsetTop) ignore 3D transforms
  // and don't force a rect read per chapter; chapters are in order, so binary-search them.
  const measure = () => {
    frame.current = 0
    const sc = scroller.current
    if (!sc) return
    pinnedBottom.current = sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 24
    if (pinnedBottom.current) return setCur(Math.max(0, turns.length - 1))
    const y = sc.scrollTop + 12
    let lo = 0
    let hi = turns.length - 1
    let c = 0
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      if ((sections.current[mid]?.offsetTop ?? 0) <= y) {
        c = mid
        lo = mid + 1
      } else hi = mid - 1
    }
    setCur(c)
  }
  const onScroll = () => {
    scrollingUntil.current = now() + 160
    if (!frame.current) frame.current = raf(measure)
  }
  useEffect(() => () => caf(frame.current), [])

  const jump = i => {
    const sc = scroller.current
    const el = sections.current[i]
    if (!sc || !el) return
    haptic('tap')
    pinnedBottom.current = i === turns.length - 1
    const top = el.offsetTop
    sc.scrollTo ? sc.scrollTo({ top, behavior: 'smooth' }) : (sc.scrollTop = top)
    setCur(i)
  }

  // The very end: where the agent's last words are (usually its question back to you).
  const toEnd = () => {
    const sc = scroller.current
    if (!sc) return
    haptic('tap')
    pinnedBottom.current = true
    sc.scrollTo ? sc.scrollTo({ top: sc.scrollHeight, behavior: 'smooth' }) : (sc.scrollTop = sc.scrollHeight)
    setCur(Math.max(0, turns.length - 1))
  }

  // Let Zed Mode drive this thread from the keyboard (↑↓ chapters, i to write).
  //   ↓ on the last prompt → the end of the reply.  ↑ when you've scrolled into a chapter → its prompt.
  useEffect(() => {
    registerApi?.({
      prev: () => {
        const c = curRef.current
        const into = (scroller.current?.scrollTop ?? 0) > (sections.current[c]?.offsetTop ?? 0) + 24
        jump(into ? c : Math.max(0, c - 1))
      },
      next: () => (curRef.current >= turns.length - 1 ? toEnd() : jump(curRef.current + 1)),
      write: () => input.current?.focus()
    })
  })

  return { sq, d, live, turns, first, scroller, sections, sectionRef, input, cur, jump, onScroll, pinnedBottom, scrollingUntil }
}

// ── Branch: copy a conversation (or its first N prompts) into a new one, like the native /branch ──
// Live chat, from a prompt:  session.branch { session_id, through_message_id }   (keeps rows up to it)
// Live chat, whole:          session.branch_whole { session_id }
// Stored chat, whole:        session.branch_stored { parent_session_id }
// The app's transport turns each into the owner's canonical `branch` mutation; the answer names the
// child (`stored_session_id`). The parent is never touched.
const branching = new Set()
async function branchSession({ storedId, liveId, through }) {
  const key = storedId + ':' + (through ?? 'all')
  if (branching.has(key)) return null
  branching.add(key)
  try {
    const r = through != null && liveId
      ? await host.request('session.branch', { session_id: liveId, through_message_id: through })
      : liveId
        ? await host.request('session.branch_whole', { session_id: liveId })
        : await host.request('session.branch_stored', { parent_session_id: storedId })
    const id = r?.stored_session_id || r?.branched_session_id || r?.session_id
    if (!id) throw new Error('the gateway did not name the new session')
    haptic('open')
    queryClient.invalidateQueries({ queryKey: [ID] })
    host.notify?.({ kind: 'success', message: through != null ? 'Branched from that prompt' : 'Branched this conversation' })
    zedApi.hold ? zedApi.hold(id) : openSession(id)
    return id
  } catch (err) {
    host.notifyError?.(err, 'Could not branch')
    return null
  } finally {
    branching.delete(key)
  }
}

function Rail({ turns, first, cur, jump }) {
  return jsx('div', {
    className: 'hstk-rail',
    children: turns.map((t, i) =>
      jsx(
        'button',
        {
          className: 'hstk-tick',
          'data-on': i === cur ? '1' : '0',
          'aria-label': `Prompt ${first + i + 1}: ${oneLine(t.user, 60)}`,
          onClick: e => (e.stopPropagation(), jump(i)),
          children: jsxs('span', { className: 'hstk-tip', children: [jsx('i', { children: `#${first + i + 1}` }, 'i'), oneLine(t.user, 140) || '(no prompt)'] })
        },
        first + i
      )
    )
  })
}

// ── Model selection, the native protocol ────────────────────────────────────
// What the native composer pill does (use-model-controls.ts), reproduced for a Zed Mode composer:
//   1. paint the pick at once (pending), keeping a snapshot to roll back to
//   2. `config.set model "<model> --provider <p> --session"`: the app's transport turns this into
//      the owner's canonical `session.mutate operation=model` (always session-scoped: a pick in
//      Zed Mode never rewrites the profile default)
//   3. `confirm_required` (a guarded / expensive target) → roll back, ask with the owner's own
//      message, resend with `confirm_expensive_model: true` only if you accept
//   4. `deferred` (picked mid-turn) → "applies after this turn"; session.info confirms it later
//   5. failure → roll back and say WHY. The owner only answers `model_resolution_failed`, so Zed Mode
//      asks its backend to run the same resolver (`/resolve`) for the real reason.
//   6. `session.info` from the gateway is the truth: it confirms a pick, or corrects the label.
// State is per live session and shared, so a tile, its dive and a held thread agree.
const modelStore = new Map() // liveId → { model, provider, effort, status, note, prev, at }
const modelSubs = new Set()
let modelVersion = 0
const putModel = (liveId, patch) => {
  modelStore.set(liveId, { ...(modelStore.get(liveId) || {}), ...patch, at: Date.now() })
  modelVersion++
  modelSubs.forEach(f => f())
}
const useModelVersion = () => useSyncExternalStore(cb => (modelSubs.add(cb), () => modelSubs.delete(cb)), () => modelVersion)
const shortModel = m => (m || '').split('/').pop()
const errReason = err => (err?.data?.reason || err?.reason || err?.message || String(err || '')).replace(/^JsonRpcGatewayError:\s*/, '')

async function explainModelFailure(err, model, provider, cur) {
  const reason = errReason(err)
  if (!/model_resolution_failed/.test(reason)) return reason || 'The gateway refused the switch.'
  try {
    const r = await CTX.rest(`/resolve?model=${enc(model)}&provider=${enc(provider)}&current_model=${enc(cur.model || '')}&current_provider=${enc(cur.provider || '')}`)
    if (r && !r.ok && r.reason && !r.error) return r.reason // `error`: the check itself failed, so there is no real reason to show
  } catch {}
  return `Hermes couldn’t resolve ${model} on ${provider}. Usually the provider isn’t signed in / has no API key, or a local server isn’t running.`
}

// The catalog comes from the SESSION'S OWN gateway (owner-routed `model.options` with
// explicit_only, exactly what the native pill passes as `request`), so the menu lists only the
// providers that session can actually use. Without it the menu falls back to the window's REST
// catalog, which can offer providers the session isn't connected to.
// One more step the native pill doesn't take: Hermes' catalog can list a provider as connected
// when its login is actually missing (seen with Nous Portal, listed first, full of names that look
// like another provider's models). Every pick from such a group can only fail. So the catalog is
// checked against Hermes' own resolver (backend /usable, one model per provider, cached) and
// providers that cannot resolve are left out of the menu and named in its footer instead.
// The session's current provider is never hidden. If the check itself fails, the catalog is shown as is.
let hiddenProviders = [] // [{ slug, name, reason }]
const firstSentence = t => {
  const m = /^(.*?[.!?])(\s|$)/.exec(String(t || '').trim())
  return (m ? m[1] : String(t || '')).trim()
}
async function ownerRequest(method, params) {
  const res = await host.request(method, params)
  if (method !== 'model.options' || !Array.isArray(res?.providers)) return res
  try {
    const idOf = m => (typeof m === 'string' ? m : m?.id || m?.name || '')
    const pairs = res.providers.filter(p => !p.is_current && idOf((p.models || [])[0])).map(p => [p.slug, idOf(p.models[0])])
    if (!pairs.length) return res
    const verdict = (await CTX.rest(`/usable?pairs=${enc(JSON.stringify(pairs))}&current_model=${enc(res.model || '')}&current_provider=${enc(res.provider || '')}`))?.providers || {}
    const hidden = res.providers.filter(p => !p.is_current && verdict[p.slug] && verdict[p.slug].ok === false)
    const next = hidden.map(p => ({ slug: p.slug, name: p.name || p.slug, reason: verdict[p.slug].reason || '' }))
    if (JSON.stringify(next) !== JSON.stringify(hiddenProviders)) {
      hiddenProviders = next
      modelVersion++
      modelSubs.forEach(f => f())
    }
    return hidden.length ? { ...res, providers: res.providers.filter(p => !hidden.includes(p)) } : res
  } catch {
    return res
  }
}
const NEEDS_CONNECT = /not connected|no credentials|not signed in|not logged in|api key|unauthori[sz]ed|login/i

function ModelPill({ liveId, storedId, info, storedModel }) {
  useModelVersion()
  const [open, setOpen] = useState(false)
  const [ask, setAsk] = useState(null) // { model, provider, message } awaiting your confirmation
  const st = (liveId && modelStore.get(liveId)) || {}

  // session.info / the live list are the truth. A pending pick ignores reports of the old model
  // until the gateway reports the new one (then it's confirmed).
  useEffect(() => {
    if (!liveId || !info?.model) return
    const s = modelStore.get(liveId) || {}
    if ((s.status === 'pending' || s.status === 'deferred') && info.model !== s.model) return
    if (s.model === info.model && (s.provider || '') === (info.provider || s.provider || '') && s.status === 'confirmed') return
    putModel(liveId, {
      model: info.model,
      provider: info.provider || s.provider || '',
      effort: info.effort ?? s.effort ?? '',
      status: 'confirmed',
      note: s.status === 'pending' || s.status === 'deferred' ? `Now using ${shortModel(info.model)}` : s.note || '',
      flash: s.status === 'pending' || s.status === 'deferred'
    })
  }, [liveId, info?.model, info?.provider, info?.effort])
  // Notes fade on their own.
  useEffect(() => {
    if (!st.note) return
    const failed = st.status === 'failed' // a failure stays long enough to read, then the pill goes back to normal
    const t = setTimeout(() => liveId && putModel(liveId, failed ? { note: '', status: 'confirmed', fix: '', detail: '' } : { note: '', flash: false }), failed ? 12000 : 2600)
    return () => clearTimeout(t)
  }, [st.note, st.status])

  const cur = { model: st.model || info?.model || storedModel || '', provider: st.provider || info?.provider || '', effort: st.effort ?? info?.effort ?? '' }
  const label = shortModel(cur.model) || 'model'

  const send = async (model, provider, confirm = false) => {
    const before = { model: cur.model, provider: cur.provider, effort: cur.effort }
    putModel(liveId, { model, provider, status: 'pending', note: `Switching to ${shortModel(model)}…`, prev: before, flash: false })
    try {
      const res = await host.request('config.set', {
        session_id: liveId,
        key: 'model',
        value: `${model} --provider ${provider} --session`,
        ...(confirm ? { confirm_expensive_model: true } : {})
      })
      if (res?.confirm_required) {
        putModel(liveId, { ...before, status: 'confirmed', note: '' })
        setAsk({ model, provider, message: res.confirm_message || '' })
        return false
      }
      if (res?.deferred) {
        putModel(liveId, { status: 'deferred', note: `${shortModel(model)} applies after this turn` })
        return true
      }
      putModel(liveId, { status: 'confirmed', note: `Now using ${shortModel(model)}`, flash: true })
      return true
    } catch (err) {
      putModel(liveId, { ...before, status: 'failed', note: `Couldn’t switch to ${shortModel(model)}: checking why…` })
      const why = await explainModelFailure(err, model, provider, before)
      putModel(liveId, { status: 'failed', note: `Still on ${shortModel(before.model) || 'your model'}. ${shortModel(model)} via ${provider}: ${firstSentence(why)}`, detail: why, fix: NEEDS_CONNECT.test(why) ? 'connect' : '' })
      return false
    }
  }

  // Not live: the gateway holds no session to switch, so there is no menu to offer here. The pill
  // is still a button, and an honest one: it opens the chat in Hermes (what ⏎ does), where the
  // model can be changed. ⌘-click opens it in a new tab and leaves Zed Mode where it is.
  if (!liveId && storedId)
    return jsxs('button', {
      type: 'button',
      className: 'hstk-model open',
      title: `Model: ${cur.model || 'unknown'}\nThis chat isn’t live, so its model can’t be switched from here.\nClick to open it in Hermes and change it there (⌘-click: new tab).`,
      'aria-label': `Model: ${cur.model || 'unknown'}. Not live. Open this chat in Hermes to change the model`,
      onClick: e => openSession(storedId, e),
      children: [jsx('span', { className: 'nm', children: label }, 'l'), Icon('link-external')]
    })

  if (!liveId || typeof ModelCatalogMenu !== 'function' || typeof DropdownMenu !== 'function')
    return jsx('span', {
      className: 'hstk-model ghost',
      title: liveId ? 'Model menu unavailable' : 'The model can be changed while the chat is live.',
      children: jsx('span', { className: 'nm', children: label })
    })

  const controller = {
    allowSpeed: false,
    current: { model: cur.model, provider: cur.provider, effort: cur.effort || '', fast: false },
    presetFor: () => ({}),
    applyPreset: () => {},
    select: (model, provider) => {
      if (model === cur.model && provider === cur.provider) return true
      return send(model, provider)
    },
    setOptions: async patch => {
      if (patch.effort === undefined) return
      const prev = cur.effort
      putModel(liveId, { effort: patch.effort, note: `Reasoning: ${patch.effort}` })
      try {
        const res = await host.request('config.set', { session_id: liveId, key: 'reasoning', value: patch.effort })
        if (res?.status === 'deferred') putModel(liveId, { note: `Reasoning ${patch.effort} applies after this turn` })
      } catch (err) {
        putModel(liveId, { effort: prev, status: 'failed', note: `Couldn’t change reasoning: ${errReason(err)}` })
      }
    }
  }

  const status = st.status || 'confirmed'
  const glyph =
    status === 'pending'
      ? jsx(Codicon, { name: 'loading', size: '11px', className: 'leading-none codicon-modifier-spin' })
      : status === 'deferred'
        ? Icon('clock')
        : status === 'failed'
          ? Icon('warning')
          : null
  const tip = [
    `Model: ${cur.model || 'unknown'}`,
    cur.provider && `Provider: ${cur.provider}`,
    cur.effort && `Reasoning: ${cur.effort}`,
    status === 'pending' ? 'Switching…' : status === 'deferred' ? 'Applies after the current turn' : status === 'failed' ? st.note : 'Confirmed by the session'
  ]
    .filter(Boolean)
    .join('\n')

  return jsxs('span', {
    className: 'hstk-modelwrap',
    children: [
      jsx(Safe, {
        fallback: jsx('span', { className: 'hstk-model ghost', children: jsx('span', { className: 'nm', children: label }) }),
        children: jsxs(DropdownMenu, {
          open,
          onOpenChange: setOpen,
          children: [
            jsx(
              DropdownMenuTrigger,
              {
                asChild: true,
                children: jsxs('button', {
                  type: 'button',
                  className: 'hstk-model' + (st.flash ? ' flash' : ''),
                  'data-status': status,
                  title: tip,
                  'aria-label': `Model: ${cur.model}${cur.provider ? ` (${cur.provider})` : ''}. ${status}`,
                  children: [
                    glyph && jsx('span', { className: 'st', children: glyph }, 'g'),
                    cur.provider && jsx('span', { className: 'pv', children: cur.provider }, 'p'),
                    jsx('span', { className: 'nm', children: label }, 'l'),
                    cur.effort && jsx('span', { className: 'ef', children: cur.effort }, 'e'),
                    Icon('chevron-down')
                  ]
                })
              },
              't'
            ),
            jsx(
              DropdownMenuContent,
              {
                align: 'start',
                className: 'w-72 p-0',
                children: jsx(ModelMenuCloseContext.Provider, { value: () => setOpen(false), children: jsx(ModelCatalogMenu, {
                  controller,
                  sessionId: liveId,
                  request: ownerRequest,
                  footer:
                    hiddenProviders.length > 0 &&
                    jsxs('div', {
                      className: 'hstk-mhidden',
                      title: hiddenProviders.map(p => `${p.name}: ${p.reason}`).join('\n'),
                      children: [
                        jsx('span', { className: 'tx', children: `Not connected, so not listed: ${hiddenProviders.map(p => p.name).join(', ')}` }, 't'),
                        jsx('button', { type: 'button', className: 'fix', onClick: () => (setOpen(false), host.navigate('/settings?tab=providers')), children: 'Connect' }, 'b')
                      ]
                    })
                }) })
              },
              'c'
            )
          ]
        })
      }, 'menu'),
      st.note &&
        jsxs('span', {
          className: 'hstk-mnote',
          'data-status': status,
          title: st.note,
          children: [
            jsx('span', { className: 'tx', children: st.note }, 't'),
            status === 'failed' &&
              st.fix === 'connect' &&
              jsx('button', { type: 'button', className: 'fix', onClick: () => host.navigate('/settings?tab=providers'), children: 'Connect provider…' }, 'fix'),
            status === 'failed' && jsx('button', { type: 'button', 'aria-label': 'Dismiss', onClick: () => putModel(liveId, { note: '', status: 'confirmed', fix: '' }), children: Icon('close') }, 'x')
          ]
        }, 'note'),
      ask &&
        typeof ConfirmDialog === 'function' &&
        jsx(ConfirmDialog, {
          open: true,
          onClose: () => setAsk(null),
          title: `Switch to ${shortModel(ask.model)}?`,
          description: ask.message || 'This model needs a confirmation (cost, data policy or context size).',
          confirmLabel: 'Switch',
          cancelLabel: 'Keep current',
          destructive: true,
          dismissOnConfirm: true,
          onConfirm: async () => {
            const a = ask
            setAsk(null)
            await send(a.model, a.provider, true)
          }
        }, 'ask')
    ]
  })
}

const readDataUrl = file =>
  new Promise((ok, fail) => {
    const r = new FileReader()
    r.onload = () => ok(String(r.result))
    r.onerror = () => fail(r.error)
    r.readAsDataURL(file)
  })
const readB64 = async file => (await readDataUrl(file)).split(',')[1] || ''
// Quote a path / URL the way the gateway does, so an `@file:` / `@folder:` / `@url:` reference round-trips.
const refValue = v => {
  if (!/[\s()[\]{}"'`]/.test(v)) return v
  const q = ['`', '"', "'"].find(c => !v.includes(c))
  return q ? q + v + q : v
}
const SNIPPETS = [
  ['Code review', 'Please review this for bugs, regressions, and missing tests.'],
  ['Implementation plan', 'Please make a concise implementation plan before changing code.'],
  ['Explain this', 'Please explain how this works, step by step, and point me at the key files.']
]

// The composer: the app's composer ring + backing, paste / drop / attach images (queued on the
// live session with image.attach_bytes, exactly like the native composer), the model menu, and
// send ⇄ stop while the agent is working.
function Composer({ storedId, liveId, inputRef, onFocus, onSent, info, working, storedModel }) {
  const [draft, setDraft] = useState('')
  const [imgs, setImgs] = useState([]) // { path, url, name }
  const [refs, setRefs] = useState([]) // { text: '@file:…' | '@folder:…' | '@url:…', label, icon }: sent with the prompt
  const [note, setNote] = useState('')
  const [drag, setDrag] = useState(false)
  const [menu, setMenu] = useState(false)
  const [urlBox, setUrlBox] = useState(null) // null = closed, else the text being typed
  const fileInput = useRef(null)
  const imageInput = useRef(null)
  // The box is as tall as its text, between two lines and about ten.
  useEffect(() => {
    const el = inputRef?.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(220, Math.max(44, el.scrollHeight)) + 'px'
  }, [draft])
  const addRef = r => setRefs(list => (list.some(x => x.text === r.text) ? list : [...list, r]))

  // Files: the gateway stages them into the session's workspace and hands back an `@file:` reference.
  const attachFiles = async files => {
    const list = [...(files || [])].filter(Boolean)
    const others = list.filter(f => !/^image\//.test(f.type || ''))
    if (list.length > others.length) await attach(list)
    if (!others.length) return
    if (!liveId) return setNote('Files need a live chat. Use Open to attach them in Hermes.')
    for (const f of others) {
      try {
        const res = await host.request('file.attach', { session_id: liveId, data_url: await readDataUrl(f), name: f.name || 'file' })
        addRef({ text: res?.ref_text || `@file:${refValue(res?.ref_path || f.name)}`, label: res?.name || f.name || 'file', icon: 'file' })
        setNote('')
      } catch (err) {
        setNote('Could not attach file: ' + (err?.message || err))
      }
    }
  }
  // Folder: the app's own folder picker; the folder goes along as an `@folder:` reference.
  const pickFolder = async () => {
    try {
      const res = await CTX?.files?.requestFolder?.()
      const folder = res?.folder
      if (folder?.path) addRef({ text: `@folder:${refValue(folder.path)}`, label: folder.name || baseName(folder.path), icon: 'folder' })
      else if (res && res.ok === false) setNote('Could not open the folder picker')
    } catch (err) {
      setNote('Could not add folder: ' + (err?.message || err))
    }
  }
  const pasteImage = async () => {
    try {
      for (const item of (await navigator.clipboard.read()) || []) {
        const type = item.types.find(t => /^image\//.test(t))
        if (type) return void (await attach([new File([await item.getType(type)], 'pasted.' + type.split('/')[1], { type })]))
      }
      setNote('No image on the clipboard')
    } catch {
      setNote('Could not read the clipboard (⌘V in the box works too)')
    }
  }
  const addUrl = (refocus = true) => {
    const u = (urlBox || '').trim()
    if (u) addRef({ text: `@url:${refValue(u)}`, label: u.replace(/^https?:\/\//, ''), icon: 'globe' })
    setUrlBox(null)
    if (refocus) inputRef?.current?.focus()
  }
  const item = (key, icon, label, run, disabled) =>
    jsxs(DropdownMenuItem, { disabled, onSelect: () => (setMenu(false), run()), children: [Icon(icon), jsx('span', { style: { marginLeft: 8 }, children: label }, 'l')] }, key)

  const attach = async files => {
    const images = [...(files || [])].filter(f => f && /^image\//.test(f.type || ''))
    if (!images.length) return false
    if (!liveId) {
      setNote('Images need a live chat. Use Open to attach them in Hermes.')
      return true
    }
    for (const f of images) {
      try {
        const res = await host.request('image.attach_bytes', { session_id: liveId, content_base64: await readB64(f), filename: f.name || 'pasted.png' })
        let url = '' // preview only; the image is already queued on the session either way
        try {
          url = URL.createObjectURL(f)
        } catch {}
        setImgs(list => [...list, { path: res?.path || f.name, url, name: f.name || 'image', mime: f.type || 'image/png' }])
        setNote('')
      } catch (err) {
        setNote('Could not attach image: ' + (err?.message || err))
      }
    }
    return true
  }
  const detach = async img => {
    setImgs(list => list.filter(i => i !== img))
    try {
      await host.request('image.detach', { session_id: liveId, path: img.path })
    } catch {}
  }
  const stop = async () => {
    haptic('tap')
    try {
      await host.request('session.interrupt', { session_id: liveId })
      setNote('stopped')
    } catch (err) {
      setNote('Could not stop: ' + (err?.message || err))
    }
  }
  const [offerOpen, setOfferOpen] = useState(false)
  const send = async (openIfNeeded = false) => {
    // References ride in the prompt text, the way the native composer sends them.
    const text = [refs.map(r => r.text).join(' '), draft.trim()].filter(Boolean).join('\n\n')
    if (!text && !imgs.length) return
    haptic('tap')
    setNote('sending…')
    try {
      const how = await sendPrompt(storedId, liveId, text || (imgs.length ? '(image)' : ''), imgs, { openIfNeeded })
      if (how === 'not-live') {
        setOfferOpen(true)
        return setNote('This chat isn’t live, so it can’t take a message from here. Your text is kept.')
      }
      setOfferOpen(false)
      setDraft('')
      setRefs([])
      setImgs([]) // the gateway consumes queued images with the prompt
      setNote(how === 'sent' ? '' : 'opened in Hermes')
      onSent?.()
    } catch (err) {
      setNote('could not send: ' + (err?.message || err))
    }
  }

  const canStop = working && liveId && !draft.trim() && !imgs.length && !refs.length
  return jsxs('div', {
    className: 'hstk-comp',
    children: [
      jsxs(
        'div',
        {
          className: 'hstk-cbox ' + (composerSurfaceRing || '') + (drag ? ' drag' : ''),
          onDragOver: e => (e.preventDefault(), setDrag(true)),
          onDragLeave: () => setDrag(false),
          onDrop: e => {
            e.preventDefault()
            setDrag(false)
            attachFiles(e.dataTransfer?.files)
          },
          children: [
            composerInputBacking && jsx('div', { className: composerInputBacking }, 'bk'),
            imgs.length > 0 &&
              jsx(
                'div',
                {
                  className: 'hstk-imgs',
                  children: imgs.map((img, i) =>
                    jsxs(
                      'div',
                      {
                        className: 'hstk-img',
                        title: img.name,
                        children: [
                          img.url ? jsx('img', { src: img.url, alt: img.name }, 'i') : Icon('file-media'),
                          jsx('button', { type: 'button', 'aria-label': 'Remove image', onClick: () => detach(img), children: Icon('close') }, 'x')
                        ]
                      },
                      img.path + i
                    )
                  )
                },
                'imgs'
              ),
            refs.length > 0 &&
              jsx(
                'div',
                {
                  className: 'hstk-refs',
                  children: refs.map(r =>
                    jsxs(
                      'span',
                      {
                        className: 'hstk-ref',
                        title: r.text,
                        children: [
                          Icon(r.icon),
                          jsx('span', { className: 'l', children: r.label }, 'l'),
                          jsx('button', { type: 'button', 'aria-label': 'Remove ' + r.label, onClick: () => setRefs(list => list.filter(x => x !== r)), children: Icon('close') }, 'x')
                        ]
                      },
                      r.text
                    )
                  )
                },
                'refs'
              ),
            urlBox !== null &&
              jsx(
                'input',
                {
                  className: 'hstk-urlbox',
                  autoFocus: true,
                  placeholder: 'Paste a URL, then ⏎ (esc cancels)',
                  value: urlBox,
                  onChange: e => setUrlBox(e.target.value),
                  onBlur: () => addUrl(false), // clicking away (onto Send, say) keeps the link
                  onKeyDown: e => {
                    if (e.key === 'Enter') (e.preventDefault(), addUrl())
                    else if (e.key === 'Escape') (e.preventDefault(), setUrlBox(null), inputRef?.current?.focus())
                    e.stopPropagation()
                  }
                },
                'url'
              ),
            jsx(
              'textarea',
              {
                ref: inputRef,
                value: draft,
                rows: 2,
                placeholder: liveId ? 'Reply…' : 'Reply… (sends by opening the chat in Hermes)',
                onChange: e => setDraft(e.target.value),
                onFocus,
                onPaste: e => {
                  const files = e.clipboardData?.files
                  if (files && files.length) {
                    e.preventDefault()
                    attachFiles(files)
                  }
                },
                onKeyDown: e => {
                  if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent?.isComposing) {
                    e.preventDefault()
                    send()
                  } else if (e.key === 'Escape') {
                    e.preventDefault()
                    e.target.blur()
                  }
                  e.stopPropagation()
                }
              },
              'ta'
            ),
            jsxs(
              'div',
              {
                className: 'hstk-cbar',
                children: [
                  // The + menu, item for item what the native composer offers.
                  jsx(
                    Safe,
                    {
                      fallback: jsx('button', { type: 'button', className: 'hstk-cbtn icon ' + (GHOST_ICON_BTN || ''), title: 'Attach', onClick: () => fileInput.current?.click(), children: Icon('add') }),
                      children: jsxs(DropdownMenu, {
                        open: menu,
                        onOpenChange: setMenu,
                        children: [
                          jsx(DropdownMenuTrigger, { asChild: true, children: jsx('button', { type: 'button', className: 'hstk-cbtn icon hstk-plus ' + (GHOST_ICON_BTN || ''), title: 'Attach', children: Icon('add') }) }, 't'),
                          jsxs(
                            DropdownMenuContent,
                            {
                              align: 'start',
                              side: 'top',
                              className: 'w-56',
                              children: [
                                item('files', 'file', 'Files…', () => fileInput.current?.click()),
                                item('folder', 'folder-opened', 'Folder…', pickFolder),
                                item('images', 'file-media', 'Images…', () => imageInput.current?.click()),
                                item('paste', 'clippy', 'Paste image', pasteImage),
                                item('url', 'globe', 'URL…', () => setUrlBox('')),
                                DropdownMenuSeparator ? jsx(DropdownMenuSeparator, {}, 'sep') : null,
                                ...SNIPPETS.map(([label, text]) => item('s:' + label, 'quote', label, () => (setDraft(d => (d.trim() ? d.replace(/\s*$/, '\n\n') + text : text)), inputRef?.current?.focus())))
                              ]
                            },
                            'c'
                          )
                        ]
                      })
                    },
                    'att'
                  ),
                  jsx('input', { ref: fileInput, type: 'file', multiple: true, hidden: true, 'data-pick': 'files', onChange: e => (attachFiles(e.target.files), (e.target.value = '')) }, 'file'),
                  jsx('input', { ref: imageInput, type: 'file', accept: 'image/*', multiple: true, hidden: true, 'data-pick': 'images', onChange: e => (attach(e.target.files), (e.target.value = '')) }, 'image'),
                  jsx(ModelPill, { liveId, storedId, info, storedModel }, 'model'),
                  note && jsx('span', { className: 'hstk-cnote', children: note }, 'note'),
                  offerOpen && jsx('button', { type: 'button', className: 'hstk-x', title: 'Open this chat in Hermes and put your text in its prompt', onClick: () => send(true), children: 'Open in Hermes & send' }, 'oos'),
                  jsx('span', { className: 'sp' }, 'sp'),
                  canStop
                    ? jsx('button', { type: 'button', className: 'hstk-csend stop ' + (PRIMARY_ICON_BTN || ''), title: 'Stop', onClick: stop, children: Icon('debug-stop') }, 'stop')
                    : jsx('button', { type: 'button', className: 'hstk-csend ' + (PRIMARY_ICON_BTN || ''), title: 'Send (⏎)', disabled: !draft.trim() && !imgs.length && !refs.length, onClick: () => send(), children: Icon('arrow-up') }, 'send')
                ]
              },
              'bar'
            )
          ]
        },
        'box'
      )
    ]
  })
}

const LiveDot = (liveId, status) => jsx('span', { className: 'hstk-live', 'data-s': liveId ? status || 'idle' : 'off', title: liveId ? status : 'not live' })

// FLAT thread: a NOW tile (and the FLAT option of a dive/hold). Sticky prompt per chapter,
// the agent's work a tad back in Z, rail on the right, composer at the bottom.
// Chapters are memoised: scrolling, the rail and streaming only re-render what changed.
const ThreadChapter = pure(function ThreadChapter({ tn, i, n, open, onToggle, sectionRef, onBranch }) {
  return jsxs('section', {
    className: 'hstk-ch',
    ref: sectionRef,
    children: [
      tn.user &&
        jsx(
          'div',
          {
            className: 'hstk-ch-prompt',
            'data-open': open ? '1' : '0',
            onClick: e => (e.stopPropagation(), onToggle(i)),
            children: jsxs('div', { className: 'bub', children: [jsx('span', { className: 'n', children: `#${n}` }, 'n'), jsx('span', { className: 'p', children: tn.user }, 'p'), onBranch && jsx('button', { type: 'button', className: 'br', title: tn.row != null ? 'Branch from here: a new conversation with everything up to this prompt’s answer' : 'Branching from a single prompt needs the chat to be live', disabled: tn.row == null, 'aria-label': `Branch from prompt ${n}`, onClick: e => (e.stopPropagation(), onBranch(tn)), children: Icon('git-branch') }, 'br')] })
          },
          'prompt'
        ),
      jsx('div', { className: 'hstk-ch-work', children: jsx(Steps, { steps: tn.steps, assistant: tn.assistant }) }, 'work')
    ]
  })
})

function Thread({ storedId, liveId, status, model, title, focused, onFocus, onDive, solo = false, enter = false, registerApi }) {
  const t = useThread({ storedId, liveId, status, registerApi })
  const { d, turns, first, scroller, sectionRef, input, cur, jump, onScroll } = t
  const [open, setOpen] = useState(-1)
  const toggle = useCallback(i => setOpen(o => (o === i ? -1 : i)), [])
  const onBranch = useCallback(tn => branchSession({ storedId, liveId, through: tn.row }), [storedId, liveId])

  const header = jsxs('div', {
    className: 'hstk-tvh',
    onDoubleClick: onDive,
    children: [
      jsx('span', { children: LiveDot(liveId, status) }, 'dot'),
      jsx('span', { className: 't', children: title || d?.title || 'Untitled' }, 't'),
      jsx('span', { className: 'meta', children: [d?.model, d ? plural(d.total_turns, 'prompt') : '', d?.source === 'live' ? 'live feed' : d ? 'stored' : ''].filter(Boolean).join(' · ') }, 'm'),
      jsx('span', { className: 'sp' }, 'sp'),
      onDive && jsx('button', { className: 'hstk-x primary', onClick: e => (e.stopPropagation(), onDive()), children: 'Dive ⇧⏎' }, 'd'),
      jsxs('button', { className: 'hstk-x', title: 'Branch: a new conversation that starts as a copy of this one', onClick: e => (e.stopPropagation(), branchSession({ storedId, liveId })), children: [Icon('git-branch'), ' Branch'] }, 'br'),
      jsx('button', { className: 'hstk-x', onClick: e => (e.stopPropagation(), openSession(storedId, e)), children: 'Open' }, 'o')
    ]
  })

  const body = !d
    ? jsx(NoFeed, { loading: t.sq.isLoading, error: t.sq.error })
    : jsxs('div', {
        className: 'hstk-tvb',
        children: [
          jsx(
            'div',
            {
              className: 'hstk-tvs',
              ref: scroller,
              onScroll,
              children: [
                ...turns.map((tn, i) => jsx(ThreadChapter, { tn, i, n: first + i + 1, open: open === i, onToggle: toggle, sectionRef: sectionRef(i), onBranch }, first + i)),
                jsx(Inflight, { live: t.live }, 'live')
              ]
            },
            'scroll'
          ),
          jsx(Rail, { turns, first, cur, jump }, 'rail')
        ]
      })

  return jsxs('div', {
    className: 'hstk-tv' + (solo ? ' solo' : '') + (enter ? ' enter' : ''),
    'data-focus': focused ? '1' : '0',
    onMouseDown: onFocus,
    children: [header, body, jsx(Composer, { storedId, liveId, storedModel: t.d?.model || '', info: { ...(model ? { model } : {}), ...(t.live.info || {}) }, working: status === 'working' || t.live.active, inputRef: input, onFocus, onSent: () => ((t.pinnedBottom.current = true), t.sq.refetch?.()) }, 'comp')]
  })
}

// PAPER thread: the classic chat layout, 3D-ified. Each part of a chapter is its own sheet:
//   your prompt   lifted toward you (+z)        reply   on the page (0)
//   agent's work  one quiet summary line a little further back (−z); click to unfold
// Sheets curve away at the edges as you scroll (scroll-driven, on the compositor), and the
// pointer shifts the viewpoint (perspective-origin), the same off-axis idea as head
// tracking. The viewpoint eases toward the pointer once per frame OUTSIDE React, and holds
// still while you scroll, so scrolling + moving the mouse can't make the layers jitter.
const PaperChapter = pure(function PaperChapter({ tn, i, n, open, onFold, sectionRef }) {
  const { work, reply } = splitTurn(tn)
  return jsxs('section', {
    className: 'hstk-pch',
    ref: sectionRef,
    children: [
      tn.user &&
        jsx(
          'div',
          {
            className: 'hstk-pitem hstk-puser',
            children: jsxs('div', { className: 'sheet', children: [jsx('span', { className: 'n', children: `#${n}` }, 'n'), jsx('div', { className: 'p', children: tn.user }, 'p')] })
          },
          'u'
        ),
      work.length > 0 &&
        jsxs(
          'div',
          {
            className: 'hstk-pitem hstk-pfold',
            'data-open': open ? '1' : '0',
            children: [
              jsxs(
                'button',
                {
                  className: 'sum',
                  onClick: () => onFold(i, !open),
                  children: [jsx('span', { className: 'tx', children: summarizeWork(work) }, 's'), Icon(open ? 'chevron-down' : 'chevron-right', 'chev')]
                },
                'sum'
              ),
              open
                ? jsx('div', { className: 'leaf', children: jsx(Steps, { steps: work }) }, 'leaf')
                : work.some(st => st.diff) && jsx('div', { className: 'leaf edits', children: jsx(Steps, { steps: work.filter(st => st.diff) }) }, 'edits')
            ]
          },
          'w'
        ),
      reply && jsx('div', { className: 'hstk-pitem hstk-preply', children: jsx('div', { className: 'sheet', children: jsx(Markdown, { text: reply }) }) }, 'r')
    ]
  })
})

function Paper({ storedId, liveId, status, model, title, flat = false, delay = 420, registerApi, onBack }) {
  const t = useThread({ storedId, liveId, status, registerApi })
  const { d, turns, first, scroller, sectionRef, input, cur, jump, onScroll, scrollingUntil } = t
  const [lifted, setLifted] = useState(false)
  const [folds, setFolds] = useState({}) // chapter index → open?
  const onFold = useCallback((i, open) => setFolds(f => ({ ...f, [i]: open })), [])
  const eye = useRef({ x: 0, y: 0, tx: 0, ty: 0, id: 0 })

  useEffect(() => {
    if (flat) return setLifted(false)
    const id = setTimeout(() => setLifted(true), delay)
    return () => clearTimeout(id)
  }, [flat])

  // Viewpoint easing: one style write per frame, no React render; waits out active scrolling.
  const step = () => {
    const e = eye.current
    e.id = 0
    const sc = scroller.current
    if (!sc) return
    if (now() < scrollingUntil.current) {
      e.id = raf(step)
      return
    }
    e.x += (e.tx - e.x) * tune.ease
    e.y += (e.ty - e.y) * tune.ease
    sc.style.perspectiveOrigin = `${(50 + e.x * tune.parallax).toFixed(2)}% ${(50 + e.y * tune.parallax).toFixed(2)}%`
    if (Math.abs(e.tx - e.x) > 0.002 || Math.abs(e.ty - e.y) > 0.002) e.id = raf(step)
  }
  const aim = (x, y) => {
    eye.current.tx = x
    eye.current.ty = y
    if (!eye.current.id) eye.current.id = raf(step)
  }
  useEffect(() => () => caf(eye.current.id), [])
  const onMove = e => {
    const r = e.currentTarget.getBoundingClientRect()
    if (r.width) aim(((e.clientX - r.left) / r.width - 0.5) * 2, ((e.clientY - r.top) / r.height - 0.5) * 2)
  }

  const curTurn = turns[cur]
  const header = jsxs('div', {
    className: 'hstk-tvh',
    children: [
      jsx('span', { children: LiveDot(liveId, status) }, 'dot'),
      jsx('span', { className: 't', children: title || d?.title || 'Untitled' }, 't'),
      jsx('span', { className: 'meta', children: [d?.model, d ? plural(d.total_turns, 'prompt') : '', d?.source === 'live' ? 'live feed' : d ? 'stored' : ''].filter(Boolean).join(' · ') }, 'm'),
      jsx('span', { className: 'sp' }, 'sp'),
      onBack && jsx('button', { className: 'hstk-x', onClick: e => (e.stopPropagation(), onBack()), children: 'Back esc' }, 'b'),
      jsx('button', { className: 'hstk-x primary', onClick: e => (e.stopPropagation(), openSession(storedId, e)), children: 'Open in Hermes' }, 'o')
    ]
  })

  // The prompt you're reading under, stuck to the top (outside the 3D layer so it stays crisp).
  const strip =
    curTurn &&
    jsx('button', {
      className: 'hstk-pstrip',
      onClick: () => jump(cur),
      children: jsxs('span', { className: 'in', children: [jsx('span', { className: 'n', children: `#${first + cur + 1}` }, 'n'), jsx('span', { className: 'p', children: oneLine(curTurn.user, 400) || '(no prompt)' }, 'p')] })
    })

  const body = !d
    ? jsx(NoFeed, { loading: t.sq.isLoading, error: t.sq.error })
    : jsxs('div', {
        className: 'hstk-pbody',
        children: [
          jsx(
            'div',
            {
              className: 'hstk-pscroll',
              ref: scroller,
              onScroll,
              children: jsx('div', {
                className: 'hstk-pcol',
                children: [
                  ...turns.map((tn, i) =>
                    jsx(PaperChapter, { tn, i, n: first + i + 1, open: folds[i] ?? i === turns.length - 1, onFold, sectionRef: sectionRef(i) }, first + i)
                  ),
                  jsx(Inflight, { live: t.live, paper: true }, 'live')
                ]
              })
            },
            'scroll'
          ),
          jsx(Rail, { turns, first, cur, jump }, 'rail')
        ]
      })

  return jsxs('div', {
    className: 'hstk-paper',
    'data-phase': lifted ? 'paper' : 'flat',
    onPointerMove: onMove,
    onPointerLeave: () => aim(0, 0),
    children: [header, strip, body, jsx(Composer, { storedId, liveId, storedModel: t.d?.model || '', info: { ...(model ? { model } : {}), ...(t.live.info || {}) }, working: status === 'working' || t.live.active, inputRef: input, onSent: () => ((t.pinnedBottom.current = true), t.sq.refetch?.()) }, 'comp')]
  })
}

// Is the app's background light? Back cards dim toward the background: darker on a dark theme,
// paler on a light one (darkening on white reads as dirty grey). Read from the painted colour of
// the theme's own --ui-bg-primary, so it follows Hermes' theme whatever sets it.
function bgIsLight() {
  try {
    const probe = document.createElement('i')
    probe.style.cssText = 'position:absolute;width:0;height:0;color:var(--ui-bg-primary, Canvas)'
    ;(document.querySelector('.hstk') || document.body).appendChild(probe)
    const col = getComputedStyle(probe).color
    probe.remove()
    const cx = document.createElement('canvas').getContext('2d', { willReadFrequently: true })
    cx.fillStyle = col
    cx.fillRect(0, 0, 1, 1)
    const [r, g, b] = cx.getImageData(0, 0, 1, 1).data
    return 0.2126 * r + 0.7152 * g + 0.0722 * b > 140
  } catch {
    return false
  }
}
function useLightBg() {
  const [light, setLight] = useState(bgIsLight)
  useEffect(() => {
    const check = () => setLight(bgIsLight())
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)')
    mq?.addEventListener?.('change', check)
    const mo = new MutationObserver(check)
    for (const el of [document.documentElement, document.body]) mo.observe(el, { attributes: true, attributeFilter: ['class', 'style', 'data-theme'] })
    check()
    return () => (mq?.removeEventListener?.('change', check), mo.disconnect())
  }, [])
  return light
}
// Dim a card by `m` (0..1) toward the background. Dark: brightness. Light: mix toward white, done as
// contrast c then brightness 1 + m, which maps v → v·(1 − m) + m (white stays white).
const dimFilter = (m, light) => (m <= 0 ? 'none' : light ? `contrast(${((1 - m) / (1 + m)).toFixed(4)}) brightness(${(1 + m).toFixed(4)})` : `brightness(${(1 - m).toFixed(4)})`)

// ── the stack primitive ─────────────────────────────────────────────────────
// Every card is always in the DOM; r = how many steps it is behind the front card. Changing the
// selection (or the order) changes every transform, and the CSS transition is the animation.
function Stage({ items, sel, step, pick, onFront, onOpen, onFocus, render }) {
  const ref = useRef(null)
  const light = useLightBg()
  const [off, setOff] = useState(0) // how far the fingers have pushed past the selected card, in cards
  const [scrolling, setScrolling] = useState(false)
  const now_ = useRef({})
  now_.current = { sel, n: items.length, step, onFocus }
  const acc = useRef({ off: 0, frame: 0, idle: 0 })

  // Free scrolling: the stack moves with the gesture, slow or fast, and the
  // selection changes as each card passes. When the fingers stop, it settles on the nearest card.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const a = acc.current
    const frame = () => {
      a.frame = 0
      const { sel, n, step } = now_.current
      const move = Math.max(-sel, Math.min(n - 1 - sel, Math.round(a.off))) // whole cards travelled
      if (move) {
        step(move)
        a.off -= move
        now_.current.sel = sel + move
      }
      const at = sel + move
      if ((at <= 0 && a.off < 0) || (at >= n - 1 && a.off > 0)) a.off = Math.max(-0.3, Math.min(0.3, a.off)) // the ends give a little
      setOff(a.off)
    }
    const onWheel = e => {
      e.preventDefault()
      now_.current.onFocus?.()
      a.off += e.deltaY / Math.max(20, tune.scrollPx)
      setScrolling(true)
      if (!a.frame) a.frame = raf(frame)
      clearTimeout(a.idle)
      a.idle = setTimeout(() => {
        a.off = 0
        setOff(0)
        setScrolling(false)
      }, 150)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      el.removeEventListener('wheel', onWheel)
      caf(a.frame)
      clearTimeout(a.idle)
    }
  }, [])

  const depth = tune.depth
  // Only the cards near the front are in the DOM (two already flipped past, the ones in view,
  // two arriving), so a stack of hundreds costs the same as a stack of ten.
  const lo = Math.max(0, sel - 2)
  const hi = Math.min(items.length - 1, sel + depth + 2)
  const shown = []
  for (let k = lo; k <= hi; k++) shown.push([items[k], k])
  return jsx('div', {
    className: 'hstk-stage' + (scrolling ? ' scrolling' : ''),
    ref,
    'data-count': items.filter(it => !it.ghost).length,
    'data-order': items.map(it => it.id || '').join(' '),
    'data-states': items.map(it => it.state || '').join(' '),
    children: shown.map(([it, k]) => {
      const r = k - sel
      const rr = r - off // where the card is right now, between whole positions while you scroll
      const hidden = rr <= -1 || rr > depth
      let style
      if (rr < 0) {
        // passing the front: it drops toward you and fades
        const t = Math.min(1, -rr)
        style = { transform: `translate3d(0,${t * 120}%,${t * 160}px) rotateX(${-18 * t}deg)`, opacity: 1 - t, zIndex: 101, pointerEvents: t > 0.5 ? 'none' : 'auto' }
      } else {
        // Past `arcAt` the cards curve up and tip away.
        const far = Math.max(0, rr - tune.arcAt)
        const y = rr * tune.cardY + far * far * tune.arcUp
        style = {
          transform: `translate3d(${rr * tune.driftX}px,${-y}px,${-rr * tune.cardZ}px) rotateX(${Math.min(1, rr) * tune.backTilt + far * tune.arcTilt}deg)`,
          // Cards stay solid (text never shows through); only the last two fade out.
          opacity: hidden ? 0 : rr <= depth - 2 ? 1 : Math.max(0, (depth - rr + 1) / 3),
          filter: dimFilter(Math.min(0.65, Math.max(0, rr) * tune.dim), light),
          zIndex: 100 - Math.round(rr),
          pointerEvents: hidden ? 'none' : 'auto',
          animationDelay: `${(k % 4) * 0.35}s`
        }
      }
      return jsx(
        'div',
        {
          className: 'hstk-card' + (r === 0 && !it.ghost ? ' sel' : '') + (it.ghost ? ' ghost' : ''),
          'data-state': it.state || 'rest',
          'data-id': it.id,
          style,
          onClick: e => {
            onFocus?.()
            if (it.ghost) return
            if (r !== 0) pick(it)
            else if (e.metaKey) onOpen(it, e)
            else onFront(it, e)
          },
          onDoubleClick: e => !it.ghost && onOpen(it, e),
          children: render(it, r)
        },
        it.key
      )
    })
  })
}

const NativeDot = id =>
  SessionStatusDot ? jsx(Safe, { fallback: null, children: jsx(SessionStatusDot, { storedSessionId: id }) }) : null

// A card's body: the conversation's latest prompts, newest on top, one line each (the same
// landmarks the prompt rail uses inside a thread). Falls back to the first prompt's preview.
const useGlance = id =>
  useQuery(q(['glance', id], `/glance?ids=${enc(id)}`, Boolean(id), { staleTime: 10_000, refetchInterval: 20_000 })).data?.glance?.[id]

function CardPrompts({ id, fallback }) {
  const list = useGlance(id)?.prompts
  if (!list?.length) return jsx('div', { className: 'hstk-prev', children: fallback })
  return jsx('ol', {
    className: 'hstk-plist',
    children: list.map(p => jsxs('li', { title: p.text, children: [jsx('i', { children: `#${p.n}` }, 'n'), jsx('span', { children: p.text }, 't')] }, p.n))
  })
}

// What the session made, at a glance: the app it worked in, lines changed, time actually spent,
// where. From the backend's cached /glance (docs/04); nothing shows until it has something to say.
const mins = m => (m >= 60 ? `${Math.floor(m / 60)}h${m % 60 >= 5 ? ` ${m % 60}m` : ''}` : `${m}m`)
function CardFacts({ id }) {
  const g = useGlance(id)
  if (!g) return null
  const facts = [
    ...(g.kinds || []).filter(k => k.app).slice(0, 2).map(k => ({ k: 'app', t: k.label, title: `${k.count} ${k.label} file${k.count === 1 ? '' : 's'}` })),
    g.diff && g.diff.add + g.diff.del > 0 && { k: 'diff', add: g.diff.add, del: g.diff.del },
    g.files && g.files.written > 0 && { k: 'files', t: plural(g.files.written, 'file'), title: 'files written' },
    g.activeMin >= 2 && { k: 'time', t: `${mins(g.activeMin)} active`, title: 'time with activity (gaps under 10 minutes)' },
    g.repo && { k: 'repo', t: g.branch ? `${g.repo} · ${g.branch}` : g.repo, title: g.cwd }
  ].filter(Boolean)
  return facts.map(f =>
    f.k === 'diff'
      ? jsxs('span', { className: 'hstk-pill fact', 'data-fact': 'diff', title: 'lines added / removed', children: [jsx('b', { className: 'add', children: `+${f.add}` }, 'a'), ' ', jsx('b', { className: 'del', children: `−${f.del}` }, 'd')] }, 'diff')
      : jsx('span', { className: 'hstk-pill fact', 'data-fact': f.k, title: f.title, children: f.t }, f.k + f.t)
  )
}

// ── answering from the card (checkpoint C3) ─────────────────────────────────
// What a waiting session is blocked on, read from the gateway (never guessed from text):
// `session.events.since` returns the session's open server requests, with an approval's command
// already redacted by the gateway and its allowed choices listed. Answers go back through the
// gateway's own calls, naming the exact request:
//   approval → approval.respond { session_id, choice, request_id }
//   question → clarify.lock { request_id, question_id, answer }   (one question at a time)
// Rule: there is never an Approve button without the request shown right above it.
const usePending = (liveId, on) =>
  useQuery({
    queryKey: [ID, 'pending', liveId],
    queryFn: async () => (await host.request('session.events.since', { session_id: liveId, last_seen: Number.MAX_SAFE_INTEGER }))?.open_requests ?? [],
    enabled: Boolean(liveId) && on,
    refetchInterval: 2_500,
    staleTime: 1_000,
    retry: 0
  })
const CHOICE = {
  once: { label: 'Approve once', title: 'Allow this one time (⇧Y)' },
  session: { label: 'This session', title: 'Allow it for the rest of this session' },
  always: { label: 'Always', title: 'Always allow this. A lasting permission.' },
  deny: { label: 'Deny', title: 'Refuse it (⇧N)' }
}
const askKeys = { id: null, approve: null, deny: null } // the front card's answer, for ⇧Y / ⇧N

function CardAsk({ c, front, fallback }) {
  const pq = usePending(c.liveId, true)
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  const reqs = pq.data || []
  const approvals = reqs.filter(r => r.method === 'approval')
  const ap = approvals[0]
  const clarify = !ap && reqs.find(r => r.method === 'clarify')
  const question = clarify && (clarify.params?.questions || []).find(x => !(clarify.params?.answers && x.qid in clarify.params.answers))

  const send = async (key, method, params) => {
    if (busy) return
    setBusy(key)
    setErr('')
    haptic('tap')
    try {
      await host.request(method, params)
      await pq.refetch?.()
    } catch (e) {
      setErr('Could not send: ' + (e?.message || e))
    }
    setBusy('')
  }
  const answer = choice => ap && send(choice, 'approval.respond', { session_id: c.liveId, choice, request_id: ap.params?.request_id })
  useEffect(() => {
    if (!front || !ap) return
    Object.assign(askKeys, { id: c.id, approve: () => answer('once'), deny: () => answer('deny') })
    return () => {
      if (askKeys.id === c.id) Object.assign(askKeys, { id: null, approve: null, deny: null })
    }
  })

  if (!ap && !question) return fallback ? jsx('div', { className: 'hstk-lead', children: fallback }) : null
  const stop = { onClick: e => e.stopPropagation(), onDoubleClick: e => e.stopPropagation() }
  const btn = (key, label, title, run, primary) =>
    jsx('button', { type: 'button', className: 'hstk-x' + (primary ? ' primary' : ''), 'data-choice': key, title, disabled: Boolean(busy), onClick: run, children: busy === key ? '…' : label }, key)

  if (ap) {
    const p = ap.params || {}
    const choices = (Array.isArray(p.choices) && p.choices.length ? p.choices : ['once', 'deny']).filter(k => CHOICE[k])
    return jsxs('div', {
      className: 'hstk-ask',
      'data-kind': 'approval',
      ...stop,
      children: [
        jsx('div', { className: 'what', children: p.description || 'The agent wants to run this:' }, 'w'),
        p.command && jsx('pre', { className: 'cmd', title: p.command, children: p.command }, 'c'),
        jsxs('div', { className: 'row', children: [...choices.map(k => btn(k, CHOICE[k].label, CHOICE[k].title, () => answer(k), k === 'once')), approvals.length > 1 && jsx('span', { className: 'more', children: `+${approvals.length - 1} more waiting` }, 'm')] }, 'r'),
        err && jsx('div', { className: 'err', children: err }, 'e')
      ]
    })
  }
  const opts = Array.isArray(question.choices) ? question.choices.filter(x => typeof x === 'string') : []
  return jsxs('div', {
    className: 'hstk-ask',
    'data-kind': 'question',
    ...stop,
    children: [
      jsx('div', { className: 'what', children: question.question }, 'w'),
      opts.length > 0 && !question.multi_select
        ? jsx('div', { className: 'row', children: opts.map(o => btn(o, o, o, () => send(o, 'clarify.lock', { request_id: clarify.id, question_id: question.qid, answer: o }))) }, 'r')
        : jsx('div', { className: 'more', children: 'Open it in Hermes to answer.' }, 'm'),
      err && jsx('div', { className: 'err', children: err }, 'e')
    ]
  })
}

const renderCard = (c, { r = 0, grip, edit } = {}) => {
  if (c.ghost)
    return jsxs('div', { className: 'hstk-body', children: [jsx('div', { className: 'hstk-title', children: c.title }, 't'), jsx('div', { className: 'hstk-prev', children: c.preview }, 'p')] })
  const st = STATE_BY_KEY[c.state]
  const front = r === 0
  const editing = front && edit && edit.value !== null
  return [
    // The app's own running arc (the sidebar row's), so "working" looks the same everywhere.
    c.state === 'working' && jsx('span', { 'aria-hidden': true, className: 'arc-border hstk-arc' }, 'arc'),
    jsxs(
      'div',
      {
        className: 'hstk-chrome',
        children: [
          jsx('span', { className: 'hstk-ndot', children: NativeDot(c.id) }, 'd'),
          jsx('span', { className: 'lab', children: c.title }, 'l'), // the strip a card shows from behind: its title
          st.label && jsxs('span', { className: 'hstk-state', children: [Icon(st.icon), jsx('span', { children: st.label }, 't')] }, 's'),
          front && edit && jsx('button', { type: 'button', className: 'hstk-rename', title: 'Rename (r)', 'aria-label': 'Rename', onClick: e => (e.stopPropagation(), edit.start()), onDoubleClick: e => e.stopPropagation(), children: Icon('edit') }, 'ren'),
          front && grip
        ]
      },
      'chrome'
    ),
    jsxs(
      'div',
      {
        className: 'hstk-body',
        children: [
          editing
            ? jsx(
                'input',
                {
                  className: 'hstk-title hstk-titlebox',
                  autoFocus: true,
                  value: edit.value,
                  'aria-label': 'Conversation title',
                  onClick: e => e.stopPropagation(),
                  onDoubleClick: e => e.stopPropagation(),
                  onChange: e => edit.change(e.target.value),
                  onBlur: () => edit.cancel(),
                  onKeyDown: e => {
                    if (e.key === 'Enter') (e.preventDefault(), edit.save())
                    else if (e.key === 'Escape') (e.preventDefault(), edit.cancel())
                    e.stopPropagation()
                  }
                },
                't'
              )
            : jsx('div', { className: 'hstk-title', children: c.title }, 't'),
          c.state === 'needs' && c.liveId && r >= 0 && r <= 3
            ? jsx(CardAsk, { c, front, fallback: c.lead }, 'ask')
            : c.lead && jsx('div', { className: 'hstk-lead', children: c.lead }, 'lead'),
          r >= 0 && r <= 1 ? jsx(CardPrompts, { id: c.id, fallback: c.preview }, 'pl') : jsx('div', { className: 'hstk-prev', children: c.preview }, 'p')
        ]
      },
      'body'
    ),
    jsxs(
      'div',
      {
        className: 'hstk-meta',
        children: [
          jsx('span', { className: 'hstk-badge', title: c.pinned ? 'pinned' : c.source, children: Icon(c.pinned ? 'pinned' : SOURCE_ICON[c.source] || 'comment') }, 'badge'),
          ...c.pills.map(p => jsx('span', { className: 'hstk-pill', children: p }, p)),
          r >= 0 && r <= 1 && jsx(CardFacts, { id: c.id }, 'facts')
        ]
      },
      'meta'
    )
  ]
}

// The native status dots, rendered once per session out of sight and read back: the one place
// Zed Mode learns needs-input / working / stalled / background / unread, exactly as the sidebar shows them.
function DotProbe({ ids }) {
  const box = useRef(null)
  const sig = ids.join('|')
  useEffect(() => {
    const el = box.current
    if (!el) return
    const read = () => {
      let changed = false
      for (const n of el.children) {
        const cls = [...n.querySelectorAll('span')].map(s => s.getAttribute('class') || '').join(' ')
        const st = (DOT_CLASS.find(([re]) => re.test(cls)) || [])[1] || 'idle'
        if (dotStates.get(n.dataset.id) !== st) {
          dotStates.set(n.dataset.id, st)
          changed = true
        }
      }
      if (changed) bumpAttn()
    }
    read()
    if (typeof MutationObserver !== 'function') return
    const mo = new MutationObserver(read)
    mo.observe(el, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] })
    return () => mo.disconnect()
  }, [sig])
  if (!SessionStatusDot) return null
  return jsx('div', { ref: box, hidden: true, 'aria-hidden': true, children: ids.map(id => jsx('span', { 'data-id': id, children: NativeDot(id) }, id)) })
}

// ── Zed Mode ─────────────────────────────────────────────────────────────────────
// "After the next paint", on a timer: animation frames don't fire while the window is in the
// background, and a held thread must never be left waiting for one.
const raf2 = fn => setTimeout(fn, 34)

function ZedView({ inline = false }) {
  useTune() // re-render when a dial moves (the root carries the --hz-* variables)
  useAttention() // …and when a session's state changes
  const [selId, setSelId] = useState(null) // null = the front card, whatever it is right now
  const [held, setHeld] = useState(null) // { id, open, full }: the thread on the right; full = brought to the foreground
  const [box, setBox] = useState({ w: 1440, h: 900 }) // the Zed Mode area, for placing the stack
  const [arranging, setArranging] = useState(false)
  const [renaming, setRenaming] = useState(null) // { id, text }
  const [titles, setTitles] = useState({}) // names you just gave, until the lists catch up
  const [flash, setFlash] = useState('')
  const say = m => (setFlash(m), setTimeout(() => setFlash(f => (f === m ? '' : f)), 3200))
  const home = useRef(null)
  const [half, setHalf] = useState('thread') // which half the keys act on while a thread is held
  const [threadMode, setThreadModeState] = useState(memo.threadMode)
  const [tuning, setTuning] = useState(false)
  const root = useRef(null)
  const threadApi = useRef(null)
  const setThreadMode = m => ((memo.threadMode = m), setThreadModeState(m))

  useEffect(() => {
    const el = home.current
    if (!el) return
    const measure = () => el.clientWidth && setBox(b => (b.w === el.clientWidth && b.h === el.clientHeight ? b : { w: el.clientWidth, h: el.clientHeight }))
    measure()
    if (typeof ResizeObserver !== 'function') return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    if (!inline && inZed() && !document.activeElement?.closest?.('textarea')) root.current?.focus({ preventScroll: true })
  }, [Boolean(held), half])

  const zed = useQuery(q(['zed'], '/zed?pinned=20', true, { refetchInterval: 15_000, retry: 1 }))
  const all = useAllSessions(200)
  const liveQ = useLive()
  const backendOff = Boolean(zed.error)
  const loading = (zed.isLoading && !backendOff) || all.isLoading
  const live = liveQ.data || []
  const liveByStored = new Map(live.map(s => [s.session_key || s.id, s]))

  // ── one list: every conversation once, most urgent first ──
  const byId = new Map()
  for (const s of all.data || []) byId.set(s.id, { ...s, last: s.last_active ?? s.last ?? s.started_at ?? 0 })
  for (const s of zed.data?.all || []) if (!byId.has(s.id)) byId.set(s.id, s) // the whole history, however old
  for (const s of zed.data?.pinned || []) byId.set(s.id, { ...byId.get(s.id), ...s, pinned: true })
  for (const [id, l] of liveByStored) {
    const r = byId.get(id)
    if (r) byId.set(id, { ...r, title: r.title || l.title, last: Math.max(r.last || 0, l.last_active || 0) })
    else if (l.message_count > 0 || (l.status && l.status !== 'idle')) byId.set(id, { id, title: l.title || '', preview: l.preview || '', message_count: l.message_count || 0, source: '', last: l.last_active || 0 })
    else if (zedDrafts.has(id)) {
      // a chat started from Zed Mode, before its first prompt
      const d = zedDrafts.get(id)
      byId.set(id, { id, title: l.title || 'New chat', preview: d.cwd ? `in ${folderName(d.cwd)}` : '', message_count: 0, source: '', last: l.last_active || d.at })
    }
  }
  const cards = [...byId.values()]
    .map(r => {
      const l = liveByStored.get(r.id)
      const state = stateOf(r, l)
      const fail = l && failed.get(l.id)
      return {
        key: r.id,
        id: r.id,
        state,
        pinned: Boolean(r.pinned),
        source: r.source || '',
        last: r.last || 0,
        title: titles[r.id] || titleOf(r),
        liveId: l?.id || null,
        lead: state === 'failed' && fail ? fail.error : ((state === 'working' || state === 'needs') && l?.preview) || '', // why it's up front
        preview: r.preview || '',
        pills: [ago(r.last), r.message_count ? `${r.message_count} msgs` : ''].filter(Boolean)
      }
    })
    .sort((a, b) => STATE_RANK[a.state] - STATE_RANK[b.state] || b.last - a.last)
  const items = cards.length ? cards : [{ key: 'empty', ghost: true, title: loading ? 'Loading…' : 'No sessions yet', preview: loading ? '' : 'Start a chat, then come back to Zed Mode.' }]
  const sel = Math.max(0, cards.findIndex(c => c.id === selId))
  const cur = cards[sel]
  const counts = STATES.filter(s => s.sum).map(s => ({ ...s, n: cards.filter(c => c.state === s.key).length })).filter(s => s.n)

  const step = d => {
    const next = cards[Math.max(0, Math.min(cards.length - 1, sel + d))]
    if (next) setSelId(next.id)
  }
  const WANTS = { failed: 1, needs: 1, unread: 1 }
  const nextWanting = () => {
    const n = cards.length
    for (let i = 1; i <= n; i++) {
      const c = cards[(sel + i) % n]
      if (WANTS[c.state]) return void (haptic('tap'), setSelId(c.id))
    }
    say('Nothing needs you right now.')
  }
  // ⇧⏎: the stack steps down-left and the conversation floats in on the right.
  useEffect(() => {
    if (inline) return
    zedApi.hold = (id, write = false) => {
      setSelId(id)
      setHalf('thread')
      setHeld(h => (h ? { ...h, id, open: true } : { id, open: true, full: false }))
      if (write) setTimeout(() => threadApi.current?.write?.(), 350)
    }
    return () => (zedApi.hold = null)
  }, [inline])
  const hold = c => {
    if (!c || c.ghost) return
    if (inline) return openSession(c.id)
    haptic('open')
    setSelId(c.id)
    setHalf('thread')
    if (held) return setHeld(h => ({ ...h, id: c.id, open: true }))
    setHeld({ id: c.id, open: false, full: false })
    raf2(() => setHeld(h => h && { ...h, open: true }))
  }
  // ⇧⏎ again: the stack falls away and the conversation comes to the foreground. Esc steps back.
  const foreground = on => {
    haptic(on ? 'open' : 'tap')
    setHalf('thread')
    setHeld(h => h && { ...h, full: on })
  }
  const release = () => {
    if (!held) return
    haptic('tap')
    setHeld(h => h && { ...h, open: false, full: false })
    setTimeout(() => setHeld(h => (h && !h.open ? null : h)), tune.dive)
  }
  // While a thread is held, it follows the card you stop on in the stack.
  useEffect(() => {
    if (!held?.open || !cur || cur.id === held.id) return
    const t = setTimeout(() => setHeld(h => (h && h.open ? { ...h, id: cur.id } : h)), 160)
    return () => clearTimeout(t)
  }, [cur?.id, held?.id, held?.open])
  // Reading a conversation here counts as reading it: clear the app's own unread dot.
  useEffect(() => {
    if (!held?.open) return
    const t = setTimeout(() => {
      try {
        ackStoredSessionId?.(held.id)
      } catch {}
    }, 1500)
    return () => clearTimeout(t)
  }, [held?.id, held?.open])

  // ── keys ── (stack: ↑ deeper, ↓ closer)
  const onKey = e => {
    if (typing(e)) return
    const k = e.key
    if (k === '`' && !inline) {
      setTuning(v => !v)
      return e.preventDefault()
    }
    const tab = k === 'Tab' && !inline && !e.metaKey && !e.altKey && !e.ctrlKey
    const deeper = k === 'ArrowUp' || k === 'k' || (tab && !e.shiftKey)
    const closer = k === 'ArrowDown' || k === 'j' || (tab && e.shiftKey)
    if (held?.open) {
      // In a pane too narrow for side by side the thread already fills it: ⇧⏎ / esc / ← go back.
      const cramped = box.w > 0 && box.w < tune.splitMin
      if (k === 'Enter' && e.shiftKey) cramped ? release() : foreground(!held.full)
      else if (k === 'Escape') held.full && !cramped ? foreground(false) : release()
      else if (k === ' ') release()
      else if (k === 'Enter' && (e.metaKey || e.ctrlKey)) openSession(held.id, e)
      else if (k === 'ArrowLeft' || k === 'h') cramped ? release() : (held.full && foreground(false), setHalf('stack'))
      else if (k === 'ArrowRight' || k === 'l') setHalf('thread')
      else if (k === 'a') nextWanting() // the held thread follows
      else if (k === 'i' || k === '/') (setHalf('thread'), threadApi.current?.write())
      else if (half === 'thread' && (k === 'ArrowUp' || k === 'k')) threadApi.current?.prev()
      else if (half === 'thread' && (k === 'ArrowDown' || k === 'j')) threadApi.current?.next()
      else if (half === 'stack' && deeper) step(1)
      else if (half === 'stack' && closer) step(-1)
      else return
      return e.preventDefault()
    }
    if (k === 'Escape') {
      if (inline || !inZed()) return
      toggleZed()
    } else if (deeper) step(1)
    else if (closer) step(-1)
    else if (k === 'Home') setSelId(null)
    else if (k === 'r' && cur && !inline) rename.start()
    else if (k === 'a') nextWanting()
    else if (k === 'Y' && cur && askKeys.id === cur.id) askKeys.approve()
    else if (k === 'N' && cur && askKeys.id === cur.id) askKeys.deny()
    else if (k === 'Enter' && cur && e.shiftKey) hold(cur)
    else if (k === 'Enter' && cur && (e.metaKey || e.ctrlKey)) openSession(cur.id, e)
    else if (k === ' ' && cur) hold(cur)
    else if ((k === 'i' || k === '/') && cur && !inline) {
      hold(cur)
      setTimeout(() => threadApi.current?.write(), 60)
    } else return
    e.preventDefault()
  }

  // Rename the front card. The gateway names a conversation through its live session.
  const rename = {
    value: renaming && cur && renaming.id === cur.id ? renaming.text : null,
    start: () => {
      if (!cur) return
      if (!cur.liveId) return say('Renaming works while the chat is live.')
      setRenaming({ id: cur.id, text: cur.title })
    },
    change: text => setRenaming(x => x && { ...x, text }),
    cancel: () => setRenaming(null),
    save: async () => {
      const x = renaming
      const title = (x?.text || '').trim()
      setRenaming(null)
      root.current?.focus({ preventScroll: true })
      const c = x && cards.find(k => k.id === x.id)
      if (!c || !title || title === c.title) return
      try {
        await host.request('session.title', { session_id: c.liveId, title })
        setTitles(t => ({ ...t, [c.id]: title }))
      } catch (err) {
        say('Could not rename: ' + (err?.message || err))
      }
    }
  }

  // ── header ──
  const heldCard = held && cards.find(c => c.id === held.id)
  const seg = (key, opts, value, set) =>
    jsx('span', { className: 'hstk-seg', children: opts.map(m => jsx('button', { 'data-on': value === m ? '1' : '0', onClick: () => set(m), children: m.toUpperCase() }, m)) }, key)
  const bar = jsxs('div', {
    className: 'hstk-bar',
    children: [
      !inline && jsx(NewChatButton, { folders: zed.data?.folders }, 'new'),
      jsxs(
        'span',
        {
          className: 'hstk-crumbs',
          children: held
            ? [jsx('button', { onClick: release, children: 'Zed Mode' }, 'z'), jsx('span', { children: '›' }, 's'), jsx('span', { className: 'cur', children: heldCard?.title || 'session' }, 'c')]
            : [jsx('b', { children: 'Zed Mode' }, 'z')]
        },
        'crumbs'
      ),
      jsx('span', { className: 'sp' }, 'sp'),
      held && tune.paper > 0 && seg('tm', ['flat', 'paper'], threadMode, setThreadMode), // PAPER is on ice: off unless the experimental dial is on
      !inline && jsx('button', { className: 'hstk-x' + (tuning ? ' primary' : ''), title: 'Tuning panel (`)', onClick: () => setTuning(v => !v), children: 'Tune' }, 'tune'),
      !inline && inZed() && jsx('button', { className: 'hstk-x', onClick: toggleZed, children: 'Exit' }, 'exit')
    ]
  })
  const hint = jsx('div', {
    className: 'hstk-hint',
    children: flash
      ? flash
      : inline
      ? '↑↓ walk the stack · ⌘⏎ open in a new tab'
      : held
        ? held.full
          ? '↑↓ prompts (↓ past the last one: the end) · i write · ⌘⏎ open in a new tab · ⇧⏎ / esc back to the stack beside it'
          : half === 'thread'
            ? '↑↓ prompts · i write · a next that needs you · ← stack · ⇧⏎ bring it forward · esc put it back'
            : '↑↓ walk the stack (the thread follows) · → thread · ⇧⏎ bring it forward · esc put it back'
        : '↑↓ or scroll: walk the stack · a next that needs you · ⌘⏎ open in a new tab · ⇧⏎ / click hold it here · i write · r rename · esc exit'
  })

  // ── body ──
  const summary = jsx('div', {
    className: 'hstk-sum',
    children: counts.length
      ? counts.map(s =>
          jsxs('button', { className: 'hstk-chip', 'data-state': s.key, title: 'Jump to the first one', onClick: () => setSelId(cards.find(c => c.state === s.key).id), children: [jsx('i', {}, 'i'), s.sum(s.n)] }, s.key)
        )
      : jsx('span', { children: cards.length ? (cards[0].pinned ? 'All quiet · your pins are up front' : 'All quiet') : '' })
  })
  // ── where the stack sits ──
  // Its own width as a share of the Zed Mode area (must match .hstk-stackin), then the dials, clamped:
  // on its own it stays on screen; beside a thread it can never reach under the thread's left edge.
  const widthPct = Math.min(700 / box.w, 0.5) * 100
  const clamp = (v, a, b) => Math.min(Math.max(v, Math.min(a, b)), Math.max(a, b))
  const FLOAT_LEFT = 41 // % (.hstk-float)
  const place = (() => {
    if (!held?.open) {
      const sc = tune.stackScale
      const half = (widthPct * sc) / 2
      return { x: clamp(tune.stackX, -49 + half, 49 - half), y: tune.stackY, s: sc, lim: [-49 + half, 49 - half] }
    }
    const room = FLOAT_LEFT - 2 // the stack's lane, in %
    const sc = Math.min(tune.splitScale, room / widthPct)
    const half = (widthPct * sc) / 2
    const lim = [-49 + half, FLOAT_LEFT - 1 - 50 - half]
    return { x: clamp(tune.splitX, lim[0], lim[1]), y: tune.splitY, s: sc, lim }
  })()
  const narrow = box.w > 0 && box.w < tune.splitMin
  const fill = Boolean(held?.open && (held.full || narrow))
  const paneStyle = fill
    ? { transform: `translate(${place.x - 14}%,${place.y + 10}%) scale(${place.s * 0.82})`, opacity: 0, pointerEvents: 'none' }
    : { transform: `translate(${place.x}%,${place.y}%) scale(${place.s})` }

  // The grip on the front card: drag to place the stack (its own spot, or its spot beside a thread).
  const startArrange = e => {
    e.preventDefault()
    e.stopPropagation()
    const keys = held?.open ? ['splitX', 'splitY'] : ['stackX', 'stackY']
    const from = { x: e.clientX, y: e.clientY, vx: place.x, vy: place.y }
    const lim = place.lim
    setArranging(true)
    const move = ev =>
      setTune({ [keys[0]]: clamp(from.vx + ((ev.clientX - from.x) / box.w) * 100, lim[0], lim[1]), [keys[1]]: from.vy + ((ev.clientY - from.y) / box.h) * 100 }, { persist: false })
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      setArranging(false)
      setTune({}) // persist where it landed
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  const resetPlace = e => {
    e.stopPropagation()
    setTune(held?.open ? { splitX: TUNE_DEFAULTS.splitX, splitY: TUNE_DEFAULTS.splitY, splitScale: TUNE_DEFAULTS.splitScale } : { stackX: 0, stackY: 0, stackScale: 1 })
  }
  const grip =
    !inline &&
    jsx(
      'button',
      {
        type: 'button',
        className: 'hstk-grip',
        title: 'Drag to place the stack · double-click to reset',
        'aria-label': 'Place the stack',
        onPointerDown: startArrange,
        onClick: e => e.stopPropagation(),
        onDoubleClick: resetPlace,
        children: Icon('gripper')
      },
      'grip'
    )

  const liveHeld = held && liveByStored.get(held.id)
  const threadProps = held && {
    storedId: held.id,
    liveId: liveHeld?.id || null,
    status: liveHeld?.status || null,
    model: liveHeld?.model || '',
    title: heldCard?.title || liveHeld?.title || '',
    registerApi: api => (threadApi.current = api)
  }
  const body = jsxs('div', {
    className: 'hstk-home' + (arranging ? ' arranging' : ''),
    ref: home,
    'data-split': held?.open ? '1' : '0',
    'data-full': fill ? '1' : '0',
    'data-narrow': narrow ? '1' : '0',
    'data-half': half,
    children: [
      // While you drag the stack: centre lines, and the edge it can't cross beside a thread.
      arranging &&
        jsxs('div', { className: 'hstk-guides', children: [jsx('i', { className: 'v' }, 'v'), jsx('i', { className: 'h' }, 'h'), held?.open && jsx('i', { className: 'lim', style: { left: FLOAT_LEFT - 1 + '%' } }, 'l')] }, 'guides'),
      jsx(
        'div',
        {
          className: 'hstk-stackpane',
          style: paneStyle,
          onMouseDown: () => held && setHalf('stack'),
          children: jsxs('div', {
            className: 'hstk-stackin',
            children: [
              jsxs('div', {
                className: 'hstk-stagewrap',
                children: [
                  jsx(Stage, { items, sel, step, pick: c => setSelId(c.id), render: (c, r) => renderCard(c, { r, grip, edit: inline ? null : rename }), onFront: c => hold(c), onOpen: (c, e) => openSession(c.id, e) }, 'stage'),
                  summary
                ]
              }, 'stagewrap'),
              jsx('div', { className: 'hstk-count', children: cards.length ? `${sel + 1} / ${cards.length}` : '' }, 'n')
            ]
          })
        },
        'stack'
      ),
      held &&
        jsx(
          'div',
          {
            className: 'hstk-float',
            'data-open': held.open ? '1' : '0',
            onMouseDown: () => setHalf('thread'),
            children:
              threadMode === 'paper' && tune.paper > 0
                ? jsx(Paper, { ...threadProps, onBack: release }, 'p:' + held.id)
                : jsx(Thread, { ...threadProps, focused: half === 'thread', enter: true }, 'f:' + held.id)
          },
          'float'
        ),
      jsx(DotProbe, { ids: cards.slice(0, 300).map(c => c.id) }, 'probe') // states for the nearest 300; the deep past is just history
    ]
  })

  return jsxs('div', {
    ref: root,
    className: 'hstk' + (inline ? ' inline' : ''),
    'data-view': held ? (held.full || (box.w > 0 && box.w < tune.splitMin) ? 'foreground' : 'held') : 'stack',
    style: tuneVars(),
    tabIndex: 0,
    onKeyDown: onKey,
    children: [
      jsx('style', { children: CSS }, 'css'),
      jsx('div', { children: bar }, 'bar'),
      jsx('div', { children: hint }, 'hint'),
      jsx('div', { style: { display: 'contents' }, children: body }, 'body'),
      backendOff && jsx('div', { className: 'hstk-note', children: 'Pins need the plugin backend (README → Install). Everything else works without it.' }, 'off'),
      tuning && jsx('div', { children: jsx(TunePanel, { onClose: () => setTuning(false) }) }, 'tune')
    ]
  })
}

// ── registration ────────────────────────────────────────────────────────────
function registerTitlebarToggle(ctx) {
  let dispose = null
  const put = () => {
    const on = inZed()
    dispose?.()
    dispose = ctx.register({
      id: 'zed-toggle',
      area: TITLEBAR_TOOLS_RIGHT,
      order: 10,
      data: {
        id: 'zedmode-zed',
        label: on ? 'Exit Zed Mode (⌘⌥Z)' : 'Zed Mode (⌘⌥Z)',
        active: on,
        icon: jsx(Codicon, { name: on ? 'layers-active' : 'layers', size: '13.9px', className: 'leading-none' }),
        onSelect: toggleZed
      }
    })
  }
  put()
  ctx.addEventListener(window, 'hashchange', put)
  ctx.onDispose(() => dispose?.())
}

export default {
  id: ID,
  name: 'Zed Mode',
  register(ctx) {
    CTX = ctx
    setTune(ctx.storage?.get?.('tune', {}) || {}, { persist: false }) // your saved dials
    registerTitlebarToggle(ctx)

    // The same tuning panel as a user-facing page: Settings → Plugins → Zed Mode.
    ctx.registerSettingsPage?.({
      id: 'zed',
      title: 'Zed Mode',
      icon: 'layers',
      render: () => jsx('div', { className: 'hstk', style: { padding: 4 }, children: [jsx('style', { children: CSS }, 'css'), jsx(TunePanel, { embedded: true }, 'p')] })
    })

    // Failures: watched for the whole time the app is open, not only while Zed Mode is on screen,
    // so the stack is right the moment you come back to it. Kept for a day across reloads.
    failed.clear()
    for (const [sid, f] of Object.entries(ctx.storage?.get?.('failed', {}) || {})) if (f?.at > Date.now() - 86_400_000) failed.set(sid, f)
    if (typeof host.onEvent === 'function') {
      const off = host.onEvent('*', noteEvent)
      if (typeof off === 'function') ctx.onDispose(off)
    }

    ctx.registerMany([
      { id: 'page', area: ROUTES_AREA, data: { path: ROUTE }, render: () => jsx(ZedView, {}) },
      { id: 'nav', area: SIDEBAR_NAV_AREA, data: { path: ROUTE, label: 'Zed Mode', codicon: 'layers' } },
      {
        id: 'open',
        area: PALETTE_AREA,
        data: { id: 'zedmode.toggle-zed', label: 'Zed Mode: Toggle', keywords: ['zed', 'stack', 'sessions', 'inbox', 'pinned'], run: toggleZed }
      },
      {
        id: 'toggle',
        area: KEYBINDS_AREA,
        data: { id: 'zedmode.toggle-zed', label: 'Zed Mode: Toggle', category: 'Zed Mode', defaults: ['mod+alt+z'], run: toggleZed }
      },
      { id: 'directive', area: TRANSCRIPT_DIRECTIVE_AREA, data: { name: 'zedmode', render: () => jsx(ZedView, { inline: true }) } }
    ])
  }
}
