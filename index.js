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
import { mkdir, readFile, writeFile, rename, stat as statFile } from 'node:fs/promises'
import { dirname, join, resolve as resolvePath } from 'node:path'
import { homedir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'
import z from '@deepseek-ai/schemastery'
import { bodyToText } from './html.js'

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
  // Mail that belongs to no live Session goes here; empty drops it.
  fallbackSessionId: z.string().default('').description('Session id that receives mail for unknown conversations. Empty ignores such mail.'),
  // Where the binding state is stored; empty = <DSH_HOME>/agentmail/state.json.
  statePath: z.string().default('').description('Override the state file path.'),
  // Move routed messages out of the inbox so they are not routed again.
  markRead: z.boolean().default(true).description('Move routed messages to trash so they are not routed again.'),
}).volatile()

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function dshHome() {
  return process.env.DSH_HOME || join(homedir(), '.dsh')
}

// DS Bot roster index: maps every session id that belongs to a group chat
// (canonical id, room id, member sessions, archived segments) to the room's
// canonical info. Read-only; the cache is keyed on the file's mtime+size.
function createRoomIndex() {
  let cache
  const statePath = () => join(dshHome(), 'bot', 'state.json')
  return async function roomsBySession() {
    const file = statePath()
    let stat
    try {
      stat = await statFile(file)
    } catch {
      return cache ? cache.map : new Map()
    }
    const stamp = `${stat.mtimeMs}:${stat.size}`
    if (cache && cache.stamp === stamp) return cache.map
    let parsed
    try {
      parsed = JSON.parse(await readFile(file, 'utf8'))
    } catch {
      return cache ? cache.map : new Map()
    }
    const map = new Map()
    const rooms = parsed && parsed.rooms && typeof parsed.rooms === 'object' ? parsed.rooms : {}
    for (const room of Object.values(rooms)) {
      if (!room || typeof room !== 'object') continue
      const canonical = String(room.sessionId ?? room.id ?? '').trim()
      if (!canonical) continue
      const info = { roomId: room.id, name: room.name, sessionId: canonical }
      map.set(canonical, info)
      if (room.id) map.set(String(room.id), info)
      for (const part of Array.isArray(room.parts) ? room.parts : []) {
        if (part?.sessionId) map.set(String(part.sessionId), info)
      }
      if (room.sessions && typeof room.sessions === 'object') {
        for (const sid of Object.values(room.sessions)) if (sid) map.set(String(sid), info)
      }
      if (room.segments && typeof room.segments === 'object') {
        for (const segs of Object.values(room.segments)) {
          for (const seg of Array.isArray(segs) ? segs : []) if (seg?.sessionId) map.set(String(seg.sessionId), info)
        }
      }
    }
    cache = { stamp, map }
    return map
  }
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

// When the CLI executable itself cannot be run, surface the setup doc instead
// of a bare ENOENT, so the agent walks the user through installation.
const CLI_SETUP_HINT = '请阅读 https://agent.qq.com/doc/cli-setup.md 文档，按照步骤为我安装并配置 Agent Mail CLI。'
const MISSING_CLI_RE = /ENOENT|command not found|is not recognized|No such file or directory/i

function missingCliError() {
  return new Error(CLI_SETUP_HINT)
}

/** Translate spawn failures into the setup hint; pass everything else through. */
function asMissingCli(e) {
  const m = String(e?.message ?? e)
  return (e?.code === 'ENOENT' || MISSING_CLI_RE.test(m)) ? missingCliError() : e
}

/**
 * Build a runner bound to this context. It shells out to agently-cli and parses
 * the JSON line(s) it prints to stdout. Uses ctx.subprocess when available
 * (collect mode) and falls back to node:child_process otherwise.
 */
function createCli(ctx, settings) {
  // Base command: `launcher` (array) wins; else `cliPath` alone. On hosts where a
  // global install is blocked, set launcher to ["npx","--yes","@tencent-qqmail/agently-cli"].
  const baseArgv = () => {
    const config = settings()
    const launcher = Array.isArray(config.launcher) ? config.launcher.filter((part) => String(part).length > 0) : []
    return launcher.length > 0 ? launcher.map(String) : [config.cliPath || 'agently-cli']
  }
  const cwd = ctx.get?.('workingDirectory')?.defaultDirectory || process.cwd()

  async function runCollect(argv, { timeoutMs = 60000 } = {}) {
    const fullArgv = [...baseArgv(), ...argv]
    const subprocess = ctx.get?.('subprocess')
    if (subprocess) {
      let handle
      try {
        handle = subprocess.spawn({
          argv: fullArgv,
          cwd,
          stdio: { stdin: 'ignore', stdout: { maxBytes: 4 * 1024 * 1024 }, stderr: { maxBytes: 1024 * 1024 } },
          graceMs: 2000,
        })
      } catch (e) {
        throw asMissingCli(e)
      }
      const timer = setTimeout(() => { try { handle.terminate() } catch {} }, timeoutMs)
      try {
        // Wait for the process to exit FIRST, then read the collected buffers:
        // reading concurrently with `done` can observe a partial/empty spool.
        let outcome
        try {
          outcome = await handle.done
        } catch (e) {
          throw asMissingCli(e)
        }
        // Give the collector a beat to publish the final chunk.
        const out = await readReaderComplete(handle.collected?.stdout)
        const err = await readReaderComplete(handle.collected?.stderr)
        if (outcome.exitCode !== 0 && MISSING_CLI_RE.test(`${err}\n${out}`)) throw missingCliError()
        return { exitCode: outcome.exitCode, stdout: out, stderr: err }
      } finally {
        clearTimeout(timer)
      }
    }
    // Fallback: child_process (used only when subprocess is not mounted).
    const { spawn } = await import('node:child_process')
    let spawnError
    const result = await new Promise((resolvePromise) => {
      const child = spawn(fullArgv[0], fullArgv.slice(1), { cwd, windowsHide: true })
      let stdout = ''
      let stderr = ''
      const timer = setTimeout(() => { try { child.kill() } catch {} }, timeoutMs)
      child.stdout?.on('data', (d) => { stdout += d.toString() })
      child.stderr?.on('data', (d) => { stderr += d.toString() })
      child.on('error', (e) => { clearTimeout(timer); spawnError = e; resolvePromise({ exitCode: -1, stdout, stderr: stderr + String(e) }) })
      child.on('close', (code) => { clearTimeout(timer); resolvePromise({ exitCode: code, stdout, stderr }) })
    })
    if (spawnError) throw asMissingCli(spawnError)
    if (result.exitCode !== 0 && MISSING_CLI_RE.test(`${result.stderr}\n${result.stdout}`)) throw missingCliError()
    return result
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

  return { runCollect, runJson, get exec() { return baseArgv()[0] } }
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

/**
 * Read a collect-mode reader to the end after the process has exited. The
 * reader is offset based and non-consuming, so we loop readFrom(cursor) until
 * we have a non-lossy tail (or run out of patience).
 */
async function readReaderComplete(reader, { attempts = 5, delayMs = 20 } = {}) {
  if (!reader) return ''
  let last = ''
  for (let i = 0; i < attempts; i += 1) {
    let r
    try { r = reader.readFrom(0) } catch { break }
    if (r && typeof r.text === 'string') {
      last = r.text
      // Non-lossy means the configured maxBytes was not hit; we have it all.
      if (r.lossy === false) return last
    }
    await new Promise((res) => setTimeout(res, delayMs))
  }
  return last
}

// ---------------------------------------------------------------------------
// State store (bindings + seen ids), JSON on disk
// ---------------------------------------------------------------------------

function createStore(settings) {
  const stateFile = () => {
    const config = settings()
    return config.statePath ? resolvePath(config.statePath) : join(dshHome(), 'agentmail', 'state.json')
  }
  let data = { bindings: {}, seen: [], threads: {} }
  let saving = undefined

  async function load() {
    try {
      const raw = await readFile(stateFile(), 'utf8')
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
        const file = stateFile()
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
    get file() { return stateFile() },
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
  // Cordis validates against the exported Schemastery Config and fills defaults.
  // The schema is volatile, so this object reflects live edits; never copy it.
  // A volatile Config reaches the plugin as a live reference: `.get()` is the
  // current values (root-level volatile wraps the whole object), and a plain
  // object arrives when the schema is not volatile (direct/test calls).
  const config = rawConfig || {}
  const settings = () => (typeof config?.get === 'function' ? config.get() : config)
  const store = createStore(settings)
  const cli = createCli(ctx, settings)
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

  const roomsBySession = createRoomIndex()

  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'agentmail_send',
    description: 'Send an email through the QQ Agent mailbox. `session` and `thread` identify the conversation so replies are routed back to it automatically (defaults: this Session id, and a thread slug you choose). In a DS Bot group chat the marker uses the group chat\'s own Session, so replies return to the group instead of one member. Returns the message id and the marker used.',
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
      let session = String(args.session || exec.agent?.id || 'default').trim()
      let thread = String(args.thread || slug(args.subject) || randomUUID().slice(0, 8)).trim()
      let group
      try {
        const rooms = await roomsBySession()
        group = rooms.get(session)
        if (group && group.sessionId) session = group.sessionId
      } catch (e) {
        log('room resolve failed:', e?.message || e)
      }
      if (group && !args.thread) thread = slug(group.name) || thread
      let subject = String(args.subject || '').trim()
      if (!MARKER_RE.test(subject)) subject = `${subject} ${buildMarker(session, thread)}`.trim()
      const argv = ['message', '+send', '--confirmed', '--subject', subject, '--body', String(args.body ?? '')]
      for (const t of args.to || []) argv.push('--to', String(t))
      for (const c of args.cc || []) argv.push('--cc', String(c))
      for (const b of args.bcc || []) argv.push('--bcc', String(b))
      const j = await cli.runJson(argv)
      // Confirm which binding this exchange belongs to.
      store.setBinding(session, thread, { session, thread, updatedAt: Date.now(), lastDirection: 'out', ...group ? { roomId: group.roomId } : {} })
      const id = j.data?.message_id || j.message_id || ''
      const groupLine = group ? `\ngroup: ${group.name} (${group.roomId}) — replies return to the group chat` : ''
      return `Sent. message_id=${id || '(queued)'}\nsubject: ${subject}\nmarker: ${buildMarker(session, thread)}\nthread: ${thread}  session: ${session}${groupLine}`
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
        `Body-format: ${d.body_format || ''}${/^html$/i.test(String(d.body_format || '')) ? ' (rendered to markdown)' : ''}`,
        marker ? `Marker: session=${marker.session} thread=${marker.thread}` : 'Marker: none',
        (d.attachments || []).length ? `Attachments: ${d.attachments.map((a) => `${a.filename} (${a.size}B)`).join(', ')}` : '',
      ].filter(Boolean).join('\n')
      return `${head}\n\n${bodyToText(d.body, d.body_format)}`
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
    const senders = Array.isArray(settings().routeOnlyFrom) ? settings().routeOnlyFrom : []
    if (senders.length > 0 && !senders.includes(from)) return { routed: false, reason: 'sender filtered' }
    // Echo guard: our own outgoing mail (e.g. sending to yourself) can loop back as
    // incoming and would otherwise re-inject into the same Session. Skip it.
    const selfAddr = await self()
    if (selfAddr && from && from.toLowerCase() === String(selfAddr).toLowerCase()) {
      return { routed: false, reason: 'from self (echo)' }
    }

    const target = await resolveTarget(marker)
    if (!target.agent) return { routed: false, reason: target.reason }

    // Read the full body before injecting it.
    let full
    try { full = (await cli.runJson(['message', '+read', '--id', message.message_id])).data } catch { full = undefined }
    const bodyText = bodyToText(full?.body || message.snippet || '', full?.body_format)

    const userMessage = createUserMessage({
      content: [{ type: 'text', text: deliveryText(target, { subject, from, bodyText, marker }) }],
      // User-role message so the Session log accepts it like a chat message.
      source: { kind: 'user' },
    })
    const agent = target.agent
    if (typeof agent.followup === 'function') agent.followup(userMessage)
    else if (typeof agent.steer === 'function') agent.steer(userMessage)
    try { await ctx.get?.('sessions')?.flush?.(agent.session) } catch { /* flush optional */ }

    // Only a thread that resolved to its own Session becomes a binding; fallback
    // deliveries stay one-off so a revived Session reclaims its thread.
    if (target.source !== 'fallback' && marker) {
      store.setBinding(marker.session, marker.thread, { session: marker.session, thread: marker.thread, sessionId: target.sessionId, updatedAt: Date.now(), lastDirection: 'in', ...target.group ? { roomId: target.group.roomId } : {} })
    }
    return { routed: true, sessionId: target.sessionId, thread: marker?.thread, via: target.source, group: target.group?.name }
  }

  /**
   * Pick the Session that receives one message: its bound Session, the Session
   * named by the marker, or the configured fallback for unknown conversations.
   * With no fallback the message is deliberately dropped.
   */
  async function resolveTarget(marker) {
    if (marker) {
      const binding = store.bindingOf(marker.session, marker.thread)
      if (binding?.sessionId) {
        const agent = await resolveAgentById(binding.sessionId)
        if (agent) return { agent, sessionId: binding.sessionId, source: 'binding', group: await groupOf(binding.sessionId) }
      }
      if (looksLikeSessionId(marker.session)) {
        const agent = await resolveAgentById(marker.session)
        if (agent) return { agent, sessionId: marker.session, source: 'marker', group: await groupOf(marker.session) }
      }
    }
    const fallbackId = String(settings().fallbackSessionId || '').trim()
    if (!fallbackId) {
      return { reason: marker ? 'unknown conversation (no fallback session)' : 'unmarked mail (no fallback session)' }
    }
    const agent = await resolveAgentById(fallbackId)
    if (!agent) return { reason: `fallback session ${fallbackId} is not available` }
    return { agent, sessionId: fallbackId, source: 'fallback', group: await groupOf(fallbackId) }
  }

  async function groupOf(sessionId) {
    try {
      return (await roomsBySession()).get(String(sessionId || ''))
    } catch {
      return undefined
    }
  }

  function deliveryText(target, { subject, from, bodyText, marker }) {
    const group = target.group
    let head
    if (target.source === 'fallback') {
      head = [`[Agent Mail · unknown conversation · from ${from}]`]
    } else if (group) {
      head = [`[Agent Mail · 群聊 "${group.name}" 收到一封邮件 · from ${from}]`]
    } else {
      head = [`[Agent Mail · thread "${marker?.thread ?? ''}" · from ${from}]`]
    }
    if (target.source === 'fallback' && marker) head.push(`Marker: session=${marker.session} thread=${marker.thread} (no live Session)`)
    head.push(`Subject: ${normalizeSubject(subject)}`)
    return `${head.join('\n')}\n\n${bodyText}`
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

  async function pollOnce() {
    await ready
    const j = await cli.runJson(['message', '+list', '--dir', 'inbox', '--is-unread', '--limit', '20'])
    const rows = (j.data?.data) || []
    const results = []
    for (const msg of rows) {
      if (!msg?.message_id || store.hasSeen(msg.message_id)) continue
      try {
        const r = await routeIncoming(msg)
        // An ignored message stays unseen on purpose: configuring a fallback
        // Session later lets the next poll pick it up.
        if (r.routed || r.reason === 'from self (echo)') store.markSeen(msg.message_id)
        results.push({ id: msg.message_id, ...r })
        if (r.routed && settings().markRead !== false) {
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
        ? `routed ${r.id} -> session ${r.sessionId}${r.group ? ` (group chat "${r.group}")` : ''}${r.via === 'fallback' ? ' (fallback for an unknown conversation)' : ''}${r.thread ? ` (thread ${r.thread})` : ''}`
        : `skipped ${r.id}: ${r.reason}`).join('\n')
    },
  })))

  // Background poller. The interval comes from the live config each cycle, so a
  // settings edit re-arms it without remounting the plugin.
  const intervalMs = () => Number(settings().pollIntervalMs ?? CONFIG_DEFAULTS.pollIntervalMs) || 0
  ctx.effect(() => {
    let stopped = false
    let timer
    const tick = async () => {
      if (stopped) return
      try { await pollOnce() } catch (e) { log('poll failed:', e?.message || e) }
      schedule()
    }
    const schedule = (immediate = false) => {
      if (stopped) return
      if (timer) clearTimeout(timer)
      const ms = intervalMs()
      timer = ms <= 0 ? undefined : setTimeout(tick, immediate ? Math.min(ms, 5000) : ms)
    }
    schedule(true)
    ctx.on('loader/volatile-update', () => schedule())
    return () => { stopped = true; if (timer) clearTimeout(timer) }
  })

  // System prompt: tell the agent the mail tools exist and the marker rule.
  const sp = ctx.get?.('systemPrompt')
  if (sp?.section) {
    ctx.effect(() => sp.section({
      name: 'tool:agentmail',
      order: 120,
      text: 'You can send and receive email through Agent Mail (agentmail_send / agentmail_list / agentmail_read / agentmail_search / agentmail_reply / agentmail_poll). When you send mail, a session/thread marker is embedded in the subject and replies are routed back into the conversation automatically; keep the resulting thread name stable for a topic. In a DS Bot group chat, the marker is raised from the group chat itself, so replies come back into the group (the whole group sees them), not into one member\'s private thread. Mail whose conversation matches no live Session goes to the configured fallback Session, and is ignored when no fallback is configured.',
    }))
  }

  log('Agent Mail ready (poll every', intervalMs() ? `${Math.round(intervalMs() / 1000)}s` : 'never',
    settings().fallbackSessionId ? `, fallback ${settings().fallbackSessionId}` : ', unknown mail ignored', ')')
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
  fallbackSessionId: '',
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
