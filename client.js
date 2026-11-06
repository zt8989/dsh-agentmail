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

    /** Locale namespace; also the row id the bundle patch declares. */
    const NS = 'agentmail'
    /** Settings namespace a bundle-inserted row gets: the Loader entry id. */
    const ENTRY_NS = 'include:agentmail'
    /** Slot cell key: `<package name>#<row id>` as the bundle patch declares it. */
    const ROW_KEY = '@zt8989/dsh-agentmail#agentmail'
    /** Settings section id and nav label key. */
    const SECTION_ID = 'agentmail'
    /** Page shown before the settings mirror carries the namespace. */
    const PENDING_FORM = Object.freeze({ status: 'loading' })
    /** Page shown when the mirror answered without a namespace for this plugin. */
    const MISSING_FORM = Object.freeze({ status: 'unavailable' })

    const en = {
      summary: 'Routes replies back to their Session; unknown conversations go to a fallback Session or are ignored.',
      sectionLabel: 'Agent Mail',
      routing: 'Routing',
      fallbackLabel: 'Fallback Session for unknown conversations',
      fallbackHint: 'Mail whose conversation matches no live Session is delivered to this Session: any Session this client lists, running or closed. Pick none to ignore such mail.',
      fallbackNone: 'None — ignore unknown conversations',
      searchSessions: 'Search sessions',
      noMatch: 'No session matches.',
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
      searchSessions: '搜索会话',
      noMatch: '没有匹配的会话。',
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
      .amail-picker { position: relative; }
      .amail-picker__trigger { box-sizing: border-box; width: 100%; height: 36px; border: .5px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-md, 8px); background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); font: inherit; font-size: 13px; padding: 0 10px; outline: none; display: flex; align-items: center; justify-content: space-between; gap: 8px; text-align: left; cursor: pointer; }
      .amail-picker__trigger:focus-visible, .amail-picker__trigger[aria-expanded='true'] { border-color: var(--dsw-alias-brand-primary); box-shadow: inset 0 0 0 .5px var(--dsw-alias-brand-primary); }
      .amail-picker__trigger:disabled { opacity: .6; cursor: default; }
      .amail-picker__value { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .amail-picker__value--none { color: var(--dsw-alias-label-secondary); }
      .amail-picker__chev { flex: none; color: var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary)); font-size: 10px; }
      .amail-picker__pop { position: absolute; z-index: 40; left: 0; right: 0; top: calc(100% + 6px); box-sizing: border-box; display: flex; flex-direction: column; gap: 6px; padding: 6px; border: .5px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-md, 8px); background: var(--dsw-alias-bg-layer-2); box-shadow: 0 10px 30px rgb(0 0 0 / 18%); }
      .amail-picker__search { box-sizing: border-box; width: 100%; height: 32px; border: .5px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-sm, 6px); background: var(--dsw-alias-bg-layer-1, transparent); color: var(--dsw-alias-label-primary); font: inherit; font-size: 13px; padding: 0 10px; outline: none; }
      .amail-picker__search:focus { border-color: var(--dsw-alias-brand-primary); }
      .amail-picker__list { margin: 0; padding: 0; list-style: none; max-height: 232px; overflow: auto; }
      .amail-picker__option { display: flex; flex-direction: column; gap: 2px; padding: 7px 8px; border-radius: var(--dsw-radius-sm, 6px); cursor: pointer; }
      .amail-picker__option[data-active='true'], .amail-picker__option:hover { background: var(--dsw-alias-bg-layer-3, rgb(127 127 127 / 12%)); }
      .amail-picker__option[aria-selected='true'] { color: var(--dsw-alias-brand-primary); }
      .amail-picker__option-title { font-size: 13px; line-height: 18px; overflow-wrap: anywhere; }
      .amail-picker__option-meta { color: var(--dsw-alias-label-secondary); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; line-height: 16px; overflow-wrap: anywhere; }
      .amail-picker__empty { padding: 10px 8px; color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; }
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
     * @returns {{ id: string, label: string, meta: string }[]} picker rows.
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
        meta: choice.label === choice.id ? '' : choice.id,
      }))
    }

    /**
     * Rows the picker shows for a query: every session whose title or id
     * contains the text, and the "no fallback" row only while the search is empty.
     * @param {{ id: string, label: string, meta?: string }[]} choices known sessions.
     * @param {string} query raw search text.
     * @param {string} noneLabel label of the clearing row.
     * @returns {{ id: string, label: string, meta?: string }[]} visible rows.
     */
    function filterChoices(choices, query, noneLabel) {
      const needle = String(query || '').trim().toLowerCase()
      if (needle === '') return [{ id: '', label: noneLabel }, ...choices]
      return choices.filter((choice) => `${choice.label} ${choice.id}`.toLowerCase().includes(needle))
    }

    /**
     * A session picker with a search box: a native select cannot be typed into,
     * and this list grows with every Session the client knows.
     * @param {object} props picker inputs.
     * @returns {object} the picker element.
     */
    function SessionPicker(props) {
      const { id, value, choices, noneLabel, searchLabel, noMatchLabel, disabled, onChange } = props
      const openState = React.useState(false)
      const queryState = React.useState('')
      const activeState = React.useState(-1)
      const open = openState[0]
      const query = queryState[0]
      const active = activeState[0]
      const setOpen = openState[1]
      const setQuery = queryState[1]
      const setActive = activeState[1]
      const box = React.useRef(null)
      const search = React.useRef(null)

      const selected = choices.find((choice) => choice.id === value)
      const shown = value === '' ? noneLabel : selected ? selected.label : value
      const rows = filterChoices(choices, query, noneLabel)

      React.useEffect(() => {
        if (!open) return undefined
        if (search.current && typeof search.current.focus === 'function') search.current.focus()
        const onDown = (event) => {
          if (box.current && typeof box.current.contains === 'function' && box.current.contains(event.target)) return
          setOpen(false)
        }
        if (typeof document !== 'undefined') document.addEventListener('mousedown', onDown)
        return () => { if (typeof document !== 'undefined') document.removeEventListener('mousedown', onDown) }
      }, [open, setOpen])

      const close = () => { setOpen(false); setQuery(''); setActive(-1) }
      const choose = (next) => { onChange(next); close() }
      const onSearchKeyDown = (event) => {
        const key = event && event.key
        if (key === 'ArrowDown') {
          event.preventDefault()
          setActive(Math.min(active + 1, rows.length - 1))
        } else if (key === 'ArrowUp') {
          event.preventDefault()
          setActive(Math.max(active - 1, 0))
        } else if (key === 'Enter') {
          event.preventDefault()
          const row = rows[active >= 0 ? active : 0]
          if (row) choose(row.id)
        } else if (key === 'Escape') {
          event.preventDefault()
          close()
        }
      }

      return h('div', { className: 'amail-picker', ref: box },
        h('button', {
          id,
          type: 'button',
          className: 'amail-picker__trigger',
          disabled,
          'aria-haspopup': 'listbox',
          'aria-expanded': open ? 'true' : 'false',
          onClick: () => {
            if (open) close()
            else { setOpen(true); setQuery(''); setActive(-1) }
          },
        },
          h('span', { className: value === '' ? 'amail-picker__value amail-picker__value--none' : 'amail-picker__value' }, shown),
          h('span', { className: 'amail-picker__chev', 'aria-hidden': 'true' }, '▾'),
        ),
        open
          ? h('div', { className: 'amail-picker__pop' },
            h('input', {
              id: `${id}-search`,
              ref: search,
              className: 'amail-picker__search',
              type: 'text',
              autoComplete: 'off',
              spellCheck: false,
              placeholder: searchLabel,
              'aria-label': searchLabel,
              'aria-controls': `${id}-list`,
              value: query,
              onChange: (event) => { setQuery(event.target.value); setActive(-1) },
              onKeyDown: onSearchKeyDown,
            }),
            h('ul', { id: `${id}-list`, className: 'amail-picker__list', role: 'listbox' },
              rows.length === 0
                ? h('li', { className: 'amail-picker__empty' }, noMatchLabel)
                : rows.map((row, index) => h('li', {
                  key: row.id || 'none',
                  id: `${id}-option-${index}`,
                  role: 'option',
                  'data-value': row.id,
                  'data-active': index === active ? 'true' : 'false',
                  'aria-selected': row.id === value ? 'true' : 'false',
                  className: 'amail-picker__option',
                  onClick: () => choose(row.id),
                },
                  h('span', { className: 'amail-picker__option-title' }, row.label),
                  row.meta ? h('span', { className: 'amail-picker__option-meta' }, row.meta) : null,
                )),
            ),
          )
          : null,
      )
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
      // Staged text lives as typed; the Host value is the split array.
      const stagedSenders = current('routeOnlyFrom')
      const sendersText = typeof stagedSenders === 'string'
        ? stagedSenders
        : Array.isArray(stagedSenders) ? stagedSenders.join('\n') : ''
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
              h(SessionPicker, {
                id: 'amail-fallback',
                value: fallbackId,
                choices: fallbackChoices,
                noneLabel: t('fallbackNone'),
                searchLabel: t('searchSessions'),
                noMatchLabel: t('noMatch'),
                disabled,
                onChange: (next) => edit('fallbackSessionId', next),
              }),
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
     * The settings namespace that belongs to this plugin, as the Host names it:
     * the Loader entry id (`include:agentmail`) in the shipped profile.
     * @param {object} view the settings describe view.
     * @returns {string | undefined} the served namespace, or undefined.
     */
    function servedNamespace(view) {
      const list = view !== null && typeof view === 'object' && Array.isArray(view.namespaces) ? view.namespaces : []
      const names = list.map((entry) => (entry === null || typeof entry !== 'object' ? undefined : entry.ns))
        .filter((ns) => typeof ns === 'string')
      return names.find((ns) => ns === ENTRY_NS)
        ?? names.find((ns) => ns === NS)
        ?? names.find((ns) => ns.endsWith(`:${NS}`))
    }

    /**
     * The Settings page. `settings.section` hands out no form, so the page reads
     * the same namespace through the client `configForms` service the plugin
     * manager itself uses; `forms` supplies that service.
     */
    function AgentMailSection(props) {
      const forms = props.forms ? props.forms() : undefined
      const mirror = forms ? forms.describe() : undefined
      const subscribeMirror = React.useCallback(
        (listener) => (mirror ? mirror.subscribe(listener) : () => {}),
        [mirror],
      )
      const readMirror = React.useCallback(
        () => (mirror ? mirror.getSnapshot() : undefined),
        [mirror],
      )
      const describeView = React.useSyncExternalStore(subscribeMirror, readMirror)
      React.useEffect(() => {
        if (mirror) mirror.ensure()
      }, [mirror])
      const ns = servedNamespace(describeView && describeView.view)
      const form = forms && ns !== undefined ? forms.get(ns) : undefined
      const answered = describeView !== undefined && describeView.status !== 'loading'
      const subscribe = React.useCallback(
        (listener) => (form ? form.subscribe(listener) : () => {}),
        [form],
      )
      const read = React.useCallback(
        () => (form ? form.getSnapshot() : answered ? MISSING_FORM : PENDING_FORM),
        [form, answered],
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
        }, (props) => h(AgentMailSection, { ...props, t, forms: () => ctx.get('configForms') })))
        ctx.slots.inject('plugins.row.config', () => ctx.slots.register({
          name: 'plugins.row.config',
          key: ROW_KEY,
          locale: NS,
        }, AgentMailConfig))
      },
    }
  },
})
