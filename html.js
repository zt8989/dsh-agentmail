// html.js — HTML -> markdown rendering for incoming mail bodies.
//
// QQ/Foxmail bodies arrive as raw HTML full of inline styles, quote
// scaffolding, tracking pixels and bot signature blocks. turndown does the
// core rendering; string-level pre/post processing around it removes the
// noise turndown cannot know about:
//   * data-xmail_bot_mail_report signature blocks are removed whole;
//   * quoted replies (border-left bar / mail_quote class) are wrapped into
//     blockquotes so they render as "> " lines;
//   * images become "[图片]" placeholders (tiny icon/tracking pixels drop out,
//     remote mail-image URLs are useless to the model);
//   * blank-href links (Foxmail artifacts) degrade to their text.
import TurndownService from 'turndown'

const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  bulletListMarker: '-',
  emDelimiter: '*',
  strongDelimiter: '**',
  br: '\n',
})

turndown.addRule('mailImage', {
  filter: 'img',
  replacement: (_content, node) => {
    const w = parseFloat(node.getAttribute('width') || '')
    const h = parseFloat(node.getAttribute('height') || '')
    // <=40px images are icons/tracking pixels; drop them silently.
    if (Number.isFinite(w) && w <= 40 && Number.isFinite(h) && h <= 40) return ''
    const alt = (node.getAttribute('alt') || '').trim()
    return alt ? `[图片: ${alt}]` : '[图片]'
  },
})

turndown.addRule('blankHrefLink', {
  filter: (node) => node.nodeName === 'A' && !String(node.getAttribute('href') || '').trim(),
  replacement: (_content, node) => node.textContent || '',
})

turndown.addRule('mailTable', {
  filter: (node) => node.nodeName === 'TABLE',
  replacement: (_content, node) => tableToMarkdown(node),
})

export function htmlToMarkdown(html) {
  let src = String(html || '')
  src = src
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, ' ')
    .replace(/<![^>]*>/g, ' ')
    .replace(/<\?[\s\S]*?\?>/g, ' ')
    .replace(/<(?:script|style|head|title)\b[\s\S]*?<\/\1\s*>/gi, ' ')
  src = removeNoiseBlocks(src)
  src = wrapQuoteDivs(src)

  let md
  try {
    md = turndown.turndown(src)
  } catch (e) {
    // Rendering must never take the mail pipeline down; fall back to text.
    console.error('[dsh-agentmail] html->markdown fallback:', e?.message || e)
    md = String(html || '').replace(/<[^>]*>/g, ' ')
  }
  return md
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function bodyToText(body, format) {
  const raw = String(body || '')
  const fmt = String(format || '').trim().toUpperCase()
  const isHtml = fmt === 'HTML' || (!fmt && LOOKS_LIKE_HTML_RE.test(raw))
  return trimBody(isHtml ? htmlToMarkdown(raw) : raw)
}

function trimBody(body) {
  const text = String(body || '')
  if (text.length <= 12000) return text
  return `${text.slice(0, 12000)}\n\n…[truncated ${text.length - 12000} chars]`
}

// ---------------------------------------------------------------------------
// internals
// ---------------------------------------------------------------------------

// Foxmail/QQ mail mark quoted replies with a left border bar or mail_quote
// classes instead of real <blockquote> elements.
const QUOTE_HINT_RE = /border-left:\s*[^;";]*(?:solid|dashed|dotted|double|groove|ridge)|(?:mail|foxmail)_quote/i

const LOOKS_LIKE_HTML_RE = /<\/?(?:p|div|br|span|table|a|img|body|html|h[1-6])\b/i

/** Find the index range of the </tag> that balances the open tag ending at `from`. */
function balancedRange(src, from, tag) {
  const re = new RegExp(`<(/?)${tag}\\b[^>]*>`, 'gi')
  re.lastIndex = from
  let depth = 1
  for (let m; (m = re.exec(src));) {
    if (m[1]) {
      depth -= 1
      if (depth === 0) return { start: m.index, end: re.lastIndex }
    } else if (!/\/\s*>$/.test(m[0])) {
      depth += 1
    }
  }
  return undefined
}

/** Delete whole blocks whose open <div> carries the bot signature attribute. */
function removeNoiseBlocks(src) {
  const ranges = []
  const re = /<div\b[^>]*data-xmail_bot_mail_report[^>]*>/gi
  for (let m; (m = re.exec(src));) {
    const b = balancedRange(src, m.index + m[0].length, 'div')
    if (b) {
      ranges.push({ start: m.index, end: b.end })
      re.lastIndex = m.index + m[0].length
    }
  }
  // Nested hits are covered by their outer range; drop the inner ones.
  const outer = ranges.filter((r) => !ranges.some((o) => o !== r && o.start <= r.start && r.end <= o.end))
  let out = src
  for (let i = outer.length - 1; i >= 0; i -= 1) {
    out = out.slice(0, outer[i].start) + out.slice(outer[i].end)
  }
  return out
}

/** Turn Foxmail's border-left/mail_quote divs into real blockquotes. */
function wrapQuoteDivs(src) {
  const re = /<div\b([^>]*)>/gi
  const ranges = []
  for (let m; (m = re.exec(src));) {
    if (!QUOTE_HINT_RE.test(m[1])) continue
    const b = balancedRange(src, m.index + m[0].length, 'div')
    if (b) {
      ranges.push({ start: m.index, openLen: m[0].length, closeStart: b.start, closeLen: b.end - b.start, end: b.end })
      re.lastIndex = m.index + m[0].length
    }
  }
  // QQ's reply template wraps one level of quoting in a border-left shell AND
  // a mail_quote shell; skip inner hits contained by an outer one, or the
  // result renders as "> >" double quotes.
  const outer = ranges.filter((r) => !ranges.some((o) => o !== r && o.start <= r.start && r.end <= o.end))
  const edits = []
  for (const r of outer) {
    edits.push({ at: r.start, len: r.openLen, text: '<blockquote>' })
    edits.push({ at: r.closeStart, len: r.closeLen, text: '</blockquote>' })
  }
  edits.sort((a, b) => b.at - a.at)
  let out = src
  for (const e of edits) out = out.slice(0, e.at) + e.text + out.slice(e.at + e.len)
  return out
}

function tableToMarkdown(table) {
  const rows = collectTags(table, 'TR')
  if (rows.length === 0) return ''
  const cellsOf = (tr) => collectTags(tr, 'TH', 'TD')
    .map((td) => (td.textContent || '').replace(/\s+/g, ' ').trim())
  const lines = rows.map((tr) => `| ${cellsOf(tr).join(' | ')} |`)
  // A header separator makes the first row render as a markdown table header.
  if (rows.length > 1) lines.splice(1, 0, `|${' --- |'.repeat(Math.max(cellsOf(rows[0]).length, 1))}`)
  return `\n\n${lines.join('\n')}\n\n`
}

// Turndown wraps nodes without querySelectorAll; walk childNodes instead.
function collectTags(node, ...names) {
  const out = []
  const visit = (n) => {
    for (const child of Array.from(n.childNodes || [])) {
      if (names.includes(child.nodeName)) out.push(child)
      visit(child)
    }
  }
  visit(node)
  return out
}
