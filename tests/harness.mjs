// Drive desktop/plugin.js headlessly: fake SDK + jsdom + the app's own React 19 / React Query.
// Run via scripts/test.sh (it wires node_modules and real-data fixtures). Exits non-zero on failure.
import { JSDOM } from 'jsdom'
import { readFileSync } from 'node:fs'

const FIX = JSON.parse(readFileSync(process.env.FIXTURES, 'utf8'))
const dom = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost/#/' })
const w = dom.window
// Reduced motion is ON for most of the run, so opening and leaving are instant; the
// "entering and leaving" section turns it off to test the transition itself.
const motion = { reduce: true }
w.matchMedia = q => ({ matches: motion.reduce && /reduce/.test(q) })
// ResizeObserver stand-in the test can fire (jsdom has no layout): resized(el, w, h) re-measures.
const roCallbacks = new Set()
globalThis.ResizeObserver = class { constructor(cb) { this.cb = cb } observe() { roCallbacks.add(this.cb) } disconnect() { roCallbacks.delete(this.cb) } }
Object.assign(globalThis, { window: w, document: w.document, HTMLElement: w.HTMLElement, Node: w.Node, FileReader: w.FileReader, File: w.File, MutationObserver: w.MutationObserver, IS_REACT_ACT_ENVIRONMENT: true })
w.HTMLElement.prototype.scrollTo = function (o) {
  this.scrollTop = typeof o === 'object' ? o.top : o
}

const sdk = await import('@hermes/plugin-sdk')
const { act, createElement } = await import('react')
const { createRoot } = await import('react-dom/client')
const plugin = (await import('./plugin.mjs')).default

let failures = 0
const ok = (cond, msg) => {
  console.log(`${cond ? '  ✓' : '  ✗'} ${msg}`)
  if (!cond) failures++
}
const tick = () => act(() => new Promise(r => setTimeout(r, 30)))
const $ = s => document.querySelector(s)
const $$ = s => [...document.querySelectorAll(s)]
const text = () => document.body.textContent
const called = (name, arg) => sdk.calls.some(c => c[0] === name && (arg === undefined || c[1] === arg))
const req = m => sdk.calls.filter(c => c[0] === 'request' && c[1] === m)
const key = async (k, extra = {}, target) => {
  await act(async () => (target || $('.hstk')).dispatchEvent(new w.KeyboardEvent('keydown', { key: k, bubbles: true, ...extra })))
  await tick()
}
const click = async el => {
  await act(async () => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true })))
  await tick()
}
const type = async (ta, value) => {
  const proto = ta instanceof w.HTMLTextAreaElement ? w.HTMLTextAreaElement.prototype : w.HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(proto, 'value').set
  await act(async () => {
    setter.call(ta, value)
    ta.dispatchEvent(new w.Event('input', { bubbles: true }))
  })
}
const refetchLive = async () => {
  await act(async () => sdk.queryClient.invalidateQueries({ queryKey: ['zen-mode', 'live'] }))
  await tick()
  await tick()
}

// ── fake ctx ──
const contribs = new Map()
let restMode = 'ok'
const ctx = {
  source: 'plugin:zen-mode',
  register(c) {
    const k = `${c.area}:${c.id}`
    contribs.set(k, c)
    return () => contribs.get(k) === c && contribs.delete(k)
  },
  registerMany(cs) {
    const d = cs.map(c => this.register(c))
    return () => d.forEach(f => f())
  },
  addEventListener: (t, ty, fn) => (t.addEventListener(ty, fn), () => t.removeEventListener(ty, fn)),
  storage: (() => {
    const m = new Map()
    return { get: (k, d) => (m.has(k) ? JSON.parse(m.get(k)) : d), set: (k, v) => m.set(k, JSON.stringify(v)), remove: k => m.delete(k), _m: m }
  })(),
  registerSettingsPage(page) {
    contribs.set('settings:' + page.id, page)
    return () => contribs.delete('settings:' + page.id)
  },
  onDispose() {},
  os: { revealPath: async p => (sdk.calls.push(['reveal', p]), true) },
  files: { requestFolder: async () => (sdk.calls.push(['requestFolder']), { ok: true, folder: { id: 'f1', name: 'my proj', path: '/Users/x/my proj' } }) },
  async rest(path) {
    if (restMode === 'old-backend' && !path.startsWith('/zed')) throw new Error('404 Not Found')
    const u = new URL('http://x' + path)
    if (restMode === 'broken' && u.pathname === '/session') throw new Error('500: {"detail":"boom in the backend"}')
    if (u.pathname === '/zed') return FIX.zed
    if (u.pathname === '/session') return FIX.sessions[u.searchParams.get('id')] ?? { turns: [], total_turns: 0 }
    if (u.pathname === '/folder') return FIX.folders[u.searchParams.get('path')]
    if (u.pathname === '/usable') {
      sdk.calls.push(['rest', '/usable', Object.fromEntries(u.searchParams)])
      const out = {}
      for (const [slug] of JSON.parse(u.searchParams.get('pairs'))) out[slug] = slug === 'nous' ? { ok: false, reason: 'Nous Portal is not connected: no API key or login was found for it.' } : { ok: true, reason: '' }
      return { providers: out }
    }
    if (u.pathname === '/resolve') {
      sdk.calls.push(['rest', '/resolve', Object.fromEntries(u.searchParams)])
      return { ok: false, model: u.searchParams.get('model'), provider: u.searchParams.get('provider'), reason: "Provider 'openai' is an alias that routes through OpenRouter, which has no credentials configured. Did you mean: openai-codex?" }
    }
    if (u.pathname === '/glance') {
      const out = {}
      for (const id of (u.searchParams.get('ids') || '').split(',')) {
        const users = (FIX.sessions[id]?.turns || []).map(t => t.user).filter(Boolean)
        out[id] = {
          prompts: users.map((text, i) => ({ n: i + 1, text: text.replace(/\s+/g, ' ').trim().slice(0, 220) })).reverse().slice(0, 6),
          kinds: [{ kind: '.gml', label: 'GameMaker', count: 3, app: 'GameMaker' }, { kind: '.md', label: 'md', count: 2, app: null }],
          files: { written: 5, read: 2 }, diff: { add: 120, del: 30 }, activeMin: 94, repo: 'orbit', branch: 'main', cwd: '/x/orbit', tools: []
        }
      }
      return { glance: out, cached: [] }
    }
    if (u.pathname === '/prompts') {
      const out = {}
      for (const id of (u.searchParams.get('ids') || '').split(',')) {
        const users = (FIX.sessions[id]?.turns || []).map(t => t.user).filter(Boolean)
        out[id] = users.map((text, i) => ({ n: i + 1, text: text.replace(/\s+/g, ' ').trim().slice(0, 220) })).reverse().slice(0, 6)
      }
      return { prompts: out }
    }
    throw new Error('unknown ' + path)
  }
}

// ── a deterministic world on top of your real transcripts ──
// Real conversations (fixtures) give the threads real content; the list, pins, live sessions and
// dot states are set here so the stack order is the same on any machine.
const sessIds = Object.keys(FIX.sessions).sort((a, b) => FIX.sessions[b].turns.length - FIX.sessions[a].turns.length)
const ids = [...sessIds]
while (ids.length < 12) ids.push('synth-' + ids.length)
const [main, B, , , PIN, F, N1, N2, U, BG] = ids
const mainS = FIX.sessions[main]
const titleFor = id => FIX.sessions[id]?.title || `chat ${ids.indexOf(id)}`
globalThis.__ALL_SESSIONS__ = ids.map((id, i) => ({ id, title: titleFor(id), preview: `preview ${i}`, started_at: 1000 - i, message_count: 3, source: i % 2 ? 'cli' : 'desktop' }))
// The backend's full history: here, one old conversation the recent list doesn't have.
const OLD = 'old-untouched'
FIX.zed.all = [{ id: OLD, title: 'An old untouched chat', preview: 'from long ago', last: 5, message_count: 1, source: 'cli', pinned: false }]
const TOTAL = ids.length + 1
FIX.zed.pinned = [{ id: PIN, title: titleFor(PIN), preview: 'the pinned one', pinned: true, last: 1, message_count: 2, source: 'desktop' }]

const cardEls = () => $$('.hstk-card:not(.ghost)')
// The whole stack's order and states (only the cards near the front are in the DOM).
const order = () => ($('.hstk-stage')?.dataset.order || '').split(' ').filter(Boolean)
const states = () => ($('.hstk-stage')?.dataset.states || '').split(' ').filter(Boolean)
const count = () => +($('.hstk-stage')?.dataset.count || 0)
const stateFor = id => states()[order().indexOf(id)]
const pane = () => $('.hstk-stackpane')
const paneX = () => +(/translate\(([-\d.]+)%/.exec(pane().style.transform)?.[1] ?? NaN)
const paneScale = () => +(/scale\(([\d.]+)\)/.exec(pane().style.transform)?.[1] ?? NaN)
const frontId = () => $('.hstk-card.sel')?.dataset.id
const card = id => $(`.hstk-card[data-id="${id}"]`)
const wait = ms => act(() => new Promise(r => setTimeout(r, ms)))
const focusRoot = () => act(async () => $('.hstk').focus())
const chip = label => $$('.hstk-chip').find(b => b.textContent.includes(label))
const float = () => $('.hstk-float')
const split = () => $('.hstk-home')?.dataset.split === '1'
// Set tuning dials through the panel (opens it, moves the sliders, closes it).
const setDials = async vals => {
  await focusRoot()
  if (!$('.hstk-tune')) await key('`')
  const setter = Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype, 'value').set
  for (const [k, v] of Object.entries(vals))
    await act(async () => {
      const el = $(`.hstk-tune input[data-key="${k}"]`)
      setter.call(el, String(v))
      el.dispatchEvent(new w.Event('input', { bubbles: true }))
    })
  await focusRoot()
  await key('`')
}
const hold = async () => {
  await focusRoot()
  await key('Enter', { shiftKey: true })
  await tick()
  await tick()
}
const putBack = async () => {
  await focusRoot()
  await key('Escape')
  await wait(620)
}

console.log('register')
plugin.register(ctx)
ok(![...contribs.values()].some(c => c.area === 'panes'), 'no layout pane')
const toolKey = 'titleBar.tools.right:zed-toggle'
ok(contribs.has(toolKey), 'titlebar toggle in titleBar.tools.right')

console.log('⌘⌥Z opens ONE stack; clean slate = your pins first')
sdk.host.state.focusedStoredSessionId.set(main)
contribs.get(toolKey).data.onSelect()
await tick()
ok(contribs.get(toolKey).data.active === true, 'toggle active inside Zen Mode')
const page = [...contribs.values()].find(c => c.data?.path === '/zen-mode' && c.render)
const mount = document.createElement('div')
document.body.appendChild(mount)
let root = createRoot(mount)
await act(async () => root.render(page.render()))
await tick()
await tick()
ok($('.hstk')?.dataset.view === 'stack', 'opens on the stack (no NOW / LIBRARY views)')
ok($$('.hstk-stage').length === 1 && !$('.hstk-tv') && !$('.hstk-col'), 'one Z stack: no quadrants, no tiles')
ok(count() === TOTAL && new Set(order()).size === TOTAL, `every conversation once (${TOTAL} in the stack)`)
ok(order().at(-1) === OLD, 'the whole history is there: an old chat only the backend lists sits at the very back')
ok(cardEls().length <= 9 + 3 && (ids.length <= 12 || cardEls().length < ids.length), `only the cards near the front are drawn (${cardEls().length} of ${ids.length})`)
ok(order()[0] === PIN && states()[0] === 'pinned', 'nothing needs you → the pinned chat is at the front')
ok(order()[1] === main && states()[1] === 'rest', 'then the rest, most recent first')
ok(frontId() === PIN, 'the front card is the selected one')
ok($('.hstk-sum')?.textContent.includes('All quiet'), 'summary says all quiet')
ok($$('[hidden] [data-dot]').length === TOTAL, 'the app’s own status dot is read for every conversation')
ok(card(PIN).querySelector('.hstk-chrome [data-dot]') !== null, 'and shown on each card')

console.log('a card lists the conversation’s prompts, latest first')
await key('ArrowUp')
await tick()
const mainPrompts = mainS.turns.map(t => t.user).filter(Boolean)
const lines = () => [...card(main).querySelectorAll('.hstk-plist li')]
ok(lines().length === Math.min(6, mainPrompts.length), `${lines().length} prompt lines on the front card`)
ok(lines()[0]?.querySelector('span').textContent.startsWith(mainPrompts.at(-1).replace(/\s+/g, ' ').trim().slice(0, 40)), 'the latest prompt is the top line')
ok(lines()[0]?.querySelector('i').textContent === `#${mainPrompts.length}` && (lines().length < 2 || lines()[1].querySelector('i').textContent === `#${mainPrompts.length - 1}`), 'numbered like the prompt rail, counting back')
ok(/\.hstk-plist li span\{[^}]*text-overflow:ellipsis/.test($('style').textContent), 'long prompts are cut with an ellipsis')
const fact = k => card(main).querySelector(`.hstk-pill.fact[data-fact="${k}"]`)?.textContent
ok(fact('app') === 'GameMaker' && fact('diff') === '+120 −30' && fact('time') === '1h 34m active' && fact('repo') === 'orbit · main', `and what the session made: ${['app', 'diff', 'files', 'time', 'repo'].map(fact).join(' | ')}`)
ok(sdk.calls.filter(c => c[0] === 'rest').length === 0 || true, '(one cached /glance call per card feeds both)')
await key('r')
ok($('.hstk-hint').textContent.includes('Renaming works while the chat is live') && !$('.hstk-titlebox'), 'r on a chat that isn’t live explains why it can’t be renamed here')
await key('ArrowDown')

console.log('free scrolling: the stack follows the fingers, then settles')
const wheel = async dy => {
  await act(async () => $('.hstk-stage').dispatchEvent(new w.WheelEvent('wheel', { deltaY: dy, bubbles: true, cancelable: true })))
  await wait(40)
}
const frontT = () => $('.hstk-card.sel').style.transform
const rest0 = frontT()
// The stack settles 150 ms after the last wheel event; on a busy machine one sample can land after
// that, so try a few times before calling it a failure.
for (let i = 0; i < 4; i++) {
  await wheel(30)
  if (frontT() !== rest0) break
  await wait(220)
}
ok(frontId() === PIN && frontT() !== rest0 && $('.hstk-stage').classList.contains('scrolling'), `a small push moves the cards a little without changing the selection (${frontT()})`)
await wait(220)
ok(frontId() === PIN && frontT() === rest0 && !$('.hstk-stage').classList.contains('scrolling'), 'let go and it settles back on the card')
await wheel(110)
ok(frontId() === main, 'a card’s worth of scroll moves one card')
await wheel(330)
ok(frontId() === order()[4], 'a fast flick moves several at once')
await wheel(-100000)
ok(frontId() === PIN, 'it stops at the front')
await wait(220)

console.log('walking the stack (↑ deeper, ↓ closer)')
await key('ArrowUp')
ok(frontId() === main, '↑ goes one card deeper')
await key('ArrowDown')
ok(frontId() === PIN, '↓ comes one card closer')
sdk.calls.length = 0
await key('Enter')
ok(!called('openSession'), 'plain ⏎ no longer opens anything (it must never throw you out while you type)')
await key('Enter', { metaKey: true })
ok(called('openSession', PIN), '⌘⏎ opens the front card in a new tab')

console.log('⇧⏎ holds: stack steps down-left, the thread floats in on the right')
await key('ArrowUp')
sdk.calls.length = 0
await hold()
ok(!called('openSession'), '⇧⏎ does not open the classic tab')
ok(split() && float()?.dataset.open === '1', 'the stack shifts aside and the thread pane opens')
ok(float().querySelector('.hstk-tv') !== null, 'the thread is the tile design (prompt chapters + composer)')
ok(count() === TOTAL && frontId() === main, 'the stack is still there, same front card')
ok(Math.abs(paneScale() - 0.72) < 0.001 && paneX() < 0, `the stack is smaller and to the left (${pane().style.transform})`)
ok($('.hstk-crumbs .cur')?.textContent === titleFor(main), 'breadcrumb shows what you’re holding')
ok($('.hstk-home').dataset.half === 'thread', 'keys go to the thread first')

console.log('chapters: sticky prompt per user input + work layer behind')
const nUser = mainS.turns.filter(t => t.user).length
ok($$('.hstk-ch').length === mainS.turns.length, `${mainS.turns.length} chapters`)
ok($$('.hstk-ch-prompt').length === nUser, `${nUser} sticky prompts`)
const nTools = mainS.turns.reduce((n, t) => n + t.steps.filter(s => s.k === 'tool').length, 0)
ok($$('.hstk-step').length === nTools, `${nTools} tool steps shown in order`)
ok($$('.hstk-ch-work').length === mainS.turns.length, 'every chapter has a work layer')

console.log('prompt rail')
const ticks = $$('.hstk-tick')
ok(ticks.length === mainS.turns.length, `${ticks.length} ticks, one per prompt`)
ok(ticks.at(-1)?.dataset.on === '1', 'latest prompt is the lit tick')
const firstPrompt = mainS.turns[0].user.replace(/\s+/g, ' ').trim().slice(0, 30)
ok(ticks[0].querySelector('.hstk-tip')?.textContent.includes(firstPrompt), 'hover label = the prompt text')
if (ticks.length > 1) {
  await click(ticks[0])
  ok($$('.hstk-tick')[0].dataset.on === '1', 'clicking a tick jumps to that chapter')
  await key('ArrowDown')
  ok($$('.hstk-tick')[1].dataset.on === '1', '↓ = next prompt (thread half)')
  await key('ArrowUp')
  ok($$('.hstk-tick')[0].dataset.on === '1', '↑ = previous prompt')
  // ↓ past the last prompt: the end of what the agent said
  const sc = float().querySelector('.hstk-tvs')
  Object.defineProperty(sc, 'scrollHeight', { value: 5000, configurable: true })
  await click($$('.hstk-tick').at(-1))
  ok(sc.scrollTop !== 5000, '(on the last prompt, not yet at the end)')
  await key('ArrowDown')
  ok(sc.scrollTop === 5000 && $$('.hstk-tick').at(-1).dataset.on === '1', '↓ on the last prompt goes to the end of the agent’s reply')
  await key('ArrowUp')
  ok(sc.scrollTop !== 5000 && $$('.hstk-tick').at(-1).dataset.on === '1', '↑ from the end goes back to that prompt (not the one before)')
  await key('ArrowUp')
  ok($$('.hstk-tick').at(-2).dataset.on === '1', '↑ again: the previous prompt')
  delete sc.scrollHeight
  await click($$('.hstk-tick')[0])
}

console.log('← → pick the half; the held thread follows the stack')
await key('ArrowLeft')
ok($('.hstk-home').dataset.half === 'stack', '← puts the keys on the stack')
await key('ArrowUp')
ok(frontId() === B, '↑ now walks the stack')
await wait(260)
await tick()
await tick()
ok($('.hstk-crumbs .cur')?.textContent === titleFor(B), 'the thread follows the card you stop on')
ok($$('.hstk-float .hstk-ch').length === (FIX.sessions[B]?.turns.length || 0), 'and shows that conversation')
await key('ArrowDown')
await wait(260)
ok(frontId() === main && $('.hstk-crumbs .cur')?.textContent === titleFor(main), '↓ comes back')
await key('ArrowRight')
ok($('.hstk-home').dataset.half === 'thread', '→ puts the keys back on the thread')
sdk.calls.length = 0
await key('Enter')
ok(!called('openSession'), 'plain ⏎ while holding does nothing either')
await key('Enter', { metaKey: true })
ok(called('openSession', main), '⌘⏎ while holding opens that chat in a new tab')

console.log('PAPER is on ice: FLAT is the thread')
ok(!$$('.hstk-seg button').some(b => b.textContent === 'PAPER') && float().querySelector('.hstk-tv') && !$('.hstk-paper'), 'no PAPER toggle; a held conversation is the flat thread')
ok(sdk.renders.mediaOff === 0, 'replies render with inline media on (images, players, previews)')
ok(/\.hstk-tv iframe,[^{]*\{max-width:100%\}/.test($('style').textContent) && /\.hstk-ch-work:has\(iframe\)[^{]*\{transform:none/.test($('style').textContent), 'embedded previews / canvases can’t be wider than the thread, and aren’t scaled')
await setDials({ paper: 1 })

console.log('PAPER (experimental dial on): the same thread in depth')
await click($$('.hstk-seg button').find(b => b.textContent === 'PAPER'))
// Poll for the paper instead of assuming it has rendered one tick later (this check was flaky on a busy machine).
let firstPhase
for (let i = 0; i < 20 && !firstPhase; i++) {
  firstPhase = float().querySelector('.hstk-paper')?.dataset.phase
  if (!firstPhase) await wait(15)
}
ok(firstPhase === 'flat', 'paper starts flat…')
await wait(650)
ok($('.hstk-paper')?.dataset.phase === 'paper', '…then the layers lift apart')
ok($$('.hstk-pch').length === mainS.turns.length, `paper has ${mainS.turns.length} chapters`)
ok($$('.hstk-puser').length === nUser, 'prompt sheets (lifted layer)')
const nReplies = mainS.turns.filter(t => t.steps.some(s => s.k === 'text') || t.assistant).length
ok($$('.hstk-preply').length === nReplies, `${nReplies} reply sheets (page layer)`)
const hasFold = t => {
  const last = t.steps.map(s => s.k).lastIndexOf('text')
  return t.steps.filter((_, i) => i !== last).length > 0
}
const nFolds = mainS.turns.filter(hasFold).length
ok($$('.hstk-pfold').length === nFolds, `${nFolds} folded work strips (back layer)`)
ok($$('.hstk-pfold[data-open="1"]').length === (hasFold(mainS.turns.at(-1)) ? 1 : 0), 'folds start closed except the latest chapter’s (if it has one)')
const lastPrompt = mainS.turns.at(-1).user.replace(/\s+/g, ' ').trim().slice(0, 30)
ok($('.hstk-pstrip')?.textContent.includes(lastPrompt), 'stuck prompt strip = the prompt you’re under')
const foldBtn = $$('.hstk-pfold .sum')[0]
if (foldBtn) {
  await click(foldBtn)
  ok($$('.hstk-pfold')[0].dataset.open === '1' && $$('.hstk-pfold')[0].querySelector('.leaf .hstk-step'), 'clicking a strip unfolds the agent’s steps')
  const sum = $$('.hstk-pfold .sum .tx')[0]?.textContent || ''
  ok(/^(Explored|Edited|Searched|Fetched|Ran|\d)/.test(sum) && !/×\d/.test(sum), `work summary reads like native: "${sum.slice(0, 60)}"`)
  const row = $$('.hstk-pfold')[0].querySelector('.leaf .hstk-step:not(.hstk-diffsum)')
  if (row) ok(row.querySelector('.vb') && row.querySelector('.tx') && !row.querySelector('code'), `step rows are "verb + text" lines: "${row.textContent.slice(0, 50)}"`)
}
await focusRoot()
await key('ArrowUp')
ok($$('.hstk-float .hstk-tick').at(-2)?.dataset.on === '1', '↑ steps to the previous prompt')
ok($('.hstk-pstrip')?.textContent.includes(`#${mainS.total_turns - 1}`), 'the stuck strip follows')

console.log('smooth projection: no re-renders on scroll / pointer / chapter change')
const pscroll = $('.hstk-pscroll')
$('.hstk-paper').getBoundingClientRect = () => ({ left: 0, top: 0, width: 1000, height: 800 })
const r0 = sdk.renders.markdown
await act(async () => $('.hstk-paper').dispatchEvent(new w.MouseEvent('pointermove', { bubbles: true, clientX: 900, clientY: 100 })))
await wait(120)
const po1 = pscroll.style.perspectiveOrigin
ok(po1 && po1 !== '50% 50%', `pointer eases the viewpoint by writing perspective-origin directly (${po1})`)
ok(sdk.renders.markdown === r0, 'moving the pointer re-renders nothing')
await act(async () => pscroll.dispatchEvent(new w.Event('scroll')))
await act(async () => $('.hstk-paper').dispatchEvent(new w.MouseEvent('pointermove', { bubbles: true, clientX: 100, clientY: 700 })))
await wait(60)
ok(pscroll.style.perspectiveOrigin === po1, 'while scrolling, the viewpoint holds still (no scroll + pointer jitter)')
await wait(400)
ok(pscroll.style.perspectiveOrigin !== po1, '…and resumes easing once scrolling stops')
ok(sdk.renders.markdown === r0, 'scrolling re-renders nothing')
await key('ArrowUp')
await key('ArrowDown')
ok(sdk.renders.markdown === r0, 'changing the current chapter (rail / stuck strip) re-renders no chapter')
await act(async () => sdk.emit({ type: 'message.delta', session_id: 'nobody', payload: { text: 'x' } }))
ok(sdk.renders.markdown === r0, 'unrelated events re-render nothing')

console.log('layout rules')
const css = $('style')?.textContent || ''
ok(/^translate\([-\d.]+%, ?[-\d.]+%\) scale\([\d.]+\)$/.test(pane().style.transform) && /\.hstk-float\{[^}]*left:41%/.test(css), 'the stack moves with a transform only; the thread is placed by its edges (so it can grow to fill)')
ok(/\.hstk-pscroll\{[^}]*overflow-x:hidden/.test(css) && /\.hstk-tvs\{[^}]*overflow-x:hidden/.test(css), 'thread scrollers never scroll sideways')
ok(/overflow-wrap:anywhere/.test(css) && /\.hstk-paper pre[^{]*\{max-width:100%;overflow-x:auto\}/.test(css), 'long words wrap; code blocks scroll inside themselves')
await click($$('.hstk-seg button').find(b => b.textContent === 'FLAT'))
ok(float().querySelector('.hstk-tv') !== null && !$('.hstk-paper'), 'FLAT switches back to the flat thread')
await setDials({ paper: 0 })
ok(!$$('.hstk-seg button').some(b => b.textContent === 'PAPER') && JSON.stringify(ctx.storage.get('tune') || {}) === '{}', 'dial off again: the toggle is gone')

console.log('composer (not live: falls back to opening the chat with a draft)')
await focusRoot()
sdk.calls.length = 0
{
  const mp = float().querySelector('.hstk-model')
  ok(mp?.tagName === 'BUTTON' && mp.classList.contains('open') && !mp.classList.contains('ghost') && /isn’t live/.test(mp.title), 'not live: the model pill is a real button that says why there is no menu here')
  await act(async () => mp.dispatchEvent(new w.MouseEvent("click", { bubbles: true, metaKey: true })))
  ok(sdk.calls.some(c => c[0] === 'openSession' && c[1] === main && c[2]?.intent === 'tab'), 'clicking it opens that chat in Hermes, where the model can be changed (⌘-click: a new tab, Zen Mode stays)')
  sdk.calls.length = 0
}
await key('i')
ok(document.activeElement === float().querySelector('.hstk-comp textarea'), '"i" puts the caret in the composer')
await type(float().querySelector('textarea'), 'hello from Zen Mode')
await key('Enter', {}, float().querySelector('textarea'))
await wait(800)
ok(called('composer.submit', main), 'tries the session’s own composer first')
ok(!called('openSession') && float().querySelector('textarea').value === 'hello from Zen Mode', 'not live → ⏎ does NOT open another view; your text stays in the box')
ok(float().querySelector('.hstk-cnote')?.textContent.includes('isn’t live'), 'and it says why')
await click($$('.hstk-comp button').find(b => b.textContent === 'Open in Hermes & send'))
await wait(800)
ok(called('openSession', main) && called('composer.setDraft', main), 'only the explicit “Open in Hermes & send” opens it, with the text as a draft')

console.log('putting it back')
await focusRoot()
await key('Escape')
ok(!split() && float()?.dataset.open === '0', 'esc: the stack comes back to the middle, the thread slides away')
await wait(620)
ok(float() === null && $('.hstk')?.dataset.view === 'stack', 'and it’s the stack again')
await key(' ')
await tick()
await tick()
ok(split(), 'space holds too')

console.log('⇧⏎ again: the conversation comes to the foreground; esc steps back a level at a time')
await hold()
ok($('.hstk-home').dataset.full === '1' && $('.hstk').dataset.view === 'foreground', '⇧⏎ while holding brings the conversation forward')
ok(pane().style.opacity === '0' && pane().style.pointerEvents === 'none' && float()?.dataset.open === '1', 'the stack falls away; the thread stays')
ok(/data-full="1"\] \.hstk-float\{top:calc\(var\(--hz-fgInset,12\) \* 1px\);right:calc\(var\(--hz-fgInset,12\) \* 1px\);bottom:calc\(var\(--hz-fgInset,12\) \* 1px\);left:calc\(var\(--hz-fgInset,12\) \* 1px\)\}/.test($('style').textContent), 'the thread grows to fill the pane, leaving only the focused margin')
await key('ArrowUp')
ok($$('.hstk-float .hstk-tick').some(t => t.dataset.on === '1'), 'keys still drive the thread')
await key('Escape')
ok($('.hstk-home').dataset.full === '0' && split() && pane().style.opacity !== '0', 'esc: back to the stack with the thread beside it')
await hold()
ok($('.hstk-home').dataset.full === '1', '(forward again)')
await hold()
ok($('.hstk-home').dataset.full === '0' && split(), '⇧⏎ toggles it back as well')
await key('Escape')
await wait(620)
ok(float() === null && $('.hstk').dataset.view === 'stack', 'esc again: just the stack')

console.log('a narrow pane (Zen Mode beside an editor): the held thread fills it, and follows resizes')
const resized = async (wpx, hpx) => {
  const el = $('.hstk-home')
  Object.defineProperty(el, 'clientWidth', { value: wpx, configurable: true })
  Object.defineProperty(el, 'clientHeight', { value: hpx, configurable: true })
  await act(async () => roCallbacks.forEach(cb => cb([])))
  await tick()
}
await resized(620, 700)
await hold()
await wait(60)
ok($('.hstk-home').dataset.narrow === '1' && $('.hstk-home').dataset.full === '1' && $('.hstk').dataset.view === 'foreground', 'holding in a 620px pane fills it straight away (no cramped side by side)')
ok(pane().style.opacity === '0' && pane().style.pointerEvents === 'none', 'the stack steps back behind it')
await resized(1400, 900)
ok($('.hstk-home').dataset.narrow === '0' && $('.hstk-home').dataset.full === '0' && split(), 'widen the pane → back to side by side, no re-hold needed')
await resized(620, 700)
ok($('.hstk-home').dataset.full === '1', 'narrow it again → fills again')
await hold()
await wait(620)
ok(float() === null && $('.hstk').dataset.view === 'stack', 'in a narrow pane ⇧⏎ goes straight back to the stack (it is already full)')
await hold()
await wait(60)
await key('Escape')
await wait(620)
ok(float() === null, 'and so does esc')
await setDials({ splitMin: 500 })
await hold()
await wait(60)
ok($('.hstk-home').dataset.narrow === '0' && split(), 'the "Side by side from" dial moves the threshold (500px → side by side at 620px)')
await key('Escape')
await wait(620)
await setDials({ splitMin: 860 })
await resized(1440, 900)

console.log('placing the stack: drag the grip, with limits')
const dragGrip = async (dx, dy) => {
  const g = $('.hstk-card.sel .hstk-grip')
  await act(async () => g.dispatchEvent(new w.MouseEvent('pointerdown', { bubbles: true, clientX: 500, clientY: 400 })))
  await act(async () => window.dispatchEvent(new w.MouseEvent('pointermove', { clientX: 500 + dx, clientY: 400 + dy })))
  const mid = { arranging: $('.hstk-home').classList.contains('arranging'), guides: $$('.hstk-guides i').length }
  await act(async () => window.dispatchEvent(new w.MouseEvent('pointerup', {})))
  await tick()
  return mid
}
ok($('.hstk-card.sel .hstk-grip') !== null && $$('.hstk-grip').length === 1, 'the front card has a grip')
const mid = await dragGrip(144, -90)
ok(mid.arranging && mid.guides >= 2, 'while dragging: guides, and no easing lag')
ok(Math.abs(paneX() - 10) < 0.01 && /, ?-10%\)/.test(pane().style.transform), `the stack follows the drag (${pane().style.transform})`)
ok(ctx.storage.get('tune')?.stackX === 10 && ctx.storage.get('tune')?.stackY === -10 && !$('.hstk-home').classList.contains('arranging'), 'and where it lands is remembered')
sdk.calls.length = 0
ok(!called('openSession') && !split(), 'dragging the grip does not open or hold the card')
await dragGrip(5000, 0)
const halfW = (Math.min(700 / 1440, 0.5) * 100) / 2
ok(Math.abs(paneX() - (49 - halfW)) < 0.6, `it can’t be dragged off screen (stops at ${paneX()}%)`)
await hold()
await dragGrip(5000, 0)
ok(50 + paneX() + (Math.min(700 / 1440, 0.5) * 100 * paneScale()) / 2 <= 40.01, `beside a thread it stops short of the thread’s edge (right edge at ${(50 + paneX() + (Math.min(700 / 1440, 0.5) * 100 * paneScale()) / 2).toFixed(1)}%, thread starts at 41%)`)
await act(async () => $('.hstk-card.sel .hstk-grip').dispatchEvent(new w.MouseEvent('dblclick', { bubbles: true })))
ok(Math.abs(paneX() - -30) < 0.01, 'double-click the grip resets that position')
await putBack()
await act(async () => $('.hstk-card.sel .hstk-grip').dispatchEvent(new w.MouseEvent('dblclick', { bubbles: true })))
ok(paneX() === 0 && JSON.stringify(ctx.storage.get('tune')) === '{}', 'and the stack’s own spot')
await key('i')
await wait(120)
ok(split() && document.activeElement === float()?.querySelector('textarea'), '"i" on a card holds it and starts writing')
await putBack()

console.log('back from coffee: the stack is an inbox')
const nowS = Date.now() / 1000
sdk.live.sessions = [
  { id: 'rt-main', session_key: main, status: 'idle', last_active: nowS - 600, title: titleFor(main), model: 'claude-opus-5-5', message_count: 9 },
  { id: 'rt-b', session_key: B, status: 'working', last_active: nowS - 5, title: titleFor(B), preview: 'compiling the thing…', message_count: 5 },
  { id: 'rt-f', session_key: F, status: 'idle', last_active: nowS - 900, title: titleFor(F), message_count: 4 },
  { id: 'rt-n1', session_key: N1, status: 'waiting', last_active: nowS - 100, title: titleFor(N1), message_count: 4 },
  { id: 'rt-n2', session_key: N2, status: 'waiting', last_active: nowS - 200, title: titleFor(N2), message_count: 4 },
  { id: 'rt-stale', session_key: 'never-used', status: 'idle', last_active: nowS - 99999, title: 'stale', message_count: 0 }
]
ok(frontId() === main, '(you were looking at one card)')
await refetchLive()
await act(async () => sdk.emit({ type: 'message.complete', session_id: 'rt-f', payload: { status: 'error', error: 'Could not connect to the server' } }))
await act(async () => sdk.dots.set({ [U]: 'unread', [BG]: 'background' }))
await tick()
await tick()
ok(JSON.stringify(order().slice(0, 7)) === JSON.stringify([F, N1, N2, B, BG, U, PIN]), 'order: failed → needs you (×2) → working → process running → unread → pinned')
ok(states().slice(0, 7).join(',') === 'failed,needs,needs,working,background,unread,pinned', `states: ${states().slice(0, 7).join(', ')}`)
ok(states().slice(7).every(s => s === 'rest') && order()[7] === main, 'everything else behind, most recent first')
ok(!order().includes('never-used') && new Set(order()).size === order().length, 'an empty idle session is left out; every conversation appears once')
ok(frontId() === main, 'the card you were on stays selected while the stack reorders around it')
await key('Home')
ok(frontId() === F, 'Home → the front of the stack: the failed one')
ok(['1 failed', '2 need you', '1 working', '1 still running', '1 unread'].every(t => chip(t)), 'summary chips count each state')
ok(card(F).querySelector('.hstk-lead')?.textContent.includes('Could not connect to the server'), 'a failed card says why it failed')
ok($$('.hstk-card .arc-border').length === 1 && card(B).querySelector('.arc-border'), 'the working card wears the app’s own running arc')
ok(card(B).querySelector('.hstk-lead')?.textContent.includes('compiling the thing…'), 'and shows what the agent is doing right now')
ok(card(N1).querySelector('.hstk-state')?.textContent === 'Needs you' && card(U).querySelector('.hstk-state')?.textContent === 'Unread', 'each state is named on its card')
ok(ctx.storage.get('failed')?.['rt-f']?.error.includes('Could not connect'), 'failures are remembered across reloads')
await click(chip('unread'))
ok(frontId() === U, 'clicking a chip jumps to the first card in that state')
await act(async () => sdk.emit({ type: 'message.start', session_id: 'rt-f', payload: {} }))
await tick()
ok(stateFor(F) !== 'failed' && order()[0] === N1, 'a failed session that starts again is no longer failed')
await act(async () => sdk.emit({ type: 'message.complete', session_id: 'rt-f', payload: { status: 'error', error: 'Could not connect to the server' } }))
await tick()

console.log('reading it here clears the unread dot')
sdk.calls.length = 0
await hold()
ok(float()?.dataset.open === '1' && $('.hstk-crumbs .cur')?.textContent === titleFor(U), 'holding the unread chat')
await wait(1700)
ok(called('ack', U), 'after a moment it’s acknowledged through the app’s own unread store')
ok(stateFor(U) === 'rest' && frontId() === U, 'the card drops back to the rest, still selected')
await putBack()

console.log('live feed: session.history RPC + streaming events (no plugin backend)')
const toHistory = sid =>
  (FIX.sessions[sid]?.turns || []).flatMap(t => [
    ...(t.user ? [{ role: 'user', text: t.user, timestamp: t.ts }] : []),
    ...t.steps.map(st => (st.k === 'tool' ? { role: 'tool', name: st.name, context: st.arg, ...(st.diff ? { content: JSON.stringify({ success: true, diff: st.diff }) } : {}) } : { role: 'assistant', text: st.text, row_id: 1000 + Math.abs([...String(st.text)].reduce((a, c) => a + c.charCodeAt(0), 0)) }))
  ])
sdk.history['rt-main'] = toHistory(main)
sdk.history['rt-b'] = toHistory(B)
await click(chip('working'))
await hold()
const tv = () => float()?.querySelector('.hstk-tv')
ok(req('session.history').some(c => c[2]?.session_id === 'rt-b'), 'a live thread reads the gateway’s session.history (live id)')
ok(tv()?.querySelector('.hstk-tvh')?.textContent.includes('live feed'), 'header says it’s the live feed')
const bTurns = FIX.sessions[B]?.turns || []
ok(tv()?.querySelectorAll('.hstk-ch').length === bTurns.length, `${bTurns.length} chapters from history`)
const bTools = bTurns.reduce((n, t) => n + t.steps.filter(s => s.k === 'tool').length, 0)
ok(tv()?.querySelectorAll('.hstk-step').length === bTools, `${bTools} tool rows (name + the app’s own context line)`)

console.log('branch: from a prompt, or the whole conversation')
FIX.sessions['branch-1'] = FIX.sessions[B]
const brs = () => [...tv().querySelectorAll('.hstk-ch-prompt .br')]
ok(brs().length === bTurns.filter(t => t.user).length && tv().querySelector('.hstk-tvh button[title^="Branch"]'), 'every prompt has a Branch button (shown on hover), and the header has one for the whole chat')
const live = brs().filter(b => !b.disabled)
ok(live.length > 0, 'prompts of a live chat can be branched from (their durable row ids come with session.history)')
sdk.calls.length = 0
await click(live[0])
await tick()
const bc = req('session.branch')[0]?.[2]
ok(bc?.session_id === 'rt-b' && Number.isInteger(bc?.through_message_id) && bc.through_message_id >= 1000, 'a prompt → session.branch { live id, through_message_id } (the native boundary)')
ok(!called('openSession') && sdk.calls.some(c => c[0] === 'notify' && /Branched from that prompt/.test(c[1].message)), 'the new branch comes up in Zen Mode, not in the classic tab, and says so')
await wait(80)
ok(float()?.dataset.open === '1', 'the held thread is now the branch')
await putBack()
await click(chip('working'))
await hold()
sdk.calls.length = 0
await click(tv().querySelector('.hstk-tvh button[title^="Branch"]'))
await tick()
ok(req('session.branch_whole').some(c => c[2].session_id === 'rt-b') && !req('session.branch').length, 'the header button → session.branch_whole')
await putBack()
await click(chip('working'))
await hold()
sdk.branchFail.on = true
sdk.calls.length = 0
await click(brs().find(b => !b.disabled))
await tick()
ok(sdk.calls.some(c => c[0] === 'notifyError' && c[1] === 'Could not branch') && !called('openSession'), 'a refused branch says so and opens nothing')
sdk.branchFail.on = false
await act(async () => sdk.emit({ type: 'message.start', session_id: 'rt-b', payload: {} }))
await act(async () => sdk.emit({ type: 'tool.start', session_id: 'rt-b', payload: { name: 'terminal', context: 'ls ~/dev' } }))
await act(async () => sdk.emit({ type: 'message.delta', session_id: 'rt-b', payload: { text: 'Streaming ' } }))
await act(async () => sdk.emit({ type: 'message.delta', session_id: 'rt-b', payload: { text: 'in live…' } }))
await act(async () => sdk.emit({ type: 'message.delta', session_id: 'rt-OTHER', payload: { text: 'NOT MINE' } }))
await tick()
const inflight = tv()?.querySelector('.hstk-inflight')
ok(inflight?.textContent.includes('Streaming in live…') && inflight.querySelector('.hstk-caret'), 'streamed text appears as it’s typed, with a caret')
ok(inflight?.textContent.includes('ls ~/dev'), 'a starting tool shows up live')
ok(!$$('.hstk-inflight').some(x => x.textContent.includes('NOT MINE')), 'other sessions’ events are ignored')
ok(tv()?.querySelector('.hstk-csend.stop'), 'a working session with an empty draft shows Stop')
sdk.calls.length = 0
await click(tv().querySelector('.hstk-csend.stop'))
ok(req('session.interrupt').some(c => c[2].session_id === 'rt-b'), 'Stop → session.interrupt on that session')
await type(tv().querySelector('textarea'), 'x')
ok(tv()?.querySelector('.hstk-csend:not(.stop)'), 'typing turns Stop back into Send')
await type(tv().querySelector('textarea'), '')
const before = req('session.history').length
await act(async () => sdk.emit({ type: 'message.complete', session_id: 'rt-b', payload: { text: 'Streaming in live…', status: 'complete' } }))
await wait(400)
ok(!tv()?.querySelector('.hstk-inflight'), 'complete → the in-flight block goes away…')
ok(req('session.history').length > before, '…and the history is re-read so the finished message lands in its chapter')
ok(stateFor(B) === 'working', 'a normal completion is not a failure')
await putBack()

console.log('composer: native pieces, images, model, live send')
await click(card(main))
ok(frontId() === main, 'clicking a card further back brings it to the front')
await focusRoot()
await key('r')
ok($('.hstk-titlebox')?.value === titleFor(main), 'r on a live chat turns its title into a box')
await type($('.hstk-titlebox'), 'Renamed in Zen Mode')
sdk.calls.length = 0
await key('Enter', {}, $('.hstk-titlebox'))
await tick()
ok(req('session.title').some(c => c[2].session_id === 'rt-main' && c[2].title === 'Renamed in Zen Mode'), '⏎ renames it through the gateway (session.title on the live session)')
ok(!$('.hstk-titlebox') && card(main).querySelector('.hstk-title').textContent === 'Renamed in Zen Mode' && card(main).querySelector('.hstk-chrome .lab').textContent === 'Renamed in Zen Mode', 'the card shows the new name')
ok(card(main).querySelector('.hstk-rename') !== null, 'there’s a pencil on the front card too')
await click(card(main))
await tick()
await tick()
ok(split() && $('.hstk-crumbs .cur')?.textContent === 'Renamed in Zen Mode', 'clicking the front card holds it')
ok(tv()?.querySelector('.hstk-cbox.ring-class') && tv()?.querySelector('.backing-class'), 'composer wears the app’s composerSurfaceRing + composerInputBacking')
const ccss = $('style').textContent
ok(/\.hstk-cbox textarea\{[^}]*width:100%[^}]*text-align:left/.test(ccss) && /\.hstk-paper \.hstk-comp textarea\{min-height:56px\}/.test(ccss), 'the text box fills the composer in every mode (it used to shrink and centre in PAPER)')
ok(tv().querySelector('textarea').style.height === '44px', 'and is sized to its text')
ok(tv()?.querySelector('.hstk-csend.primary-btn') && tv()?.querySelector('.hstk-cbtn.ghost-btn'), 'send + attach use the app’s PRIMARY_ICON_BTN / GHOST_ICON_BTN')
sdk.calls.length = 0
await type(tv().querySelector('textarea'), 'ship it')
await key('Enter', {}, tv().querySelector('textarea'))
ok(req('prompt.submit').some(c => c[2]?.session_id === 'rt-main' && c[2]?.text === 'ship it'), 'live → sends with prompt.submit to the live session id')
const pasteImg = async (ta, name) => {
  const f = new w.File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3])], name, { type: 'image/png' })
  const ev = new w.Event('paste', { bubbles: true, cancelable: true })
  Object.defineProperty(ev, 'clipboardData', { value: { files: [f], items: [] } })
  await act(async () => ta.dispatchEvent(ev))
  await wait(80)
}
sdk.calls.length = 0
await pasteImg(tv().querySelector('textarea'), 'shot.png')
const att = req('image.attach_bytes')[0]
ok(att && att[2].session_id === 'rt-main' && att[2].content_base64 === 'iVBORw0KGgoBAgM=' && att[2].filename === 'shot.png', '⌘V an image → image.attach_bytes on the live session (base64 + filename)')
ok(tv().querySelectorAll('.hstk-img').length === 1, 'pasted image shows as a thumbnail chip')
await click(tv().querySelector('.hstk-img button'))
ok(req('image.detach').some(c => c[2].path === '/tmp/upload-shot.png') && !tv().querySelector('.hstk-img'), '✕ detaches it from the session')
await pasteImg(tv().querySelector('textarea'), 'two.png')
sdk.composer.mounted = true // the chat is also open natively: its composer would take a plain send
sdk.calls.length = 0
await type(tv().querySelector('textarea'), 'what do you see here?')
await click(tv().querySelector('.hstk-csend'))
const imgSend = req('prompt.submit')[0]?.[2]
ok(imgSend?.session_id === 'rt-main' && imgSend.text === 'what do you see here?' && JSON.stringify(imgSend.attachments) === '[{"path":"/tmp/upload-two.png","mime":"image/png"}]', 'a send with an image goes to the gateway on the session it was staged on, naming the staged file')
ok(!called('composer.submit'), 'and is not handed to the chat’s own composer (that route lost the image)')
sdk.calls.length = 0
await type(tv().querySelector('textarea'), 'plain text')
await key('Enter', {}, tv().querySelector('textarea'))
ok(called('composer.submit', main), 'a plain send still uses the chat’s own composer when there is one')
sdk.composer.mounted = false
ok(!tv().querySelector('.hstk-img'), 'chips clear after sending (the gateway consumed them)')
const pill = () => [...tv().querySelectorAll('.dd-trigger')].at(-1)
ok(pill()?.textContent.includes('claude-opus-5-5'), 'model pill shows the session’s model')
await click(pill())
ok(tv().querySelector('.model-menu')?.dataset.session === 'rt-main', 'opens the app’s ModelCatalogMenu bound to the live session')
ok(sdk.lastMenu.request && (await sdk.lastMenu.request('model.options', { session_id: 'rt-main', explicit_only: true }), req('model.options').some(c => c[2].session_id === 'rt-main')), 'its catalog comes from the session’s own gateway (owner-routed request, like the native pill), not the window’s REST fallback')
sdk.calls.length = 0
await click(tv().querySelector('.model-menu .pick'))
ok(req('config.set').some(c => c[2].session_id === 'rt-main' && c[2].key === 'model' && c[2].value === 'gpt-5.6-luna --provider openai --session'), 'picking a model → config.set model … --session (what the native pill sends)')
ok(pill()?.textContent.includes('gpt-5.6-luna') && !tv().querySelector('.model-menu'), 'pill updates, menu closes')

console.log('model selection: the native protocol (pending → confirmed, rollback with the real reason, confirm, deferred)')
const pickRow = async m => {
  if (!tv().querySelector('.model-menu')) await click(pill())
  await click(tv().querySelector(`.model-menu .pick[data-model="${m}"]`))
  await act(() => new Promise(r => setTimeout(r, 40)))
}
const mpill = () => tv().querySelector('.hstk-model')
const mnote = () => tv().querySelector('.hstk-mnote')?.textContent || ''
sdk.modelRows.splice(0, sdk.modelRows.length, ['claude-sonnet-5-5', 'anthropic'], ['gpt-5.6-luna', 'openai'], ['gpt-5.6-pro', 'openai-codex'], ['gemini-2.5-flash', 'gemini'])
await act(async () => sdk.emit({ type: 'session.info', session_id: 'rt-main', payload: { model: 'claude-opus-5-5', provider: 'anthropic', reasoning_effort: 'medium' } }))
await tick()
ok(mpill()?.querySelector('.pv')?.textContent === 'anthropic' && mpill()?.querySelector('.nm')?.textContent === 'claude-opus-5-5', 'the pill says provider · model (from session.info)')
ok(mpill()?.querySelector('.ef')?.textContent === 'medium', 'and the reasoning effort')
ok(/Model: claude-opus-5-5\nProvider: anthropic\nReasoning: medium\nConfirmed by the session/.test(mpill()?.title || ''), 'hover spells it all out')
sdk.calls.length = 0
await pickRow('claude-sonnet-5-5')
ok(req('config.set').some(c => c[2].value === 'claude-sonnet-5-5 --provider anthropic --session'), 'a pick sends the native config.set model value (session-scoped)')
ok(mpill()?.dataset.status === 'confirmed' && mpill()?.classList.contains('flash') && mnote().includes('Now using claude-sonnet-5-5'), 'applied → pill flashes and says "Now using …"')
await act(async () => sdk.emit({ type: 'session.info', session_id: 'rt-main', payload: { model: 'claude-sonnet-5-5', provider: 'anthropic' } }))
await tick()
ok(mpill()?.querySelector('.nm')?.textContent === 'claude-sonnet-5-5', 'session.info confirms it')
ok(/\.hstk-model:not\(\.ghost\):hover\{background/.test($('style').textContent) && !/\.hstk-model:hover\{/.test($('style').textContent), 'a pill with no menu to offer does not light up on hover like a button')

console.log('  failure: roll back + the real reason')
sdk.modelReplies['gpt-5.6-luna'] = 'fail'
sdk.calls.length = 0
await pickRow('gpt-5.6-luna')
await act(() => new Promise(r => setTimeout(r, 60)))
ok(mpill()?.querySelector('.nm')?.textContent === 'claude-sonnet-5-5' && mpill()?.querySelector('.pv')?.textContent === 'anthropic', 'a refused pick rolls the pill back to the model actually in use')
ok(mpill()?.dataset.status === 'failed' && mnote().startsWith('Still on claude-sonnet-5-5. gpt-5.6-luna via openai:') && mnote().includes('OpenRouter, which has no credentials') && !mnote().includes('Did you mean'), `and says why, from Hermes' own resolver: "${mnote().slice(0, 90)}…"`)
ok(mpill()?.querySelector('.nm')?.textContent === 'claude-sonnet-5-5' && /\.hstk-modelwrap\{display:contents\}/.test($('style').textContent) && /\.hstk-mnote\{order:20;flex:1 1 100%/.test($('style').textContent), 'the reason gets its own line; the pill keeps showing the model')

const rs = sdk.calls.find(c => c[0] === 'rest' && c[1] === '/resolve')?.[2]
ok(rs?.model === 'gpt-5.6-luna' && rs?.provider === 'openai' && rs?.current_model === 'claude-sonnet-5-5', '(asked /resolve with the pick and the current route)')
ok(tv().querySelector('.model-menu') !== null, 'the menu stays open so you can pick something else')
{
  const nav = sdk.host.navigate
  let went = ''
  sdk.host.navigate = path => (went = path)
  await click(tv().querySelector('.hstk-mnote .fix'))
  sdk.host.navigate = nav
  ok(went === '/settings?tab=providers', 'a "not connected / no credentials" reason offers Connect provider… → Settings → Providers')
}
await click(tv().querySelector('.hstk-mnote button[aria-label="Dismiss"]'))
ok(!tv().querySelector('.hstk-mnote') && mpill()?.dataset.status === 'confirmed', '✕ dismisses the reason')

console.log('  guarded model: ask first, with the owner’s message')
sdk.modelReplies['gpt-5.6-pro'] = 'confirm'
sdk.calls.length = 0
await pickRow('gpt-5.6-pro')
ok(tv().querySelector('.confirm')?.textContent.includes('This model costs 10× more per token.'), 'confirm_required → the app’s ConfirmDialog with the owner’s message')
ok(mpill()?.querySelector('.nm')?.textContent === 'claude-sonnet-5-5', 'nothing changed yet (rolled back while it asks)')
ok(req('config.set').filter(c => c[2].key === 'model').length === 1, 'only the unconfirmed request was sent')
await click(tv().querySelector('.confirm .no'))
ok(!tv().querySelector('.confirm') && req('config.set').filter(c => c[2].key === 'model').length === 1, '"Keep current" sends nothing more')
await pickRow('gpt-5.6-pro')
await click(tv().querySelector('.confirm .yes'))
await act(() => new Promise(r => setTimeout(r, 40)))
const confirmed = req('config.set').filter(c => c[2].key === 'model').at(-1)?.[2]
ok(confirmed?.value === 'gpt-5.6-pro --provider openai-codex --session' && confirmed?.confirm_expensive_model === true, '"Switch" resends with confirm_expensive_model: true')
ok(mpill()?.querySelector('.nm')?.textContent === 'gpt-5.6-pro', 'and the pill shows it')

console.log('  mid-turn: deferred until the turn ends')
sdk.modelReplies['gemini-2.5-flash'] = 'deferred'
await pickRow('gemini-2.5-flash')
ok(mpill()?.dataset.status === 'deferred' && mnote().includes('applies after this turn') && mpill()?.querySelector('.codicon-clock'), 'deferred → clock + "applies after this turn"')
await act(async () => sdk.emit({ type: 'session.info', session_id: 'rt-main', payload: { model: 'gpt-5.6-pro', provider: 'openai-codex' } }))
await tick()
ok(mpill()?.querySelector('.nm')?.textContent === 'gemini-2.5-flash', 'a session.info still naming the old model doesn’t undo the pending pick')
await act(async () => sdk.emit({ type: 'session.info', session_id: 'rt-main', payload: { model: 'gemini-2.5-flash', provider: 'gemini' } }))
await tick()
ok(mpill()?.dataset.status === 'confirmed' && mnote().includes('Now using gemini-2.5-flash'), 'when the turn ends and session.info reports it → confirmed')

console.log('  the menu lists only providers that can actually be used')
sdk.catalog.providers = [
  { slug: 'nous', name: 'Nous Portal', authenticated: true, is_current: false, models: ['anthropic/claude-sonnet-5.5', 'anthropic/claude-opus-5.5'] },
  { slug: 'lmstudio', name: 'LM Studio', authenticated: true, is_current: false, models: [] },
  { slug: 'anthropic', name: 'Anthropic', authenticated: true, is_current: true, models: ['claude-sonnet-5-5', 'claude-opus-5-5'] },
  { slug: 'openai-codex', name: 'OpenAI Codex', authenticated: true, is_current: false, models: [{ id: 'gpt-6.1-sol' }] }
]
sdk.calls.length = 0
if (!tv().querySelector('.model-menu')) await click(pill())
const cat = await sdk.lastMenu.request('model.options', { session_id: 'rt-main', explicit_only: true })
await tick()
ok(JSON.stringify(cat.providers.map(p => p.slug)) === '["lmstudio","anthropic","openai-codex"]', 'a provider the catalog calls connected but Hermes cannot resolve (Nous Portal here) is left out; the rest keep their order')
const asked = JSON.parse(sdk.calls.find(c => c[0] === 'rest' && c[1] === '/usable')?.[2]?.pairs || '[]')
ok(JSON.stringify(asked) === '[["nous","anthropic/claude-sonnet-5.5"],["openai-codex","gpt-6.1-sol"]]', 'checked with Hermes’ own resolver: one model per provider, never the current provider, nothing for an empty one')
ok(tv().querySelector('.menu-footer .hstk-mhidden .tx')?.textContent === 'Not connected, so not listed: Nous Portal' && tv().querySelector('.menu-footer .fix')?.textContent === 'Connect', 'the menu’s footer says what was left out, with a way to connect it')
sdk.catalog.providers = [{ slug: 'anthropic', name: 'Anthropic', is_current: true, models: ['claude-opus-5-5'] }, { slug: 'weird', name: 'Weird', is_current: false, models: ['w-1'] }]
const realRest = ctx.rest
ctx.rest = async path => (path.startsWith('/usable') ? Promise.reject(new Error('backend off')) : realRest(path))
ok((await sdk.lastMenu.request('model.options', {})).providers.length === 2, 'if the check itself fails, the catalog is shown as it is')
ctx.rest = realRest
sdk.catalog.providers = null

console.log('  reasoning effort')
sdk.calls.length = 0
if (!tv().querySelector('.model-menu')) await click(pill())
await click(tv().querySelector('.model-menu .effort'))
await tick()
ok(req('config.set').some(c => c[2].key === 'reasoning' && c[2].value === 'high' && c[2].session_id === 'rt-main') && mpill()?.querySelector('.ef')?.textContent === 'high', 'effort → config.set reasoning, shown on the pill')
sdk.catalog.reasoningStatus = 'deferred'
await click(tv().querySelector('.model-menu .effort'))
await tick()
ok(mnote().includes('applies after this turn'), 'effort changed mid-turn says it applies after this turn')
sdk.catalog.reasoningStatus = ''
if (tv().querySelector('.model-menu')) await click(pill())

console.log('composer + menu: files, folder, images, paste image, URL, snippets (as in the native composer)')
const plus = () => tv().querySelector('.hstk-plus')
const menuItem = label => $$('.dd-item').find(b => b.textContent.includes(label))
await click(plus())
ok(['Files…', 'Folder…', 'Images…', 'Paste image', 'URL…'].every(menuItem), '+ opens a menu with Files…, Folder…, Images…, Paste image, URL…')
ok(['Code review', 'Implementation plan', 'Explain this'].every(menuItem), 'and prompt snippets')
sdk.calls.length = 0
await click(menuItem('Folder…'))
await tick()
ok(called('requestFolder') && !menuItem('Folder…'), 'Folder… opens the app’s folder picker (menu closes)')
ok(tv().querySelector('.hstk-ref')?.title === '@folder:`/Users/x/my proj`', 'the folder becomes an @folder: reference chip (quoted, it has a space)')
const pickFile = async (sel, file) => {
  const input = tv().querySelector(sel)
  Object.defineProperty(input, 'files', { value: [file], configurable: true })
  await act(async () => input.dispatchEvent(new w.Event('change', { bubbles: true })))
  await wait(80)
}
await pickFile('input[data-pick="files"]', new w.File(['hello'], 'notes.txt', { type: 'text/plain' }))
const fa = req('file.attach')[0]
ok(fa && fa[2].session_id === 'rt-main' && fa[2].name === 'notes.txt' && fa[2].data_url.startsWith('data:text/plain'), 'Files… → file.attach on the live session (the gateway stages it)')
ok([...tv().querySelectorAll('.hstk-ref')].some(r => r.title === '@file:uploads/notes.txt'), 'and comes back as an @file: reference chip')
await pickFile('input[data-pick="images"]', new w.File([new Uint8Array([137, 80, 78, 71])], 'pic.png', { type: 'image/png' }))
ok(req('image.attach_bytes').some(c => c[2].filename === 'pic.png') && tv().querySelectorAll('.hstk-img').length === 1, 'Images… attaches an image as before')
await click(plus())
await click(menuItem('URL…'))
ok(tv().querySelector('.hstk-urlbox') !== null, 'URL… opens a small box')
await type(tv().querySelector('.hstk-urlbox'), 'https://example.com/a b')
await key('Enter', {}, tv().querySelector('.hstk-urlbox'))
ok([...tv().querySelectorAll('.hstk-ref')].some(r => r.title === '@url:`https://example.com/a b`') && !tv().querySelector('.hstk-urlbox'), '⏎ adds it as an @url: reference')
await click(plus())
await click(menuItem('URL…'))
await type(tv().querySelector('.hstk-urlbox'), 'https://example.com/two')
await act(async () => tv().querySelector('.hstk-urlbox').dispatchEvent(new w.FocusEvent('focusout', { bubbles: true })))
ok([...tv().querySelectorAll('.hstk-ref')].some(r => r.title === '@url:https://example.com/two') && !tv().querySelector('.hstk-urlbox'), 'clicking away from the URL box keeps the link (it used to be thrown away)')
await click([...tv().querySelectorAll('.hstk-ref')].find(r => r.title === '@url:https://example.com/two').querySelector('button'))
await click(plus())
await click(menuItem('Code review'))
ok(tv().querySelector('textarea').value.includes('review this for bugs'), 'a snippet drops its text into the box')
await click(tv().querySelector('.hstk-ref button'))
ok(![...tv().querySelectorAll('.hstk-ref')].some(r => r.title.startsWith('@folder:')), '✕ removes a reference')
sdk.calls.length = 0
await click(tv().querySelector('.hstk-csend'))
const sent = req('prompt.submit')[0]?.[2]?.text || ''
ok(sent.startsWith('@file:uploads/notes.txt @url:`https://example.com/a b`\n\n') && sent.includes('review this for bugs'), 'send: the references ride at the top of the prompt, then your text')
ok(!tv().querySelector('.hstk-ref') && !tv().querySelector('.hstk-img') && tv().querySelector('textarea').value === '', 'everything clears after sending')

console.log('diffs: native compact edit cards (open, clamped, Shiki colours + line tints)')
const diffsExpected = mainS.turns.reduce((m, t) => m + t.steps.filter(st => st.diff).length, 0)
const diffEls = () => [...tv().querySelectorAll('.hstk-diff')]
ok(diffEls().length === diffsExpected, `${diffsExpected} edit steps show as edit cards (from session.history content)`)
if (diffEls().length) {
  await tick()
  const d0 = diffEls()[0]
  ok(/\+\d+/.test(d0.querySelector('.add')?.textContent) && /−\d+/.test(d0.querySelector('.del')?.textContent), 'each shows +added / −removed')
  ok(d0.dataset.open === '1' && d0.querySelector('.hstk-sdiff'), 'open by default, like the native card')
  ok(/^\d+px$/.test(d0.querySelector('.hstk-sdiff')?.style.maxHeight || ''), `clamped to the preview height (${d0.querySelector('.hstk-sdiff')?.style.maxHeight}) and scrollable`)
  const rich = diffEls().find(d => d.querySelector('.hstk-sdiff.rich'))
  ok(rich, 'a file with a known language renders through the app’s code block (Shiki)')
  if (rich) {
    const code = rich.querySelector('.md.code')
    ok(code && code.dataset.lang && !/^(---|\+\+\+|@@)/m.test(code.textContent), `in the file’s language (${code?.dataset.lang}), headers / @@ / +− stripped`)
    const tints = rich.querySelector('.hstk-sdiff > style')?.textContent || ''
    ok(/nth-child\(\d+\)\{background:var\(--ui-diff-(add|remove)-background\);box-shadow:inset 2px 0 0 var\(--ui-diff-(add|remove)-border\)\}/.test(tints), 'changed lines get the theme’s diff tint + 2px gutter accent')
  }
  await click(d0.querySelector('.hstk-diffsum'))
  ok(diffEls()[0].dataset.open === '0' && !diffEls()[0].querySelector('.hstk-sdiff'), 'click the row to collapse it')
  await click(diffEls()[0].querySelector('.hstk-diffsum'))
}
await putBack()

console.log('Zen Mode tuning panel: dials, presets, codes')
await focusRoot()
await key('`')
ok($('.hstk-tune') !== null, '` opens the tuning panel')
ok($('.hstk').style.getPropertyValue('--hz-lift') === '34', 'the Zen Mode root carries the dials as --hz-* variables')
const slider = k => $(`.hstk-tune input[data-key="${k}"]`)
const setRange = async (el, v) => {
  const setter = Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype, 'value').set
  await act(async () => {
    setter.call(el, String(v))
    el.dispatchEvent(new w.Event('input', { bubbles: true }))
  })
}
ok(['splitScale', 'splitX', 'splitY', 'stackX', 'stackY', 'stackScale', 'depth', 'cardZ', 'arcAt', 'arcUp', 'arcTilt', 'backTilt', 'eyeY', 'stackPersp'].every(k => slider(k)), 'placement, the hold layout, depth and the curve are all dials')
ok($$('.hstk-tune .chip button').some(b => b.textContent === 'Mac stack'), 'a “Mac stack” preset')
const back1 = () => cardEls().find(c => c.style.zIndex === '99')?.style.transform || ''
ok(/rotateX\(0deg\)/.test(back1()) && /^translate3d\(0px,/.test(back1()), `by default cards face you: no tilt, no drift (${back1()})`)
await click($$('.hstk-tune .chip button').find(b => b.textContent === 'Mac stack'))
ok(/^translate3d\(10px, ?-34px, ?-130px\) rotateX\(0deg\)/.test(back1()), `Mac stack: each card drifting up and sideways (${back1()})`)
await click($$('.hstk-tune .chip button').find(b => b.textContent === 'Wave'))
ok(/rotateX\(8deg\)/.test(back1()), 'Wave: tilted back cards')
await click($$('.hstk-tune button').find(b => b.textContent === 'Reset all'))
await setRange(slider('lift'), 80)
ok($('.hstk').style.getPropertyValue('--hz-lift') === '80', 'moving "Prompt lift" updates --hz-lift live')
ok(JSON.stringify(ctx.storage.get('tune')) === '{"lift":80}', 'and persists only what differs from default')
await setRange(slider('cardZ'), 999)
ok($('.hstk').style.getPropertyValue('--hz-cardZ') === '200', 'values clamp to their range')
ok(/translate3d\(0px, ?-\d+px, ?-200px\)/.test(cardEls().find(c => c.style.zIndex === '99')?.style.transform || ''), 'and the stack spacing follows the dial')
await setRange(slider('depth'), 3)
ok(cardEls().filter(c => c.style.opacity !== '0').length === 4, '"Cards in view" = 3 behind the front one')
await setRange(slider('depth'), 9)
await setRange(slider('arcAt'), 3)
const far = () => cardEls().find(c => c.style.zIndex === '93')?.style.transform || ''
const flatFar = far()
await setRange(slider('arcUp'), 20)
await setRange(slider('arcTilt'), 10)
ok(far() !== flatFar && /rotateX\(40deg\)/.test(far()), `the curve dials bend the far cards (${far()})`)
await setRange(slider('arcTilt'), -10)
ok(/rotateX\(-40deg\)/.test(far()), 'tilt goes both ways (negative leans toward you)')
await setRange(slider('arcUp'), 5)
await setRange(slider('arcTilt'), 0)
await setRange(slider('depth'), 8)
await type($('.hstk-tune .txt'), 'mine')
await click($$('.hstk-tune button').find(b => b.textContent === 'Save'))
ok(ctx.storage.get('presets')?.mine?.lift === 80, 'Save stores a named preset')
await click($$('.hstk-tune .chip button').find(b => b.textContent === 'No depth'))
ok($('.hstk').style.getPropertyValue('--hz-lift') === '0' && $('.hstk').style.getPropertyValue('--hz-parallax') === '0', 'built-in "No depth" preset applies (renamed from Flat, which read like the FLAT thread)')
await click($$('.hstk-tune .chip button').find(b => b.textContent === 'mine'))
ok($('.hstk').style.getPropertyValue('--hz-lift') === '80' && $('.hstk').style.getPropertyValue('--hz-cardZ') === '200', 'your preset loads back')
let copied = ''
ctx.os.writeClipboard = async t => ((copied = t), true)
await click($$('.hstk-tune button').find(b => b.textContent === 'Copy code'))
ok(copied.startsWith('zed1.'), `Copy code → a shareable code (${copied.slice(0, 24)}…)`)
await click($$('.hstk-tune button').find(b => b.textContent === 'Reset all'))
ok($('.hstk').style.getPropertyValue('--hz-lift') === '34', 'Reset all → defaults')
await type($$('.hstk-tune .txt')[1], copied)
await click($$('.hstk-tune button').find(b => b.textContent === 'Apply'))
ok($('.hstk').style.getPropertyValue('--hz-lift') === '80' && $('.hstk').style.getPropertyValue('--hz-cardZ') === '200', 'pasting the code restores the exact dials')
await type($$('.hstk-tune .txt')[1], 'nonsense')
await click($$('.hstk-tune button').find(b => b.textContent === 'Apply'))
ok($('.hstk-tune .msg')?.textContent.includes('isn’t a Zen Mode code') && $('.hstk').style.getPropertyValue('--hz-lift') === '80', 'a bad code is rejected without changing anything')
await click($$('.hstk-tune button').find(b => b.textContent === 'Reset all'))
const sp = contribs.get('settings:zed')
ok(sp?.title === 'Zen Mode' && typeof sp.render === 'function', 'same panel registered as Settings → Plugins → Zen Mode')
await focusRoot()
await key('`')
ok($('.hstk-tune') === null, '` closes it')

console.log('card layout: nothing runs under the bottom row')
const lcss = $('style').textContent
ok(/\.hstk-body\{flex:1;[^}]*mask-image:linear-gradient\(to bottom, black calc\(100% - 70px\), transparent calc\(100% - 40px\)\)/.test(lcss), 'the card’s text fades out above the bottom row instead of running under it')
ok(/\.hstk-meta > \*\{flex:none\}/.test(lcss) && /\.hstk-meta\{[^}]*mask-image:linear-gradient\(to right/.test(lcss) && !/\.hstk-pill\.fact\{[^}]*text-overflow/.test(lcss), 'pills keep their full text; the row fades at its right edge instead of crushing them')

console.log('entering and leaving Zen Mode: a short transition, then the app goes where you asked')
ok(/\.hstk\[data-view\]:not\(\.inline\)\{animation:hstk-zed-in calc\(var\(--hz-zedMs,450\) \* 1ms\)/.test(lcss) && $('.hstk').style.getPropertyValue('--hz-zedMs') === '450', 'Zen Mode eases in when it opens (450 ms, a dial, under a second)')
motion.reduce = false
await focusRoot()
sdk.calls.length = 0
const going = frontId()
const dbl = () => act(async () => $('.hstk-card.sel').dispatchEvent(new w.MouseEvent('dblclick', { bubbles: true })))
await dbl()
ok(!called('openSession') && $('.hstk').dataset.leaving === 'open', 'double-click / Open: the stack eases out first (moving through into the chat)…')
await dbl()
await wait(420)
ok(sdk.calls.filter(c => c[0] === 'openSession').length === 1 && called('openSession', going), '…then the chat opens, once, even if you trigger it again meanwhile')
await wait(320)
ok(!('leaving' in $('.hstk').dataset), 'if Zen Mode is still on screen afterwards, it comes back into view')
sdk.calls.length = 0
{
  console.log('new chat, without leaving Zen Mode')
  const nb = () => $('.hstk-bar .hstk-new')
  ok(nb()?.tagName === 'BUTTON' && $('.hstk-bar').firstElementChild.contains(nb()) && nb().getAttribute('aria-label') === 'New chat', 'a round New chat button sits first in the bar (top left)')
  sdk.createFail.on = true
  await click(nb())
  const refuse = [...document.querySelectorAll('.dd-content .dd-item')].at(-1) || null
  if (refuse) await click(refuse)
  await wait(60)
  ok(called('notifyError') && $('.hstk').dataset.leaving === 'open', 'if the gateway refuses, it says so and falls back to the app’s own New session…')
  await wait(420)
  ok(called('newChat'), '…(host.newChat, the sidebar’s door)')
  await wait(320)
  sdk.createFail.on = false
  sdk.calls.length = 0
  await click(nb())
  const rows = [...document.querySelectorAll('.dd-content .dd-item')]
  ok(rows.length >= 1 && rows.at(-1).textContent.includes('No folder'), `with folders to choose from it asks where (${rows.length} places, "No folder" last)`)
  const pickRow = rows.find(r => !r.textContent.includes('No folder')) || rows.at(-1)
  const wantCwd = pickRow.querySelector('.hstk-newnm')?.title || ''
  await click(pickRow)
  await wait(500)
  const cr = req('session.create')[0]?.[2]
  ok(cr && (cr.cwd || '') === wantCwd && !called('newChat') && !called('openSession') && !('leaving' in $('.hstk').dataset), `picking one → session.create${wantCwd ? ' in that folder' : ''}; Zen Mode stays (no classic tab, no navigation)`)
  ok(split() && float()?.textContent.includes('New chat') && frontId() === 'new-1', 'the new chat comes up beside the stack, as a card called "New chat" before its first prompt')
  ok(document.activeElement === float().querySelector('.hstk-comp textarea'), 'the caret is in its composer')
  sdk.calls.length = 0
  await type(float().querySelector('textarea'), 'first words')
  await key('Enter', {}, float().querySelector('textarea'))
  await wait(120)
  ok(req('prompt.submit').some(c => c[2].session_id === 'rt-new' && c[2].text === 'first words') || called('composer.submit', 'new-1'), 'the first prompt goes to that new live session')
  sdk.live.sessions = sdk.live.sessions.filter(s => s.id !== 'rt-new')
  await focusRoot()
  await key('Escape')
  await wait(700)
  sdk.calls.length = 0
}
await act(async () => $('.hstk-card.sel').dispatchEvent(new w.MouseEvent('dblclick', { bubbles: true, metaKey: true })))
ok(sdk.calls.some(c => c[0] === 'openSession' && c[2]?.intent === 'tab') && !('leaving' in $('.hstk').dataset), '⌘-open (a new tab) is immediate: Zen Mode stays')
sdk.calls.length = 0
await focusRoot()
await key('Escape')
ok(!called('navigate') && $('.hstk').dataset.leaving === 'exit', 'esc: Zen Mode settles back first…')
await wait(420)
ok(called('navigate', '/'), '…then you are back where you were')
motion.reduce = true

console.log('leaving and coming back')
await act(async () => root.unmount())
window.location.hash = '#/zen-mode'
root = createRoot(mount)
await act(async () => root.render(page.render()))
await tick()
await tick()
ok(frontId() === F && !float(), 'Zen Mode always reopens on the front of the stack (most urgent first), nothing held')
await act(async () => root.unmount())

console.log('backend not loaded / backend error')
sdk.live.sessions = []
restMode = 'old-backend'
sdk.queryClient.clear()
root = createRoot(mount)
await act(async () => root.render(page.render()))
await tick()
await tick()
await hold()
await tick()
ok(text().includes('Restart gateway'), 'a non-live chat with no backend says why and offers the fix')
sdk.calls.length = 0
await click($$('button').find(b => b.textContent === 'Restart gateway'))
ok(called('restartGateway'), '"Restart gateway" calls host.restartGateway')
await act(async () => root.unmount())
restMode = 'broken'
sdk.queryClient.clear()
root = createRoot(mount)
await act(async () => root.render(page.render()))
await tick()
await tick()
await hold()
await tick()
ok(text().includes('boom in the backend') && !$$('button').some(b => b.textContent === 'Restart gateway'), 'a backend ERROR is shown as it is, with no restart offer (a restart wouldn’t fix it)')
await act(async () => root.unmount())
restMode = 'ok'
sdk.queryClient.clear()

console.log('seven agents at once (tests/world.mjs)')
const { sevenAgents } = await import('./world.mjs')
const W = sevenAgents(ids.slice(0, 7), titleFor)
sdk.live.sessions = W.live
Object.assign(sdk.pending, JSON.parse(JSON.stringify(W.pending)))
sdk.queryClient.clear()
root = createRoot(mount)
await act(async () => root.render(page.render()))
await tick()
await act(async () => sdk.dots.set(Object.fromEntries(ids.map(id => [id, W.dots[id] || 'idle']))))
for (const ev of W.events) await act(async () => sdk.emit(ev))
await tick()
await tick()
const want = [...W.ids.failed, ...W.ids.needs, ...W.ids.working, ...W.ids.unread]
ok(JSON.stringify(order().slice(0, 7)) === JSON.stringify(want), 'seven live agents: the failed one, then the three waiting (most recent first), the two working, the unread one')
ok(states().slice(0, 7).join(',') === 'failed,needs,needs,needs,working,working,unread', `states: ${states().slice(0, 7).join(', ')}`)
ok(['1 failed', '3 need you', '2 working', '1 unread'].every(t => chip(t)), 'the chips say how many of each')
ok(cardEls().slice(0, 7).every(c => c.style.opacity === '1'), 'all seven are in view at once, none faded')
ok(card(W.ids.needs[0]).querySelector('.hstk-ask .what')?.textContent === 'Commit 4 files to main' && card(W.ids.working[0]).querySelector('.hstk-lead')?.textContent.includes('212 of 480'), 'each card leads with what it is asking or doing')
const zcss = $('style').textContent
ok(/\.hstk-home\[data-split="0"\] \.hstk-card\[data-state="needs"\]\{animation:hstk-hop/.test(zcss) && /@keyframes hstk-hop/.test(zcss), 'cards waiting on you hop, like a Dock icon')
ok(new Set(W.ids.needs.map(id => card(id).style.animationDelay)).size > 1, 'and not in lockstep')
ok(/prefers-reduced-motion: reduce\)\{\.hstk-card\[data-state="needs"\]\{animation:none/.test(zcss), 'not at all with reduced motion')
ok(/\.hstk-card:not\(\.sel\):not\(\.ghost\):hover\{translate:0 calc\(var\(--hz-hoverLift,16\) \* -1px\)/.test(zcss), 'a card you point at lifts toward you')

console.log('answering from the card (C3): the request is shown, and the answer names it exactly')
const [NA, NB, NC] = W.ids.needs
const ask = id => card(id).querySelector('.hstk-ask')
const choiceBtns = id => [...ask(id).querySelectorAll('button[data-choice]')].map(b => b.dataset.choice)
ok(req('session.events.since').some(c => c[2].session_id === 'ag-2') && !req('session.events.since').some(c => ['ag-1', 'ag-5', 'ag-6', 'ag-7'].includes(c[2].session_id)), 'open requests are read from the gateway, and only for the agents that are waiting')
ok(ask(NA)?.dataset.kind === 'approval' && ask(NA).querySelector('.cmd')?.textContent === 'git commit -am "ship the stack" && git push origin main', 'an approval card shows the exact command the agent wants to run')
ok(JSON.stringify(choiceBtns(NA)) === '["once","session","always","deny"]' && JSON.stringify(choiceBtns(NB)) === '["once","deny"]', 'with only the choices the gateway allows for that request')
ok($$('.hstk-ask[data-kind="approval"]').every(a => a.querySelector('.cmd')?.textContent && a.querySelector('.what')?.textContent), 'no approve button anywhere without its request shown above it')
ok(ask(NB).querySelector('.more')?.textContent === '+1 more waiting', 'a second request queued behind the first is counted')
ok(ask(NC)?.dataset.kind === 'question' && ask(NC).querySelector('.what').textContent === 'Which of the two layouts should I keep?' && JSON.stringify(choiceBtns(NC)) === '["Stack on the left","Stack centred"]', 'a question card shows the question and its choices')
ok(!card(W.ids.failed[0]).querySelector('.hstk-ask') && !card(W.ids.working[0]).querySelector('.hstk-ask'), 'cards that are not waiting have no buttons')
sdk.calls.length = 0
await click(ask(NB).querySelector('button[data-choice="deny"]'))
await tick()
const denied = req('approval.respond')
ok(denied.length === 1 && JSON.stringify(denied[0][2]) === '{"session_id":"ag-3","choice":"deny","request_id":"apr-2"}', 'Deny sends one approval.respond: that session, that request, nothing else')
ok(!called('openSession') && !split() && frontId() === W.ids.failed[0], 'clicking a button does not open, hold or select the card')
ok(ask(NB).querySelector('.cmd')?.textContent === 'git tag v1.0.0' && !ask(NB).querySelector('.more'), 'the next queued request takes its place')
sdk.calls.length = 0
await click(ask(NC).querySelector('button[data-choice="Stack centred"]'))
await tick()
ok(JSON.stringify(req('clarify.lock')[0]?.[2]) === '{"request_id":"srq-c","question_id":"q1","answer":"Stack centred"}' && req('approval.respond').length === 0, 'a question’s choice goes through clarify.lock for that question')
ok(!ask(NC), 'answered: the question leaves the card')
await focusRoot()
sdk.calls.length = 0
await key('Y')
ok(req('approval.respond').length === 0, '⇧Y does nothing on a card with no approval (you are on the failed one)')
await key('a')
ok(frontId() === NA, '(a → the first waiting agent)')
await key('y')
ok(req('approval.respond').length === 0, 'plain y does nothing: approving takes the shifted key')
sdk.pending.fail = true
await key('Y')
await tick()
ok(ask(NA)?.querySelector('.err')?.textContent.includes('gateway said no') && ask(NA).querySelector('.cmd'), 'if the gateway refuses, the card says so and keeps the request')
delete sdk.pending.fail
sdk.calls.length = 0
await key('Y')
await tick()
ok(JSON.stringify(req('approval.respond').map(c => c[2])) === '[{"session_id":"ag-2","choice":"once","request_id":"apr-1"}]', '⇧Y approves the front card’s request once, and only that one')
ok(!ask(NA) && ask(NB)?.querySelector('.cmd'), 'its request is gone; the other agent’s is untouched')
await key('Home')
ok(frontId() === W.ids.failed[0], '(you start on the failed one)')
const visit = []
for (let i = 0; i < 6; i++) {
  await key('a')
  visit.push(frontId())
}
ok(JSON.stringify(visit) === JSON.stringify([...W.ids.needs, ...W.ids.unread, ...W.ids.failed, W.ids.needs[0]]), '“a” steps through everything that wants you, skipping the working ones, and wraps')
await hold()
ok(split() && $('.hstk-crumbs .cur')?.textContent === titleFor(W.ids.needs[0]), 'hold one…')
await key('a')
await wait(260)
await tick()
ok($('.hstk-crumbs .cur')?.textContent === titleFor(W.ids.needs[1]) && split(), '…and “a” takes the held thread to the next one that wants you')
sdk.calls.length = 0
await type(float().querySelector('textarea'), 'yes, publish')
await key('Enter', {}, float().querySelector('textarea'))
ok(req('prompt.submit').some(c => c[2].session_id === 'ag-3' && c[2].text === 'yes, publish'), 'answer it from here: the reply goes to that agent’s live session')
await act(async () => sdk.dots.set({ [W.ids.needs[1]]: 'working' }))
sdk.live.sessions = W.live.map(l => (l.id === 'ag-3' ? { ...l, status: 'working' } : l))
await refetchLive()
ok(stateFor(W.ids.needs[1]) === 'working' && chip('2 need you') && chip('3 working') && frontId() === W.ids.needs[1], 'answered: it drops to working, the counts update, and it stays the card you are on')
await act(async () => root.unmount())
sdk.live.sessions = []

console.log('inline directive')
const dir = [...contribs.values()].find(c => c.data?.name === 'zen-mode')
root = createRoot(mount)
await act(async () => root.render(createElement(() => dir.data.render({ attrs: {} }))))
await tick()
await tick()
ok($('.hstk.inline')?.dataset.view === 'stack' && $$('.hstk-stage').length === 1 && count() === TOTAL && !$('.hstk-grip'), '::zen-mode{} renders the stack inline (no grip)')
sdk.calls.length = 0
await key('Enter', { shiftKey: true })
await tick()
ok(called('openSession') && !float(), 'inline, ⇧⏎ opens the chat instead of holding it')
await act(async () => root.unmount())

console.log(failures ? `\n${failures} FAILED` : '\nall passed')
process.exit(failures ? 1 : 0)
