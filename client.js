// Browser half: the Agent Mail configuration page.
//
// The page appears twice. Under Settings it is a `settings.section` page that
// reads its values from the client `configForms` service; on the Plugins page it
// is the `agentmail` row's `plugins.row.config` cell, which the plugin manager
// hands a form directly. Both render the same component, and this module owns
// only the staged draft and the labels.
window.__ModuleLoader__.load({
  id: '@zt8989/dsh-agentmail',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    /** Settings namespace of the `agentmail` Loader row. */
    const NS = 'agentmail'
    /** Slot cell key: `<package name>#<row id>` as the bundle patch declares it. */
    const ROW_KEY = '@zt8989/dsh-agentmail#agentmail'
    /** Settings section id and nav label key. */
    const SECTION_ID = 'agentmail'
    /** Page shown before the settings mirror carries the namespace. */
    const PENDING_FORM = Object.freeze({ status: 'loading' })

    const en = {
      summary: 'Routes replies back to their Session; unknown conversations go to a fallback Session or are ignored.',
      sectionLabel: 'Agent Mail',
      routing: 'Routing',
      fallbackLabel: 'Fallback Session for unknown conversations',
      fallbackHint: 'Mail whose conversation matches no live Session is delivered to this Session: any Session this client lists, running or closed. Pick none to ignore such mail.',
      fallbackNone: 'None — ignore unknown conversations',
      fallbackMissing: '(not in this client’s Session list)',
      fallbackCurrent: 'Session id:',
      running: 'running',
      filterLabel: 'Only auto-route these senders',
      filterHint: 'One email address per line. Empty routes every sender.',
      filterPlaceholder: 'boss@example.com',
      delivery: 'Delivery',
      markReadLabel: 'Move routed mail out of the inbox',
      markReadHint: 'Routed messages go to Trash so the poller does not list them again.',
      polling: 'Polling',
      intervalLabel: 'Poll interval (ms)',
      intervalHint: 'Milliseconds between inbox checks. 0 turns the background poller off.',
      intervalInvalid: 'Enter a whole number of milliseconds, or leave empty to use the default.',
      connection: 'Connection',
      cliLabel: 'agently-cli executable',
      cliHint: 'A command on PATH or an absolute path. Leave empty for agently-cli.',
      stateLabel: 'State file',
      stateHint: 'Where thread bindings are stored. Leave empty for <DSH_HOME>/agentmail/state.json.',
      save: 'Save',
      saving: 'Saving…',
      discard: 'Discard changes',
      saved: 'Saved.',
      saveFailed: 'The deployment did not accept these values; they were left for you to correct.',
      loading: 'Loading configuration…',
      unavailable: 'This plugin is not loaded, so it cannot be configured right now.',
      readOnly: 'This deployment stores settings read-only.',
      dirty: 'Unsaved changes',
    }

    const zh = {
      summary: '把回信路由回对应的会话；不认识的会话交给兜底会话，未配置则忽略。',
      sectionLabel: 'Agent 邮箱',
      routing: '路由',
      fallbackLabel: '未知会话的兜底 Session',
      fallbackHint: '来信的会话匹配不到任何活动会话时，投递到选中的 Session；列表里是当前客户端已知的会话，运行中的会在后面标出。选“不指定”则忽略这类来信。',
      fallbackNone: '不指定（忽略未知会话的来信）',
      fallbackMissing: '（不在当前会话列表中）',
      fallbackCurrent: '会话 ID：',
      running: '运行中',
      filterLabel: '只自动路由这些发件人',
      filterHint: '每行一个邮箱地址。留空表示不过滤。',
      filterPlaceholder: 'boss@example.com',
      delivery: '投递',
      markReadLabel: '把已路由的邮件移出收件箱',
      markReadHint: '已路由的邮件会被移入废件箱，轮询器不会再次列出它们。',
      polling: '轮询',
      intervalLabel: '轮询间隔（毫秒）',
      intervalHint: '两次检查收件箱之间的毫秒数，0 表示关闭后台轮询。',
      intervalInvalid: '请填写整数毫秒值；留空表示使用默认值。',
      connection: '连接',
      cliLabel: 'agently-cli 可执行文件',
      cliHint: 'PATH 上的命令名或绝对路径；留空使用 agently-cli。',
      stateLabel: '状态文件',
      stateHint: '线程绑定的存放位置；留空使用 <DSH_HOME>/agentmail/state.json。',
      save: '保存',
      saving: '保存中…',
      discard: '放弃修改',
      saved: '已保存。',
      saveFailed: '部署没有接受这些值，已保留供你修改。',
      loading: '正在读取配置…',
      unavailable: '该插件当前未加载，暂时无法配置。',
      readOnly: '本部署的设置为只读。',
      dirty: '有未保存的修改',
    }

    const CSS = `
      .amail-config { display: flex; flex-direction: column; gap: 20px; color: var(--dsw-alias-label-primary); }
      .amail-config__intro { margin: 0; color: var(--dsw-alias-label-secondary); font-size: 13px; line-height: 20px; }
      .amail-config__section { display: flex; flex-direction: column; gap: 14px; }
      .amail-config__legend { margin: 0; font-size: 14px; font-weight: 500; line-height: 22px; }
      .amail-config__note { color: var(--dsw-alias-label-secondary); margin: 0; font-size: 13px; line-height: 20px; }
      .amail-field { display: flex; flex-direction: column; gap: 6px; }
      .amail-field__label { font-size: 13px; line-height: 20px; }
      .amail-field__hint { color: var(--dsw-alias-label-secondary); margin: 0; font-size: 12px; line-height: 18px; }
      .amail-field__error { color: var(--dsw-alias-state-error-primary); margin: 0; font-size: 12px; line-height: 18px; }
      .amail-select { box-sizing: border-box; width: 100%; height: 36px; border: .5px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-md, 8px); background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); font: inherit; font-size: 13px; padding: 0 10px; outline: none; }
      .amail-select:focus { border-color: var(--dsw-alias-brand-primary); box-shadow: inset 0 0 0 .5px var(--dsw-alias-brand-primary); }
      .amail-select:disabled { opacity: .6; cursor: default; }
      .amail-field__meta { margin: 0; color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; }
      .amail-field__meta code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
      .amail-input, .amail-textarea { box-sizing: border-box; width: 100%; border: .5px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-md, 8px); background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); font: inherit; font-size: 13px; outline: none; padding: 0 12px; }
      .amail-input { height: 36px; }
      .amail-textarea { padding: 8px 12px; line-height: 20px; resize: vertical; min-height: 82px; }
      .amail-input:focus, .amail-textarea:focus { border-color: var(--dsw-alias-brand-primary); box-shadow: inset 0 0 0 .5px var(--dsw-alias-brand-primary); }
      .amail-input:disabled, .amail-textarea:disabled { opacity: .6; cursor: default; }
      .amail-check { display: flex; align-items: flex-start; gap: 10px; }
      .amail-check input { width: 16px; height: 16px; margin: 2px 0 0; flex: none; accent-color: var(--dsw-alias-brand-primary); }
      .amail-check__text { display: flex; flex-direction: column; gap: 2px; }
      .amail-footer { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; border-top: .5px solid var(--dsw-alias-border-l1); padding-top: 14px; }
      .amail-footer__status { flex: 1; min-width: 0; margin: 0; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary); }
      .amail-btn { border-radius: var(--dsw-radius-md, 8px); height: 32px; padding: 0 14px; font: inherit; font-size: 13px; line-height: 20px; cursor: pointer; border: .5px solid var(--dsw-alias-border-l2); background: transparent; color: var(--dsw-alias-label-primary); }
      .amail-btn:hover:not(:disabled) { background: var(--dsw-alias-bg-layer-2); }
      .amail-btn:disabled { opacity: .5; cursor: default; }
      .amail-btn--primary { border-color: transparent; background: var(--dsw-alias-button-primary-fill, var(--dsw-alias-label-primary)); color: var(--dsw-alias-button-primary-foreground, var(--dsw-alias-bg-base)); }
      .amail-btn--primary:hover:not(:disabled) { background: var(--dsw-alias-button-primary-hover, var(--dsw-alias-label-primary)); }
      .amail-btn:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; }
    `

    /**
     * Read one host value in its form representation.
     * @param {object} values namespace values from the settings form.
     * @param {string} field field name.
     * @returns {unknown} the host value, or undefined.
     */
    function valueOf(values, field) {
      return values !== null && typeof values === 'object' ? values[field] : undefined
    }

    /**
     * Sessions offered as the fallback target: everything this client knows,
     * newest first, plus the configured id when the list no longer carries it.
     * @param {object} byId session snapshot by id.
     * @param {string} selected configured session id.
     * @param {(key: string) => string} t translator.
     * @returns {{ id: string, label: string }[]} select options.
     */
    function sessionChoices(byId, selected, t) {
      const rows = byId !== null && typeof byId === 'object' ? Object.values(byId) : []
      const choices = rows
        .filter((row) => row !== null && typeof row === 'object' && typeof row.id === 'string')
        .map((row) => ({
          id: row.id,
          label: row.displayTitle || row.title || row.id,
          running: row.running === true,
          updatedAt: typeof row.updatedAt === 'number' ? row.updatedAt : 0,
        }))
        .sort((a, b) => b.updatedAt - a.updatedAt)
      const value = String(selected || '')
      if (value !== '' && !choices.some((choice) => choice.id === value)) {
        choices.unshift({ id: value, label: `${value} ${t('fallbackMissing')}`, running: false })
      }
      return choices.map((choice) => ({
        id: choice.id,
        label: choice.running ? `${choice.label} · ${t('running')}` : choice.label,
      }))
    }

    /** One labeled text input bound to a namespace field. */
    function TextField(props) {
      const { id, label, hint, extraHint, placeholder, value, disabled, onChange } = props
      return h('div', { className: 'amail-field' },
        h('label', { className: 'amail-field__label', htmlFor: id }, label),
        h('input', {
          id,
          className: 'amail-input',
          type: 'text',
          spellCheck: false,
          autoComplete: 'off',
          placeholder: placeholder || '',
          value,
          disabled,
          onChange: (event) => onChange(event.target.value),
        }),
        hint ? h('p', { className: 'amail-field__hint' }, hint) : null,
        extraHint ? h('p', { className: 'amail-field__hint' }, extraHint) : null,
      )
    }

    /** The page body: staged edits over the Host values, written only on save. */
    function AgentMailConfig(props) {
      const t = props.t
      const form = props.form
      const state = form ? form.state : undefined
      // Optional so the page still renders where the owner passes no session hook.
      const sessionsById = typeof props.useSessions === 'function'
        ? props.useSessions((snapshot) => (snapshot ? snapshot.byId : undefined))
        : undefined
      const [edits, setEdits] = React.useState({})
      const [busy, setBusy] = React.useState(false)
      const [error, setError] = React.useState('')
      const [saved, setSaved] = React.useState(false)

      if (props.view === 'summary') return t('summary')

      if (!form || !state) {
        return h('div', { className: 'amail-config' }, h('p', { className: 'amail-config__note' }, t('unavailable')))
      }
      if (state.status !== 'ready') {
        const message = state.status === 'loading' ? t('loading') : t('unavailable')
        return h('div', { className: 'amail-config' }, h('p', { className: 'amail-config__note' }, message))
      }

      const values = state.value || {}
      const writable = state.writable !== false
      const disabled = !writable || busy
      const dirty = Object.keys(edits).length > 0

      const current = (field) => (Object.prototype.hasOwnProperty.call(edits, field) ? edits[field] : valueOf(values, field))
      const edit = (field, value) => {
        setSaved(false)
        setEdits((previous) => ({ ...previous, [field]: value }))
      }
      const reset = () => {
        setEdits({})
        setError('')
        setSaved(false)
      }

      const intervalRaw = current('pollIntervalMs')
      const intervalText = intervalRaw === undefined || intervalRaw === null ? '' : String(intervalRaw)
      const intervalInvalid = intervalText.trim() !== '' && !/^\d+$/.test(intervalText.trim())
      const fallbackId = String(current('fallbackSessionId') ?? '')
      const fallbackChoices = sessionChoices(sessionsById, fallbackId, t)
      const senders = Array.isArray(current('routeOnlyFrom')) ? current('routeOnlyFrom') : []
      const sendersText = senders.join('\n')
      const markRead = current('markRead') !== false

      const save = async () => {
        if (!writable || busy) return
        if (intervalInvalid) {
          setError(t('intervalInvalid'))
          return
        }
        const ops = []
        const pushUnsetOrSet = (field, value) => {
          if (value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0)) {
            ops.push({ op: 'unset', path: [field] })
          } else {
            ops.push({ op: 'set', path: [field], value })
          }
        }
        for (const [field, value] of Object.entries(edits)) {
          if (field === 'pollIntervalMs') {
            const text = String(value ?? '').trim()
            if (text === '') ops.push({ op: 'unset', path: ['pollIntervalMs'] })
            else ops.push({ op: 'set', path: ['pollIntervalMs'], value: Number(text) })
          } else if (field === 'routeOnlyFrom') {
            const lines = String(value ?? '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
            pushUnsetOrSet('routeOnlyFrom', lines)
          } else if (field === 'markRead') {
            ops.push({ op: 'set', path: ['markRead'], value: value !== false })
          } else {
            pushUnsetOrSet(field, String(value ?? '').trim() === '' ? '' : String(value).trim())
          }
        }
        if (ops.length === 0) return
        setBusy(true)
        setError('')
        try {
          const accepted = await form.mutate(ops, state.revision)
          if (accepted === false) {
            setError(t('saveFailed'))
            return
          }
          setEdits({})
          setSaved(true)
        } catch (cause) {
          setError(cause && cause.message ? String(cause.message) : t('saveFailed'))
        } finally {
          setBusy(false)
        }
      }

      const status = error
        ? h('p', { className: 'amail-footer__status', role: 'alert', style: { color: 'var(--dsw-alias-state-error-primary)' } }, error)
        : saved
          ? h('p', { className: 'amail-footer__status', role: 'status' }, t('saved'))
          : dirty
            ? h('p', { className: 'amail-footer__status', role: 'status' }, t('dirty'))
            : writable ? null : h('p', { className: 'amail-footer__status' }, t('readOnly'))

      return h(React.Fragment, null,
        h('style', { key: 'amail-style' }, CSS),
        h('div', { className: 'amail-config' },
          h('p', { className: 'amail-config__intro' }, t('summary')),

          h('section', { className: 'amail-config__section' },
            h('h4', { className: 'amail-config__legend' }, t('routing')),
            h('div', { className: 'amail-field' },
              h('label', { className: 'amail-field__label', htmlFor: 'amail-fallback' }, t('fallbackLabel')),
              h('select', {
                id: 'amail-fallback',
                className: 'amail-select',
                value: fallbackId,
                disabled,
                onChange: (event) => edit('fallbackSessionId', event.target.value),
              },
                h('option', { value: '' }, t('fallbackNone')),
                fallbackChoices.map((choice) => h('option', { key: choice.id, value: choice.id }, choice.label)),
              ),
              h('p', { className: 'amail-field__hint' }, t('fallbackHint')),
              fallbackId
                ? h('p', { className: 'amail-field__meta' }, t('fallbackCurrent'), h('code', null, fallbackId))
                : null,
            ),
            h('div', { className: 'amail-field' },
              h('label', { className: 'amail-field__label', htmlFor: 'amail-senders' }, t('filterLabel')),
              h('textarea', {
                id: 'amail-senders',
                className: 'amail-textarea',
                rows: 3,
                spellCheck: false,
                placeholder: t('filterPlaceholder'),
                value: sendersText,
                disabled,
                onChange: (event) => edit('routeOnlyFrom', event.target.value),
              }),
              h('p', { className: 'amail-field__hint' }, t('filterHint')),
            ),
          ),

          h('section', { className: 'amail-config__section' },
            h('h4', { className: 'amail-config__legend' }, t('delivery')),
            h('div', { className: 'amail-check' },
              h('input', {
                id: 'amail-mark-read',
                type: 'checkbox',
                checked: markRead,
                disabled,
                onChange: (event) => edit('markRead', event.target.checked),
              }),
              h('div', { className: 'amail-check__text' },
                h('label', { className: 'amail-field__label', htmlFor: 'amail-mark-read' }, t('markReadLabel')),
                h('p', { className: 'amail-field__hint' }, t('markReadHint')),
              ),
            ),
          ),

          h('section', { className: 'amail-config__section' },
            h('h4', { className: 'amail-config__legend' }, t('polling')),
            h('div', { className: 'amail-field' },
              h('label', { className: 'amail-field__label', htmlFor: 'amail-interval' }, t('intervalLabel')),
              h('input', {
                id: 'amail-interval',
                className: 'amail-input',
                type: 'text',
                inputMode: 'numeric',
                placeholder: '60000',
                value: intervalText,
                disabled,
                'aria-invalid': intervalInvalid ? 'true' : undefined,
                onChange: (event) => edit('pollIntervalMs', event.target.value),
              }),
              intervalInvalid
                ? h('p', { className: 'amail-field__error' }, t('intervalInvalid'))
                : h('p', { className: 'amail-field__hint' }, t('intervalHint')),
            ),
          ),

          h('section', { className: 'amail-config__section' },
            h('h4', { className: 'amail-config__legend' }, t('connection')),
            h(TextField, {
              id: 'amail-cli',
              label: t('cliLabel'),
              hint: t('cliHint'),
              placeholder: 'agently-cli',
              value: String(current('cliPath') ?? ''),
              disabled,
              onChange: (next) => edit('cliPath', next),
            }),
            h(TextField, {
              id: 'amail-state',
              label: t('stateLabel'),
              hint: t('stateHint'),
              placeholder: '',
              value: String(current('statePath') ?? ''),
              disabled,
              onChange: (next) => edit('statePath', next),
            }),
          ),

          h('div', { className: 'amail-footer' },
            status,
            h('button', {
              type: 'button',
              className: 'amail-btn',
              disabled: !dirty || busy,
              onClick: reset,
            }, t('discard')),
            h('button', {
              type: 'button',
              className: 'amail-btn amail-btn--primary',
              disabled: disabled || !dirty || intervalInvalid,
              onClick: save,
            }, busy ? t('saving') : t('save')),
          ),
        ),
      )
    }

    /**
     * The Settings page. `settings.section` hands out no form, so the page reads
     * the same namespace through the client `configForms` service the plugin
     * manager itself uses; `formFor` supplies the cached controller.
     */
    function AgentMailSection(props) {
      const form = props.formFor ? props.formFor() : undefined
      const subscribe = React.useCallback(
        (listener) => (form ? form.subscribe(listener) : () => {}),
        [form],
      )
      const read = React.useCallback(
        () => (form ? form.getSnapshot() : PENDING_FORM),
        [form],
      )
      const state = React.useSyncExternalStore(subscribe, read)
      const bound = form
        ? { state, mutate: (ops, revision) => form.mutate(ops, revision) }
        : undefined
      return h(AgentMailConfig, { ...props, view: 'page', form: bound })
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        const t = ctx.locale.bind(NS)
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'agentmail: dictionaries')
        ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section',
          id: SECTION_ID,
          order: 16,
          label: () => t('sectionLabel'),
        }, (props) => h(AgentMailSection, { ...props, t, formFor: () => { const forms = ctx.get('configForms'); return forms ? forms.get(NS) : undefined } })))
        ctx.slots.inject('plugins.row.config', () => ctx.slots.register({
          name: 'plugins.row.config',
          key: ROW_KEY,
          locale: NS,
        }, AgentMailConfig))
      },
    }
  },
})
