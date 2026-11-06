# dsh-agentmail — DeepSeek Harness 的 Agent Mail 插件

[English](README.md) | 简体中文

一个 DeepSeek Harness **插件**：让智能体通过 QQ **Agent Mail** 邮箱（基于
[`agently-cli`](https://agent.qq.com/doc/cli-setup.md)）收发邮件，把来信**路由回
拥有该线程的 DSH 会话**，并把**不认识的会话**交给指定的兜底会话（未配置时忽略）。
各项设置可在 Web 界面的配置页里修改。

## 功能

- **智能体工具**：
  - `agentmail_send` — 发送邮件；主题自动嵌入 `session`/`thread` 标记。
  - `agentmail_list` — 列出某个文件夹（inbox/sent/trash/spam）。
  - `agentmail_read` — 读取完整邮件；HTML 正文渲染为干净的 Markdown。
  - `agentmail_search` — 按关键词搜索。
  - `agentmail_reply` — 回复邮件（保留标记）。
  - `agentmail_poll` — 立即检查收件箱并路由新邮件。
- **轮询器** — 每隔 `pollIntervalMs` 列出收件箱未读邮件，逐封读取新邮件、解析标记，
  并通过 `agent.followup(...)` 把内容投递进绑定的 DSH 会话（唤醒智能体）。匹配不到
  任何活动会话的来信会交给配置好的**兜底会话**；没有配置兜底会话时，这类邮件留在
  收件箱里被忽略。
- **配置页** — **设置 → Agent 邮箱** 是一整页配置；同一个页面也挂在
  **Plugins → Agent Mail** 的插件行上（行上的**配置**入口），两处改的是同一份设置。
  可设兜底会话、发件人过滤、投递、轮询与连接参数；兜底会话从**会话下拉列表**里选，
  不用手抄会话 id。修改先暂存，点 **保存** 才写入，日常使用不必手改 `cordis.patch.yml`。
- **HTML → Markdown** — QQ/Foxmail 的 HTML 正文被渲染为紧凑的 Markdown
  （`html.js`，基于 turndown）：签名/报告块（`data-xmail_bot_mail_report`）整体移除，
  Foxmail 的 border-left/`mail_quote` 引用壳变成 `>` 引用，微小图标/追踪像素被丢弃，
  其余图片变成 `[图片]` 占位，表格渲染为管道表格。PLAIN 与 MARKDOWN 正文原样透传。
- **缺失 CLI 提示** — 当 `agently-cli` 无法执行时，所有工具（含轮询器）返回官方安装
  文档指引（`https://agent.qq.com/doc/cli-setup.md`），而不是裸的 ENOENT 报错，智能体
  可以据此引导用户完成安装。

## 会话 / 线程标记

发送邮件时，主题末尾会追加：

```
Subject: Quarterly report  [AM:s=<session>|t=<thread>]
```

- `s` — 会话归属：DSH 会话 id（或你指定的稳定 key）。
- `t` — 智能体为本轮对话选择的**线程**（主题）。

回复会保留标记（邮件客户端在主题里保留 `Re: …`），因此轮询器能把
`(session, thread)` 解析回同一个 DSH 会话。映射表持久化在 `state.json`，
即使主题被编辑、标记只存活在摘要里，重启后路由依然有效。

## 前提条件

1. 安装并授权 `agently-cli`（一次即可）：

   ```bash
   npm install -g @tencent-qqmail/agently-cli
   agently-cli auth login        # 交互式 OAuth 授权
   agently-cli +me              # 验证邮箱地址
   ```

2. 把插件安装进某个 profile：

   ```bash
   dsh plugin --profile web add @zt8989/dsh-agentmail
   ```

   任意 profile 名均可（这里以 `web` 为例）；`--profile <name>` 在首次使用时自动
   初始化。如果 CLI 缺失，工具会返回上面的安装提示。

## 打包

发布的包是一个**自包含的单文件 bundle**（`dist/index.js`）：turndown
（HTML→Markdown）在 `prepublishOnly` 阶段经 esbuild 内联，因此运行时**零依赖**。
bundle 在运行时导入 DSH 宿主包（`@deepseek-ai/cordis`、`@deepseek-ai/dsh-llm`、
`@deepseek-ai/dsh-tools`）；它们**有意不声明为 peerDependencies**——从宿主自身的
安装里解析（registry 上的同名包并不相干），声明它们会导致 npm arborist 崩溃。
源码在 `index.js` + `html.js`；`npm run build` 重新生成 bundle。

## 配置

在侧边栏打开 **Plugins**，选中 `@zt8989/dsh-agentmail`，在 `agentmail` 行上点
**配置**。配置页会写入 profile 的 `cordis.patch.yml`；也可以手动写入同样的值：

```yaml
- id: agentmail
  config:
    fallbackSessionId: "session-…"  # 未知会话的兜底会话；留空表示忽略
    pollIntervalMs: 60000           # 0 关闭后台轮询
    routeOnlyFrom: []               # 例如 ["boss@example.com"] 只自动路由这些发件人
    cliPath: agently-cli            # 不在 PATH 上时用绝对路径
    statePath: ""                   # 默认 <DSH_HOME>/agentmail/state.json
    markRead: true                  # 已路由的邮件移出收件箱
```

兜底会话 id 就是会话菜单里复制的那个 id。投递到兜底会话的邮件在正文里标明是
「未知会话」，且不会建立线程绑定：该会话恢复后，它自己的线程依然路由回它自己。

## 说明

- 发送/回复使用 `--confirmed`，不会被交互式确认提示卡住。
- 附件可直接用 CLI 发送；本插件聚焦会话/线程路由工作流。
