# dsh-agentmail — Agent Mail for DeepSeek Harness

A DeepSeek Harness **host plugin** that lets an agent send and receive email
through the QQ **Agent Mail** mailbox (via [`agently-cli`](https://agent.qq.com/doc/cli-setup.md)),
and routes incoming replies **back into the DSH Session that owns the thread**.

## What it does

- **Tools** for the agent:
  - `agentmail_send` — send an email; a `session`/`thread` marker is embedded in
    the subject automatically.
  - `agentmail_list` — list a folder (inbox/sent/trash/spam).
  - `agentmail_read` — read one message in full; HTML bodies are rendered to
    clean markdown.
  - `agentmail_search` — search by keyword.
  - `agentmail_reply` — reply to a message (marker preserved).
  - `agentmail_poll` — check the inbox now and route new mail.
- **Poller** — every `pollIntervalMs` it lists unread inbox mail, reads each new
  message, parses the marker, and delivers it into the bound DSH Session with
  `agent.followup(...)` (waking the agent). A thread with no binding gets a new
  Session when `autoCreateSession` is on.
- **HTML -> markdown** — QQ/Foxmail HTML bodies are rendered down to compact
  markdown (`html.js`, turndown-based): signature/report blocks
  (`data-xmail_bot_mail_report`) are removed, Foxmail's border-left/`mail_quote`
  shells become `>` quotes, tiny icon/tracking pixels drop out, other images
  become `[图片]` placeholders, tables render as pipe tables. PLAIN and MARKDOWN
  bodies pass through untouched.

## The session / thread marker

Sending mail appends this to the subject:

```
Subject: Quarterly report  [AM:s=<session>|t=<thread>]
```

- `s` — the conversation owner: the DSH Session id (or a stable key you pass).
- `t` — the **thread** (topic) the agent chose.

Replies keep the marker (mail clients keep `Re: …` in the subject), so the poller
resolves `(session, thread)` back to the same DSH Session. A mapping table is
persisted in `state.json` so routing survives restarts even if the subject is
edited or the marker only survives in the snippet.

## Requirements

1. `agently-cli` installed and authorized once:

   ```bash
   npm install -g @tencent-qqmail/agently-cli
   agently-cli auth login        # interactive OAuth
   agently-cli +me              # verify the mailbox address
   ```

2. The plugin installed into the profile (via Plugin Manager / `install_bundle`).

## Configuration (`cordis.patch.yml`)

Override the `agentmail` row's config to tune behaviour:

```yaml
- id: agentmail
  config:
    cliPath: agently-cli        # absolute path if not on PATH
    pollIntervalMs: 60000       # 0 disables the background poller
    routeOnlyFrom: []           # e.g. ["boss@example.com"] to only auto-route those
    autoCreateSession: true     # create a DSH Session for unseen threads
    workspaceId: ""             # workspace for auto-created Sessions
    statePath: ""               # default <DSH_HOME>/agentmail/state.json
    markRead: true              # move routed mail to trash
```

## Notes

- Send/reply use `--confirmed` so mail is not blocked on an interactive
  confirmation prompt.
- Attachments can be sent with the CLI directly; this plugin focuses on the
  session/thread routing workflow.
