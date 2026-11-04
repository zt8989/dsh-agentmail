// dsh-agentmail — Agent Mail for DeepSeek Harness.
//
// Wraps the QQ Agent mailbox CLI (`agently-cli`) with:
//   * tools to send / list / read / search / reply mail;
//   * a configurable poller that reads new inbox mail and routes each message
//     back into the DSH Session that is "about" it, using a session/thread
//     marker embedded in the subject line of the mail we sent.
//
// Marker in the subject:  [AM:s=<session>|t=<thread>]
//   s = the DSH Session id (or a friendly key) that owns the conversation;
//   t = the thread (topic) name the agent chose for this exchange.
// A reply that keeps "Re: ..." keeps the marker, so the poller can resolve it.
//
// State (session/thread -> DSH session bindings, seen message ids) lives in a
// JSON file next to the profile's DSH_HOME, so it survives restarts.
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises'
import { dirname, join, resolve as resolvePath } from 'node:path'
import { homedir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'
import z from '@deepseek-ai/schemastery'

export const name = 'dsh-agentmail'
// tools: register mail tools. Every other service (subprocess, sessions,
// sessionController, systemPrompt) is looked up with ctx.get so the plugin
// stays loadable in profiles that lack them.
export const inject = ['tools']

const MARKER_RE = /\[AM:s=([^\]|]+)\|t=([^\]]+)\]/i

export const Config = z.object({
  // Absolute path to the agently-cli executable, or a bare name resolved on PATH.
  cliPath: z.string().default('agently-cli').description('agently-cli executable (absolute path or PATH name).'),
  launcher: z.array(z.string()).default([]).description('Full base command as an argv array (wins over cliPath). E.g. ["npx","--yes","@tencent-qqmail/agently-cli"] when a global install is blocked.'),
  // Milliseconds between inbox polls. 0 disables the poller.
  pollIntervalMs: z.number().min(0).default(60000).description('Poll the inbox every N milliseconds. 0 disables polling.'),
  // Only route mail from these senders, when non-empty.
  routeOnlyFrom: z.array(z.string()).default([]).description('If set, only mail from these sender emails is auto-routed.'),
  // Create a fresh DSH Session for a thread with no existing binding.
  autoCreateSession: z.boolean().default(true).description('Create a new DSH Session when an incoming thread has no bound Session.'),
  // Workspace id used for auto-created Sessions (empty = the default).
  workspaceId: z.string().default('').description('Workspace id for sessions created by the poller (empty = default workspace).'),
  // Where the binding state is stored; empty = <DSH_HOME>/agentmail/state.json.
  statePath: z.string().default('').description('Override the state file path.'),
  // Move routed messages out of the inbox so they are not routed again.
  markRead: z.boolean().default(true).description('Move routed messages to trash so they are not routed again.'),
})

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function dshHome() {
  return process.env.DSH_HOME || join(homedir(), '.dsh')
}

function log(...args) {
  // A plugin must not spam; one prefixed line per notable event.
  console.error('[dsh-agentmail]', ...args)
}

/** Strip a leading Re:/Fwd:/答复 etc. so a reply still matches the original. */
function normalizeSubject(subject) {
  let s = String(subject || '')
  for (let i = 0; i < 8; i += 1) {
    const next = s.replace(/^\s*(re|fwd|fw|回[复復]|转发|轉發)\s*[:：]\s*/i, '')
    if (next === s) break
    s = next
  }
  return s.replace(/\s+/g, ' ').trim()
}

function parseMarker(text) {
  const m = MARKER_RE.exec(String(text || ''))
  if (!m) return undefined
  return { session: m[1].trim(), thread: m[2].trim() }
}

function buildMarker(session, thread) {
  // `|` and `]` cannot appear inside a marker; replace defensively.
  const clean = (v) => String(v).replace(/[\]|]/g, '_').trim()
  return `[AM:s=${clean(session)}|t=${clean(thread)}]`
}

// ---------------------------------------------------------------------------
// agently-cli runner
// ---------------------------------------------------------------------------

/**
 * Build a runner bound to this context. It shells out to agently-cli and parses
 * the JSON line(s) it prints to stdout. Uses ctx.subprocess when available
 * (collect mode) and falls back to node:child_process otherwise.
 */
function createCli(ctx, config) {
  // Base command: `launcher` (array) wins; else `cliPath` alone. On hosts where a
  // global install is blocked, set launcher to ["npx","--yes","@tencent-qqmail/agently-cli"].
  const base = Array.isArray(config.launcher) && config.launcher.length > 0
    ? config.launcher.map(String)
    : [config.cliPath || 'agently-cli']
  const exec = base[0]
  const baseArgs = base.slice(1)
  const cwd = ctx.get?.('workingDirectory')?.defaultDirectory || process.cwd()

  async function runCollect(argv, { timeoutMs = 60000 } = {}) {
    const fullArgv = [exec, ...baseArgs, ...argv]
    const subprocess = ctx.get?.('subprocess')
    if (subprocess) {
      const handle = subprocess.spawn({
        argv: fullArgv,
        cwd,
        stdio: { stdin: 'ignore', stdout: { maxBytes: 4 * 1024 * 1024 }, stderr: { maxBytes: 1024 * 1024 } },
        graceMs: 2000,
      })
      const timer = setTimeout(() => { try { handle.terminate() } catch {} }, timeoutMs)
      try {
        const [outcome, out, err] = await Promise.all([
          handle.done,
          readReader(handle.collected?.stdout),
          readReader(handle.collected?.stderr),
        ])
        return { exitCode: outcome.exitCode, stdout: out, stderr: err }
      } finally {
        clearTimeout(timer)
      }
    }
    // Fallback: child_process (used only when subprocess is not mounted).
    const { spawn } = await import('node:child_process')
    return await new Promise((resolvePromise) => {
      const child = spawn(fullArgv[0], fullArgv.slice(1), { cwd, windowsHide: true })
      let stdout = ''
      let stderr = ''
      const timer = setTimeout(() => { try { child.kill() } catch {} }, timeoutMs)
      child.stdout?.on('data', (d) => { stdout += d.toString() })
      child.stderr?.on('data', (d) => { stderr += d.toString() })
      child.on('close', (code) => { clearTimeout(timer); resolvePromise({ exitCode: code, stdout, stderr }) })
      child.on('error', (e) => { clearTimeout(timer); resolvePromise({ exitCode: -1, stdout, stderr: stderr + String(e) }) })
    })
  }

  /** Run and parse the last JSON object emitted on stdout (CLI prints one JSON). */
  async function runJson(argv, opts) {
    const { exitCode, stdout, stderr } = await runCollect(argv, opts)
    const text = stdout.trim()
    // The CLI prints pretty JSON; find the outermost JSON object.
    const start = text.indexOf('{')
    let json
    if (start !== -1) {
      try { json = JSON.parse(text.slice(start)) } catch { json = undefined }
    }
    // +watch prints one bare JSON object per line; be tolerant.
    if (json === undefined && text !== '') {
      const lines = text.split(/\r?\n/).filter(Boolean)
      const parsed = lines.map((l) => { try { return JSON.parse(l) } catch { return undefined } }).filter(Boolean)
      if (parsed.length === 1) json = parsed[0]
      else if (parsed.length > 1) json = { __lines: parsed }
    }
    if (json === undefined) {
      const hint = stderr.trim() || text.slice(0, 500) || `agently-cli exited ${exitCode}`
      throw new Error(`agently-cli returned no JSON: ${hint}`)
    }
    if (json.ok === false) {
      const e = json.error || {}
      throw new Error(`agently-cli error (${e.type || 'unknown'}): ${e.message || 'unknown error'}`)
    }
    return json
  }

  return { runCollect, runJson, exec }
}

async function readReader(reader) {
  if (!reader) return ''
  // SubprocessOutputReader is offset based; read everything from 0.
  try {
    const r = reader.readFrom(0)
    return r.text || ''
  } catch {
    return ''
  }
}

// ---------------------------------------------------------------------------
// State store (bindings + seen ids), JSON on disk
// ---------------------------------------------------------------------------

function createStore(config) {
  const file = config.statePath ? resolvePath(config.statePath) : join(dshHome(), 'agentmail', 'state.json')
  let data = { bindings: {}, seen: [], threads: {} }
  let saving = undefined

  async function load() {
    try {
      const raw = await readFile(file, 'utf8')
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed === 'object') {
        data = {
          bindings: parsed.bindings && typeof parsed.bindings === 'object' ? parsed.bindings : {},
          seen: Array.isArray(parsed.seen) ? parsed.seen : [],
          threads: parsed.threads && typeof parsed.threads === 'object' ? parsed.threads : {},
        }
      }
    } catch (e) {
      if (e?.code !== 'ENOENT') log('state load failed:', e?.message || e)
    }
    return data
  }

  async function save() {
    if (saving) return saving
    saving = (async () => {
      try {
        await mkdir(dirname(file), { recursive: true })
        const tmp = `${file}.tmp-${process.pid}`
        await writeFile(tmp, JSON.stringify(data, null, 2), 'utf8')
        await rename(tmp, file)
      } catch (e) {
        log('state save failed:', e?.message || e)
      } finally {
        saving = undefined
      }
    })()
    return saving
  }

  const keyOf = (session, thread) => `${session}::${thread}`
  return {
    file,
    load,
    save,
    data,
    bindingOf(session, thread) { return data.bindings[keyOf(session, thread)] },
    setBinding(session, thread, value) { data.bindings[keyOf(session, thread)] = value; void save() },
    hasSeen(id) { return data.seen.includes(id) },
    markSeen(id) {
      if (!data.seen.includes(id)) {
        data.seen.push(id)
        if (data.seen.length > 5000) data.seen.splice(0, data.seen.length - 5000)
        void save()
      }
    },
  }
}

// ---------------------------------------------------------------------------
// Plugin entry
// ---------------------------------------------------------------------------

export function apply(ctx, rawConfig = {}) {
  // Cordis validates against the exported Schemastery Config and fills defaults;
  // the plain fallback keeps direct/test calls working.
  const config = { ...CONFIG_DEFAULTS, ...(rawConfig || {}) }
  const store = createStore(config)
  const cli = createCli(ctx, config)
  let ready = store.load()

  // Discover our own mailbox address once (used in send receipts, headers).
  let selfAddress
  async function self() {
    if (selfAddress) return selfAddress
    try {
      const j = await cli.runJson(['+me'])
      const d = j.data || j
      selfAddress = d.email || d.address || d.mail || d.alias || undefined
    } catch (e) {
      log('+me failed (authorization?):', e?.message || e)
    }
    return selfAddress
  }

  // ---- tools -------------------------------------------------------------

  const textOut = { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: typeof v === 'string' ? v : JSON.stringify(v, null, 2) }] }
  const out = () => textOut

  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'agentmail_send',
    description: 'Send an email through the QQ Agent mailbox. `session` and `thread` identify the conversation so replies are routed back to it automatically (defaults: this Session id, and a thread slug you choose). Returns the message id and the marker used.',
    parameters: {
      to: { type: 'array', items: { type: 'string' }, required: true, description: 'Recipient email address(es).' },
      subject: { type: 'string', required: true, description: 'Email subject. The session/thread marker is appended automatically unless already present.' },
      body: { type: 'string', required: true, description: 'Plain-text or markdown body.' },
      cc: { type: 'array', items: { type: 'string' }, description: 'CC recipients.' },
      bcc: { type: 'array', items: { type: 'string' }, description: 'BCC recipients.' },
      thread: { type: 'string', description: 'Thread (topic) name you define; defaults to a slug of the subject.' },
      session: { type: 'string', description: 'Session key that owns this thread; defaults to the current DSH Session id.' },
    },
    output: textOut,
    async execute(args, exec) {
      await ready
      const session = String(args.session || exec.agent?.id || 'default').trim()
      const thread = String(args.thread || slug(args.subject) || randomUUID().slice(0, 8)).trim()
      let subject = String(args.subject || '').trim()
      if (!MARKER_RE.test(subject)) subject = `${subject} ${buildMarker(session, thread)}`.trim()
      const argv = ['message', '+send', '--confirmed', '--subject', subject, '--body', String(args.body ?? '')]
      for (const t of args.to || []) argv.push('--to', String(t))
      for (const c of args.cc || []) argv.push('--cc', String(c))
      for (const b of args.bcc || []) argv.push('--bcc', String(b))
      const j = await cli.runJson(argv)
      // Confirm which binding this exchange belongs to.
      store.setBinding(session, thread, { session, thread, updatedAt: Date.now(), lastDirection: 'out' })
      const id = j.data?.message_id || j.message_id || ''
      return `Sent. message_id=${id || '(queued)'}\nsubject: ${subject}\nmarker: ${buildMarker(session, thread)}\nthread: ${thread}  session: ${session}`
    },
  })))

  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'agentmail_list',
    description: 'List messages in a mailbox folder (inbox/sent/trash/spam). Returns compact rows with message_id, from, subject, time and read state; use agentmail_read with a message_id for the body.',
    parameters: {
      dir: { type: 'string', enum: ['inbox', 'sent', 'trash', 'spam'], description: 'Folder; defaults to inbox.' },
      limit: { type: 'number', description: 'Max messages (1-50); default 10.' },
      unreadOnly: { type: 'boolean', description: 'Only unread messages.' },
      hasAttachments: { type: 'boolean', description: 'Only messages with attachments.' },
      cursor: { type: 'string', description: 'Pagination cursor from a previous response.' },
    },
    output: textOut,
    async execute(args) {
      const argv = ['message', '+list', '--dir', args.dir || 'inbox', '--limit', String(clamp(args.limit ?? 10, 1, 50))]
      if (args.unreadOnly) argv.push('--is-unread')
      if (args.hasAttachments) argv.push('--has-attachments')
      if (args.cursor) argv.push('--cursor', String(args.cursor))
      const j = await cli.runJson(argv)
      const rows = (j.data?.data) || []
      if (rows.length === 0) return 'No messages.'
      const lines = rows.map((m) => {
        const from = m.from?.email || m.from?.name || '?'
        const read = m.is_read ? ' ' : '*'
        return `${read}${m.message_id}  ${fmtTime(m.created_at)}  ${from}  —  ${m.subject || '(no subject)'}`
      })
      const more = j.data?.pagination?.has_more
      return `${rows.length} message(s)${more ? ' (more available)' : ''}:\n${lines.join('\n')}`
    },
  })))

  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'agentmail_read',
    description: 'Read one message in full (body, headers, attachments). The reply shows the session/thread marker if present.',
    parameters: {
      id: { type: 'string', required: true, description: 'message_id (msg_ prefix) from agentmail_list.' },
    },
    output: textOut,
    async execute(args) {
      const j = await cli.runJson(['message', '+read', '--id', String(args.id)])
      const d = j.data || {}
      const marker = parseMarker(d.subject) || parseMarker(d.body)
      const head = [
        `From: ${d.from?.name || ''} <${d.from?.email || ''}>`,
        `To: ${(d.to || []).map((x) => x.email || x.name).join(', ')}`,
        `Subject: ${d.subject || ''}`,
        `Date: ${d.created_at || ''}`,
        `Body-format: ${d.body_format || ''}`,
        marker ? `Marker: session=${marker.session} thread=${marker.thread}` : 'Marker: none',
        (d.attachments || []).length ? `Attachments: ${d.attachments.map((a) => `${a.filename} (${a.size}B)`).join(', ')}` : '',
      ].filter(Boolean).join('\n')
      const body = trimBody(d.body || '')
      return `${head}\n\n${body}`
    },
  })))

  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'agentmail_search',
    description: 'Search mailbox messages by keyword.',
    parameters: {
      q: { type: 'string', required: true, description: 'Keyword or phrase.' },
    },
    output: textOut,
    async execute(args) {
      const j = await cli.runJson(['message', '+search', '--q', String(args.q)])
      const rows = (j.data?.data) || []
      if (rows.length === 0) return 'No matches.'
      return rows.map((m) => `${m.message_id}  ${fmtTime(m.created_at)}  ${m.from?.email || '?'}  —  ${m.subject || ''}`).join('\n')
    },
  })))

  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'agentmail_reply',
    description: 'Reply to a message by id. The session/thread marker is preserved in the subject so the thread continues to route correctly.',
    parameters: {
      id: { type: 'string', required: true, description: 'message_id to reply to.' },
      body: { type: 'string', required: true, description: 'Reply body.' },
      replyAll: { type: 'boolean', description: 'Reply to all original recipients.' },
    },
    output: textOut,
    async execute(args) {
      const argv = ['message', '+reply', '--id', String(args.id), '--confirmed', '--body', String(args.body)]
      if (args.replyAll) argv.push('--reply-all')
      const j = await cli.runJson(argv)
      const id = j.data?.message_id || j.queued ? '(queued)' : ''
      return `Reply sent${id ? ` (${id})` : ''}.`
    },
  })))

  // ---- poller + routing --------------------------------------------------

  async function routeIncoming(message) {
    const subject = message.subject || ''
    const marker = parseMarker(subject) || parseMarker(message.snippet)
    const from = message.from?.email || message.from?.name || ''
    if (config.routeOnlyFrom.length > 0 && !config.routeOnlyFrom.includes(from)) return { routed: false, reason: 'sender filtered' }
    if (!marker) return { routed: false, reason: 'no marker' }

    const { session: sessionKey, thread } = marker
    const binding = store.bindingOf(sessionKey, thread)
    let targetSessionId = binding?.sessionId

    // Resolve the DSH Session to wake.
    let agent
    if (targetSessionId) {
      agent = await resolveAgentById(targetSessionId)
    }
    if (!agent && looksLikeSessionId(sessionKey)) {
      agent = await resolveAgentById(sessionKey)
      targetSessionId = sessionKey
    }
    if (!agent && config.autoCreateSession) {
      targetSessionId = await createSession()
      agent = targetSessionId ? await resolveAgentById(targetSessionId) : undefined
    }
    if (!agent) return { routed: false, reason: 'no target session' }

    // Read the full body before injecting it.
    let full
    try { full = (await cli.runJson(['message', '+read', '--id', message.message_id])).data } catch { full = undefined }
    const bodyText = trimBody(full?.body || message.snippet || '')

    const header = `[Agent Mail · thread "${thread}" · from ${from}]`
    const text = `${header}\nSubject: ${normalizeSubject(subject)}\n\n${bodyText}`
    const userMessage = createUserMessage({
      content: [{ type: 'text', text }],
      // User-role message so the Session log accepts it like a chat message.
      source: { kind: 'user' },
    })
    if (typeof agent.followup === 'function') agent.followup(userMessage)
    else if (typeof agent.steer === 'function') agent.steer(userMessage)
    try { await ctx.get?.('sessions')?.flush?.(agent.session) } catch { /* flush optional */ }

    store.setBinding(sessionKey, thread, { session: sessionKey, thread, sessionId: targetSessionId, updatedAt: Date.now(), lastDirection: 'in' })
    return { routed: true, sessionId: targetSessionId, thread }
  }

  async function resolveAgentById(sessionId) {
    const sc = ctx.get?.('sessionController')
    if (!sc) return undefined
    try {
      const res = await sc.resolveAgent(sessionId)
      if (res && 'agent' in res) return res.agent
      if (res && 'error' in res) return undefined
      return res
    } catch (e) {
      log('resolveAgent failed:', e?.message || e)
      return undefined
    }
  }

  async function createSession() {
    const sc = ctx.get?.('sessionController')
    if (!sc) return undefined
    try {
      const req = {}
      if (config.workspaceId) req.workspaceId = config.workspaceId
      const res = await sc.create(req)
      return res?.sessionId
    } catch (e) {
      log('create session failed:', e?.message || e)
      return undefined
    }
  }

  async function pollOnce() {
    await ready
    const j = await cli.runJson(['message', '+list', '--dir', 'inbox', '--is-unread', '--limit', '20'])
    const rows = (j.data?.data) || []
    const results = []
    for (const msg of rows) {
      if (!msg?.message_id || store.hasSeen(msg.message_id)) continue
      try {
        const r = await routeIncoming(msg)
        store.markSeen(msg.message_id)
        results.push({ id: msg.message_id, ...r })
        if (r.routed && config.markRead) {
          // Move out of the inbox so it is not listed as unread again.
          try { await cli.runJson(['message', '+trash', '--id', msg.message_id]) } catch (e) { log('trash failed:', e?.message || e) }
        }
      } catch (e) {
        log('route failed for', msg.message_id, e?.message || e)
      }
    }
    return results
  }

  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'agentmail_poll',
    description: 'Check the inbox now and route any new mail to its bound Session. Returns what was routed. (The plugin also polls automatically on its interval.)',
    parameters: {},
    output: textOut,
    async execute() {
      const results = await pollOnce()
      if (results.length === 0) return 'No new mail to route.'
      return results.map((r) => r.routed
        ? `routed ${r.id} -> session ${r.sessionId} (thread ${r.thread})`
        : `skipped ${r.id}: ${r.reason}`).join('\n')
    },
  })))

  // Background interval poller.
  const intervalMs = Number(config.pollIntervalMs) || 0
  if (intervalMs > 0) {
    ctx.effect(() => {
      let stopped = false
      let timer
      const tick = async () => {
        if (stopped) return
        try { await pollOnce() } catch (e) { log('poll failed:', e?.message || e) }
        if (!stopped) timer = setTimeout(tick, intervalMs)
      }
      timer = setTimeout(tick, Math.min(intervalMs, 5000))
      return () => { stopped = true; if (timer) clearTimeout(timer) }
    })
  }

  // System prompt: tell the agent the mail tools exist and the marker rule.
  const sp = ctx.get?.('systemPrompt')
  if (sp?.section) {
    ctx.effect(() => sp.section({
      name: 'tool:agentmail',
      order: 120,
      text: 'You can send and receive email through Agent Mail (agentmail_send / agentmail_list / agentmail_read / agentmail_search / agentmail_reply / agentmail_poll). When you send mail, a session/thread marker is embedded in the subject and replies are routed back into the conversation automatically; keep the resulting thread name stable for a topic.',
    }))
  }

  log('Agent Mail ready (poll every', intervalMs ? `${Math.round(intervalMs / 1000)}s` : 'never', ')')
  return { pollOnce }
}

// ---------------------------------------------------------------------------
// misc
// ---------------------------------------------------------------------------

const CONFIG_DEFAULTS = {
  cliPath: 'agently-cli',
  launcher: [],
  pollIntervalMs: 60000,
  routeOnlyFrom: [],
  autoCreateSession: true,
  workspaceId: '',
  statePath: '',
  markRead: true,
}

function defaultsOf() { return CONFIG_DEFAULTS }

function slug(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
}

function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, Number(n) || lo)) }

function looksLikeSessionId(s) { return /^session[-_]/i.test(String(s)) || /^[0-9a-f-]{16,}$/i.test(String(s)) }

function fmtTime(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return String(iso).slice(0, 16)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

function trimBody(body) {
  const text = String(body || '')
  if (text.length <= 12000) return text
  return `${text.slice(0, 12000)}\n\n…[truncated ${text.length - 12000} chars]`
}
