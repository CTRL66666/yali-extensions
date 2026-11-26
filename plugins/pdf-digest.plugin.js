/* pdf-digest.plugin.js — PDF 精读提炼 · v2.0.0
 *
 * v1.1 是单视图 277 行：选文件 → 逐页抽字 → AI 提炼 → 看一眼结果。
 * v2.0 按成熟插件形态重造：多视图 shell + 本机文档库 + 自测记录 + 笔记追问 +
 * 有依据的阅读统计 + 历史 + 可导出报告。教练可通过 queries 查同一份数据。
 *
 * 【兼容契约 · 一个都不许改】
 *   · id 'pdf-digest'；VERSION 升到 2.0.0；plugin.desc 原文保留；
 *   · config 的 pages（默认 12，含原 desc）与 kind（考点/公式/例题为主）保留；
 *   · tools[].id / title / icon（自建 MARK_TILE 品牌砖）保留；
 *   · AI 提炼的 sys / usr 提示词口径、ctx.ai.json(sys, usr, { ctx: 'plugin.ai' })
 *     调用签名、ctx.ai.has() 的判断与报错文案原样保留；
 *   · 本地解析桥 window.PdfKit.pick/open/docText 的调用形状原样保留；
 *   · 送教练走 window.Copilot.open({ send: q })，未就绪走 ctx.Toast.show；
 *   · 导出走 ctx.api.download(name, text, mime)，绝不写 ctx.download；
 *   · 能力边界不变：解析全本地、只读文字层、扫描件如实说读不到、AI 失败不冒充成功。
 *
 * 【存储口径 · 有上限】
 *   ctx.data 的 key 全部带 pdf 前缀：pdfDocs / pdfQuiz / pdfNotes / pdfHistory / pdfCfg。
 *   文档最多 MAX_DOCS 份、每份保留的文字层最多 MAX_FEED 字、每份笔记 MAX_NOTES_PER_DOC 条、
 *   自测记录全局 MAX_QUIZ_ATTEMPTS 条、历史 MAX_HISTORY 条。只存本机，不进 Store 主集合。
 */
;(function () {
  'use strict'

  var VERSION = '2.0.0'
  var PID = 'pdf-digest'
  var NS = 'pd-'
  var K_DOCS = 'pdfDocs'
  var K_QUIZ = 'pdfQuiz'
  var K_NOTES = 'pdfNotes'
  var K_HISTORY = 'pdfHistory'
  var K_CFG = 'pdfCfg'
  var K_LAST_VIEW = 'pdfLastView'
  var K_LAST_ID = 'pdfLastDoc'

  var MAX_DOCS = 8                 // 本机最多留几份讲义（超出丢最老的）
  var MAX_HISTORY = 120            // 提炼历史条数
  var MAX_NOTES_PER_DOC = 40       // 每份讲义的笔记上限
  var MAX_QUIZ_ATTEMPTS = 120      // 全局自测作答记录上限
  var MAX_PAGE_ROWS = 60           // 逐页表最多显示多少页
  var MAX_FEED = 20000             // 单次喂给 AI / 本机留存的字数上限（原值不变）
  var MAX_NOTE_LEN = 600           // 单条笔记长度
  var KINDS = ['考点为主', '公式为主', '例题为主']
  var DESC = '本地解析 PDF（不上传）→ 逐页抽文字层 → AI 提炼考点/公式/易错点 + 3 道自测题，可送教练追问、导出 Markdown。'

  /* ---------------- 品牌字形 / 品牌砖（原文保留，let → var） ----------------
   * 页面 + 放大镜（精读提炼）。 MARK_TILE 给导航/工具图标，MARK_INLINE 给页内标题。
   * 渐变 id 带插件前缀 pmMarkG，避免多插件同名 id 抢填充。 */
  var MARK_PATHS = '<path d="M13.5 3.5H5.5a1 1 0 0 0-1 1v15a1 1 0 0 0 1 1h6"/>'
    + '<path d="M7.5 7.5h6M7.5 10.5h4"/>'
    + '<circle cx="15.2" cy="13.2" r="4.3"/>'
    + '<path d="M18.4 16.4L21.5 19.5"/>'
  var MARK_TILE = '<svg viewBox="0 0 48 48" width="1em" height="1em" aria-hidden="true">'
    + '<defs><linearGradient id="pmMarkG" x1="0" y1="0" x2="0" y2="1">'
    + '<stop offset="0" stop-color="#0891B2"/><stop offset="1" stop-color="#1D4ED8"/></linearGradient></defs>'
    + '<rect width="48" height="48" rx="13" fill="url(#pmMarkG)"/>'
    + '<g transform="translate(9.6 9.6) scale(1.2)" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">'
    + MARK_PATHS + '</g></svg>'
  var MARK_INLINE = '<span style="font-size:18px;line-height:1;display:inline-block;vertical-align:-4px;margin-right:5px">' + MARK_TILE + '</span>'

  /* ══════════════ 1. 基础工具（无依赖） ══════════════ */

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
    })
  }
  function num(v, d) { var n = Number(v); return isFinite(n) ? n : (d === undefined ? 0 : d) }
  function clamp(v, a, b, d) { var n = num(v, d === undefined ? a : d); return Math.max(a, Math.min(b, n)) }
  function pad2(n) { return String(n < 10 ? '0' + n : n) }
  function flat(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim() }
  function trunc(s, n) {
    s = flat(s)
    return s.length > n ? s.slice(0, n - 1) + '…' : s
  }
  function dkey(t) {
    var d = t == null ? new Date() : (t instanceof Date ? t : new Date(t))
    if (isNaN(d.getTime())) d = new Date()
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate())
  }
  function fmtTime(t) {
    var d = new Date(num(t, Date.now()))
    if (isNaN(d.getTime())) return '—'
    return dkey(d) + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes())
  }
  function hashStr(s) {
    var h = 5381
    s = String(s)
    for (var i = 0; i < s.length; i++) h = (((h << 5) + h) ^ s.charCodeAt(i)) | 0
    return h >>> 0
  }
  function docId(name, at) {
    return dkey(at).replace(/-/g, '') + '-' + hashStr(name + '|' + at).toString(36)
  }
  /** 图标统一走站内 U.icon，拿不到就退成文字 —— 绝不写原生 emoji */
  function I(key, text) {
    try {
      if (typeof U !== 'undefined' && U && typeof U.icon === 'function') {
        var svg = U.icon(key)
        if (svg) return '<span class="' + NS + 'ic" aria-hidden="true">' + svg + '</span>'
      }
    } catch (e) { /* 沙箱里没有 U 时静默退化 */ }
    return '<span class="' + NS + 'ic" aria-hidden="true">' + esc(text || '·') + '</span>'
  }
  function toast(ctx, msg, level) {
    try { if (ctx && typeof ctx.notify === 'function') ctx.notify({ title: String(msg), level: level || 'info', timeout: 3200 }) }
    catch (e) { }
  }
  function okToContinue(ctx, msg) {
    try { if (ctx.api && typeof ctx.api.confirm === 'function') return !!ctx.api.confirm(msg) }
    catch (e) { }
    return true
  }
  function hasKit() { return !!(typeof window !== 'undefined' && window.PdfKit && typeof window.PdfKit.open === 'function') }
  /** 公式走站内渲染器（不是 Markdown）：AI 输出里的 $...$ / 破损 | 伪转义由它兜 */
  function tex(s) {
    try { return Tex.renderInline(String(s == null ? '' : s)) }
    catch (e) { return esc(s) }
  }
  function errText(e) { return String((e && e.message) || e || '未知错误') }

  /* ══════════════ 2. 配置 / 数据层（ctx.data，有上限） ══════════════ */

  function cfgGet(ctx) {
    var d = { pages: 12, kind: '考点为主', showPanel: true, autoSave: true, keepText: true }
    try { d.pages = clamp(ctx.config('pages'), 1, 200, 12) } catch (e) { }
    try { var k = String(ctx.config('kind') || ''); if (KINDS.indexOf(k) >= 0) d.kind = k } catch (e) { }
    var got = null
    try { got = ctx && typeof ctx.data === 'function' ? ctx.data(K_CFG) : null } catch (e) { }
    if (got && typeof got === 'object') {
      d.showPanel = got.showPanel !== false
      d.autoSave = got.autoSave !== false
      d.keepText = got.keepText !== false
    }
    /* 插件中心的配置优先；ctx.config 在部分环境是只读的，读不到就用本机镜像 */
    try { var a = ctx.config('autoSave'); if (typeof a === 'boolean') d.autoSave = a } catch (e) { }
    try { var t = ctx.config('keepText'); if (typeof t === 'boolean') d.keepText = t } catch (e) { }
    try { var p = ctx.config('showPanel'); if (typeof p === 'boolean') d.showPanel = p } catch (e) { }
    return d
  }
  function cfgLocalSet(ctx, patch) {
    var d = cfgGet(ctx)
    Object.keys(patch || {}).forEach(function (k) { if (k in d) d[k] = patch[k] })
    try { if (ctx && typeof ctx.data === 'function') ctx.data(K_CFG, d) } catch (e) { }
    return d
  }
  function cfgBoolSet(ctx, key, val) {
    cfgOfficialSet(ctx, key, val)
    var patch = {}
    patch[key] = val
    return cfgLocalSet(ctx, patch)
  }
  function cfgOfficialSet(ctx, key, val) {
    try { if (ctx && typeof ctx.config === 'function') ctx.config(key, val) } catch (e) { }
  }

  function normalizeDigest(d) {
    var out = { points: [], formulas: [], traps: [], quiz: [], kindName: '' }
    if (!d || typeof d !== 'object') return out
    function arr(x) { return Array.isArray(x) ? x.filter(function (y) { return y != null && String(y) !== '' }).map(function (y) { return String(y) }) : [] }
    out.points = arr(d.points).slice(0, 12)
    out.formulas = arr(d.formulas).slice(0, 12)
    out.traps = arr(d.traps).slice(0, 12)
    out.quiz = (Array.isArray(d.quiz) ? d.quiz : []).slice(0, 5).map(function (q) {
      return { q: String((q && q.q) || ''), a: String((q && q.a) || '') }
    }).filter(function (q) { return q.q || q.a })
    out.kindName = String(d.kindName || '')
    return out
  }
  function normalizeDoc(x) {
    if (!x || typeof x !== 'object') return null
    var name = flat(x.name) || '未命名 PDF'
    var at = num(x.at, Date.now())
    var pages = Array.isArray(x.pagesMeta) ? x.pagesMeta.slice(0, MAX_PAGE_ROWS).map(function (p) {
      return {
        n: num(p && p.n, 0),
        hasText: !!(p && p.hasText),
        chars: num(p && p.chars),
        prev: flat(p && p.prev).slice(0, 48)
      }
    }) : []
    return {
      id: String(x.id || docId(name, at)),
      name: name,
      at: at,
      pagesCount: clamp(x.pagesCount, 0, 2000, 0),
      chars: num(x.chars),
      emptyPages: (Array.isArray(x.emptyPages) ? x.emptyPages : []).slice(0, 200).map(function (n) { return num(n, 0) }),
      clipped: !!x.clipped,
      text: String(x.text || '').slice(0, MAX_FEED),
      pagesMeta: pages,
      digest: normalizeDigest(x.digest)
    }
  }
  function docsGet(ctx) {
    var raw = null
    try { raw = ctx && typeof ctx.data === 'function' ? ctx.data(K_DOCS) : null } catch (e) { }
    if (!Array.isArray(raw)) return []
    return raw.map(normalizeDoc).filter(Boolean)
      .sort(function (a, b) { return b.at - a.at })
      .slice(0, MAX_DOCS)
  }
  function docsSave(ctx, docs) {
    var out = (docs || []).map(normalizeDoc).filter(Boolean)
      .sort(function (a, b) { return b.at - a.at }).slice(0, MAX_DOCS)
    try { if (ctx && typeof ctx.data === 'function') ctx.data(K_DOCS, out) } catch (e) { }
    return out
  }
  function findDoc(docs, id) {
    var found = null
    ;(docs || []).forEach(function (d) { if (d && d.id === id) found = d })
    return found
  }
  function upsertDoc(ctx, doc) {
    var arr = docsGet(ctx)
    var replaced = false
    for (var i = 0; i < arr.length; i++) {
      if (arr[i].id === doc.id) { arr[i] = doc; replaced = true; break }
    }
    if (!replaced) arr.push(doc)
    return docsSave(ctx, arr)
  }
  function removeDoc(ctx, id) {
    var arr = docsGet(ctx).filter(function (d) { return d.id !== id })
    return docsSave(ctx, arr)
  }

  function quizMapGet(ctx) {
    var raw = null
    try { raw = ctx && typeof ctx.data === 'function' ? ctx.data(K_QUIZ) : null } catch (e) { }
    var out = {}
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out
    var all = []
    Object.keys(raw).forEach(function (k) {
      if (!Array.isArray(raw[k])) return
      out[k] = raw[k].filter(function (a) { return a && typeof a === 'object' }).map(function (a) {
        return { i: num(a.i, 0), ok: !!a.ok, at: num(a.at, Date.now()) }
      })
      out[k].forEach(function (a) { all.push({ k: k, a: a }) })
    })
    if (all.length > MAX_QUIZ_ATTEMPTS) {
      all.sort(function (x, y) { return x.a.at - y.a.at })
      var keep = all.slice(-MAX_QUIZ_ATTEMPTS)
      out = {}
      keep.forEach(function (x) { if (!out[x.k]) out[x.k] = []; out[x.k].push(x.a) })
    }
    return out
  }
  function quizMapSave(ctx, m) {
    try { if (ctx && typeof ctx.data === 'function') ctx.data(K_QUIZ, m || {}) } catch (e) { }
    return m || {}
  }
  function quizAdd(ctx, docId2, idx, ok) {
    var m = quizMapGet(ctx)
    if (!m[docId2]) m[docId2] = []
    m[docId2].push({ i: num(idx, 0), ok: !!ok, at: Date.now() })
    return quizMapSave(ctx, m)
  }
  function quizReset(ctx, docId2) {
    var m = quizMapGet(ctx)
    delete m[docId2]
    return quizMapSave(ctx, m)
  }
  function quizAttemptsOf(m, docId2) { return (m && Array.isArray(m[docId2])) ? m[docId2] : [] }

  function notesMapGet(ctx) {
    var raw = null
    try { raw = ctx && typeof ctx.data === 'function' ? ctx.data(K_NOTES) : null } catch (e) { }
    var out = {}
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out
    Object.keys(raw).forEach(function (k) {
      if (!Array.isArray(raw[k])) return
      out[k] = raw[k].filter(function (n) { return n && typeof n === 'object' }).slice(-MAX_NOTES_PER_DOC).map(function (n) {
        return { id: String(n.id || hashStr(String(n.text) + n.at).toString(36)), text: String(n.text || '').slice(0, MAX_NOTE_LEN), at: num(n.at, Date.now()), kind: String(n.kind || 'note') }
      })
    })
    return out
  }
  function notesMapSave(ctx, m) {
    try { if (ctx && typeof ctx.data === 'function') ctx.data(K_NOTES, m || {}) } catch (e) { }
    return m || {}
  }
  function notesAdd(ctx, docId2, text, kind) {
    var body = flat(text).slice(0, MAX_NOTE_LEN)
    if (!body) return notesMapGet(ctx)
    var m = notesMapGet(ctx)
    if (!m[docId2]) m[docId2] = []
    m[docId2].push({ id: hashStr(body + Date.now()).toString(36), text: body, at: Date.now(), kind: kind || 'note' })
    m[docId2] = m[docId2].slice(-MAX_NOTES_PER_DOC)
    return notesMapSave(ctx, m)
  }
  function notesDel(ctx, docId2, noteId) {
    var m = notesMapGet(ctx)
    if (Array.isArray(m[docId2])) m[docId2] = m[docId2].filter(function (n) { return n.id !== noteId })
    return notesMapSave(ctx, m)
  }
  function notesOf(m, docId2) { return (m && Array.isArray(m[docId2])) ? m[docId2].slice().reverse() : [] }

  function historyGet(ctx) {
    var arr = null
    try { arr = ctx && typeof ctx.data === 'function' ? ctx.data(K_HISTORY) : null } catch (e) { }
    if (!Array.isArray(arr)) return []
    return arr.filter(function (x) { return x && typeof x === 'object' && /^\d{4}-\d{2}-\d{2}$/.test(String(x.day || '')) })
      .map(function (x) {
        return {
          day: x.day, docId: String(x.docId || ''), name: flat(x.name),
          pages: num(x.pages), points: num(x.points), formulas: num(x.formulas),
          traps: num(x.traps), quiz: num(x.quiz), at: num(x.at, Date.now())
        }
      })
      .sort(function (a, b) { return b.at - a.at })
      .slice(0, MAX_HISTORY)
  }
  function historySave(ctx, arr) {
    var out = (arr || []).slice(0, MAX_HISTORY)
    try { if (ctx && typeof ctx.data === 'function') ctx.data(K_HISTORY, out) } catch (e) { }
    return out
  }
  /** 同一份讲义同一天只记一条；重复提炼覆盖当天那条，不把历史撑爆 */
  function recordHistory(ctx, doc) {
    if (!doc || !doc.digest) return historyGet(ctx)
    var arr = historyGet(ctx)
    var day = dkey()
    var d = doc.digest
    var rec = {
      day: day, docId: doc.id, name: doc.name, pages: doc.pagesCount,
      points: d.points.length, formulas: d.formulas.length, traps: d.traps.length,
      quiz: d.quiz.length, at: Date.now()
    }
    var hit = -1
    for (var i = 0; i < arr.length; i++) { if (arr[i].docId === doc.id && arr[i].day === day) { hit = i; break } }
    if (hit >= 0) arr[hit] = rec
    else arr.unshift(rec)
    return historySave(ctx, arr)
  }

  /* ══════════════ 3. 分析层：有依据的阅读统计 ══════════════ */

  /** 所有数字都从本机文档 / 自测记录现算；没有记录就返回 0 + 明确的 null，不编 */
  function statsOf(docs, quiz, hist) {
    var pages = 0, chars = 0, points = 0, formulas = 0, traps = 0, questions = 0, digests = 0
    ;(docs || []).forEach(function (d) {
      pages += d.pagesCount
      chars += d.chars
      var g = d.digest || {}
      points += (g.points || []).length
      formulas += (g.formulas || []).length
      traps += (g.traps || []).length
      questions += (g.quiz || []).length
      if ((g.points || []).length || (g.formulas || []).length || (g.traps || []).length) digests++
    })
    var tries = 0, rights = 0, perDoc = {}
    Object.keys(quiz || {}).forEach(function (k) {
      var arr = quiz[k] || []
      perDoc[k] = arr.length
      arr.forEach(function (a) { tries++; if (a.ok) rights++ })
    })
    return {
      docs: (docs || []).length, pages: pages, chars: chars,
      points: points, formulas: formulas, traps: traps, questions: questions,
      digests: digests, tries: tries, rights: rights,
      accuracy: tries ? Math.round(rights / tries * 100) : null,
      perDoc: perDoc, history: (hist || []).length
    }
  }
  /** 判断必须带证据数字；数据不够就明说，不写"加油"这类空话 */
  function insightsOf(S) {
    var out = []
    var st = S.stats
    var c = S.cfg
    if (!st.docs) {
      out.push({ level: 'info', title: '还没有解析过讲义', body: '选一份带文字层的 PDF，先本机解析再提炼；这一步不需要 AI。' })
      return out
    }
    out.push({ level: 'info', title: '本机已留存 ' + st.docs + ' 份讲义',
      body: '累计解析 ' + st.pages + ' 页、' + st.chars + ' 字（留存取前 ' + MAX_FEED + ' 字/份）。文件不出设备。' })
    if (st.digests) {
      out.push({ level: 'good', title: '已提炼 ' + st.digests + ' 份讲义',
        body: '共 ' + st.points + ' 个考点、' + st.formulas + ' 条公式、' + st.traps + ' 个易错点，' + st.questions + ' 道自测题。侧重：' + c.kind + '。' })
    } else {
      out.push({ level: 'warn', title: '有文字层，但还没提炼',
        body: '解析结果已在本机。配好 AI 后点「AI 提炼」；提炼失败不会拿空结果冒充成功。' })
    }
    if (st.tries) {
      out.push({ level: 'info', title: '自测已作答 ' + st.tries + ' 次',
        body: '正确 ' + st.rights + ' 次，正确率 ' + st.accuracy + '%。这是点过"我答对/答错"的记录，不是估算。' })
    } else {
      out.push({ level: 'info', title: '自测还没有作答记录',
        body: '题目已生成，但正确率不能靠猜。做完点一下"我答对了/答错了"才会统计。' })
    }
    if (S.cur && S.cur.emptyPages && S.cur.emptyPages.length) {
      out.push({ level: 'warn', title: '当前讲义有 ' + S.cur.emptyPages.length + ' 页没有文字层',
        body: '这些页读不到内容，也不会编。想读图版请走「题核析鉴」或拍照识别。' })
    }
    if (S.history && S.history.length) {
      out.push({ level: 'info', title: '提炼历史 ' + S.history.length + ' 条',
        body: '同一份讲义同一天只记一条，可在「历史」导出 JSON 留存。' })
    }
    return out.slice(0, 6)
  }

  /* ══════════════ 4. 样式（完整设计层，含夜间与窄屏） ══════════════ */

  var CSS = [
    '.' + NS + 'page{display:flex;flex-direction:column;gap:12px;max-width:1180px;margin:0 auto}',
    '.' + NS + 'hero{border-radius:14px;padding:17px 19px;background:var(--glass-bg);border:1px solid var(--line);position:relative;overflow:hidden}',
    '.' + NS + 'hero:after{content:"";position:absolute;right:-40px;top:-60px;width:180px;height:180px;border-radius:50%;background:radial-gradient(circle,var(--accent-text),transparent 70%);opacity:.1;pointer-events:none}',
    '.' + NS + 'hero h3{margin:0 0 6px;font-size:16px;display:flex;align-items:center;gap:8px}',
    '.' + NS + 'hero p{margin:0;color:var(--text-secondary);font-size:12.5px;line-height:1.75}',
    '.' + NS + 'tabs{display:flex;gap:6px;flex-wrap:wrap;border-bottom:1px solid var(--line);padding-bottom:8px}',
    '.' + NS + 'tab{border:1px solid var(--line);background:transparent;color:var(--text-secondary);border-radius:9px;padding:6px 13px;font-size:12px;cursor:pointer;transition:.16s}',
    '.' + NS + 'tab:hover{border-color:var(--accent-text);color:var(--text-primary)}',
    '.' + NS + 'tab.on{background:var(--accent-text);border-color:var(--accent-text);color:var(--btn-text,#fff)}',
    '.' + NS + 'kpis{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:9px}',
    '.' + NS + 'kpi{border:1px solid var(--line);border-radius:11px;padding:11px 12px;background:var(--glass-bg);min-width:0}',
    '.' + NS + 'kpi b{display:block;font-size:19px;line-height:1.35;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.' + NS + 'kpi span{font-size:11px;color:var(--text-secondary)}',
    '.' + NS + 'kpi i{font-style:normal;font-size:10px;margin-left:4px;color:var(--text-secondary)}',
    '.' + NS + 'card{border:1px solid var(--line);border-radius:12px;padding:14px 16px;background:var(--glass-bg)}',
    '.' + NS + 'card h4{margin:0 0 10px;font-size:13.5px;display:flex;align-items:center;gap:7px}',
    '.' + NS + 'card-hd{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:10px;flex-wrap:wrap}',
    '.' + NS + 'card-hd h4{margin:0}',
    '.' + NS + 'grid2{display:grid;grid-template-columns:1fr 1fr;gap:12px}',
    '.' + NS + 'row{display:flex;justify-content:space-between;align-items:center;gap:8px;font-size:12px;padding:8px 0;border-bottom:1px dashed var(--line)}',
    '.' + NS + 'row:last-child{border-bottom:0}',
    '.' + NS + 'row span{color:var(--text-secondary);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.' + NS + 'row b{white-space:nowrap}',
    '.' + NS + 'note{display:flex;gap:9px;padding:9px 11px;border-radius:10px;margin-bottom:8px;border-left:3px solid var(--line);background:var(--glass-bg);font-size:12px;line-height:1.7}',
    '.' + NS + 'note.warn{border-left-color:var(--danger,#d9534f)}',
    '.' + NS + 'note.good{border-left-color:var(--ok,#2e9e5b)}',
    '.' + NS + 'note.info{border-left-color:var(--blue)}',
    '.' + NS + 'note b{display:block;font-size:12.5px;margin-bottom:2px}',
    '.' + NS + 'empty{color:var(--text-secondary);font-size:12px;line-height:1.8;padding:12px 0;text-align:center}',
    '.' + NS + 'acts{display:flex;gap:7px;flex-wrap:wrap;margin-top:10px}',
    '.' + NS + 'btn{border:1px solid var(--line);background:var(--glass-bg);color:var(--text-primary);border-radius:8px;padding:6px 12px;font-size:11.5px;cursor:pointer;transition:.15s}',
    '.' + NS + 'btn:hover{border-color:var(--accent-text);color:var(--accent-text)}',
    '.' + NS + 'btn.pri{background:var(--accent-text);border-color:var(--accent-text);color:var(--btn-text,#fff)}',
    '.' + NS + 'btn.mini{padding:3px 8px;font-size:11px}',
    '.' + NS + 'btn:disabled{opacity:.45;cursor:not-allowed}',
    '.' + NS + 'field{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:9px 0;border-bottom:1px dashed var(--line);font-size:12px}',
    '.' + NS + 'field:last-child{border-bottom:0}',
    '.' + NS + 'field label{color:var(--text-secondary)}',
    '.' + NS + 'field select,.pd-field input{border:1px solid var(--line);border-radius:8px;background:var(--bg-muted,var(--glass-bg));color:var(--text-primary);padding:5px 9px;font-size:12px}',
    '.' + NS + 'ic{display:inline-flex;align-items:center;justify-content:center;width:15px;height:15px;vertical-align:-2px}',
    '.' + NS + 'ic svg{width:15px;height:15px;fill:none;stroke:currentColor;stroke-width:1.8}',
    '.' + NS + 'doc{display:flex;gap:10px;align-items:flex-start;padding:10px 0;border-bottom:1px dashed var(--line)}',
    '.' + NS + 'doc:last-child{border-bottom:0}',
    '.' + NS + 'doc.on{background:linear-gradient(90deg,rgba(8,145,178,.08),transparent);border-radius:9px;padding-left:8px}',
    '.' + NS + 'doc-main{flex:1;min-width:0}',
    '.' + NS + 'doc-name{font-size:13px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.' + NS + 'doc-meta{font-size:11px;color:var(--text-secondary);margin-top:3px}',
    '.' + NS + 'badge{display:inline-block;border:1px solid var(--line);border-radius:99px;padding:1px 7px;font-size:10px;color:var(--text-secondary);margin-right:5px}',
    '.' + NS + 'badge.ok{border-color:var(--ok,#2e9e5b);color:var(--ok,#2e9e5b)}',
    '.' + NS + 'sec{margin-top:10px}',
    '.' + NS + 'sec b{font-size:12.5px}',
    '.' + NS + 'sec ul{margin:5px 0 0;padding-left:18px;font-size:12.5px;line-height:1.85}',
    '.' + NS + 'sec li{margin-bottom:3px}',
    '.' + NS + 'q{padding:9px 0;border-bottom:1px dashed var(--line)}',
    '.' + NS + 'q:last-child{border-bottom:0}',
    '.' + NS + 'q-t{font-size:13px;line-height:1.7}',
    '.' + NS + 'q-a{margin-top:5px;font-size:12px;opacity:.9;line-height:1.75}',
    '.' + NS + 'q-a summary{cursor:pointer;color:var(--accent-text);font-size:11.5px}',
    '.' + NS + 'txt{width:100%;min-height:72px;box-sizing:border-box;border:1px solid var(--line);border-radius:9px;background:var(--bg-muted,var(--glass-bg));color:var(--text-primary);padding:8px 10px;font-size:12.5px;line-height:1.7;resize:vertical}',
    '.' + NS + 'prog{height:8px;border-radius:99px;background:var(--line);overflow:hidden;margin:6px 0 2px}',
    '.' + NS + 'prog i{display:block;height:100%;border-radius:99px;background:var(--accent-text)}',
    '.' + NS + 'table{width:100%;border-collapse:collapse;font-size:12px}',
    '.' + NS + 'table th{text-align:left;color:var(--text-secondary);font-weight:500;padding:7px 8px;border-bottom:1px solid var(--line);font-size:11px}',
    '.' + NS + 'table td{padding:7px 8px;border-bottom:1px dashed var(--line)}',
    '.' + NS + 'table tr:last-child td{border-bottom:0}',
    '.' + NS + 'panel{padding:10px 12px;font-size:12px;line-height:1.7}',
    '.' + NS + 'panel-hd{display:flex;justify-content:space-between;align-items:center;gap:6px;margin-bottom:7px}',
    '.' + NS + 'spark{display:flex;align-items:flex-end;gap:3px;height:26px;margin-top:7px}',
    '.' + NS + 'spark i{flex:1;background:var(--accent-text);opacity:.7;border-radius:2px 2px 0 0;min-height:2px}',
    '@media(max-width:820px){.' + NS + 'kpis{grid-template-columns:repeat(2,1fr)}.' + NS + 'grid2{grid-template-columns:1fr}}',
    'html[data-theme="night"] .' + NS + 'note.good{border-left-color:#6ddc9a}'
  ].join('\n')

  function style(ctx) {
    try { if (ctx && ctx.css && typeof ctx.css.add === 'function') ctx.css.add(CSS, 'skin') } catch (e) { }
  }

  /* ══════════════ 5. 复用片段（逐页表 / 提炼块 / 自测块） ══════════════ */

  function statStrip(S) {
    var st = S.stats
    var cells = [
      ['讲义', String(st.docs), '本机留存'],
      ['解析页', String(st.pages), '累计'],
      ['考点', String(st.points), '提炼'],
      ['公式', String(st.formulas), '提炼'],
      ['自测', st.accuracy == null ? '—' : st.accuracy + '%', st.tries ? st.tries + ' 次作答' : '未作答']
    ]
    return '<div class="' + NS + 'kpis">' + cells.map(function (x) {
      return '<div class="' + NS + 'kpi"><b>' + esc(x[1]) + '</b><span>' + esc(x[0])
        + (x[2] ? '<i>' + esc(x[2]) + '</i>' : '') + '</span></div>'
    }).join('') + '</div>'
  }
  function pageRows(doc) {
    if (!doc || !doc.pagesMeta || !doc.pagesMeta.length) return ''
    var rows = ''
    for (var i = 0; i < doc.pagesMeta.length; i++) {
      var p = doc.pagesMeta[i]
      rows += '<div style="display:flex;gap:8px;align-items:baseline;padding:4px 0;border-bottom:1px solid var(--line)">'
        + '<span style="flex:0 0 62px;font-size:12px;opacity:.75">第 ' + p.n + ' 页</span>'
        + '<span style="flex:0 0 62px;font-size:12px">' + (p.hasText ? p.chars + ' 字' : '无文字层') + '</span>'
        + '<span style="flex:1;font-size:12px;opacity:.85;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'
        + (p.prev ? esc(p.prev) : '—') + '</span></div>'
    }
    var more = doc.pagesCount > doc.pagesMeta.length
      ? '<p class="muted-sm" style="font-size:11px">仅列前 ' + doc.pagesMeta.length + ' 页，本次共读 ' + doc.pagesCount + ' 页。</p>' : ''
    return '<section class="' + NS + 'card" style="margin-top:12px"><h4>' + I('fileText', '页')
      + ' 逐页文字层（' + doc.pagesMeta.length + ' 页）</h4>' + rows + more + '</section>'
  }
  function blockList(title, arr, useTex) {
    if (!arr || !arr.length) return ''
    var h = ''
    for (var i = 0; i < arr.length; i++) h += '<li>' + (useTex ? tex(arr[i]) : esc(arr[i])) + '</li>'
    return '<div class="' + NS + 'sec"><b>' + esc(title) + '（' + arr.length + '）</b><ul>' + h + '</ul></div>'
  }
  function digestBlocks(doc) {
    if (!doc || !doc.digest) return ''
    var d = doc.digest
    return '<section class="' + NS + 'card"><div class="' + NS + 'card-hd"><h4>'
      + I('cpBrain', '炼') + ' 提炼结果 · ' + esc(d.kindName || '考点为主') + '</h4>'
      + '<span class="muted-sm" style="font-size:11px">' + esc(fmtTime(doc.at)) + '</span></div>'
      + blockList('核心考点', d.points, false)
      + blockList('关键公式', d.formulas, true)
      + blockList('易错点', d.traps, false)
      + '</section>'
  }
  function quizBlock(doc, S, limit) {
    if (!doc || !doc.digest || !doc.digest.quiz || !doc.digest.quiz.length) {
      return '<section class="' + NS + 'card"><h4>自测题</h4><div class="' + NS + 'empty">'
        + '还没有题目。先在本机解析讲义，再点「AI 提炼」。</div></section>'
    }
    var arr = doc.digest.quiz
    var n = limit ? Math.min(limit, arr.length) : arr.length
    var log = quizAttemptsOf(S.quiz, doc.id)
    var items = ''
    for (var i = 0; i < n; i++) {
      var q = arr[i] || {}
      var mine = log.filter(function (a) { return a.i === i })
      var mark = mine.length
        ? '<span class="' + NS + 'badge' + (mine[mine.length - 1].ok ? ' ok' : '') + '">'
          + (mine[mine.length - 1].ok ? '已答对' : '答错过') + '</span>' : ''
      items += '<div class="' + NS + 'q">'
        + '<div class="' + NS + 'q-t">' + (i + 1) + '. ' + tex(q.q) + ' ' + mark + '</div>'
        + '<details class="' + NS + 'q-a"><summary>看参考答案（先自己写）</summary><div>' + tex(q.a) + '</div></details>'
        + '<div class="' + NS + 'acts" style="margin-top:6px">'
        + '<button class="' + NS + 'btn mini" data-act="quiz-right" data-v="' + i + '">我答对了</button>'
        + '<button class="' + NS + 'btn mini" data-act="quiz-wrong" data-v="' + i + '">答错了</button>'
        + '</div></div>'
    }
    var tries = log.length
    var rights = log.filter(function (a) { return a.ok }).length
    var acc = tries ? rights + '/' + tries + '（' + Math.round(rights / tries * 100) + '%）' : '还没有作答记录，正确率无法计算'
    return '<section class="' + NS + 'card"><div class="' + NS + 'card-hd"><h4>'
      + I('listCheck', '测') + ' 自测（共 ' + arr.length + ' 道，由易到难）</h4>'
      + '<span class="muted-sm" style="font-size:11px">这份讲义正确率：' + esc(acc) + '</span></div>'
      + items
      + '<div class="' + NS + 'acts"><button class="' + NS + 'btn" data-act="quiz-reset">清空这份作答记录</button>'
      + '<button class="' + NS + 'btn" data-act="ask">把错题送教练</button></div></section>'
  }
  function noteBlock(doc, S) {
    var list = notesOf(S.notes, doc ? doc.id : '')
    var items = list.length ? list.map(function (n) {
      return '<div class="' + NS + 'row"><span title="' + esc(n.text) + '">'
        + '<span class="' + NS + 'badge">' + esc(n.kind === 'ask' ? '追问' : '笔记') + '</span>'
        + esc(n.text) + '</span><span style="display:flex;gap:6px;align-items:center">'
        + '<span class="muted-sm" style="font-size:10.5px">' + esc(fmtTime(n.at)) + '</span>'
        + '<button class="' + NS + 'btn mini" data-act="note-del" data-v="' + esc(n.id) + '">删</button></span></div>'
    }).join('') : '<div class="' + NS + 'empty">还没有笔记。读到有疑问的地方随手记一条，之后可整段送教练。</div>'
    return '<section class="' + NS + 'card"><h4>' + I('noteText', '记') + ' 笔记与追问</h4>'
      + '<textarea class="' + NS + 'txt" data-act="note-input" placeholder="记下没看懂的地方，或想追问教练的问题（最多 '
      + MAX_NOTE_LEN + ' 字）"></textarea>'
      + '<div class="' + NS + 'acts"><button class="' + NS + 'btn pri" data-act="note-add">记下来</button>'
      + '<button class="' + NS + 'btn" data-act="note-ask" data-v="explain">让教练讲这个考点</button>'
      + '<button class="' + NS + 'btn" data-act="note-ask" data-v="quiz">让教练再出两道</button>'
      + '<button class="' + NS + 'btn" data-act="note-ask" data-v="plain">用自己的话总结</button></div>'
      + '<div style="margin-top:10px">' + items + '</div></section>'
  }

  /* ══════════════ 6. 视图（六个） ══════════════ */

  function viewDocs(ctx, S) {
    var out = []
    out.push('<section class="' + NS + 'hero"><h3>' + MARK_INLINE + ' PDF 精读提炼</h3>'
      + '<p>PDF 在本机解析（pdf.js + 独立 worker），文件不会上传、不联网；只读文字层。'
      + '提炼侧重：<b>' + esc(S.cfg.kind) + '</b> · 单次最多读 <b>' + S.cfg.pages + '</b> 页。'
      + '当前留存 <b>' + S.stats.docs + '</b>/' + MAX_DOCS + ' 份。</p></section>')
    out.push('<div class="' + NS + 'acts" style="margin-top:0"><button class="' + NS + 'btn pri" data-act="pick">'
      + I('fileText', '选') + ' 选择 PDF</button>'
      + '<button class="' + NS + 'btn" data-act="digest"' + (S.cur && S.cur.text ? '' : ' disabled') + '>AI 提炼</button>'
      + '<button class="' + NS + 'btn" data-act="export-md"' + (S.cur && S.cur.digest ? '' : ' disabled') + '>导出 Markdown</button>'
      + '<button class="' + NS + 'btn" data-act="export-json">导出 JSON</button>'
      + '<button class="' + NS + 'btn" data-act="ask"' + (S.cur && S.cur.digest ? '' : ' disabled') + '>送教练追问</button></div>')
    if (S.err) out.push('<div class="' + NS + 'note warn"><div>' + esc(S.err) + '</div></div>')
    if (S.busy) out.push('<div class="' + NS + 'note info"><div>' + esc(S.note || '处理中…') + '</div></div>')
    out.push(statStrip(S))
    if (!hasKit()) {
      out.push('<section class="' + NS + 'card"><div class="' + NS + 'note warn"><div>'
        + '当前版本没有 window.PdfKit（PDF 本地解析能力未注册）。请更新到含 pdfPluginBridge 的版本后重试。</div></div></section>')
      return out.join('')
    }
    out.push('<section class="' + NS + 'card"><div class="' + NS + 'card-hd"><h4>'
      + I('books', '库') + ' 本机讲义库</h4><span class="muted-sm" style="font-size:11px">'
      + '按最近解析排序 · 点标题切换</span></div>')
    if (!S.docs.length) {
      out.push('<div class="' + NS + 'empty">还没有讲义。点「选择 PDF」开始：先本机抽文字层，再让 AI 提炼。</div>')
    } else {
      S.docs.forEach(function (d) {
        var g = d.digest
        var on = S.cur && d.id === S.cur.id
        out.push('<div class="' + NS + 'doc' + (on ? ' on' : '') + '">'
          + '<div class="' + NS + 'doc-main"><div class="' + NS + 'doc-name">'
          + '<button class="' + NS + 'btn mini" data-act="doc-open" data-v="' + esc(d.id) + '">' + esc(d.name) + '</button>'
          + (on ? ' <span class="' + NS + 'badge ok">当前</span>' : '') + '</div>'
          + '<div class="' + NS + 'doc-meta">' + esc(fmtTime(d.at)) + ' · ' + d.pagesCount + ' 页 · ' + d.chars + ' 字'
          + (g ? ' · 考点 ' + g.points.length + ' / 公式 ' + g.formulas.length + ' / 易错 ' + g.traps.length : ' · 未提炼')
          + (d.emptyPages.length ? ' · ' + d.emptyPages.length + ' 页无文字层' : '')
          + (d.clipped ? ' · 已截断至 ' + MAX_FEED + ' 字' : '') + '</div></div>'
          + '<button class="' + NS + 'btn mini" data-act="doc-del" data-v="' + esc(d.id) + '">删</button></div>')
      })
    }
    out.push('</section>')
    if (S.cur && S.cur.emptyPages.length && !S.busy) {
      out.push('<div class="' + NS + 'note warn"><div>第 ' + S.cur.emptyPages.slice(0, 12).join('、')
        + (S.cur.emptyPages.length > 12 ? ' 等' : '') + ' 页抽不到文字（扫描件/图片版）。'
        + '这几页的内容我读不到，也不会猜 —— 想读图版请用「题核析鉴」或拍照识别。</div></div>')
    }
    out.push('<section class="' + NS + 'card"><h4>' + I('cpBrain', '判') + ' 从数据里读出的判断</h4>'
      + S.insights.map(function (x) {
        return '<div class="' + NS + 'note ' + esc(x.level) + '"><div><b>' + esc(x.title) + '</b>' + esc(x.body) + '</div></div>'
      }).join('') + '</section>')
    return out.join('')
  }

  function viewDigest(ctx, S) {
    var out = []
    if (!S.cur) {
      out.push('<section class="' + NS + 'card"><h4>解析结果</h4><div class="' + NS + 'empty">'
        + '还没有选讲义。先到「文档」页选一份带文字层的 PDF。</div></section>')
      return out.join('')
    }
    out.push('<section class="' + NS + 'hero"><h3>' + I('cpBrain', '炼') + ' 解析结果 · ' + esc(S.cur.name) + '</h3>'
      + '<p>本机解析 ' + S.cur.pagesCount + ' 页 / ' + S.cur.chars + ' 字'
      + (S.cur.clipped ? '（已截断到 ' + MAX_FEED + ' 字喂 AI）' : '')
      + '，提炼侧重 ' + esc(S.cfg.kind) + '。所有内容来自这份讲义的文字层。</p></section>')
    if (S.busy) out.push('<div class="' + NS + 'note info"><div>' + esc(S.note || '处理中…') + '</div></div>')
    if (S.err) out.push('<div class="' + NS + 'note warn"><div>' + esc(S.err) + '</div></div>')
    if (!S.cur.digest) {
      out.push('<section class="' + NS + 'card"><div class="' + NS + 'empty">这份讲义还没提炼。'
        + '配好 AI 后点下面的按钮；PDF 解析本身不需要 AI。</div>'
        + '<div class="' + NS + 'acts"><button class="' + NS + 'btn pri" data-act="digest">AI 提炼</button>'
        + '<button class="' + NS + 'btn" data-act="tab" data-v="docs">回文档页</button></div></section>')
    } else {
      out.push(digestBlocks(S.cur))
      out.push('<div class="' + NS + 'acts"><button class="' + NS + 'btn" data-act="export-md">导出 Markdown</button>'
        + '<button class="' + NS + 'btn" data-act="ask">送教练追问</button>'
        + '<button class="' + NS + 'btn" data-act="tab" data-v="quiz">去做自测</button></div>')
    }
    out.push(pageRows(S.cur))
    return out.join('')
  }

  function viewQuiz(ctx, S) {
    var out = []
    if (!S.cur) {
      out.push('<section class="' + NS + 'card"><div class="' + NS + 'empty">还没有讲义，先去「文档」页选一份 PDF。</div></section>')
      return out.join('')
    }
    out.push('<section class="' + NS + 'hero"><h3>' + I('listCheck', '测') + ' 自测题 · ' + esc(S.cur.name) + '</h3>'
      + '<p>先自己写，再展开答案；每道题都点一下"我答对了/答错了"，正确率才会被统计。'
      + '当前讲义累计作答 <b>' + quizAttemptsOf(S.quiz, S.cur.id).length + '</b> 次。</p></section>')
    out.push(quizBlock(S.cur, S, 0))
    out.push('<section class="' + NS + 'card"><h4>统计口径</h4>'
      + '<p style="font-size:12px;line-height:1.8;color:var(--text-secondary);margin:0">'
      + '正确率 = 你点过的"我答对"次数 / 总作答次数，只统计点过按钮的题，未作答不按猜的算。'
      + '自测作答记录全机最多 ' + MAX_QUIZ_ATTEMPTS + ' 条，超出丢最老的。</p></section>')
    return out.join('')
  }

  function viewNotes(ctx, S) {
    var out = []
    out.push('<section class="' + NS + 'hero"><h3>' + I('noteText', '记') + ' 笔记与追问</h3>'
      + '<p>笔记只存本机。追问会把当前讲义的提炼摘要和你的问题一起发给教练（走站内 Copilot），'
      + '不会把整份 PDF 上传。</p></section>')
    if (!S.cur) {
      out.push('<section class="' + NS + 'card"><div class="' + NS + 'empty">还没有讲义，先去「文档」页选一份 PDF。</div></section>')
      return out.join('')
    }
    out.push('<section class="' + NS + 'card"><div class="' + NS + 'card-hd"><h4>当前讲义</h4>'
      + '<span class="muted-sm" style="font-size:11px">' + esc(S.cur.name) + '</span></div>'
      + (S.cur.digest && S.cur.digest.points.length
        ? '<div class="' + NS + 'sec"><b>已提炼考点（追问时会带上前 2 条）</b><ul>'
          + S.cur.digest.points.slice(0, 2).map(function (p) { return '<li>' + esc(p) + '</li>' }).join('') + '</ul></div>'
        : '<div class="' + NS + 'empty">这份讲义还没提炼，追问时只能带文件名。</div>')
      + '</section>')
    out.push(noteBlock(S.cur, S))
    return out.join('')
  }

  function viewHistory(ctx, S) {
    var out = []
    out.push('<section class="' + NS + 'card"><div class="' + NS + 'card-hd"><h4>'
      + I('history', '史') + ' 提炼历史（同一讲义同一天一条）</h4>'
      + '<span class="' + NS + 'acts" style="margin:0">'
      + '<button class="' + NS + 'btn" data-act="export-md">导出报告</button>'
      + '<button class="' + NS + 'btn" data-act="export-json">导出 JSON</button>'
      + '<button class="' + NS + 'btn" data-act="clear-history">清空历史</button></span></div>')
    if (!S.hist.length) {
      out.push('<div class="' + NS + 'empty">还没有提炼历史。每次 AI 提炼成功后会自动记一条。</div>')
    } else {
      out.push('<table class="' + NS + 'table"><thead><tr><th>日期</th><th>讲义</th><th>页</th><th>考点</th><th>公式</th><th>自测</th></tr></thead><tbody>')
      S.hist.slice(0, 60).forEach(function (r) {
        out.push('<tr><td>' + esc(r.day) + '</td><td>' + esc(trunc(r.name, 28)) + '</td><td>' + r.pages
          + '</td><td>' + r.points + '</td><td>' + r.formulas + '</td><td>' + r.quiz + '</td></tr>')
      })
      out.push('</tbody></table>')
      if (S.hist.length > 60) out.push('<p class="muted-sm" style="font-size:11px">仅显示最近 60 条，导出的 JSON 里是全部 ' + S.hist.length + ' 条。</p>')
    }
    out.push('</section>')
    out.push('<section class="' + NS + 'card"><h4>数据管理</h4>'
      + '<p style="font-size:12px;line-height:1.8;color:var(--text-secondary);margin:0">'
      + '本机留存 ' + S.stats.docs + '/' + MAX_DOCS + ' 份讲义、' + S.stats.history + ' 条历史、'
      + '笔记 ' + Object.keys(S.notes).length + ' 组、作答 ' + S.stats.tries + ' 次。'
      + '清空讲义会同时删掉对应笔记与作答记录，不能撤销 —— 建议先导出 JSON。</p>'
      + '<div class="' + NS + 'acts"><button class="' + NS + 'btn" data-act="clear-all">清空全部讲义数据</button></div></section>')
    return out.join('')
  }

  function viewConfig(ctx, S) {
    var c = S.cfg
    var out = []
    out.push('<section class="' + NS + 'card"><h4>' + I('settings', '设') + ' 提炼设置</h4>'
      + '<div class="' + NS + 'field"><label>单次最多读几页</label>'
      + '<input type="number" min="1" max="200" step="1" value="' + c.pages + '" data-act="cfg-pages" style="width:82px"></div>'
      + '<div class="' + NS + 'field"><label>提炼侧重</label><select data-act="cfg-kind">'
      + KINDS.map(function (k) { return '<option value="' + esc(k) + '"' + (c.kind === k ? ' selected' : '') + '>' + esc(k) + '</option>' }).join('')
      + '</select></div>'
      + '<p class="muted-sm" style="font-size:11.5px;line-height:1.8">'
      + '这两项与插件中心配置同一份（ctx.config）。大讲义先读前 N 页（默认 12；全书请分次读）。</p></section>')
    out.push('<section class="' + NS + 'card"><h4>本机行为</h4>'
      + '<div class="' + NS + 'field"><label>解析后自动存入本机讲义库</label>'
      + '<button class="' + NS + 'btn' + (c.autoSave ? ' pri' : '') + '" data-act="cfg-auto">' + (c.autoSave ? '已开启' : '已关闭') + '</button></div>'
      + '<div class="' + NS + 'field"><label>留存文字层原文（便于重新提炼）</label>'
      + '<button class="' + NS + 'btn' + (c.keepText ? ' pri' : '') + '" data-act="cfg-text">' + (c.keepText ? '留存' : '不留存') + '</button></div>'
      + '<div class="' + NS + 'field"><label>显示常驻摘要面板</label>'
      + '<button class="' + NS + 'btn' + (c.showPanel ? ' pri' : '') + '" data-act="cfg-panel">' + (c.showPanel ? '显示' : '隐藏') + '</button></div>'
      + '</section>')
    out.push('<section class="' + NS + 'card"><h4>数据与隐私</h4>'
      + '<p style="font-size:12px;line-height:1.8;color:var(--text-secondary);margin:0">'
      + '解析完全在本机（window.PdfKit → pdf.js + 独立 worker）。文字层最多留 ' + MAX_FEED + ' 字/份，'
      + '讲义最多 ' + MAX_DOCS + ' 份、笔记最多 ' + MAX_NOTES_PER_DOC + ' 条/份、历史最多 ' + MAX_HISTORY + ' 条。'
      + 'AI 提炼只在点按钮后把截取的文字层发给已配置的 AI 接口；解析本身不联网。'
      + 'AI 失败会原样报错，不会拿空结果冒充成功。</p></section>')
    return out.join('')
  }

  var VIEWS = [
    { k: 'docs', t: '文档', f: viewDocs },
    { k: 'digest', t: '解析结果', f: viewDigest },
    { k: 'quiz', t: '自测题', f: viewQuiz },
    { k: 'notes', t: '笔记与追问', f: viewNotes },
    { k: 'history', t: '历史', f: viewHistory },
    { k: 'config', t: '设置', f: viewConfig },
  ]

  /* ══════════════ 7. Shell：状态 + 事件委托 ══════════════ */

  function stateOf(ctx) {
    var cfg = cfgGet(ctx)
    var docs = docsGet(ctx)
    var quiz = quizMapGet(ctx)
    var notes = notesMapGet(ctx)
    var hist = historyGet(ctx)
    var lastId = ''
    var v = 'docs'
    try { lastId = ctx.keep.get(K_LAST_ID) || '' } catch (e) { }
    try { v = ctx.keep.get(K_LAST_VIEW) || v } catch (e) { }
    var cur = findDoc(docs, lastId) || (docs.length ? docs[0] : null)
    return {
      cfg: cfg, docs: docs, quiz: quiz, notes: notes, hist: hist,
      cur: cur, curId: cur ? cur.id : '',
      view: VIEWS.some(function (x) { return x.k === v }) ? v : 'docs',
      stats: statsOf(docs, quiz, hist),
      insights: [], busy: false, note: '', err: ''
    }
  }
  function refresh(ctx, S) {
    S.cfg = cfgGet(ctx)
    S.docs = docsGet(ctx)
    S.quiz = quizMapGet(ctx)
    S.notes = notesMapGet(ctx)
    S.hist = historyGet(ctx)
    S.stats = statsOf(S.docs, S.quiz, S.hist)
    S.cur = findDoc(S.docs, S.curId) || (S.docs.length ? S.docs[0] : null)
    S.curId = S.cur ? S.cur.id : ''
    S.insights = insightsOf(S)
  }
  function setView(ctx, S, v) {
    if (!VIEWS.some(function (x) { return x.k === v })) return
    S.view = v
    try { if (ctx.keep && typeof ctx.keep.set === 'function') ctx.keep.set(K_LAST_VIEW, v) } catch (e) { }
  }
  function render(root, ctx, S) {
    if (!root) return
    S.insights = insightsOf(S)
    var header = '<div class="' + NS + 'tabs" role="tablist">'
      + VIEWS.map(function (v) {
        return '<button class="' + NS + 'tab' + (S.view === v.k ? ' on' : '') + '" data-act="tab" data-v="' + v.k
          + '" role="tab" aria-selected="' + (S.view === v.k ? 'true' : 'false') + '">' + esc(v.t) + '</button>'
      }).join('') + '</div>'
    var cur = VIEWS.filter(function (v) { return v.k === S.view })[0] || VIEWS[0]
    var body = ''
    try { body = cur.f(ctx, S) } catch (e) { body = '<div class="' + NS + 'empty">这个视图渲染失败了：' + esc(errText(e)) + '</div>' }
    root.innerHTML = '<div class="' + NS + 'page">' + header + body + '</div>'
  }

  /* ---------------- 核心流程：本地解析 / AI 提炼 / 导出 / 送教练 ---------------- */

  function pickPdf(ctx, S, root) {
    if (S.busy) return
    window.PdfKit.pick().then(function (f) {
      return readAll(ctx, S, root, f)
    }).catch(function (e) {
      var m = errText(e)
      if (m.indexOf('未选择文件') >= 0) return   // 用户取消 → 静默
      S.err = '打开 PDF 失败：' + m
      S.busy = false
      render(root, ctx, S)
    })
  }
  function readAll(ctx, S, root, f) {
    S.busy = true; S.err = ''; S.note = '正在本地解析《' + f.name + '》…'; S.note2 = ''
    render(root, ctx, S)
    var p = window.PdfKit.open(f.data)
    return p.then(function (doc) {
      var maxPages = clamp(ctx.config('pages'), 1, 200, 12)
      S.note = '共 ' + doc.numPages + ' 页，读取前 ' + Math.min(maxPages, doc.numPages) + ' 页…'
      render(root, ctx, S)
      return window.PdfKit.docText(doc, {
        to: maxPages,
        onPage: function (pg, done, total) {
          S.note = '抽取文字层 ' + done + '/' + total + ' 页…'
          render(root, ctx, S)
        }
      }).then(function (r) {
        try { if (doc && doc.destroy) doc.destroy() } catch (e) { }
        return r
      })
    }).then(function (r) {
      var full = String((r && r.text) || '')
      var clipped = full.length > MAX_FEED
      var text = cfgGet(ctx).keepText ? (clipped ? full.slice(0, MAX_FEED) : full) : ''
      var pagesMeta = (r && Array.isArray(r.pages) ? r.pages : []).slice(0, MAX_PAGE_ROWS).map(function (pg) {
        var t = String((pg && pg.text) || '')
        return { n: num(pg && pg.n, 0), hasText: !!t.trim(), chars: t.length, prev: flat(t).slice(0, 48) }
      })
      var docObj = {
        id: docId(f.name, Date.now()),
        name: flat(f.name) || '未命名 PDF',
        at: Date.now(),
        pagesCount: (r && Array.isArray(r.pages)) ? r.pages.length : 0,
        chars: full.length,
        emptyPages: (r && Array.isArray(r.emptyPages)) ? r.emptyPages : [],
        clipped: clipped,
        text: text,
        pagesMeta: pagesMeta,
        digest: null
      }
      if (cfgGet(ctx).autoSave) {
        S.docs = upsertDoc(ctx, docObj)
      } else {
        S.docs = docsGet(ctx).concat([docObj]).sort(function (a, b) { return b.at - a.at }).slice(0, MAX_DOCS)
      }
      S.curId = docObj.id
      S.cur = findDoc(S.docs, docObj.id)
      S.busy = false; S.note = ''
      if (!full.replace(/\s/g, '').length) {
        S.err = '这份 PDF 的文字层是空的（扫描件/图片版）。可以换一份带文字层的 PDF，或用「题核析鉴 / 拍照」读图版页面。'
      }
      try { if (ctx.keep && typeof ctx.keep.set === 'function') ctx.keep.set(K_LAST_ID, docObj.id) } catch (e) { }
      refresh(ctx, S)
      render(root, ctx, S)
    }).catch(function (e) {
      S.busy = false
      S.err = '解析失败：' + errText(e)
      render(root, ctx, S)
    })
  }
  function digest(ctx, S, root) {
    if (S.busy || !S.cur || !S.cur.text) return
    if (!ctx.ai.has()) {
      S.err = '还没配置 AI：去「设置 → AI 接口」填好后再点提炼（PDF 解析本身不需要 AI）。'
      render(root, ctx, S); return
    }
    var cur = S.cur
    S.busy = true; S.err = ''; S.note = 'AI 正在读这 ' + cur.pagesCount + ' 页…'
    render(root, ctx, S)
    var kind = String(ctx.config('kind') || '考点为主')
    /* ★ 以下 sys / usr 提示词口径与 v1.1 原文逐字一致，不许改写 */
    var sys = '你是考研讲义精读助手。只输出 JSON 本身，不要前言、不要后记。数学公式一律用 $...$ 包裹。'
      + '文字来自 PDF 文字层，公式可能是带 ^{} _{} 的近似转写 —— 遇到残缺的记号按语义补齐，但不要编造原文没有的内容。'
    var usr = '下面是讲义《' + cur.name + '》第 1-' + cur.pagesCount + ' 页的文字层内容：\n\n' + cur.text
      + '\n\n请按「' + kind + '」的侧重提炼，只输出 JSON：'
      + '{"points":["核心考点，≤6 条，每条≤40字"],"formulas":["关键公式，≤6 条，用 $...$"],"traps":["易错点，≤5 条"],'
      + '"quiz":[{"q":"一道自测题","a":"参考答案与关键步骤"}]}'
      + '。要求：quiz 给 3 道、由易到难；points/formulas/traps 里只写这份讲义**真实出现**的内容，原文没有就少写几条，不许凑数。'
    ctx.ai.json(sys, usr, { ctx: 'plugin.ai' }).then(function (r) {
      var d = (r && typeof r === 'object') ? r : {}
      d.points = Array.isArray(d.points) ? d.points : []
      d.formulas = Array.isArray(d.formulas) ? d.formulas : []
      d.traps = Array.isArray(d.traps) ? d.traps : []
      d.quiz = Array.isArray(d.quiz) ? d.quiz.slice(0, 5) : []
      d.kindName = kind
      if (!d.points.length && !d.formulas.length && !d.traps.length) {
        S.busy = false
        S.err = 'AI 这次没给出可用的提炼结果（返回结构不完整）。可以再点一次「AI 提炼」，或先「送教练追问」看它怎么读。'
        render(root, ctx, S)
        return
      }
      cur.digest = normalizeDigest(d)
      S.docs = upsertDoc(ctx, cur)
      S.cur = findDoc(S.docs, cur.id)
      S.curId = cur.id
      S.hist = recordHistory(ctx, S.cur)
      S.busy = false; S.note = ''
      ctx.log('PDF 精读：' + cur.name + ' → 考点 ' + d.points.length + ' / 公式 ' + d.formulas.length + ' / 易错 ' + d.traps.length)
      refresh(ctx, S)
      render(root, ctx, S)
    }).catch(function (e) {
      S.busy = false
      S.err = 'AI 提炼失败：' + errText(e) + '（PDF 已解析好，问题出在 AI 接口）'
      render(root, ctx, S)
    })
  }

  function docMd(doc, withText) {
    var out = '# ' + (doc ? doc.name : 'PDF') + ' · 精读提炼\n\n'
    if (!doc) return out
    if (doc.pagesCount) out += '> 本地解析：' + doc.pagesCount + ' 页 · ' + doc.chars + ' 字'
      + (doc.emptyPages.length ? ' · 无文字层页 ' + doc.emptyPages.join('、') : '')
      + (doc.clipped ? ' · 已截断到 ' + MAX_FEED + ' 字喂 AI' : '') + '\n\n'
    var d = doc.digest
    if (d) {
      function lines(title, arr) {
        if (!arr || !arr.length) return ''
        return '## ' + title + '\n' + arr.map(function (x) { return '- ' + x }).join('\n') + '\n\n'
      }
      out += lines('核心考点', d.points)
      out += lines('关键公式', d.formulas)
      out += lines('易错点', d.traps)
      if (d.quiz && d.quiz.length) {
        out += '## 自测\n' + d.quiz.map(function (q, i) {
          return (i + 1) + '. ' + q.q + '\n   - 答案：' + q.a
        }).join('\n') + '\n\n'
      }
    }
    if (withText && doc.text) out += '## 原文（文字层，前 ' + doc.text.length + ' 字）\n\n' + doc.text
    return out
  }
  function reportMd(ctx, S) {
    var out = ['# PDF 精读 · 本机报告', '', '> 生成时间：' + new Date().toLocaleString(),
      '> 讲义 ' + S.stats.docs + ' 份 · 解析 ' + S.stats.pages + ' 页 · 提炼 ' + S.stats.digests + ' 份', '']
    out.push('## 阅读统计')
    out.push('')
    out.push('- 本机讲义：' + S.stats.docs + ' 份（上限 ' + MAX_DOCS + '）')
    out.push('- 累计解析：' + S.stats.pages + ' 页 / ' + S.stats.chars + ' 字')
    out.push('- 提炼结果：' + S.stats.points + ' 考点 / ' + S.stats.formulas + ' 公式 / ' + S.stats.traps + ' 易错点 / ' + S.stats.questions + ' 自测题')
    out.push('- 自测作答：' + S.stats.tries + ' 次' + (S.stats.accuracy == null ? '（还没有作答记录，正确率无法计算）' : '，正确率 ' + S.stats.accuracy + '%'))
    out.push('')
    S.docs.forEach(function (d) {
      out.push('---', '')
      out.push(docMd(d, false))
    })
    if (S.hist.length) {
      out.push('## 提炼历史', '')
      out.push('| 日期 | 讲义 | 页 | 考点 | 公式 | 易错 | 自测 |')
      out.push('|---|---|---|---|---|---|---|')
      S.hist.forEach(function (r) {
        out.push('| ' + r.day + ' | ' + r.name.replace(/\|/g, '\\|') + ' | ' + r.pages + ' | ' + r.points
          + ' | ' + r.formulas + ' | ' + r.traps + ' | ' + r.quiz + ' |')
      })
    }
    return out.join('\n')
  }
  function reportJson(ctx, S) {
    return JSON.stringify({
      plugin: PID, version: VERSION, exportedAt: new Date().toISOString(),
      limits: { docs: MAX_DOCS, feed: MAX_FEED, history: MAX_HISTORY, notes: MAX_NOTES_PER_DOC, quiz: MAX_QUIZ_ATTEMPTS },
      stats: S.stats, docs: S.docs, quiz: S.quiz, notes: S.notes, history: S.hist
    }, null, 2)
  }
  function exportMd(ctx, S) {
    if (!S.cur || !S.cur.digest) return
    ctx.api.download('PDF精读-' + S.cur.name.replace(/\.pdf$/i, '') + '.md', docMd(S.cur, true), 'text/markdown;charset=utf-8')
    toast(ctx, '已导出《' + S.cur.name + '》的提炼笔记', 'success')
  }
  function exportReport(ctx, S) {
    ctx.api.download('PDF精读_报告_' + dkey() + '.md', reportMd(ctx, S), 'text/markdown;charset=utf-8')
    toast(ctx, '报告已导出', 'success')
  }
  function exportJson(ctx, S) {
    ctx.api.download('PDF精读_数据_' + dkey() + '.json', reportJson(ctx, S), 'application/json')
    toast(ctx, '已导出 ' + S.stats.docs + ' 份讲义数据', 'success')
  }
  function askCoach(ctx, S) {
    if (!S.cur || !S.cur.digest) return
    var d = S.cur.digest
    var first = (d.points && d.points[0]) || ''
    var q = '我刚用「PDF 精读」读了讲义《' + S.cur.name + '》前 ' + S.cur.pagesCount + ' 页，提炼出的第一个考点是：' + first
      + '。别急着讲答案，先问我一个能检验我是否真懂的问题；我答完你再指出我漏了什么。'
    if (window.Copilot && typeof window.Copilot.open === 'function') {
      window.Copilot.open({ send: q })
    } else {
      ctx.Toast.show('教练面板还没就绪，稍后再试', 'warn', 2500)
    }
  }
  function askNote(ctx, S, kind) {
    if (!S.cur) return
    var input = null
    try { input = document.querySelector('.' + NS + 'txt[data-act="note-input"]') } catch (e) { }
    var text = flat(input && input.value ? input.value : '')
    var d = S.cur.digest
    var head = '我在读讲义《' + S.cur.name + '》（本机解析 ' + S.cur.pagesCount + ' 页）。'
    if (d && d.points.length) head += '已提炼的考点有：' + d.points.slice(0, 2).join('；') + '。'
    var ask = ''
    if (kind === 'explain') ask = '请用考研复习的口径讲清楚我最困惑的地方：' + (text || '上面第一个考点') + '。先诊断我卡在哪一步，再讲。'
    else if (kind === 'quiz') ask = '围绕这些考点，再给我出 2 道比原来更难的自测题，先别给答案。'
    else ask = '请用你自己的话，把这些考点压缩成 3 条我能背下来的结论。' + (text ? '我特别想弄明白：' + text : '')
    var q = head + ask
    if (window.Copilot && typeof window.Copilot.open === 'function') {
      window.Copilot.open({ send: q })
      if (input) input.value = ''
    } else {
      ctx.Toast.show('教练面板还没就绪，稍后再试', 'warn', 2500)
    }
  }

  function doAct(ctx, S, root, act, v) {
    if (act === 'tab') { setView(ctx, S, v); render(root, ctx, S); return }
    if (act === 'pick') { pickPdf(ctx, S, root); return }
    if (act === 'digest') { digest(ctx, S, root); return }
    if (act === 'export-md') {
      if (S.view === 'history') exportReport(ctx, S)
      else exportMd(ctx, S)
      return
    }
    if (act === 'export-json') { exportJson(ctx, S); return }
    if (act === 'ask') { askCoach(ctx, S); return }
    if (act === 'doc-open') {
      S.curId = v
      S.cur = findDoc(S.docs, v)
      try { if (ctx.keep && typeof ctx.keep.set === 'function') ctx.keep.set(K_LAST_ID, v) } catch (e) { }
      S.err = ''
      render(root, ctx, S)
      return
    }
    if (act === 'doc-del') {
      var d = findDoc(S.docs, v)
      if (!d) return
      if (!okToContinue(ctx, '删除《' + d.name + '》及它的笔记/作答记录？不能撤销。')) return
      var m = quizMapGet(ctx); delete m[v]; quizMapSave(ctx, m)
      var n = notesMapGet(ctx); delete n[v]; notesMapSave(ctx, n)
      S.docs = removeDoc(ctx, v)
      if (S.curId === v) { S.cur = S.docs.length ? S.docs[0] : null; S.curId = S.cur ? S.cur.id : '' }
      refresh(ctx, S)
      toast(ctx, '已删除讲义', 'info')
      render(root, ctx, S)
      return
    }
    if (act === 'quiz-right' || act === 'quiz-wrong') {
      if (!S.cur) return
      S.quiz = quizAdd(ctx, S.cur.id, num(v, 0), act === 'quiz-right')
      refresh(ctx, S)
      render(root, ctx, S)
      return
    }
    if (act === 'quiz-reset') {
      if (!S.cur) return
      if (!okToContinue(ctx, '清空这份讲义的自测作答记录？')) return
      S.quiz = quizReset(ctx, S.cur.id)
      refresh(ctx, S)
      render(root, ctx, S)
      return
    }
    if (act === 'note-add') {
      if (!S.cur) return
      var input = null
      try { input = root.querySelector('.' + NS + 'txt[data-act="note-input"]') } catch (e) { }
      var text = input ? input.value : ''
      if (!flat(text)) { toast(ctx, '先写点什么再记下来', 'info'); return }
      S.notes = notesAdd(ctx, S.cur.id, text, 'note')
      refresh(ctx, S)
      render(root, ctx, S)
      return
    }
    if (act === 'note-ask') { askNote(ctx, S, v); return }
    if (act === 'note-del') {
      if (!S.cur) return
      S.notes = notesDel(ctx, S.cur.id, v)
      refresh(ctx, S)
      render(root, ctx, S)
      return
    }
    if (act === 'cfg-pages' || act === 'cfg-kind') return
    if (act === 'cfg-auto') { S.cfg = cfgLocalSet(ctx, { autoSave: !S.cfg.autoSave }); render(root, ctx, S); return }
    if (act === 'cfg-text') { S.cfg = cfgLocalSet(ctx, { keepText: !S.cfg.keepText }); render(root, ctx, S); return }
    if (act === 'cfg-panel') { S.cfg = cfgLocalSet(ctx, { showPanel: !S.cfg.showPanel }); render(root, ctx, S); return }
    if (act === 'clear-history') {
      if (!okToContinue(ctx, '清空 ' + S.hist.length + ' 条提炼历史？不能撤销。')) return
      S.hist = historySave(ctx, [])
      refresh(ctx, S)
      toast(ctx, '历史已清空', 'info')
      render(root, ctx, S)
      return
    }
    if (act === 'clear-all') {
      if (!okToContinue(ctx, '清空全部讲义、笔记、自测与历史？不能撤销，建议先导出 JSON。')) return
      try {
        if (ctx && typeof ctx.data === 'function') {
          ctx.data(K_DOCS, []); ctx.data(K_QUIZ, {}); ctx.data(K_NOTES, {}); ctx.data(K_HISTORY, [])
        }
      } catch (e) { }
      S.cur = null; S.curId = ''
      refresh(ctx, S)
      toast(ctx, '本机讲义数据已清空', 'info')
      render(root, ctx, S)
      return
    }
  }

  function mount(el, ctx) {
    style(ctx)
    var S = stateOf(ctx)
    render(el, ctx, S)
    var onClick = function (ev) {
      var t = ev.target
      for (var i = 0; i < 5 && t && t !== el; i++, t = t.parentElement) {
        var act = t.getAttribute && t.getAttribute('data-act')
        if (!act) continue
        if (act === 'note-input') return
        ev.preventDefault()
        doAct(ctx, S, el, act, t.getAttribute('data-v'))
        return
      }
    }
    var onChange = function (ev) {
      var t = ev.target
      if (!t || !t.getAttribute) return
      var act = t.getAttribute('data-act')
      if (act === 'cfg-pages') {
        var n = clamp(t.value, 1, 200, 12)
        cfgOfficialSet(ctx, 'pages', n)
        S.cfg.pages = n
        render(el, ctx, S)
      } else if (act === 'cfg-kind') {
        var k = String(t.value || '')
        if (KINDS.indexOf(k) < 0) return
        cfgOfficialSet(ctx, 'kind', k)
        S.cfg.kind = k
        render(el, ctx, S)
      }
    }
    el.addEventListener('click', onClick)
    el.addEventListener('change', onChange)
    return function () {
      el.removeEventListener('click', onClick)
      el.removeEventListener('change', onChange)
      el.innerHTML = ''
    }
  }

  /* ══════════════ 8. 面板：最近一份文档的提炼摘要 ══════════════ */

  function panel(ctx) {
    style(ctx)
    var cfg = cfgGet(ctx)
    if (!cfg.showPanel) return ''
    var docs = docsGet(ctx)
    var st = statsOf(docs, quizMapGet(ctx), historyGet(ctx))
    var d = docs.length ? docs[0] : null
    var header = '<div class="' + NS + 'panel"><div class="' + NS + 'panel-hd">'
      + '<span>' + MARK_INLINE + ' PDF 精读摘要</span>'
      + '<span class="muted-sm" style="font-size:11px">' + st.docs + '/' + MAX_DOCS + ' 份</span></div>'
    if (!d) {
      return header + '<div class="' + NS + 'empty">还没有解析过讲义。文件在本机处理，不上传。</div></div>'
    }
    var g = d.digest
    var body = '<div style="font-size:12px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'
      + esc(d.name) + '</div>'
      + '<div class="muted-sm" style="font-size:11px;margin:2px 0 6px">' + d.pagesCount + ' 页 · ' + d.chars + ' 字 · '
      + esc(fmtTime(d.at)) + '</div>'
    if (g && g.points.length) {
      body += '<div style="font-size:11.5px;line-height:1.7">'
        + g.points.slice(0, 2).map(function (p) { return '· ' + esc(trunc(p, 42)) }).join('<br>')
        + '</div>'
    } else {
      body += '<div class="muted-sm" style="font-size:11.5px">还没提炼；解析结果已在本机。</div>'
    }
    body += '<div style="margin-top:6px;font-size:11px">考点 ' + (g ? g.points.length : 0)
      + ' · 公式 ' + (g ? g.formulas.length : 0) + ' · 自测 ' + (g ? g.quiz.length : 0)
      + (st.tries ? ' · 正确率 ' + st.accuracy + '%' : ' · 正确率暂无记录') + '</div>'
    var spark = historyGet(ctx).slice(0, 12).reverse().map(function (r) {
      return '<i style="height:' + Math.max(2, Math.min(24, r.points * 4)) + 'px" title="' + esc(r.day + ' · ' + r.name) + '"></i>'
    }).join('')
    if (spark) body += '<div class="' + NS + 'spark">' + spark + '</div>'
    return header + body + '</div>'
  }

  /* ══════════════ 9. api：tools / panels / config / queries / hooks / memory ══════════════ */

  var api = {
    id: PID,
    name: 'PDF 精读提炼',
    version: VERSION,
    author: '内置',
    desc: DESC,
    tools: [{
      id: 'pdf-digest',
      title: 'PDF 精读',
      icon: MARK_TILE,
      mount: function (el, ctx) { return mount(el, ctx) }
    }],
    init: function (ctx) { style(ctx) },
    shortcuts: [{
      key: 'alt+p', label: '打开 PDF 精读',
      run: function (ctx) { try { if (ctx && ctx.api && ctx.api.goTool) ctx.api.goTool('pdf-digest') } catch (e) { } }
    }],
    panels: [{
      id: 'pd-summary', title: 'PDF 精读摘要', icon: MARK_TILE, width: 300, height: 210,
      render: panel
    }],
    config: [
      /* ★ 原 config 契约：key / label / type / options / default / desc 全部保留 */
      { key: 'pages', label: '单次最多读几页', type: 'number', default: 12, desc: '大讲义先读前 N 页（默认 12；全书请分次读）' },
      { key: 'kind', label: '提炼侧重', type: 'select', options: ['考点为主', '公式为主', '例题为主'], default: '考点为主' },
      { key: 'autoSave', label: '解析后自动存入本机讲义库', type: 'bool', default: true },
      { key: 'keepText', label: '留存文字层原文便于重新提炼', type: 'bool', default: true },
      { key: 'showPanel', label: '显示常驻摘要面板', type: 'bool', default: true },
    ],
    hooks: {
      /* 宿主若在别的入口触发提炼完成，可回调这个 hook 补记历史（按讲义+日去重） */
      pdfDigestDone: function (ctx, payload) {
        try {
          if (!payload || !payload.docId) return
          var d = findDoc(docsGet(ctx), payload.docId)
          if (d) recordHistory(ctx, d)
        } catch (e) { }
      },
    },
    queries: [
      {
        key: 'pdf-read', label: '我读过哪些讲义',
        run: function (ctx) {
          var docs = docsGet(ctx)
          if (!docs.length) return '本机还没有解析过讲义。PDF 精读在本机解析、不上传；选一份带文字层的 PDF 后才会留下记录。'
          return '本机已解析 ' + docs.length + ' 份讲义：' + docs.slice(0, 8).map(function (d, i) {
            return (i + 1) + '）' + d.name + '（' + d.pagesCount + ' 页，' + d.chars + ' 字'
              + (d.digest ? '，已提炼' : '，未提炼') + '）'
          }).join('；') + '。' + (docs.length > 8 ? '另外还有 ' + (docs.length - 8) + ' 份。' : '')
        }
      },
      {
        key: 'pdf-points', label: '从讲义里提炼出哪些考点',
        run: function (ctx) {
          var docs = docsGet(ctx)
          var st = statsOf(docs, quizMapGet(ctx), historyGet(ctx))
          if (!st.digests) return '还没有提炼结果。' + (docs.length ? '讲义已在本机解析，配好 AI 后点「AI 提炼」即可；提炼失败会原样报错。' : '先选一份带文字层的 PDF。')
          var pts = []
          docs.forEach(function (d) {
            ;(d.digest.points || []).slice(0, 3).forEach(function (p) { pts.push(d.name + '：' + p) })
          })
          return '已从 ' + st.digests + ' 份讲义提炼出 ' + st.points + ' 个考点、' + st.formulas + ' 条公式、'
            + st.traps + ' 个易错点。前几条：' + pts.slice(0, 8).join('；') + '。'
            + (pts.length > 8 ? '共 ' + pts.length + ' 条，完整清单见插件页「解析结果」。' : '')
        }
      },
      {
        key: 'pdf-quiz', label: 'PDF 自测做得怎么样',
        run: function (ctx) {
          var st = statsOf(docsGet(ctx), quizMapGet(ctx), historyGet(ctx))
          if (!st.questions) return '还没有生成自测题。先本机解析讲义并点「AI 提炼」。'
          if (!st.tries) return '已生成 ' + st.questions + ' 道自测题，但还没有作答记录 —— 正确率不能靠猜。做完点一下「我答对了 / 答错了」。'
          return '自测共 ' + st.questions + ' 道题，已作答 ' + st.tries + ' 次，答对 ' + st.rights
            + ' 次，正确率 ' + st.accuracy + '%（只统计点过按钮的作答）。'
        }
      },
    ],
    memory: '用户装有「PDF 精读提炼」插件：PDF 在本机解析（pdf.js + 独立 worker），不上传，只读文字层；'
      + '解析后 AI 提炼考点/公式/易错点并出 3 道自测题，可送教练追问、导出 Markdown/JSON。'
      + '教练问「我读过哪些讲义」（pdf-read）、「从讲义里提炼出哪些考点」（pdf-points）、'
      + '「PDF 自测做得怎么样」（pdf-quiz）时可查对应接口；'
      + '回答要带真实数字，扫描件无文字层要如实说读不到，不能编造讲义里没有的内容。',
  }

  if (typeof window !== 'undefined' && window.__PDFD_DEBUG__) {
    window.__pdfInternals = {
      esc: esc, num: num, clamp: clamp, flat: flat, trunc: trunc, dkey: dkey,
      fmtTime: fmtTime, hashStr: hashStr, docId: docId, hasKit: hasKit, tex: tex,
      cfgGet: cfgGet, cfgLocalSet: cfgLocalSet,
      normalizeDoc: normalizeDoc, docsGet: docsGet, docsSave: docsSave, upsertDoc: upsertDoc,
      quizMapGet: quizMapGet, quizAdd: quizAdd, quizReset: quizReset,
      notesMapGet: notesMapGet, notesAdd: notesAdd, notesDel: notesDel,
      historyGet: historyGet, historySave: historySave, recordHistory: recordHistory,
      statsOf: statsOf, insightsOf: insightsOf,
      docMd: docMd, reportMd: reportMd, reportJson: reportJson,
      stateOf: stateOf, refresh: refresh, render: render, mount: mount, panel: panel,
      VIEWS: VIEWS, api: api, MAX_DOCS: MAX_DOCS, MAX_FEED: MAX_FEED, MAX_HISTORY: MAX_HISTORY,
    }
  }

  PluginBus.register(api)
})()
