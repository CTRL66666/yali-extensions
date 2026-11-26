/* async-form-action.plugin.js — 异步表单动作 · v2.0.0
 *
 * v1.1.0 只有 204 行：表单能填、能异步写、能模糊撤销，但看不到「刚才到底加了什么」、
 * 没有队列、没有模板、历史只躺在 ctx.keep 里。v2.0.0 按成熟插件形态重造：
 * 常量 / 纯工具 / 数据层 / 分析层 / 完整 CSS / 多视图 VIEWS / mountShell 事件委托 /
 * panel / api（tools·panels·config·shortcuts·queries·hooks·memory·actions）/ 调试 internals。
 *
 * 【兼容契约 · 一个都不能改】
 *   · VERSION 升 2.0.0，PID 仍为 'async-form-action'；
 *   · 工具 id 'async-form-action-page'、面板 id 'af-today'、查询 key 'af-last'、
 *     快捷键 'alt+t'、config key 'maxBatch' 原样保留；
 *   · api.actions[0].type 仍为 'batchAddTasks'，needs 的 subject/text/count 三个字段
 *     （type / options / placeholder）原样保留，run 仍是返回 Promise 的异步调用，
 *     undo 仍走同一套撤销语义（只动本次新加的未完成任务，已完成的不碰）；
 *   · 写入仍然 setTimeout 600ms，任务字段形状（id/subject/text/done/createdAt/
 *     updatedAt/order）不变，教练按老方式调 run/undo 不会有任何行为差异。
 *
 * 【数据口径 · 单一来源】
 *   · 历史批次写 ctx.data('afHistory')，上限 MAX_HISTORY，不再散落在 ctx.keep；
 *   · 老版本留在 ctx.keep('afHistory') 的记录首次进入时自动迁移（按文本兜底撤销）；
 *   · 任务本体永远现读 ctx.Store，插件只存「哪一批加了哪些 id」，不做第二份任务表。
 */
;(function () {
  'use strict'

  /* ══════════════ 0. 常量 ══════════════ */

  var VERSION = '2.0.0'
  var PID = 'async-form-action'
  var NS = 'af-'
  var DEF_MAX = 10
  var ASYNC_MS = 600

  var K_HISTORY = 'afHistory'       // 批次历史（ctx.data，最多 MAX_HISTORY 条）
  var K_TEMPLATES = 'afTemplates'   // 批量模板（ctx.data）
  var K_PREF = 'afPref'             // 插件偏好（ctx.data）
  var K_DRAFT = 'afDraft'           // 表单草稿（ctx.keep，跟随 keepDraft 偏好）
  var K_LAST_VIEW = 'afLastView'    // 记住上次视图（ctx.keep）

  var MAX_HISTORY = 40
  var MAX_TEMPLATES = 12
  var MAX_TEXT = 120

  var SUBJECTS = [
    ['math', '数学'],
    ['eng', '英语'],
    ['pol', '政治'],
    ['major', '专业课']
  ]

  /* 快捷内容模式：只替换 {n}，逐项编号交给 addTasks 统一处理 */
  var PATTERNS = [
    { k: 'topic', t: '专题刷题', tpl: '专题练习 · 共 {n} 组' },
    { k: 'review', t: '错题回顾', tpl: '错题回顾 · 共 {n} 组' },
    { k: 'recite', t: '背诵默写', tpl: '背诵默写 · 共 {n} 组' },
    { k: 'mock', t: '模拟套卷', tpl: '模拟套卷 · 共 {n} 套' },
    { k: 'past', t: '真题精做', tpl: '真题精做 · 共 {n} 套' }
  ]

  /* ══════════════ 1. 基础工具（纯函数，可单测） ══════════════ */

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
    })
  }

  function num(v, d) {
    var n = Number(v)
    return isFinite(n) ? n : (d === undefined ? 0 : d)
  }

  function clamp(v, a, b, d) {
    var n = num(v, d === undefined ? a : d)
    return Math.max(a, Math.min(b, n))
  }

  function flat(s) {
    return String(s == null ? '' : s).replace(/\s+/g, ' ').trim()
  }

  function trunc(s, n) {
    s = flat(s)
    return s.length > n ? s.slice(0, n - 1) + '…' : s
  }

  function pad2(n) {
    n = num(n)
    return (n < 10 ? '0' : '') + n
  }

  function dkey(t) {
    var d = t == null ? new Date() : (t instanceof Date ? t : new Date(t))
    if (isNaN(d.getTime())) d = new Date()
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate())
  }

  function fmtTime(iso) {
    var s = String(iso || '')
    if (/^\d{4}-\d{2}-\d{2}T/.test(s)) return s.slice(5, 16).replace('T', ' ')
    return s.slice(0, 16) || '—'
  }

  /**
   * 图标统一走站内 U.icon，拿不到就退成文字 —— 绝不写原生 emoji（硬性要求）。
   */
  function I(key, text) {
    try {
      if (typeof U !== 'undefined' && U && typeof U.icon === 'function') {
        var svg = U.icon(key)
        if (svg) return '<span class="' + NS + 'ic" aria-hidden="true">' + svg + '</span>'
      }
    } catch (e) { /* 沙箱里没有 U 时静默退化 */ }
    return '<span class="' + NS + 'ic" aria-hidden="true">' + esc(text || '·') + '</span>'
  }

  function log(ctx, msg) {
    try { if (ctx && typeof ctx.log === 'function') ctx.log(String(msg)) } catch (e) { }
  }

  function toast(ctx, msg, level) {
    var lv = level || 'info'
    try {
      if (ctx && ctx.Toast && typeof ctx.Toast.show === 'function') {
        ctx.Toast.show(String(msg), lv === 'danger' ? 'warn' : lv)
        return
      }
    } catch (e) { }
    try {
      if (ctx && typeof ctx.notify === 'function') {
        ctx.notify({ title: String(msg), level: lv, timeout: 3200 })
      }
    } catch (e) { }
  }

  function confirm(ctx, msg) {
    try {
      if (ctx && ctx.api && typeof ctx.api.confirm === 'function') return !!ctx.api.confirm(String(msg))
    } catch (e) { }
    return true
  }

  function download(ctx, name, text, mime) {
    /* 只能用 ctx.api.download；写 ctx.download 是老插件踩过的坑 */
    try {
      if (ctx && ctx.api && typeof ctx.api.download === 'function') {
        ctx.api.download(String(name), String(text), String(mime))
        return true
      }
    } catch (e) { }
    return false
  }

  function dataGet(ctx, key, fallback) {
    try {
      if (ctx && typeof ctx.data === 'function') {
        var v = ctx.data(key)
        if (v != null) return v
      }
    } catch (e) { }
    return fallback
  }

  function dataSet(ctx, key, val) {
    try { if (ctx && typeof ctx.data === 'function') ctx.data(key, val) } catch (e) { }
    return val
  }

  function keepGet(ctx, key, fallback) {
    try {
      if (ctx && ctx.keep && typeof ctx.keep.get === 'function') {
        var v = ctx.keep.get(key)
        if (v != null) return v
      }
    } catch (e) { }
    return fallback
  }

  function keepSet(ctx, key, val) {
    try { if (ctx && ctx.keep && typeof ctx.keep.set === 'function') ctx.keep.set(key, val) } catch (e) { }
    return val
  }

  function safeStore(ctx) {
    try { return (ctx && ctx.Store && typeof ctx.Store.get === 'function') ? (ctx.Store.get() || {}) : {} }
    catch (e) { return {} }
  }

  function uidOf(ctx) {
    try { if (ctx && typeof ctx.uid === 'function') return ctx.uid() } catch (e) { }
    return 'af' + Date.now().toString(36) + Math.floor(Math.random() * 1000000).toString(36)
  }

  function max(ctx) {
    var n = DEF_MAX
    try { n = Number((ctx && ctx.config && ctx.config('maxBatch')) || DEF_MAX) || DEF_MAX } catch (e) { }
    return Math.max(1, Math.min(30, n))
  }

  function subjectName(code) {
    for (var i = 0; i < SUBJECTS.length; i++) {
      if (SUBJECTS[i][0] === code) return SUBJECTS[i][1]
    }
    return '数学'
  }

  function subjectOK(code) {
    for (var i = 0; i < SUBJECTS.length; i++) {
      if (SUBJECTS[i][0] === code) return true
    }
    return false
  }

  function clampCount(ctx, raw) {
    var n = parseInt(raw, 10)
    if (!isFinite(n) || n < 1) n = 1
    return Math.max(1, Math.min(max(ctx), n))
  }

  function patternOf(k) {
    for (var i = 0; i < PATTERNS.length; i++) {
      if (PATTERNS[i].k === k) return PATTERNS[i]
    }
    return null
  }

  /* ══════════════ 2. 偏好 / 草稿 / 历史 / 模板（数据层） ══════════════ */

  function cfgGet(ctx) {
    var d = { showPanel: true, confirmDelete: true, keepDraft: true }
    var got = dataGet(ctx, K_PREF, null)
    if (!got || typeof got !== 'object') return d
    Object.keys(d).forEach(function (k) {
      if (typeof got[k] === 'boolean') d[k] = got[k]
    })
    return d
  }

  function cfgSet(ctx, patch) {
    var d = cfgGet(ctx)
    Object.keys(patch || {}).forEach(function (k) {
      if (k in d) d[k] = !!patch[k]
    })
    dataSet(ctx, K_PREF, d)
    return d
  }

  function draft(ctx) {
    var d = { subject: 'math', text: '', count: 1 }
    var got = keepGet(ctx, K_DRAFT, null)
    if (got && typeof got === 'object') {
      if (subjectOK(got.subject)) d.subject = got.subject
      if (got.text != null) d.text = String(got.text)
      if (got.count != null) d.count = clampCount(ctx, got.count)
    }
    return d
  }

  function saveDraft(ctx, d) {
    if (!cfgGet(ctx).keepDraft) return
    keepSet(ctx, K_DRAFT, {
      subject: subjectOK(d.subject) ? d.subject : 'math',
      text: String(d.text || ''),
      count: clampCount(ctx, d.count)
    })
  }

  function normalizeRec(ctx, x) {
    var items = []
    if (Array.isArray(x.items)) {
      x.items.forEach(function (it) {
        if (!it || typeof it !== 'object' || it.id == null) return
        items.push({
          id: it.id,
          text: String(it.text || ''),
          done: !!it.done,
          undone: !!it.undone
        })
      })
    }
    return {
      id: x.id != null ? x.id : uidOf(ctx),
      at: String(x.at || new Date().toISOString()),
      subject: subjectOK(x.subject) ? x.subject : 'math',
      text: String(x.text || ''),
      n: num(x.n, items.length),
      items: items,
      undone: !!x.undone
    }
  }

  function historyGet(ctx) {
    var arr = dataGet(ctx, K_HISTORY, null)
    if (!Array.isArray(arr)) return []
    return arr
      .filter(function (x) { return x && typeof x === 'object' && x.at != null })
      .map(function (x) { return normalizeRec(ctx, x) })
      .sort(function (a, b) { return String(b.at).localeCompare(String(a.at)) })
      .slice(0, MAX_HISTORY)
  }

  function historySave(ctx, arr) {
    var out = (arr || []).slice(0, MAX_HISTORY)
    dataSet(ctx, K_HISTORY, out)
    return out
  }

  function migrateLegacy(ctx) {
    if (dataGet(ctx, K_HISTORY, null) != null) return 0
    var old = null
    try { if (ctx && ctx.keep && typeof ctx.keep.get === 'function') old = ctx.keep.get('afHistory') } catch (e) { }
    if (!Array.isArray(old) || !old.length) return 0
    var out = old.map(function (x) { return normalizeRec(ctx, x) })
    dataSet(ctx, K_HISTORY, out.slice(0, MAX_HISTORY))
    log(ctx, '已从旧版迁移 ' + out.length + ' 条批次记录')
    return out.length
  }

  function activeOf(h) {
    return (h || []).filter(function (x) { return !x.undone })
  }

  function findRec(h, id) {
    var rec = null
    ;(h || []).forEach(function (x) { if (String(x.id) === String(id)) rec = x })
    return rec
  }

  function templatesGet(ctx) {
    var arr = dataGet(ctx, K_TEMPLATES, null)
    if (!Array.isArray(arr)) return []
    return arr.filter(function (x) { return x && typeof x === 'object' && x.name != null })
      .map(function (x) {
        return {
          id: x.id != null ? x.id : uidOf(ctx),
          name: String(x.name || '未命名模板'),
          subject: subjectOK(x.subject) ? x.subject : 'math',
          text: String(x.text || ''),
          count: clampCount(ctx, x.count)
        }
      })
      .slice(0, MAX_TEMPLATES)
  }

  function templatesSave(ctx, arr) {
    var out = (arr || []).slice(0, MAX_TEMPLATES)
    dataSet(ctx, K_TEMPLATES, out)
    return out
  }

  /* ══════════════ 3. 校验 / 预览 / 统计（分析层） ══════════════ */

  function validateDraft(ctx, d) {
    var errors = []
    var notes = []
    var text = flat(d.text || '')
    var n = clampCount(ctx, d.count)
    var sub = subjectOK(d.subject) ? d.subject : 'math'

    if (!text) errors.push('任务内容不能为空，写一句要做的事再添加。')
    if (text.length > MAX_TEXT) errors.push('任务内容最多 ' + MAX_TEXT + ' 字，当前 ' + text.length + ' 字。')
    var rawN = parseInt(d.count, 10)
    if (!isFinite(rawN) || rawN < 1) notes.push('数量无效，已按 1 项处理。')
    else if (rawN !== n) notes.push('数量已按上限 ' + max(ctx) + ' 收敛为 ' + n + ' 项。')
    if (!subjectOK(d.subject)) notes.push('科目无效，已按数学处理。')

    return {
      ok: !errors.length,
      errors: errors,
      notes: notes,
      n: n,
      text: text,
      subject: sub
    }
  }

  function previewItems(ctx, d) {
    var c = validateDraft(ctx, d)
    var out = []
    if (!c.text) return out
    for (var i = 0; i < c.n; i++) {
      out.push(c.n > 1 ? (c.text + '（' + (i + 1) + '/' + c.n + '）') : c.text)
    }
    return out
  }

  function statsOf(h) {
    var list = h || []
    var out = {
      batches: list.length,
      active: 0,
      total: 0,
      undoneN: 0,
      bySubject: {},
      lastAt: ''
    }
    list.forEach(function (r) {
      if (!r.undone) out.active++
      out.total += num(r.n)
      if (r.items) {
        r.items.forEach(function (it) { if (it && it.undone) out.undoneN++ })
      }
      out.bySubject[r.subject] = num(out.bySubject[r.subject]) + num(r.n)
      if (!out.lastAt) out.lastAt = r.at
    })
    return out
  }

  function taskMap(ctx) {
    var map = {}
    var s = safeStore(ctx)
    var tasks = Array.isArray(s.tasks) ? s.tasks : []
    tasks.forEach(function (t) {
      if (t && t.id != null) map[String(t.id)] = t
    })
    return map
  }

  function queueOf(ctx, h, tmap) {
    var out = []
    ;(h || []).forEach(function (rec) {
      ;(rec.items || []).forEach(function (it) {
        var t = tmap[String(it.id)]
        out.push({
          recId: rec.id,
          itemId: it.id,
          text: it.text,
          subject: rec.subject,
          at: rec.at,
          done: t ? !!t.done : true,
          missing: !t,
          undone: !!it.undone
        })
      })
    })
    return out
  }

  function syncAllItems(ctx) {
    var tmap = taskMap(ctx)
    var h = historyGet(ctx)
    var changed = false
    h.forEach(function (rec) {
      ;(rec.items || []).forEach(function (it) {
        var t = tmap[String(it.id)]
        if (!t) return
        if (!!t.done !== !!it.done) {
          it.done = !!t.done
          changed = true
        }
      })
    })
    if (changed) historySave(ctx, h)
    return changed
  }

  /* ══════════════ 4. 写入与撤销（核心异步契约） ══════════════ */

  function normalizeArgs(ctx, a) {
    a = a || {}
    return {
      n: clampCount(ctx, a.count),
      text: String(a.text || ''),
      subject: subjectOK(a.subject) ? a.subject : 'math'
    }
  }

  /**
   * 与原 action.run 同一套写入逻辑：600ms 后逐项写 Store，任务字段形状完全不变。
   * done(ok, added, rec) 的前两个参数与原版一致（added 是文本数组），第三个参数
   * 仅供工具页做逐项撤销，老调用方忽略即可。
   */
  function addTasks(ctx, a, done) {
    var args = normalizeArgs(ctx, a)
    var timer = setTimeout(function () {
      var items = []
      try {
        for (var i = 0; i < args.n; i++) {
          var text = args.n > 1 ? (args.text + '（' + (i + 1) + '/' + args.n + '）') : args.text
          var id = uidOf(ctx)
          ;(function (id2, text2) {
            ctx.Store.update(function (s) {
              s.tasks = s.tasks || []
              var order = 0
              s.tasks.forEach(function (t) {
                if (t && t.order != null && t.order > order) order = t.order
              })
              s.tasks.push({
                id: id2,
                subject: args.subject,
                text: text2,
                done: false,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                order: order + 1
              })
            })
          })(id, text)
          items.push({ id: id, text: text, done: false, undone: false })
        }
        var rec = {
          id: uidOf(ctx),
          at: new Date().toISOString(),
          subject: args.subject,
          text: args.text,
          n: items.length,
          items: items,
          undone: false
        }
        var h = historyGet(ctx)
        h.unshift(rec)
        historySave(ctx, h)
        log(ctx, '异步批量加任务 ' + items.length + ' 项')
        done(true, items.map(function (x) { return x.text }), rec)
      } catch (e) {
        done(false, [], null)
      }
    }, ASYNC_MS)
    return timer
  }

  function removeById(ctx, id) {
    var removed = 0
    try {
      ctx.Store.update(function (s) {
        var before = Array.isArray(s.tasks) ? s.tasks.length : 0
        s.tasks = (s.tasks || []).filter(function (t) {
          return !t || String(t.id) !== String(id)
        })
        removed = before - ((s.tasks || []).length)
      })
    } catch (e) { }
    return removed
  }

  function recAllDone(rec) {
    var items = rec.items || []
    rec.undone = items.length > 0 && items.every(function (it) { return !!it.undone })
    return rec.undone
  }

  function syncItem(ctx, recId, itemId, patch) {
    var h = historyGet(ctx)
    var rec = findRec(h, recId)
    if (!rec) return false
    var hit = false
    ;(rec.items || []).forEach(function (it) {
      if (String(it.id) === String(itemId)) {
        Object.keys(patch || {}).forEach(function (k) { it[k] = patch[k] })
        hit = true
      }
    })
    if (hit) historySave(ctx, h)
    return hit
  }

  function undoItem(ctx, recId, itemId) {
    var h = historyGet(ctx)
    var rec = findRec(h, recId)
    if (!rec) return 0
    var it = null
    ;(rec.items || []).forEach(function (x) {
      if (String(x.id) === String(itemId)) it = x
    })
    if (!it || it.undone || it.done) return 0
    var removed = removeById(ctx, itemId)
    if (removed) {
      it.undone = true
      recAllDone(rec)
      historySave(ctx, h)
      log(ctx, '撤销单条任务 ' + removed + ' 项')
    }
    return removed
  }

  function undoRecord(ctx, recId) {
    var h = historyGet(ctx)
    var rec = findRec(h, recId)
    if (!rec || rec.undone) return 0
    var removed = 0

    ;(rec.items || []).forEach(function (it) {
      if (it.undone || it.done) return
      var n = removeById(ctx, it.id)
      if (n) {
        it.undone = true
        removed += n
      }
    })

    /* 旧版记录没有 items，按原版的文本规则兜底：只删未完成的同文任务 */
    if (!rec.items.length) {
      var n2 = 0
      try {
        ctx.Store.update(function (s) {
          var before = (s.tasks || []).length
          s.tasks = (s.tasks || []).filter(function (t) {
            if (!t || t.done) return true
            return t.text !== rec.text && t.text.indexOf(rec.text + '（') !== 0
          })
          n2 = before - ((s.tasks || []).length)
        })
      } catch (e) { }
      removed += n2
      if (n2) rec.undone = true
    }

    if (removed) {
      recAllDone(rec)
      historySave(ctx, h)
      log(ctx, '撤销批量加任务 ' + removed + ' 项')
    }
    return removed
  }

  function undoLast(ctx) {
    var active = activeOf(historyGet(ctx))
    if (!active.length) return 0
    return undoRecord(ctx, active[0].id)
  }

  function undoAll(ctx) {
    var h = historyGet(ctx)
    var total = 0
    h.forEach(function (rec) { if (!rec.undone) total += undoRecord(ctx, rec.id) })
    return total
  }

  function deleteTask(ctx, recId, itemId) {
    var removed = removeById(ctx, itemId)
    if (removed) syncItem(ctx, recId, itemId, { undone: true })
    return removed
  }

  function toggleTask(ctx, recId, itemId) {
    var newDone = false
    try {
      ctx.Store.update(function (s) {
        ;(s.tasks || []).forEach(function (t) {
          if (t && String(t.id) === String(itemId)) {
            t.done = !t.done
            t.updatedAt = new Date().toISOString()
            newDone = !!t.done
          }
        })
      })
    } catch (e) { }
    syncItem(ctx, recId, itemId, { done: newDone })
    return newDone
  }

  function markAllDone(ctx, q) {
    var n = 0
    q.forEach(function (x) {
      if (x.done || x.undone || x.missing) return
      if (toggleTask(ctx, x.recId, x.itemId)) n++
    })
    return n
  }

  function deleteDone(ctx, q) {
    var n = 0
    q.forEach(function (x) {
      if (!x.done || x.undone || x.missing) return
      if (deleteTask(ctx, x.recId, x.itemId)) n++
    })
    return n
  }

  /* ══════════════ 5. 样式（完整设计层，含夜间与窄屏） ══════════════ */

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
    '.' + NS + 'card{border:1px solid var(--line);border-radius:12px;padding:14px 16px;background:var(--glass-bg)}',
    '.' + NS + 'card h4{margin:0 0 10px;font-size:13.5px;display:flex;align-items:center;gap:7px}',
    '.' + NS + 'card-hd{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:10px;flex-wrap:wrap}',
    '.' + NS + 'card-hd h4{margin:0}',
    '.' + NS + 'grid2{display:grid;grid-template-columns:1fr 1fr;gap:12px}',
    '.' + NS + 'form{display:grid;grid-template-columns:1fr 2fr 1fr;gap:10px;align-items:end}',
    '.' + NS + 'field{display:flex;flex-direction:column;gap:5px;font-size:11.5px;color:var(--text-secondary)}',
    '.' + NS + 'field input,.' + NS + 'field select{border:1px solid var(--line);border-radius:8px;padding:7px 9px;background:var(--bg-muted,transparent);color:inherit;font-size:12.5px;width:100%;box-sizing:border-box}',
    '.' + NS + 'acts{display:flex;gap:7px;flex-wrap:wrap;margin-top:10px}',
    '.' + NS + 'btn{border:1px solid var(--line);background:var(--glass-bg);color:var(--text-primary);border-radius:8px;padding:6px 12px;font-size:11.5px;cursor:pointer;transition:.15s}',
    '.' + NS + 'btn:hover{border-color:var(--accent-text);color:var(--accent-text)}',
    '.' + NS + 'btn.pri{background:var(--accent-text);border-color:var(--accent-text);color:var(--btn-text,#fff)}',
    '.' + NS + 'btn.mini{padding:3px 8px;font-size:10.5px;border-radius:6px}',
    '.' + NS + 'btn[disabled]{opacity:.45;cursor:default}',
    '.' + NS + 'ic{display:inline-flex;align-items:center;justify-content:center;width:15px;height:15px;vertical-align:-2px}',
    '.' + NS + 'ic svg{width:15px;height:15px;fill:none;stroke:currentColor;stroke-width:1.8}',
    '.' + NS + 'prog{height:7px;border-radius:99px;background:var(--chart-track,var(--line));overflow:hidden;margin-top:9px}',
    '.' + NS + 'prog i{display:block;height:100%;border-radius:99px;background:var(--accent-text);transition:width .25s ease}',
    '.' + NS + 'prog i.ok{background:var(--ok,#2e9e5b)}',
    '.' + NS + 'olist{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:5px}',
    '.' + NS + 'olist li{display:flex;align-items:center;gap:9px;padding:7px 9px;border:1px solid var(--line);border-radius:9px;font-size:12px}',
    '.' + NS + 'olist li>span{color:var(--text-secondary);font-size:10.5px;min-width:18px}',
    '.' + NS + 'olist li>b{font-weight:500;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.' + NS + 'olist li>em{font-style:normal;color:var(--text-secondary);font-size:11px}',
    '.' + NS + 'note{display:flex;gap:9px;padding:9px 11px;border-radius:10px;margin-bottom:8px;border-left:3px solid var(--line);background:var(--glass-bg);font-size:12px;line-height:1.7}',
    '.' + NS + 'note.warn{border-left-color:var(--danger,#d9534f)}',
    '.' + NS + 'note.good{border-left-color:var(--ok,#2e9e5b)}',
    '.' + NS + 'note.info{border-left-color:var(--blue)}',
    '.' + NS + 'note b{display:block;font-size:12.5px;margin-bottom:2px}',
    '.' + NS + 'hint{font-size:11px;color:var(--ok,#2e9e5b);margin-top:7px}',
    '.' + NS + 'row{display:flex;justify-content:space-between;align-items:center;gap:8px;font-size:12px;padding:8px 0;border-bottom:1px dashed var(--line)}',
    '.' + NS + 'row:last-child{border-bottom:0}',
    '.' + NS + 'row span{color:var(--text-secondary);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.' + NS + 'row b{white-space:nowrap}',
    '.' + NS + 'g{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;text-align:center}',
    '.' + NS + 'g div{border-radius:9px;padding:8px 4px;background:var(--glass-bg);border:1px solid var(--line)}',
    '.' + NS + 'g b{display:block;font-size:15px}',
    '.' + NS + 'g span{font-size:10.5px;color:var(--text-secondary)}',
    '.' + NS + 'table{width:100%;border-collapse:collapse;font-size:12px}',
    '.' + NS + 'table th{text-align:left;color:var(--text-secondary);font-weight:500;padding:7px 8px;border-bottom:1px solid var(--line);font-size:11px}',
    '.' + NS + 'table td{padding:7px 8px;border-bottom:1px dashed var(--line)}',
    '.' + NS + 'table tr:last-child td{border-bottom:0}',
    '.' + NS + 'empty{color:var(--text-secondary);font-size:12px;line-height:1.8;padding:12px 0;text-align:center}',
    '.' + NS + 'okline{font-size:12px;color:var(--ok,#2e9e5b);margin-bottom:8px}',
    '.' + NS + 'settings{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:9px 0;border-bottom:1px dashed var(--line);font-size:12px}',
    '.' + NS + 'settings:last-child{border-bottom:0}',
    '.' + NS + 'settings span{color:var(--text-secondary)}',
    '.' + NS + 'prow{font-size:12px;margin-top:6px;color:var(--text-secondary)}',
    '.' + NS + 'tag{display:inline-block;border-radius:5px;padding:1px 6px;font-size:10px;border:1px solid var(--line);margin-right:5px}',
    '.' + NS + 'tag.on{border-color:var(--ok,#2e9e5b);color:var(--ok,#2e9e5b)}',
    '.' + NS + 'tag.off{border-color:var(--danger,#d9534f);color:var(--danger,#d9534f)}',
    '@media(max-width:820px){.' + NS + 'form{grid-template-columns:1fr}.' + NS + 'grid2{grid-template-columns:1fr}.' + NS + 'g{grid-template-columns:repeat(2,1fr)}}',
    'html[data-theme="night"] .' + NS + 'hero:after{opacity:.16}'
  ].join('\n')

  function style(ctx) {
    try { if (ctx && ctx.css && typeof ctx.css.add === 'function') ctx.css.add(CSS, 'skin') } catch (e) { }
  }

  /* ══════════════ 6. 视图 ══════════════ */

  function errorsHTML(c) {
    if (!c) return ''
    if (c.errors.length) {
      return '<div class="' + NS + 'note warn"><div>' + c.errors.map(function (x) {
        return '<b>' + esc(x) + '</b>'
      }).join('') + '</div></div>'
    }
    if (c.notes.length) {
      return '<div class="' + NS + 'note info"><div>' + esc(c.notes[0]) + '</div></div>'
    }
    return '<div class="' + NS + 'hint">校验通过，可以写入 ' + c.n + ' 项。</div>'
  }

  function previewHTML(S) {
    if (!S.preview.length) {
      return '<div class="' + NS + 'empty">先填任务内容，这里会列出将要写入的每一项。</div>'
    }
    return '<ol class="' + NS + 'olist">' + S.preview.map(function (x, i) {
      return '<li><span>' + (i + 1) + '</span><b>' + esc(x) + '</b></li>'
    }).join('') + '</ol>'
  }

  function resultHTML(ctx, S) {
    if (S.busy) {
      return '<div class="' + NS + 'empty">正在异步写入，完成后这里会列出结果，并可逐项撤销。</div>'
    }
    if (!S.result) {
      return '<div class="' + NS + 'empty">还没有写入结果。点上面的「批量添加」开始一次异步写入。</div>'
    }
    if (S.result.error) {
      return '<div class="' + NS + 'note warn"><div><b>写入失败</b>请重试；如果反复失败，检查 Store 是否可写。</div></div>'
    }
    var rec = findRec(S.history, S.result.recId)
    return '<div class="' + NS + 'okline">已完成 ' + S.result.texts.length + ' 项 · ' + esc(fmtTime(S.result.at)) + '</div>'
      + '<ol class="' + NS + 'olist">' + S.result.texts.map(function (t, i) {
        var it = rec && rec.items ? rec.items[i] : null
        var undone = it && it.undone
        return '<li><span>' + (i + 1) + '</span><b>' + esc(t) + '</b>'
          + (undone
            ? '<em>已撤销</em>'
            : '<button class="' + NS + 'btn mini" data-act="undo-item" data-rec="' + esc(S.result.recId)
              + '" data-item="' + esc(it ? it.id : '') + '">撤销这项</button>')
          + '</li>'
      }).join('') + '</ol>'
      + '<div class="' + NS + 'acts"><button class="' + NS + 'btn mini" data-act="undo-batch" data-rec="'
      + esc(S.result.recId) + '">整批撤销</button></div>'
  }

  function viewCreate(ctx, S) {
    var out = []
    var d = S.draft
    var c = S.check
    var progressText = S.busy ? '正在异步写入…' : (S.progress === 100 ? '写入完成' : '空闲')

    out.push('<div class="' + NS + 'hero"><h3>' + I('cpBolt', '批') + ' 批量建任务</h3>'
      + '<p>填一张表，异步写入 Store。写入前能预览每一项，写入后能逐项撤销或整批撤销。'
      + '单次上限 <b>' + S.max + '</b> 项（在设置里调整 maxBatch）。</p>'
      + '<div class="' + NS + 'prog"><i data-progress-bar class="' + (S.progress === 100 ? 'ok' : '')
      + '" style="width:' + S.progress + '%"></i></div>'
      + '<div class="muted-sm" style="font-size:11px;margin-top:4px"><span data-progress-label>'
      + esc(progressText) + '</span></div></div>')

    out.push('<section class="' + NS + 'card"><h4>' + I('cpForm', '表') + ' 表单演示 · 异步动作收参</h4>')
    out.push('<div class="' + NS + 'form">')
    out.push('<label class="' + NS + 'field">科目<select data-act="f-subject">'
      + SUBJECTS.map(function (x) {
        return '<option value="' + x[0] + '"' + (x[0] === d.subject ? ' selected' : '') + '>' + esc(x[1]) + '</option>'
      }).join('') + '</select></label>')
    out.push('<label class="' + NS + 'field">任务内容<input data-act="f-text" maxlength="' + MAX_TEXT
      + '" placeholder="如：极限专题 20 题" value="' + esc(d.text) + '"></label>')
    out.push('<label class="' + NS + 'field">重复数量<input data-act="f-count" type="number" min="1" max="'
      + S.max + '" value="' + c.n + '"></label>')
    out.push('</div>')
    out.push('<div data-errors>' + errorsHTML(c) + '</div>')
    out.push('<div class="' + NS + 'acts">'
      + '<button class="' + NS + 'btn pri" data-act="run"' + (S.busy || !c.ok ? ' disabled' : '') + '>'
      + (S.busy ? '正在写入…' : '批量添加 ' + c.n + ' 项') + '</button>'
      + '<button class="' + NS + 'btn" data-act="undo-last"' + (S.stats.active ? '' : ' disabled') + '>撤销上一批</button>'
      + '<button class="' + NS + 'btn" data-act="tpl-go">用模板加速</button>'
      + '</div></section>')

    out.push('<section class="' + NS + 'card"><div class="' + NS + 'card-hd">'
      + '<h4>实时预览 · 将写入以下 ' + c.n + ' 项</h4>'
      + '<span class="muted-sm" style="font-size:11px">' + esc(subjectName(c.subject)) + '</span></div>'
      + '<div data-preview>' + previewHTML(S) + '</div></section>')

    out.push('<section class="' + NS + 'card"><h4>最近一次写入结果</h4>' + resultHTML(ctx, S) + '</section>')
    return out.join('')
  }

  function viewQueue(ctx, S) {
    var out = []
    var shown = S.showAll ? S.queue : S.queue.filter(function (x) {
      return !x.undone && !x.missing
    })

    out.push('<section class="' + NS + 'card"><div class="' + NS + 'card-hd"><h4>'
      + I('cpList', '列') + ' 任务队列（来自各批次）</h4>'
      + '<span class="' + NS + 'acts" style="margin:0">'
      + '<button class="' + NS + 'btn mini" data-act="q-done-all">全部标完成</button>'
      + '<button class="' + NS + 'btn mini" data-act="q-del-done">删除已完成</button>'
      + '<button class="' + NS + 'btn mini" data-act="q-show-all">' + (S.showAll ? '只看在队' : '显示已撤销') + '</button>'
      + '</span></div>')
    out.push('<p class="muted-sm" style="font-size:11.5px;line-height:1.8;margin:0 0 8px">'
      + '勾选表示完成；删除会从 Store 移除并把对应项标记为已撤销。'
      + '队列只列本插件添加的项，不动其它任务。共 ' + S.queue.length + ' 条，当前显示 ' + shown.length + ' 条。</p>')

    if (!shown.length) {
      out.push('<div class="' + NS + 'empty">队列是空的。先到「批量建任务」写一批，或用「撤销栈」找回可撤销的批次。</div>')
    } else {
      out.push('<table class="' + NS + 'table"><thead><tr><th>完成</th><th>内容</th><th>科目</th><th>批次</th><th>操作</th></tr></thead><tbody>')
      shown.forEach(function (x) {
        out.push('<tr>'
          + '<td><input type="checkbox" data-act="q-toggle" data-rec="' + esc(x.recId)
            + '" data-item="' + esc(x.itemId) + '"' + (x.done ? ' checked' : '') + '></td>'
          + '<td>' + esc(trunc(x.text, 42)) + (x.missing ? ' <em style="color:var(--text-secondary)">（已不在 Store）</em>' : '')
            + (x.undone ? ' <em style="color:var(--text-secondary)">（已撤销）</em>' : '') + '</td>'
          + '<td>' + esc(subjectName(x.subject)) + '</td>'
          + '<td>' + esc(fmtTime(x.at)) + '</td>'
          + '<td>' + (x.missing || x.undone ? '—'
            : '<button class="' + NS + 'btn mini" data-act="q-del" data-rec="' + esc(x.recId)
              + '" data-item="' + esc(x.itemId) + '">删除</button>') + '</td>'
          + '</tr>')
      })
      out.push('</tbody></table>')
    }
    out.push('</section>')
    return out.join('')
  }

  function viewUndo(ctx, S) {
    var out = []
    out.push('<div class="' + NS + 'hero"><h3>' + I('cpUndo', '撤') + ' 撤销栈</h3>'
      + '<p>只撤销「未完成」的任务；已经勾选完成的任务不会被碰。'
      + '当前有 <b>' + S.stats.active + '</b> 批可撤销，累计撤销过 <b>' + S.stats.undoneN + '</b> 项。</p>'
      + '<div class="' + NS + 'acts"><button class="' + NS + 'btn pri" data-act="undo-all"'
      + (S.stats.active ? '' : ' disabled') + '>撤销全部可撤销批次</button>'
      + '<button class="' + NS + 'btn" data-act="undo-last"' + (S.stats.active ? '' : ' disabled') + '>只撤销最近一批</button>'
      + '</div></div>')

    if (!S.active.length) {
      out.push('<section class="' + NS + 'card"><div class="' + NS + 'empty">没有可撤销的批次。'
        + '每条历史要么已完成、要么已撤销，撤销栈现在是干净的。</div></section>')
      return out.join('')
    }

    S.active.forEach(function (rec, i) {
      var items = rec.items || []
      out.push('<section class="' + NS + 'card"><div class="' + NS + 'card-hd"><h4>'
        + (i + 1) + '. ' + esc(trunc(rec.text, 30)) + ' · ' + esc(subjectName(rec.subject)) + ' · ' + rec.n + ' 项</h4>'
        + '<span>' + esc(fmtTime(rec.at)) + ' '
        + '<button class="' + NS + 'btn mini" data-act="undo-batch" data-rec="' + esc(rec.id) + '">整批撤销</button>'
        + '</span></div>')
      if (!items.length) {
        out.push('<div class="' + NS + 'empty">旧版记录（没有逐项 id），整批撤销按原版文本规则匹配。</div>')
      } else {
        out.push('<ol class="' + NS + 'olist">' + items.map(function (it) {
          return '<li><span>' + esc(String(it.done ? '✓' : '·')) + '</span><b>' + esc(it.text) + '</b>'
            + (it.done || it.undone ? '<em>' + (it.done ? '已完成' : '已撤销') + '</em>'
              : '<button class="' + NS + 'btn mini" data-act="undo-item" data-rec="' + esc(rec.id)
                + '" data-item="' + esc(it.id) + '">撤销这项</button>')
            + '</li>'
        }).join('') + '</ol>')
      }
      out.push('</section>')
    })
    return out.join('')
  }

  function viewHistory(ctx, S) {
    var out = []
    out.push('<section class="' + NS + 'card"><div class="' + NS + 'card-hd"><h4>'
      + I('cpClock', '史') + ' 历史记录（本机 ctx.data，最多 ' + MAX_HISTORY + ' 条）</h4>'
      + '<span class="' + NS + 'acts" style="margin:0">'
      + '<button class="' + NS + 'btn mini" data-act="export-json">导出 JSON</button>'
      + '<button class="' + NS + 'btn mini" data-act="export-md">导出 Markdown</button>'
      + '<button class="' + NS + 'btn mini" data-act="clear-history">清空历史</button>'
      + '</span></div>')
    out.push('<div class="' + NS + 'g"><div><b>' + S.stats.batches + '</b><span>总批次</span></div>'
      + '<div><b>' + S.stats.total + '</b><span>累计写入</span></div>'
      + '<div><b>' + S.stats.active + '</b><span>可撤销批</span></div>'
      + '<div><b>' + S.stats.undoneN + '</b><span>已撤销项</span></div></div>')

    if (!S.history.length) {
      out.push('<div class="' + NS + 'empty">还没有批次记录。写入一次后这里会出现，导出功能也会随之可用。</div>')
      return out.join('')
    }

    out.push('<table class="' + NS + 'table" style="margin-top:10px"><thead><tr>'
      + '<th>时间</th><th>内容</th><th>科目</th><th>数量</th><th>状态</th><th>操作</th></tr></thead><tbody>')
    S.history.forEach(function (r) {
      out.push('<tr>'
        + '<td>' + esc(fmtTime(r.at)) + '</td>'
        + '<td>' + esc(trunc(r.text, 34)) + '</td>'
        + '<td>' + esc(subjectName(r.subject)) + '</td>'
        + '<td>' + r.n + '</td>'
        + '<td><span class="' + NS + 'tag ' + (r.undone ? 'off' : 'on') + '">'
          + (r.undone ? '已撤销' : '可撤销') + '</span></td>'
        + '<td>' + (r.undone ? '—'
          : '<button class="' + NS + 'btn mini" data-act="undo-batch" data-rec="' + esc(r.id) + '">撤销</button>')
          + '</td>'
        + '</tr>')
    })
    out.push('</tbody></table></section>')
    return out.join('')
  }

  function viewTemplates(ctx, S) {
    var out = []
    out.push('<section class="' + NS + 'card"><h4>' + I('cpLayers', '模') + ' 快捷内容模式</h4>')
    out.push('<p class="muted-sm" style="font-size:11.5px;line-height:1.8;margin:0 0 8px">'
      + '点一下把内容模板填进表单（{n} 会替换成当前数量），再补上自己的关键词即可。</p>')
    out.push('<div class="' + NS + 'acts" style="margin-top:0">' + PATTERNS.map(function (p) {
      return '<button class="' + NS + 'btn mini" data-act="tpl-pattern" data-v="' + p.k + '">'
        + esc(p.t) + '</button>'
    }).join('') + '</div></section>')

    out.push('<section class="' + NS + 'card"><h4>保存当前表单为模板</h4>'
      + '<div class="' + NS + 'form">'
      + '<label class="' + NS + 'field">模板名<input data-act="tpl-name" maxlength="30" placeholder="如：数学极限每日三连"></label>'
      + '<label class="' + NS + 'field">将保存的内容<input value="' + esc(trunc(S.draft.text, 40)) + '" disabled></label>'
      + '<label class="' + NS + 'field">科目 / 数量<input value="' + esc(subjectName(S.draft.subject)) + ' · ' + S.check.n + '" disabled></label>'
      + '</div><div class="' + NS + 'acts"><button class="' + NS + 'btn pri" data-act="tpl-save"'
      + (S.draft.text ? '' : ' disabled') + '>保存模板</button>'
      + '<span class="muted-sm" style="font-size:11px;align-self:center">最多 ' + MAX_TEMPLATES + ' 条</span></div></section>')

    out.push('<section class="' + NS + 'card"><h4>我的模板（' + S.templates.length + '）</h4>')
    if (!S.templates.length) {
      out.push('<div class="' + NS + 'empty">还没有模板。把常用的「科目 + 内容 + 数量」存下来，下次一键套用。</div>')
    } else {
      out.push('<table class="' + NS + 'table"><thead><tr><th>名称</th><th>内容</th><th>科目 / 数量</th><th>操作</th></tr></thead><tbody>')
      S.templates.forEach(function (t) {
        out.push('<tr>'
          + '<td>' + esc(t.name) + '</td>'
          + '<td>' + esc(trunc(t.text, 34)) + '</td>'
          + '<td>' + esc(subjectName(t.subject)) + ' · ' + t.count + '</td>'
          + '<td><button class="' + NS + 'btn mini" data-act="tpl-apply" data-rec="' + esc(t.id) + '">套用</button> '
          + '<button class="' + NS + 'btn mini" data-act="tpl-del" data-rec="' + esc(t.id) + '">删除</button></td>'
          + '</tr>')
      })
      out.push('</tbody></table>')
    }
    out.push('</section>')
    return out.join('')
  }

  function viewConfig(ctx, S) {
    var out = []
    var c = S.cfg
    out.push('<section class="' + NS + 'card"><h4>插件设置</h4>')
    out.push('<div class="' + NS + 'settings"><span>单次批量上限（全局 config: maxBatch）</span>'
      + '<b>' + S.max + ' 项</b></div>')
    out.push('<div class="' + NS + 'settings"><span>常驻面板（af-today）</span>'
      + '<button class="' + NS + 'btn mini" data-act="cfg-toggle" data-v="showPanel">'
      + (c.showPanel ? '显示' : '隐藏') + '</button></div>')
    out.push('<div class="' + NS + 'settings"><span>删除任务前二次确认</span>'
      + '<button class="' + NS + 'btn mini" data-act="cfg-toggle" data-v="confirmDelete">'
      + (c.confirmDelete ? '开启' : '关闭') + '</button></div>')
    out.push('<div class="' + NS + 'settings"><span>记住表单草稿</span>'
      + '<button class="' + NS + 'btn mini" data-act="cfg-toggle" data-v="keepDraft">'
      + (c.keepDraft ? '开启' : '关闭') + '</button></div>')
    out.push('</section>')

    out.push('<section class="' + NS + 'card"><h4>数据与隐私</h4>'
      + '<p class="muted-sm" style="font-size:12px;line-height:1.9;margin:0">'
      + '批次历史写在本机插件数据 ctx.data(afHistory)，最多 ' + MAX_HISTORY + ' 条；模板最多 '
      + MAX_TEMPLATES + ' 条。任务本体始终现读 Store，插件只记「哪一批加了哪些 id」，'
      + '不另存一份任务表，因此不会和任务页的数字分叉。'
      + '清空历史会删掉全部批次记录，不能撤销 —— 建议先导出 JSON。'
      + 'maxBatch 是全局配置项，在宿主的配置界面里改，本页只显示当前生效值。</p></section>')

    out.push('<section class="' + NS + 'card"><h4>快捷键</h4>'
      + '<div class="' + NS + 'settings"><span>打开批量加任务工作台</span><b>alt+t</b></div></section>')
    return out.join('')
  }

  var VIEWS = [
    { k: 'create', t: '批量建任务', f: viewCreate },
    { k: 'queue', t: '任务队列', f: viewQueue },
    { k: 'undo', t: '撤销栈', f: viewUndo },
    { k: 'history', t: '历史记录', f: viewHistory },
    { k: 'templates', t: '模板', f: viewTemplates },
    { k: 'config', t: '设置', f: viewConfig }
  ]

  /* ══════════════ 7. Shell：状态 + 事件委托 ══════════════ */

  function refresh(ctx, S) {
    S.draft = draft(ctx)
    S.cfg = cfgGet(ctx)
    S.max = max(ctx)
    S.check = validateDraft(ctx, S.draft)
    S.preview = previewItems(ctx, S.draft)
    S.history = historyGet(ctx)
    S.active = activeOf(S.history)
    S.templates = templatesGet(ctx)
    S.stats = statsOf(S.history)
    S.tmap = taskMap(ctx)
    S.queue = queueOf(ctx, S.history, S.tmap)
    return S
  }

  function stateOf(ctx) {
    var S = {
      view: 'create',
      busy: false,
      progress: 0,
      result: null,
      msg: '',
      showAll: false,
      draft: null,
      cfg: null,
      max: DEF_MAX,
      check: null,
      preview: [],
      history: [],
      active: [],
      templates: [],
      stats: null,
      tmap: {},
      queue: []
    }
    refresh(ctx, S)
    var v = keepGet(ctx, K_LAST_VIEW, 'create')
    if (VIEWS.some(function (x) { return x.k === v })) S.view = v
    return S
  }

  function setView(ctx, S, root, v) {
    if (!VIEWS.some(function (x) { return x.k === v })) return
    S.view = v
    keepSet(ctx, K_LAST_VIEW, v)
    render(root, ctx, S)
  }

  function updatePreview(root, S) {
    var p = root.querySelector('[data-preview]')
    if (p) p.innerHTML = previewHTML(S)
    var e = root.querySelector('[data-errors]')
    if (e) e.innerHTML = errorsHTML(S.check)
  }

  function updateProgress(root, S) {
    var bar = root.querySelector('[data-progress-bar]')
    if (bar) {
      bar.style.width = S.progress + '%'
      if (S.progress === 100) bar.className = 'ok'
    }
    var label = root.querySelector('[data-progress-label]')
    if (label) {
      label.textContent = S.busy ? '正在异步写入…' : (S.progress === 100 ? '写入完成' : '空闲')
    }
  }

  function reportMD(ctx, S) {
    var lines = []
    lines.push('# 批量加任务 · 历史报告')
    lines.push('')
    lines.push('> 生成时间：' + new Date().toLocaleString())
    lines.push('> 批次：' + S.stats.batches + '，累计写入：' + S.stats.total
      + '，可撤销批：' + S.stats.active + '，已撤销项：' + S.stats.undoneN)
    lines.push('')
    lines.push('| 时间 | 内容 | 科目 | 数量 | 状态 |')
    lines.push('|---|---|---|---|---|')
    S.history.forEach(function (r) {
      lines.push('| ' + fmtTime(r.at) + ' | ' + String(r.text).replace(/\|/g, '\\|')
        + ' | ' + subjectName(r.subject) + ' | ' + r.n + ' | ' + (r.undone ? '已撤销' : '可撤销') + ' |')
    })
    lines.push('')
    lines.push('## 逐项明细')
    lines.push('')
    S.history.forEach(function (r) {
      lines.push('- ' + fmtTime(r.at) + ' 「' + r.text + '」' + subjectName(r.subject))
      ;(r.items || []).forEach(function (it) {
        lines.push('  - ' + it.text + '（' + (it.undone ? '已撤销' : (it.done ? '已完成' : '未完成')) + '）')
      })
    })
    return lines.join('\n')
  }

  function actConfirmDelete(ctx, msg) {
    return cfgGet(ctx).confirmDelete ? confirm(ctx, msg) : true
  }

  function doAct(ctx, S, root, payload) {
    var act = payload.act
    var v = payload.v
    var recId = payload.rec
    var itemId = payload.item

    if (act === 'tab') {
      setView(ctx, S, root, v)
      return
    }

    if (act === 'run') {
      var check = validateDraft(ctx, draft(ctx))
      if (!check.ok) {
        S.check = check
        toast(ctx, check.errors[0], 'warn')
        updatePreview(root, S)
        return
      }
      S.busy = true
      S.progress = 8
      S.result = null
      render(root, ctx, S)
      var tick = setInterval(function () {
        S.progress = Math.min(86, S.progress + 17)
        updateProgress(root, S)
      }, 90)
      addTasks(ctx, draft(ctx), function (ok, added, rec) {
        clearInterval(tick)
        S.busy = false
        S.progress = ok ? 100 : 0
        refresh(ctx, S)
        S.result = ok
          ? { texts: added, recId: rec && rec.id, at: new Date().toISOString(), error: false }
          : { error: true }
        render(root, ctx, S)
        toast(ctx, ok ? ('已添加 ' + added.length + ' 项任务') : '写入失败，请重试', ok ? 'success' : 'warn')
      })
      return
    }

    if (act === 'undo-last') {
      var n1 = undoLast(ctx)
      refresh(ctx, S)
      render(root, ctx, S)
      toast(ctx, n1 ? ('已撤销上一批 ' + n1 + ' 项') : '上一批没有可撤销的任务', n1 ? 'info' : 'warn')
      return
    }

    if (act === 'undo-batch') {
      var n2 = undoRecord(ctx, recId)
      refresh(ctx, S)
      render(root, ctx, S)
      toast(ctx, n2 ? ('已撤销该批 ' + n2 + ' 项') : '该批没有可撤销的任务', n2 ? 'info' : 'warn')
      return
    }

    if (act === 'undo-item') {
      var n3 = undoItem(ctx, recId, itemId)
      refresh(ctx, S)
      render(root, ctx, S)
      toast(ctx, n3 ? '已撤销这 1 项' : '这项已完成或已撤销', n3 ? 'info' : 'warn')
      return
    }

    if (act === 'undo-all') {
      if (!actConfirmDelete(ctx, '撤销全部 ' + S.stats.active + ' 批可撤销任务？已完成的不受影响。')) return
      var n4 = undoAll(ctx)
      refresh(ctx, S)
      render(root, ctx, S)
      toast(ctx, '已撤销 ' + n4 + ' 项', 'info')
      return
    }

    if (act === 'q-toggle') {
      toggleTask(ctx, recId, itemId)
      refresh(ctx, S)
      render(root, ctx, S)
      return
    }

    if (act === 'q-del') {
      if (!actConfirmDelete(ctx, '从 Store 删除这条任务？对应批次项会标记为已撤销。')) return
      var n5 = deleteTask(ctx, recId, itemId)
      refresh(ctx, S)
      render(root, ctx, S)
      toast(ctx, n5 ? '已删除 1 项' : '这项已不在 Store', 'info')
      return
    }

    if (act === 'q-done-all') {
      var n6 = markAllDone(ctx, S.queue)
      refresh(ctx, S)
      render(root, ctx, S)
      toast(ctx, '已标记完成 ' + n6 + ' 项', 'info')
      return
    }

    if (act === 'q-del-done') {
      if (!actConfirmDelete(ctx, '删除队列里所有已完成的任务？不能撤销。')) return
      var n7 = deleteDone(ctx, S.queue)
      refresh(ctx, S)
      render(root, ctx, S)
      toast(ctx, '已删除 ' + n7 + ' 项', 'info')
      return
    }

    if (act === 'q-show-all') {
      S.showAll = !S.showAll
      render(root, ctx, S)
      return
    }

    if (act === 'tpl-go') {
      setView(ctx, S, root, 'templates')
      return
    }

    if (act === 'tpl-pattern') {
      var pat = patternOf(v)
      if (!pat) return
      var d1 = draft(ctx)
      d1.text = pat.tpl.replace(/\{n\}/g, String(S.check.n))
      saveDraft(ctx, d1)
      refresh(ctx, S)
      setView(ctx, S, root, 'create')
      return
    }

    if (act === 'tpl-save') {
      var nameInput = root.querySelector('[data-act="tpl-name"]')
      var name = flat(nameInput ? nameInput.value : '')
      if (!name) {
        toast(ctx, '先给模板起个名字', 'warn')
        return
      }
      if (!flat(S.draft.text)) {
        toast(ctx, '表单内容为空，不能存成模板', 'warn')
        return
      }
      var tpls = templatesGet(ctx)
      tpls.unshift({
        id: uidOf(ctx),
        name: trunc(name, 30),
        subject: S.check.subject,
        text: flat(S.draft.text),
        count: S.check.n
      })
      S.templates = templatesSave(ctx, tpls)
      render(root, ctx, S)
      toast(ctx, '模板已保存：' + name, 'success')
      return
    }

    if (act === 'tpl-apply') {
      var target = null
      S.templates.forEach(function (t) { if (String(t.id) === String(recId)) target = t })
      if (!target) return
      var d2 = { subject: target.subject, text: target.text, count: target.count }
      saveDraft(ctx, d2)
      refresh(ctx, S)
      setView(ctx, S, root, 'create')
      toast(ctx, '已套用模板：' + target.name, 'info')
      return
    }

    if (act === 'tpl-del') {
      if (!actConfirmDelete(ctx, '删除这个模板？')) return
      S.templates = templatesSave(ctx, S.templates.filter(function (t) {
        return String(t.id) !== String(recId)
      }))
      render(root, ctx, S)
      toast(ctx, '模板已删除', 'info')
      return
    }

    if (act === 'export-json') {
      var okJson = download(ctx, dkey() + '_' + PID + '_history.json',
        JSON.stringify(S.history, null, 2), 'application/json')
      toast(ctx, okJson ? ('已导出 ' + S.history.length + ' 条批次') : '导出失败：宿主未提供下载接口', okJson ? 'success' : 'warn')
      return
    }

    if (act === 'export-md') {
      var okMd = download(ctx, dkey() + '_' + PID + '_report.md',
        reportMD(ctx, S), 'text/markdown;charset=utf-8')
      toast(ctx, okMd ? '报告已导出' : '导出失败：宿主未提供下载接口', okMd ? 'success' : 'warn')
      return
    }

    if (act === 'clear-history') {
      if (!confirm(ctx, '清空 ' + S.history.length + ' 条批次历史？此操作不能撤销。')) return
      S.history = historySave(ctx, [])
      S.active = []
      S.stats = statsOf(S.history)
      S.queue = []
      S.result = null
      render(root, ctx, S)
      toast(ctx, '历史已清空', 'info')
      return
    }

    if (act === 'cfg-toggle') {
      var patch = {}
      patch[v] = !S.cfg[v]
      S.cfg = cfgSet(ctx, patch)
      render(root, ctx, S)
      return
    }
  }

  function render(root, ctx, S) {
    if (!root) return
    var header = '<div class="' + NS + 'tabs" role="tablist">'
      + VIEWS.map(function (x) {
        return '<button class="' + NS + 'tab' + (S.view === x.k ? ' on' : '') + '" data-act="tab" data-v="'
          + x.k + '" role="tab" aria-selected="' + (S.view === x.k ? 'true' : 'false') + '">'
          + esc(x.t) + '</button>'
      }).join('') + '</div>'
    var cur = VIEWS.filter(function (x) { return x.k === S.view })[0] || VIEWS[0]
    var body = ''
    try { body = cur.f(ctx, S) }
    catch (e) { body = '<div class="' + NS + 'empty">这个视图渲染失败了：' + esc((e && e.message) || e) + '</div>' }
    root.innerHTML = '<div class="' + NS + 'page">' + header + body + '</div>'
  }

  function mount(el, ctx) {
    style(ctx)
    migrateLegacy(ctx)
    var S = stateOf(ctx)
    render(el, ctx, S)

    var onClick = function (ev) {
      var t = ev.target
      var node = null
      for (var i = 0; i < 6 && t && t !== el; i++, t = t.parentElement) {
        if (t.getAttribute && t.getAttribute('data-act')) { node = t; break }
      }
      if (!node) return
      ev.preventDefault()
      doAct(ctx, S, el, {
        act: node.getAttribute('data-act'),
        v: node.getAttribute('data-v'),
        rec: node.getAttribute('data-rec'),
        item: node.getAttribute('data-item')
      })
    }

    var onChange = function (ev) {
      var t = ev.target
      if (!t || !t.getAttribute) return
      var act = t.getAttribute('data-act')
      if (act === 'f-subject' || act === 'f-count') {
        var d1 = draft(ctx)
        if (act === 'f-subject') d1.subject = t.value
        else d1.count = t.value
        saveDraft(ctx, d1)
        refresh(ctx, S)
        render(el, ctx, S)
      } else if (act === 'q-toggle') {
        toggleTask(ctx, t.getAttribute('data-rec'), t.getAttribute('data-item'))
        refresh(ctx, S)
        render(el, ctx, S)
      }
    }

    var onInput = function (ev) {
      var t = ev.target
      if (!t || !t.getAttribute) return
      if (t.getAttribute('data-act') !== 'f-text') return
      var d2 = draft(ctx)
      d2.text = t.value
      saveDraft(ctx, d2)
      S.check = validateDraft(ctx, d2)
      S.preview = previewItems(ctx, d2)
      /* 只刷预览区，不整页 render，否则输入框会失焦 */
      updatePreview(el, S)
    }

    el.addEventListener('click', onClick)
    el.addEventListener('change', onChange)
    el.addEventListener('input', onInput)
    return function () {
      el.removeEventListener('click', onClick)
      el.removeEventListener('change', onChange)
      el.removeEventListener('input', onInput)
      el.innerHTML = ''
    }
  }

  /* ══════════════ 8. 面板 ══════════════ */

  function panel(ctx) {
    style(ctx)
    if (!cfgGet(ctx).showPanel) return ''
    var h = historyGet(ctx)
    var st = statsOf(h)
    var last = h[0]
    return '<div class="' + NS + 'panel">'
      + '<div style="display:flex;justify-content:space-between;align-items:center;gap:6px">'
      + '<span>' + I('cpBolt', '批') + ' 批量加任务</span>'
      + '<span class="muted-sm" style="font-size:11px">' + st.active + ' 批可撤销</span></div>'
      + '<div class="' + NS + 'prow">' + (last
        ? '最近：' + esc(trunc(last.text, 20)) + ' · ' + last.n + ' 项'
          + (last.undone ? '（已撤销）' : '')
        : '还没有批量添加过任务。按 alt+t 打开工作台。') + '</div>'
      + '<div class="' + NS + 'acts" style="margin-top:7px">'
      + '<button class="' + NS + 'btn mini" data-act="goTool" data-v="async-form-action-page">打开工作台</button>'
      + '<button class="' + NS + 'btn mini" data-act="undo-last"' + (st.active ? '' : ' disabled') + '>撤销上一批</button>'
      + '</div></div>'
  }

  /* ══════════════ 9. 注册 ══════════════ */

  var api = {
    id: PID,
    name: '异步表单动作',
    version: VERSION,
    author: '内置',
    desc: '批量建任务工作台：表单收参 + 600ms 异步写入 + 实时预览 + 任务队列 + 撤销栈 + 历史导出 + 模板。插件动作自由度演示：教练可带参调用 run，并按契约撤销。',
    tools: [{
      id: 'async-form-action-page',
      title: '批量加任务',
      icon: '' + I('cpBolt', '批') + '',
      mount: function (el, ctx) { return mount(el, ctx) }
    }],
    panels: [{
      id: 'af-today',
      title: '批量加任务',
      icon: '' + I('cpBolt', '批') + '',
      width: 320,
      height: 190,
      render: panel
    }],
    config: [
      { key: 'maxBatch', label: '单次批量上限', type: 'number', default: DEF_MAX }
    ],
    shortcuts: [{
      key: 'alt+t',
      label: '打开批量加任务',
      run: function (ctx) {
        try { if (ctx && ctx.api && ctx.api.goTool) ctx.api.goTool('async-form-action-page') } catch (e) { }
      }
    }],
    queries: [
      /* ★ 原样保留 key 'af-last' 与 label，老提示词和测试都依赖它 */
      {
        key: 'af-last',
        label: '最近批量任务',
        run: function (ctx) {
          var h = historyGet(ctx)
          if (!h.length) return '还没有批量添加过任务。'
          var r = h[0]
          return '最近一次批量加了 ' + r.n + ' 项「' + r.text + '」（' + subjectName(r.subject) + '），'
            + (r.undone ? '这批已撤销。' : '当前还有可撤销任务，可在批量加任务工作台里逐项或整批撤销。')
        }
      },
      {
        key: 'af-stats',
        label: '批量任务统计',
        run: function (ctx) {
          var st = statsOf(historyGet(ctx))
          if (!st.batches) return '还没有批量添加过任务，没有可统计的批次。'
          var parts = Object.keys(st.bySubject).map(function (k) {
            return subjectName(k) + ' ' + st.bySubject[k] + ' 项'
          })
          return '共 ' + st.batches + ' 批、累计写入 ' + st.total + ' 项，其中 ' + st.active
            + ' 批可撤销、已撤销 ' + st.undoneN + ' 项。按科目：' + parts.join('、') + '。'
        }
      },
      {
        key: 'af-undo',
        label: '可撤销批次',
        run: function (ctx) {
          var active = activeOf(historyGet(ctx))
          if (!active.length) return '当前没有可撤销的批次。'
          return '有 ' + active.length + ' 批可撤销：' + active.slice(0, 3).map(function (r, i) {
            return (i + 1) + '）' + r.text + '（' + r.n + ' 项）'
          }).join('；') + '。已完成的任务不会被撤销。'
        }
      },
      {
        key: 'af-templates',
        label: '批量模板清单',
        run: function (ctx) {
          var t = templatesGet(ctx)
          if (!t.length) return '还没有保存批量模板。可以在工作台里把常用的科目/内容/数量存成模板。'
          return '已存 ' + t.length + ' 个模板：' + t.map(function (x) {
            return x.name + '（' + subjectName(x.subject) + '·' + x.count + ' 项）'
          }).join('；') + '。'
        }
      }
    ],
    hooks: {
      taskDone: function (ctx) {
        /* 站内勾选完成时，把批次项的 done 状态同步回来，避免撤销栈里显示过期状态 */
        try { syncAllItems(ctx) } catch (e) { }
      }
    },
    memory: '用户装有「异步表单动作」插件：工具页有批量建任务/任务队列/撤销栈/历史记录/模板/设置六个视图。'
      + '教练可带 subject/text/count 调 batchAddTasks 动作异步批量加任务（600ms），并按契约撤销；'
      + '用户问「最近批量加了什么」（af-last）、「批量统计」（af-stats）、「还有哪些能撤销」（af-undo）、'
      + '「有哪些模板」（af-templates）时查对应接口。撤销只动未完成任务，已完成的不碰。',

    /* ★ 原 action 的 type / needs / run / undo 语义保持并加强 */
    actions: [{
      type: 'batchAddTasks',
      label: '批量加任务',
      auto: false,
      needs: {
        title: '批量加任务',
        fields: [
          {
            key: 'subject', label: '科目', type: 'select',
            options: [
              { v: 'math', t: '数学' },
              { v: 'eng', t: '英语' },
              { v: 'pol', t: '政治' },
              { v: 'major', t: '专业课' }
            ]
          },
          { key: 'text', label: '任务内容', type: 'text', placeholder: '如：极限专题 20 题' },
          { key: 'count', label: '重复数量', type: 'number', placeholder: '默认 1' }
        ]
      },
      run: function (ctx, a) {
        return new Promise(function (resolve, reject) {
          addTasks(ctx, a, function (ok, added) {
            if (ok) resolve('已加 ' + added.length + ' 项任务')
            else reject(new Error('写入任务失败'))
          })
        })
      },
      undo: function (ctx, a) {
        var n = undoLast(ctx)
        ctx.log('撤销批量加任务 ' + n + ' 项')
      },
    }],
  }

  if (typeof window !== 'undefined' && window.__AF_DEBUG__) {
    window.__afInternals = {
      esc: esc, num: num, clamp: clamp, flat: flat, trunc: trunc, dkey: dkey, fmtTime: fmtTime,
      I: I, max: max, subjectName: subjectName, clampCount: clampCount,
      cfgGet: cfgGet, cfgSet: cfgSet, draft: draft, saveDraft: saveDraft,
      historyGet: historyGet, historySave: historySave, migrateLegacy: migrateLegacy,
      templatesGet: templatesGet, templatesSave: templatesSave,
      validateDraft: validateDraft, previewItems: previewItems, statsOf: statsOf,
      taskMap: taskMap, queueOf: queueOf, syncAllItems: syncAllItems,
      addTasks: addTasks, undoItem: undoItem, undoRecord: undoRecord,
      undoLast: undoLast, undoAll: undoAll, deleteTask: deleteTask, toggleTask: toggleTask,
      reportMD: reportMD, doAct: doAct, render: render, mount: mount, panel: panel,
      VIEWS: VIEWS, SUBJECTS: SUBJECTS, PATTERNS: PATTERNS,
      MAX_HISTORY: MAX_HISTORY, MAX_TEMPLATES: MAX_TEMPLATES, ASYNC_MS: ASYNC_MS
    }
  }

  PluginBus.register(api)
})()
