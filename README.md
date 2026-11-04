# dsh-agentmail — Agent Mail for DeepSeek Harness

> **项目备注 / Project Note**
>
> **简介**：DeepSeek Harness 的 Agent 邮箱插件。让 Agent 通过 QQ Agent Mail（`agently-cli`）收发邮件，并利用邮件标题中的 `session`/`thread` 标记，把回信**自动路由回发起对话的那个 DSH 会话**。
>
> **核心能力**：6 个工具（send / list / read / search / reply / poll）+ 可配置的后台轮询；本插件为 Host-only，无需前端界面。
>
> **使用前提**：已安装并授权 `agently-cli`（`npm i -g @tencent-qqmail/agently-cli` → `agently-cli auth login`）。
>
> **已修复**：① 子进程输出改为「等进程退出后再读取」，修复发送结果读空的问题；② 增加**自发回声防护**，自发信（发件人=本邮箱）不再被重复注入会话。
>
> **待办（TODO）**：附件收发支持；发件人白名单与轮询异常重试；README 增加截图与多语言说明。

A DeepSeek Harness **host plugin** that lets an agent send and receive email
through the QQ **Agent Mail** mailbox (via [`agently-cli`](https://agent.qq.com/doc/cli-setup.md)),
and routes incoming replies **back into the DSH Session that owns the thread**.

## What it does

- **Tools** for the agent:
  - `agentmail_send` — send an email; a `session`/`thread` marker is embedded in
    the subject automatically.
  - `agentmail_list` — list a folder (inbox/sent/trash/spam).
  - `agentmail_read` — read one message in full.
  - `agentmail_search` — search by keyword.
  - `agentmail_reply` — reply to a message (marker preserved).
  - `agentmail_poll` — check the inbox now and route new mail.
- **Poller** — every `pollIntervalMs` it lists unread inbox mail, reads each new
  message, parses the marker, and delivers it into the bound DSH Session with
  `agent.followup(...)` (waking the agent). A thread with no binding gets a new
  Session when `autoCreateSession` is on.

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
