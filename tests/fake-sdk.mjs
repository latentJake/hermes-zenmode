// Fake @hermes/plugin-sdk for tests/harness.mjs. Records calls; uses real React Query.
import { QueryClient, useQuery as rqUseQuery } from '@tanstack/react-query'
import { createContext, createElement, useContext, useSyncExternalStore } from 'react'

export const calls = []
export const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, refetchInterval: false } } })
export const useQuery = opts => rqUseQuery({ ...opts, retry: false, refetchInterval: false }, queryClient)

// nanostores-like atom
export function atom(v) {
  const subs = new Set()
  return {
    get: () => v,
    set: n => ((v = n), subs.forEach(f => f(v))),
    subscribe: f => (subs.add(f), f(v), () => subs.delete(f)),
    listen: f => (subs.add(f), () => subs.delete(f))
  }
}
export const useValue = a => useSyncExternalStore(cb => a.listen(cb), a.get)

export const branchFail = { on: false }
export const createFail = { on: false }
export const modelReplies = {} // model → 'fail' | 'confirm' | 'deferred' (default: applied)
export const live = { sessions: [] } // what session.active_list returns
export const history = {} // live id → session.history messages
export const pending = {} // live id → open server requests (approval / clarify)
export const composer = { mounted: false }
const eventSubs = new Map()
export const emit = ev => [...(eventSubs.get(ev.type) || []), ...(eventSubs.get('*') || [])].forEach(f => f(ev))

export const host = {
  state: { focusedStoredSessionId: atom(null) },
  onEvent: (type, fn) => {
    const set = eventSubs.get(type) || new Set()
    set.add(fn)
    eventSubs.set(type, set)
    return () => set.delete(fn)
  },
  restartGateway: async () => calls.push(['restartGateway']),
  notify: m => calls.push(['notify', m]),
  notifyError: (e, m) => calls.push(['notifyError', m]),
  navigate: path => {
    calls.push(['navigate', path])
    window.location.hash = '#' + path
    window.dispatchEvent(new window.HashChangeEvent('hashchange'))
  },
  openSession: (id, opts) => calls.push(['openSession', id, opts]),
  newChat: (profile, opts) => calls.push(['newChat', profile, opts]),
  composer: {
    submit: (id, text) => (calls.push(['composer.submit', id, text]), composer.mounted),
    setDraft: async (id, text) => (calls.push(['composer.setDraft', id, text]), true)
  },
  request: async (method, params) => {
    calls.push(['request', method, params])
    if (method === 'session.list') return { sessions: globalThis.__ALL_SESSIONS__ || [] }
    if (method === 'session.active_list') return { sessions: live.sessions }
    if (method === 'session.create') {
      if (createFail.on) throw new Error('create refused')
      live.sessions = [...live.sessions, { id: 'rt-new', session_key: 'new-1', status: 'idle', title: '', message_count: 0, last_active: Date.now() / 1000 }]
      history['rt-new'] = []
      return { session_id: 'rt-new', stored_session_id: 'new-1' }
    }
    if (/^session\.branch/.test(method)) {
      if (branchFail.on) throw new Error('branch refused')
      return { stored_session_id: 'branch-1', branched_session_id: 'branch-1', session_id: 'branch-1' }
    }
    if (method === 'session.history') {
      if (!history[params?.session_id]) throw new Error('session not found')
      return { messages: history[params.session_id], count: history[params.session_id].length }
    }
    if (method === 'prompt.submit') return { ok: true }
    if (method === 'image.attach_bytes') return { attached: true, path: '/tmp/upload-' + (params.filename || 'x.png'), count: 1 }
    if (method === 'image.detach') return { detached: true, count: 0 }
    if (method === 'file.attach') return { attached: true, name: params.name, ref_path: 'uploads/' + params.name, ref_text: '@file:uploads/' + params.name, uploaded: true }
    if (method === 'model.options' && catalog.providers) return { providers: catalog.providers, model: 'claude-opus-5-5', provider: 'anthropic' }
    if (method === 'config.set' && params?.key === 'reasoning' && catalog.reasoningStatus) return { status: catalog.reasoningStatus, value: params.value }
    if (method === 'config.set') {
      const m = String(params?.value || '').split(' ')[0]
      const how = params?.key === 'model' ? modelReplies[m] : null
      if (how === 'fail') {
        const e = new Error('JsonRpcGatewayError: model_resolution_failed')
        e.data = { reason: 'model_resolution_failed' }
        throw e
      }
      if (how === 'confirm' && !params.confirm_expensive_model) return { confirm_required: true, confirm_message: 'This model costs 10× more per token.' }
      if (how === 'deferred') return { deferred: true }
      return { ok: true }
    }
    // open server requests per live session, as `session.events.since` reports them
    if (method === 'session.events.since') return { events: [], open_requests: pending[params?.session_id] || [] }
    if (method === 'approval.respond') {
      if (pending.fail) throw new Error('gateway said no')
      const list = pending[params.session_id] || []
      pending[params.session_id] = list.filter(r => !(r.method === 'approval' && r.params.request_id === params.request_id))
      return { resolved: 1 }
    }
    if (method === 'clarify.lock') {
      const req = (pending[params.session_id_hint] || Object.values(pending).flat().filter(Boolean)).find?.(r => r.id === params.request_id)
      for (const k of Object.keys(pending)) if (Array.isArray(pending[k])) pending[k] = pending[k].filter(r => r.id !== params.request_id)
      return { status: req ? 'ok' : 'expired', remaining: [] }
    }
    if (method === 'session.title') return { title: params.title, pending: false }
    if (method === 'session.interrupt') return { ok: true }
    return {}
  }
}
export const haptic = () => {}
export const relativeTime = ms => `${Math.round((Date.now() - ms) / 60000)}m ago`
export const Codicon = ({ name }) => createElement('i', { className: 'codicon codicon-' + name })
// The app's status dot. Painted with the real class names from app/chat/session-status-dot.tsx,
// because the plugin reads the dot back to learn each session's state. `dots.set({ id: state })`.
const DOT_CLASSES = {
  'needs-input': 'size-1.5 rounded-full bg-amber-500',
  working: 'size-1.5 rounded-full bg-(--ui-accent)',
  stalled: 'size-1.5 rounded-full border border-(--ui-accent)',
  background: 'size-1.5 rounded-full border border-(--ui-text-tertiary)',
  unread: 'size-1.5 rounded-full bg-(--ui-success)',
  idle: 'size-1 rounded-full bg-(--ui-text-quaternary)'
}
const dotAtom = atom({})
export const dots = { set: patch => dotAtom.set({ ...dotAtom.get(), ...patch }) }
export const SessionStatusDot = ({ storedSessionId }) => {
  const state = useValue(dotAtom)[storedSessionId] || 'idle'
  return createElement('span', { className: 'flex items-center gap-0.5' }, createElement('span', { className: DOT_CLASSES[state], 'data-dot': state }))
}
export const ackStoredSessionId = id => {
  calls.push(['ack', id])
  if (dotAtom.get()[id] === 'unread') dots.set({ [id]: 'idle' })
}
export const renders = { markdown: 0, mediaOff: 0 }
// Fenced code renders like the app's Shiki block: <pre class="shiki"><code><span class="line">…
// `::preview{file="…"}` renders with the native inline-preview card's own box rules
// (inline-preview-directive.tsx): a column-wide wrapper capped at 40rem, and a frame that takes
// its content's width (here 640px) but never more than the wrapper.
const PREVIEW = /^::preview\{[^}]*\}$/m
export const MessageTextContent = ({ text, media = true }) => {
  renders.markdown++
  if (media === false) renders.mediaOff++
  if (PREVIEW.test(text || '')) {
    const [before, after] = text.split(PREVIEW)
    return createElement(
      'div',
      { className: 'md' },
      before,
      createElement(
        'span',
        { className: 'my-2 block w-full max-w-160', 'data-preview': '' },
        createElement('span', { className: 'relative block max-w-full', style: { height: 300, width: 640 } }, createElement('iframe', { className: 'absolute inset-0 size-full border-0 bg-transparent', title: 'preview', srcDoc: '<body style="margin:0;font:14px system-ui;color:#ddd;background:linear-gradient(135deg,#1d3557,#457b9d);display:grid;place-items:center;height:100vh">canvas / artifact preview</body>' }))
      ),
      after
    )
  }
  const m = /^```([\w-]*)\n([\s\S]*?)\n```$/.exec(text || '')
  if (!m) return createElement('div', { className: 'md' }, text)
  const lines = m[2].split('\n')
  return createElement(
    'div',
    { className: 'md code', 'data-lang': m[1] },
    createElement('pre', { className: 'shiki' }, createElement('code', null, ...lines.map((l, i) => createElement('span', { className: 'line', key: i }, l))))
  )
}

// Composer + model menu pieces (shapes as in the real SDK; behaviour minimal)
export const composerSurfaceRing = 'ring-class'
export const composerInputBacking = 'backing-class'
export const GHOST_ICON_BTN = 'ghost-btn'
export const PRIMARY_ICON_BTN = 'primary-btn'
export const ModelMenuCloseContext = createContext(() => {})
const DDOpen = createContext(false)
export const DropdownMenu = ({ open, onOpenChange, children }) =>
  createElement(DDOpen.Provider, { value: { open, onOpenChange } }, children)
export const DropdownMenuTrigger = ({ children }) => {
  const dd = useContext(DDOpen)
  return createElement('span', { className: 'dd-trigger', onClick: () => dd.onOpenChange?.(!dd.open) }, children)
}
export const DropdownMenuItem = ({ onSelect, disabled, children }) => createElement('button', { className: 'dd-item', disabled, onClick: () => onSelect?.() }, children)
export const DropdownMenuSeparator = () => createElement('hr', { className: 'dd-sep' })
export const DropdownMenuContent = ({ children }) => (useContext(DDOpen).open ? createElement('div', { className: 'dd-content' }, children) : null)
export const modelRows = [['gpt-5.6-luna', 'openai']]
export const catalog = { providers: null, reasoningStatus: '' } // what `model.options` returns, when a test sets it
export const lastMenu = {}
export const ModelCatalogMenu = ({ controller, sessionId, request, footer }) => {
  Object.assign(lastMenu, { request, sessionId })
  const close = useContext(ModelMenuCloseContext)
  return createElement(
    'div',
    { className: 'model-menu', 'data-session': sessionId },
    createElement('span', { className: 'cur' }, controller.current.model),
    ...modelRows.map(([m, p], i) =>
      createElement('button', { key: i, className: 'pick', 'data-model': m, onClick: async () => { if ((await controller.select(m, p)) !== false) close() } }, m)
    ),
    createElement('div', { key: 'foot', className: 'menu-footer' }, footer || null),
    createElement('button', { key: 'eff', className: 'effort', onClick: () => controller.setOptions({ effort: 'high' }, { model: controller.current.model, provider: controller.current.provider }, true) }, 'high')
  )
}
export const ConfirmDialog = ({ open, title, description, confirmLabel, cancelLabel, onConfirm, onClose }) =>
  open
    ? createElement(
        'div',
        { className: 'confirm' },
        createElement('b', null, title),
        createElement('p', null, description),
        createElement('button', { className: 'yes', onClick: () => onConfirm() }, confirmLabel),
        createElement('button', { className: 'no', onClick: () => onClose() }, cancelLabel)
      )
    : null

export const PALETTE_AREA = 'palette'
export const KEYBINDS_AREA = 'keybinds'
export const ROUTES_AREA = 'routes'
export const SIDEBAR_NAV_AREA = 'sidebar.nav'
export const TRANSCRIPT_DIRECTIVE_AREA = 'transcript.directive'
