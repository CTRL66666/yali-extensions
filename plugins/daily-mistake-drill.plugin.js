/* daily-mistake-drill.plugin.js — 每日错题唤醒 · v2.0.0
 *
 * v1.1.0 只有一条 21:00 定时器 + 一个按 reviewedAt 排序的列表（168 行）。
 * 它能把题弹出来，却回答不了三个真正影响复习的问题：
 *   1）今晚轮到哪一道、之前自评过几次；
 *   2）哪些题反复"没记住"，该插队到多近；
 *   3）自评记录能不能留下来给自己看、导出给教练看。
 * v2.0.0 按成熟插件形态重造：多视图 shell + 自评事件流 + 有依据的判断 + 导出。
 *
 * 【兼容契约 · 一个都不改】
 *   · VERSION 2.0.0；PID / 工具 id 'daily-mistake-drill-page'；
 *   · 面板 id 'dm-due'；查询 key 'dm-due'（key / label / 核心口径原样）；
 *   · 快捷键 alt+m；config key 'focusOnOpen'；
 *   · 21:00 定时器：id、label、选"最久未回顾"的 ms[0]、Modal 三按钮、
 *     写回字段 reviewedAt / needRetell —— 全部沿用 v1.1.0 语义；
 *   · 核心交互"先自己想，再翻开答案自评（记住了/没记住）"不仅保留，且翻卡前不显示答案与自评按钮。
 *
 * 【数据口径 · 单一来源】
 *   · 当前题目、reviewedAt、needRetell 一律现读 ctx.Store.get()，本插件不缓存副本；
 *   · 只有两类历史是自己落的（存在 ctx.data，不进 Store 主集合）：
 *       dmHistory —— 每次自评一条事件（有上限）；
 *       dmDaily   —— 每天一条待唤醒数量快照（同日覆盖，用于看趋势）。
 */
;(function () {
  'use strict'

  var VERSION = '2.0.0'
  var PID = 'daily-mistake-drill'
  var NS = 'dm-'

  var K_HISTORY = 'dmHistory'       // 自评事件流（每次记住/没记住一条）
  var K_DAILY = 'dmDaily'           // 每日待唤醒数量快照（每天一条）
  var K_CFG = 'dmConfig'            // 插件内部配置
  var K_LAST_VIEW = 'dmLastView'    // 记住上次视图
  var K_FILTER = 'dmFilter'         // 沿用 v1.1.0 的筛选 key
  var K_SUBJECT = 'dmSubject'       // 队列页科目筛选

  var MAX_HISTORY = 300             // 事件上限，超出丢最老的
  var MAX_DAILY = 180               // 日快照上限（半年）
  var DAY = 86400000

  var FILTER_LABEL = { due: '待唤醒', all: '全部', done: '已记住' }
  var FILTER_FROM_CONFIG = { '待唤醒': 'due', '全部': 'all', '已记住': 'done' }

  /* ══════════════ 1. 基础工具（无依赖，可单测） ══════════════ */

  /** 所有渲染进 HTML 的用户输入都必须过这一层 —— 错题题干来自拍照/粘贴，不可信 */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
    })
  }
  function num(v, d) { var n = Number(v); return isFinite(n) ? n : (d === undefined ? 0 : d) }
  function clamp(v, a, b, d) { var n = num(v, d === undefined ? a : d); return Math.max(a, Math.min(b, n)) }
  function flat(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim() }
  function trunc(s, n) {
    s = flat(s)
    return s.length > n ? s.slice(0, n - 1) + '…' : s
  }
  function dkey(t) {
    var d = t == null ? new Date() : (t instanceof Date ? t : new Date(t))
    if (isNaN(d.getTime())) d = new Date()
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
  }
  function shiftDay(key, delta) {
    var p = String(key || dkey()).split('-')
    var d = new Date(num(p[0], 1970), num(p[1], 1) - 1, num(p[2], 1))
    d.setDate(d.getDate() + delta)
    return dkey(d)
  }
  function dayDiff(a, b) {
    var pa = String(a || '').split('-'), pb = String(b || '').split('-')
    var da = Date.UTC(num(pa[0]), num(pa[1]) - 1, num(pa[2]))
    var db = Date.UTC(num(pb[0]), num(pb[1]) - 1, num(pb[2]))
    if (!isFinite(da) || !isFinite(db)) return 0
    return Math.round((db - da) / DAY)
  }
  function agoText(iso) {
    if (!iso) return '还没回顾过'
    var d = dayDiff(dkey(iso), dkey())
    if (d <= 0) return '今天回顾过'
    if (d === 1) return '昨天回顾过'
    if (d < 30) return d + ' 天前回顾过'
    return dkey(iso) + ' 回顾过'
  }
  function rate(ok, all) { return all > 0 ? Math.round(ok / all * 100) : 0 }

  /** 图标统一走站内 U.icon，拿不到就退成文字 —— 绝不写原生 emoji（用户明确要求） */
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
    try {
      if (ctx && ctx.Toast && typeof ctx.Toast.show === 'function') {
        ctx.Toast.show(String(msg), level === 'danger' ? 'error' : (level || 'info'))
        return
      }
    } catch (e) { }
    try { if (ctx && typeof ctx.notify === 'function') ctx.notify({ title: String(msg), level: level || 'info', timeout: 3200 }) }
    catch (e2) { }
  }
  function safeStore(ctx) {
    try { return (ctx && ctx.Store && typeof ctx.Store.get === 'function') ? (ctx.Store.get() || {}) : {} }
    catch (e) { return {} }
  }
  /** 站点 config 的读取方式在不同宿主里不一样，这里做防御式适配 */
  function configOf(ctx, key, dflt) {
    try {
      var c = ctx && ctx.config
      if (typeof c === 'function') { var a = c(key); if (a != null) return a }
      if (c && typeof c === 'object' && c[key] != null) return c[key]
    } catch (e) { }
    return dflt
  }

  /* ══════════════ 2. 配置层 ══════════════ */

  function cfgGet(ctx) {
    var d = { focusOnOpen: '待唤醒', showPanel: true, autoRecord: true, baseInterval: 3, weakTimes: 2 }
    var got = null
    try { got = ctx && typeof ctx.data === 'function' ? ctx.data(K_CFG) : null } catch (e) { }
    if (!got || typeof got !== 'object') return d
    if (FILTER_FROM_CONFIG[got.focusOnOpen]) d.focusOnOpen = got.focusOnOpen
    d.showPanel = got.showPanel !== false
    d.autoRecord = got.autoRecord !== false
    if ([3, 5, 7].indexOf(num(got.baseInterval, 3)) >= 0) d.baseInterval = num(got.baseInterval, 3)
    d.weakTimes = clamp(got.weakTimes, 2, 5, 2)
    return d
  }
  function cfgSet(ctx, patch) {
    var d = cfgGet(ctx)
    Object.keys(patch || {}).forEach(function (k) { if (k in d) d[k] = patch[k] })
    try { if (ctx && typeof ctx.data === 'function') ctx.data(K_CFG, d) } catch (e) { }
    return d
  }
  function filterOf(ctx) {
    var f = 'due'
    try { if (ctx && ctx.keep && typeof ctx.keep.get === 'function') f = ctx.keep.get(K_FILTER) || f } catch (e) { }
    if (!FILTER_LABEL[f]) {
      /* 首次打开没有本地筛选时，跟随站点 config 的 focusOnOpen */
      var label = String(configOf(ctx, 'focusOnOpen', cfgGet(ctx).focusOnOpen))
      f = FILTER_FROM_CONFIG[label] || 'due'
    }
    return f
  }
  function setFilter(ctx, f) {
    if (!FILTER_LABEL[f]) return
    try { if (ctx && ctx.keep && typeof ctx.keep.set === 'function') ctx.keep.set(K_FILTER, f) } catch (e) { }
  }
  function subjectOf(ctx) {
    var s = '全部'
    try { if (ctx && ctx.keep && typeof ctx.keep.get === 'function') s = ctx.keep.get(K_SUBJECT) || s } catch (e) { }
    return s
  }
  function setSubject(ctx, s) {
    try { if (ctx && ctx.keep && typeof ctx.keep.set === 'function') ctx.keep.set(K_SUBJECT, s) } catch (e) { }
  }

  /* ══════════════ 3. 数据层：当前现读 Store / 历史落 ctx.data ══════════════ */

  /**
   * 当前错题：沿用 v1.1.0 的口径与排序（reviewedAt 或 createdAt 升序，最久未回顾的排第一）。
   * 注意：这里得出的 dueList 是"当前值"，绝不写回 ctx.data。
   */
  function list(ctx) {
    var s = safeStore(ctx)
    var ms = Array.isArray(s.mistakes) ? s.mistakes.filter(function (m) { return m && (m.stem || m.desc) }) : []
    return ms.slice().sort(function (a, b) {
      return String(a.reviewedAt || a.createdAt || '').localeCompare(String(b.reviewedAt || b.createdAt || ''))
    })
  }
  function isDue(m) { return !!m && (!m.reviewedAt || !!m.needRetell) }
  function dueOf(all) { return (all || []).filter(isDue) }
  function shownOf(all, f) {
    if (f === 'due') return dueOf(all)
    if (f === 'done') return (all || []).filter(function (m) { return !!m.reviewedAt && !m.needRetell })
    return all || []
  }
  /** 科目：优先用显式字段，其次用标签/来源描述，最后落"未分类"。不臆造科目。 */
  function subjectOfMistake(m) {
    var keys = ['subject', 'subjectName', 'category', 'tag', 'tags', 'group', 'course', 'type']
    for (var i = 0; i < keys.length; i++) {
      var v = m[keys[i]]
      if (Array.isArray(v)) v = v.length ? v[0] : ''
      if (v && typeof v === 'object') v = v.name || v.title || ''
      var t = flat(v)
      if (t && t !== 'undefined' && t !== 'null') return trunc(t, 14)
    }
    return '未分类'
  }
  function subjectsOf(all) {
    var map = {}, out = []
    ;(all || []).forEach(function (m) {
      var s = subjectOfMistake(m)
      if (!map[s]) { map[s] = 1; out.push(s) }
    })
    return out.sort(function (a, b) { return a.localeCompare(b) })
  }

  function historyGet(ctx) {
    var arr = null
    try { arr = ctx && typeof ctx.data === 'function' ? ctx.data(K_HISTORY) : null } catch (e) { }
    if (!Array.isArray(arr)) return []
    return arr.filter(function (x) {
      return x && typeof x === 'object' && /^\d{4}-\d{2}-\d{2}$/.test(String(x.day || ''))
    }).map(function (x) {
      return {
        day: String(x.day), at: num(x.at, Date.now()),
        id: String(x.id == null ? '' : x.id), stem: flat(x.stem),
        subject: subjectClean(x.subject), remembered: !!x.remembered
      }
    }).sort(function (a, b) { return a.at - b.at }).slice(-MAX_HISTORY)
  }
  function subjectClean(s) {
    var t = flat(s)
    return t && t !== 'undefined' ? trunc(t, 14) : '未分类'
  }
  function historySave(ctx, arr) {
    var out = (arr || []).slice(-MAX_HISTORY)
    try { if (ctx && typeof ctx.data === 'function') ctx.data(K_HISTORY, out) } catch (e) { }
    return out
  }
  /** 每次自评落一条事件。事件里存题干快照：题目以后被删/改，历史仍可解释。 */
  function logGrade(ctx, m, remembered) {
    var arr = historyGet(ctx)
    arr.push({
      day: dkey(), at: Date.now(),
      id: String(m.id == null ? '' : m.id),
      stem: trunc(m.stem || m.desc || '', 72),
      subject: subjectOfMistake(m),
      remembered: !!remembered
    })
    historySave(ctx, arr)
    return arr
  }

  function dailyGet(ctx) {
    var arr = null
    try { arr = ctx && typeof ctx.data === 'function' ? ctx.data(K_DAILY) : null } catch (e) { }
    if (!Array.isArray(arr)) return []
    return arr.filter(function (x) { return x && /^\d{4}-\d{2}-\d{2}$/.test(String(x.day || '')) })
      .map(function (x) {
        return { day: String(x.day), due: num(x.due), total: num(x.total), graded: num(x.graded), at: num(x.at) }
      })
      .sort(function (a, b) { return String(a.day).localeCompare(String(b.day)) })
      .slice(-MAX_DAILY)
  }
  function dailySave(ctx, arr) {
    var out = (arr || []).slice(-MAX_DAILY)
    try { if (ctx && typeof ctx.data === 'function') ctx.data(K_DAILY, out) } catch (e) { }
    return out
  }
  /** 每天最多一条；force=true 用当前值覆盖今天那条。 */
  function recordDaily(ctx, force) {
    var all = list(ctx), due = dueOf(all).length
    var day = dkey()
    var arr = dailyGet(ctx)
    var gradedToday = historyGet(ctx).filter(function (x) { return x.day === day }).length
    var last = arr.length ? arr[arr.length - 1] : null
    if (last && last.day === day && !force) return arr
    var rec = { day: day, due: due, total: all.length, graded: gradedToday, at: Date.now() }
    if (last && last.day === day) arr[arr.length - 1] = rec
    else arr.push(rec)
    return dailySave(ctx, arr)
  }

  /**
   * 自评写回：字段与 v1.1.0 完全一致 —— reviewedAt 写 ISO 时间戳，
   * 没记住时打 needRetell，记住时若曾打过则清掉。然后用 Toast 给出反馈。
   */
  function mark(ctx, m, remembered) {
    if (!m) return false
    var touched = false
    try {
      ctx.Store.update(function (s) {
        var arr = Array.isArray(s.mistakes) ? s.mistakes : []
        for (var i = 0; i < arr.length; i++) {
          var t = arr[i]
          if (!t) continue
          if (String(t.id) === String(m.id) || (!t.id && t === m)) {
            t.reviewedAt = new Date().toISOString()
            if (!remembered) t.needRetell = true
            else if (t.needRetell) t.needRetell = false
            touched = true
            break
          }
        }
      })
    } catch (e) { }
    logGrade(ctx, m, remembered)
    recordDaily(ctx, true)
    toast(ctx, remembered ? '已记录：记住了，它会更晚再来' : '已标记：没记住，明天的队列里它排前面',
      remembered ? 'success' : 'info')
    return touched
  }

  /* ══════════════ 4. 分析层：有依据的判断 ══════════════ */

  /** 按题聚合自评历史：忘了几次、记住几次、最近一次结果。 */
  function failureMap(hist) {
    var map = {}
    ;(hist || []).forEach(function (x) {
      var k = x.id || ('stem:' + x.stem)
      if (!map[k]) map[k] = { id: k, stem: x.stem, subject: x.subject, miss: 0, ok: 0, lastAt: 0, lastOk: false }
      var r = map[k]
      if (x.remembered) r.ok++
      else r.miss++
      if (x.at >= r.lastAt) { r.lastAt = x.at; r.lastOk = x.remembered }
      if (!r.stem) r.stem = x.stem
    })
    return map
  }
  function weakList(map, times) {
    var out = []
    Object.keys(map || {}).forEach(function (k) {
      var r = map[k]
      if (r.miss >= Math.max(2, num(times, 2))) out.push(r)
    })
    return out.sort(function (a, b) {
      if (b.miss !== a.miss) return b.miss - a.miss
      return b.lastAt - a.lastAt
    })
  }
  function recurringStats(hist) {
    var map = failureMap(hist)
    var multi = 0, total = 0
    Object.keys(map).forEach(function (k) {
      total++
      if (map[k].miss >= 2) multi++
    })
    return { total: total, multi: multi }
  }
  function gradeSeries(hist, days) {
    var map = {}
    ;(hist || []).forEach(function (x) {
      if (!map[x.day]) map[x.day] = { ok: 0, no: 0 }
      if (x.remembered) map[x.day].ok++
      else map[x.day].no++
    })
    var out = []
    for (var i = days - 1; i >= 0; i--) {
      var k = shiftDay(dkey(), -i)
      var v = map[k] || { ok: 0, no: 0 }
      out.push({ day: k, ok: v.ok, no: v.no, has: !!map[k] })
    }
    return out
  }
  function statsOf(hist, days) {
    var s = gradeSeries(hist, days || 7)
    var ok = 0, no = 0
    s.forEach(function (x) { ok += x.ok; no += x.no })
    var half = Math.floor(s.length / 2)
    var headOk = 0, headAll = 0, tailOk = 0, tailAll = 0
    s.forEach(function (x, i) {
      if (i < half) { headOk += x.ok; headAll += x.ok + x.no }
      else { tailOk += x.ok; tailAll += x.ok + x.no }
    })
    var delta = rate(tailOk, tailAll) - rate(headOk, headAll)
    return {
      series: s, ok: ok, no: no, all: ok + no, rate: rate(ok, ok + no),
      delta: delta, trend: tailAll === 0 || headAll === 0 ? 'unknown' : (delta >= 5 ? 'up' : (delta <= -5 ? 'down' : 'flat'))
    }
  }

  /** 间隔建议：只按"累计忘记次数 + 当前 reviewedAt"给区间，不冒充记忆算法。 */
  function intervalOf(r, cfg, m) {
    var miss = r ? r.miss : 0
    var ok = r ? r.ok : 0
    var base = num(cfg.baseInterval, 3)
    var days = m && m.reviewedAt ? dayDiff(dkey(m.reviewedAt), dkey()) : -1
    if (miss >= 2) return { days: 1, text: '累计忘 ' + miss + ' 次，建议明天再唤醒' }
    if (miss === 1) return { days: base, text: '忘过 1 次，建议 ' + base + ' 天后再来' }
    if (ok >= 3 && miss === 0) return { days: base * 5, text: '连对 ' + ok + ' 次，建议 ' + (base * 5) + ' 天后再来' }
    if (ok >= 1 && miss === 0) return { days: base * 2, text: '记住 ' + ok + ' 次，建议 ' + (base * 2) + ' 天后再来' }
    return { days: base, text: '还没有足够自评记录，先按 ' + base + ' 天试一次' }
  }

  /** 判断必须带证据；数据不足时如实说不足，不编结论。 */
  function insightsOf(S) {
    var out = []
    var hist = S.hist || [], cfg = S.cfg
    var st = statsOf(hist, 7)
    var due = S.dueList.length
    var rec = recurringStats(hist)
    var todayGraded = hist.filter(function (x) { return x.day === dkey() }).length

    if (hist.length < 3) {
      out.push({ level: 'info', title: '自评记录还不足以判断趋势',
        body: '目前只有 ' + hist.length + ' 条自评（至少 3 条才看趋势）。在这之前这里不编结论，先把今晚这张翻完。' })
    } else {
      if (st.trend === 'down') {
        out.push({ level: 'warn', title: '记住率在往下走',
          body: '近 7 天自评 ' + st.all + ' 次，记住 ' + st.ok + ' 次（' + st.rate + '%），'
            + '比前半段低 ' + Math.abs(st.delta) + ' 个百分点。先查是不是复习间隔拉得太长。' })
      } else if (st.trend === 'up') {
        out.push({ level: 'good', title: '记住率在回升',
          body: '近 7 天自评 ' + st.all + ' 次，记住 ' + st.ok + ' 次（' + st.rate + '%），'
            + '比前半段高 ' + st.delta + ' 个百分点。当前节奏可以继续。' })
      } else {
        out.push({ level: 'info', title: '记住率基本持平',
          body: '近 7 天自评 ' + st.all + ' 次，记住 ' + st.ok + ' 次（' + st.rate + '%）。'
            + '没有明显涨跌，这时更该看具体哪几题反复错。' })
      }
    }
    if (rec.multi > 0) {
      var w = weakList(S.fails, cfg.weakTimes)
      out.push({ level: 'warn', title: '有 ' + rec.multi + ' 题反复没记住',
        body: '在 ' + rec.total + ' 道被自评过的题里，' + rec.multi + ' 道至少忘过两次；'
          + '其中「' + trunc(w[0].stem || '未命名题目', 22) + '」忘了 ' + w[0].miss + ' 次。建议插队到明天的首位。' })
    } else if (hist.length >= 3) {
      out.push({ level: 'good', title: '没有出现反复忘记的题',
        body: '已自评的 ' + rec.total + ' 道题里，没有哪道忘过两次以上。' })
    }
    if (due >= 5) {
      out.push({ level: 'warn', title: '待唤醒已经堆到 ' + due + ' 道',
        body: '最久未回顾的那道会先来。一次翻完不如每天清最老的几道，抗遗忘效果更好。' })
    }
    if (todayGraded === 0 && due > 0) {
      out.push({ level: 'info', title: '今天还没有自评记录',
        body: '待唤醒 ' + due + ' 道。每天 21:00 的提醒弹的就是最久未回顾那道，也可以现在提前翻。' })
    }
    if (!out.length) {
      out.push({ level: 'info', title: '暂时没有可说的结论',
        body: '待唤醒 0 道，历史里也没有可归纳的模式。这是数据事实，不是"学得很好"的证明。' })
    }
    return out.slice(0, 6)
  }

  /** 统一的派生状态：视图只读取它，不自己再算一遍。 */
  function refresh(S, ctx) {
    S.hist = historyGet(ctx)
    S.daily = dailyGet(ctx)
    S.all = list(ctx)
    S.dueList = dueOf(S.all)
    S.shown = shownOf(S.all, S.viewFilter || 'due')
    S.subjects = subjectsOf(S.all)
    S.fails = failureMap(S.hist)
    S.insights = insightsOf(S)
    S.st7 = statsOf(S.hist, 7)
    S.weak = weakList(S.fails, S.cfg.weakTimes)
    if (S.cardIndex >= S.dueList.length) S.cardIndex = Math.max(0, S.dueList.length - 1)
    if (S.cardIndex < 0) S.cardIndex = 0
    return S
  }
  function stateOf(ctx) {
    var v = 'today'
    try { if (ctx && ctx.keep && typeof ctx.keep.get === 'function') v = ctx.keep.get(K_LAST_VIEW) || v } catch (e) { }
    var S = {
      root: null, cfg: cfgGet(ctx), view: VIEWS.some(function (x) { return x.k === v }) ? v : 'today',
      viewFilter: filterOf(ctx), subject: subjectOf(ctx), sort: 'oldest',
      cardIndex: 0, flipToday: false, flipCard: false, openIds: {},
      hist: [], daily: [], all: [], dueList: [], shown: [], subjects: [], fails: {}, insights: [], st7: null, weak: []
    }
    return refresh(S, ctx)
  }
  function setView(ctx, S, v) {
    if (!VIEWS.some(function (x) { return x.k === v })) return
    S.view = v
    try { if (ctx && ctx.keep && typeof ctx.keep.set === 'function') ctx.keep.set(K_LAST_VIEW, v) } catch (e) { }
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
    '.' + NS + 'kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:9px}',
    '.' + NS + 'kpi{border:1px solid var(--line);border-radius:11px;padding:11px 12px;background:var(--glass-bg);min-width:0}',
    '.' + NS + 'kpi b{display:block;font-size:19px;line-height:1.35;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.' + NS + 'kpi span{font-size:11px;color:var(--text-secondary)}',
    '.' + NS + 'kpi i{font-style:normal;font-size:10px;margin-left:4px;color:var(--text-secondary)}',
    '.' + NS + 'card{border:1px solid var(--line);border-radius:12px;padding:14px 16px;background:var(--glass-bg)}',
    '.' + NS + 'card h4{margin:0 0 10px;font-size:13.5px;display:flex;align-items:center;gap:7px}',
    '.' + NS + 'card-hd{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:10px;flex-wrap:wrap}',
    '.' + NS + 'card-hd h4{margin:0}',
    '.' + NS + 'grid2{display:grid;grid-template-columns:1fr 1fr;gap:12px}',
    '.' + NS + 'recall{border:1px solid var(--line);border-radius:13px;padding:16px 18px;background:var(--glass-bg);position:relative}',
    '.' + NS + 'recall .stem{font-size:14px;line-height:1.8;white-space:pre-wrap;word-break:break-word}',
    '.' + NS + 'recall .opts{margin-top:8px;color:var(--text-secondary);font-size:12.5px;line-height:1.8}',
    '.' + NS + 'recall .ans{margin-top:12px;border-top:1px dashed var(--line);padding-top:11px;font-size:12.5px;line-height:1.85;color:var(--text-secondary);white-space:pre-wrap;word-break:break-word}',
    '.' + NS + 'recall .hint{margin-top:12px;padding:11px;border-radius:9px;border:1px dashed var(--line);font-size:12.5px;color:var(--text-secondary);line-height:1.75}',
    '.' + NS + 'meta{display:flex;gap:8px;flex-wrap:wrap;font-size:11px;color:var(--text-secondary);margin-bottom:9px}',
    '.' + NS + 'tag{border:1px solid var(--line);border-radius:999px;padding:2px 8px;font-size:10.5px;color:var(--text-secondary)}',
    '.' + NS + 'tag.warn{border-color:var(--danger,#d9534f);color:var(--danger,#d9534f)}',
    '.' + NS + 'acts{display:flex;gap:7px;flex-wrap:wrap;margin-top:11px;align-items:center}',
    '.' + NS + 'btn{border:1px solid var(--line);background:var(--glass-bg);color:var(--text-primary);border-radius:8px;padding:6px 12px;font-size:11.5px;cursor:pointer;transition:.15s}',
    '.' + NS + 'btn:hover{border-color:var(--accent-text);color:var(--accent-text)}',
    '.' + NS + 'btn.pri{background:var(--accent-text);border-color:var(--accent-text);color:var(--btn-text,#fff)}',
    '.' + NS + 'btn.ok{background:var(--ok,#2e9e5b);border-color:var(--ok,#2e9e5b);color:#fff}',
    '.' + NS + 'btn.no{background:var(--danger,#d9534f);border-color:var(--danger,#d9534f);color:#fff}',
    '.' + NS + 'note{display:flex;gap:9px;padding:9px 11px;border-radius:10px;margin-bottom:8px;border-left:3px solid var(--line);background:var(--glass-bg);font-size:12px;line-height:1.7}',
    '.' + NS + 'note.warn{border-left-color:var(--danger,#d9534f)}',
    '.' + NS + 'note.good{border-left-color:var(--ok,#2e9e5b)}',
    '.' + NS + 'note.info{border-left-color:var(--blue,var(--accent-text))}',
    '.' + NS + 'note b{display:block;font-size:12.5px;margin-bottom:2px}',
    '.' + NS + 'chips{display:flex;gap:6px;flex-wrap:wrap}',
    '.' + NS + 'chip{border:1px solid var(--line);background:transparent;color:var(--text-secondary);border-radius:999px;padding:4px 11px;font-size:11px;cursor:pointer}',
    '.' + NS + 'chip.on{background:var(--accent-text);border-color:var(--accent-text);color:var(--btn-text,#fff)}',
    '.' + NS + 'item{border:1px solid var(--line);border-radius:11px;padding:11px 13px;background:var(--glass-bg)}',
    '.' + NS + 'item + .item{margin-top:8px}',
    '.' + NS + 'item .top{display:flex;justify-content:space-between;gap:8px;align-items:flex-start}',
    '.' + NS + 'item .t{font-size:12.5px;line-height:1.7;word-break:break-word;min-width:0}',
    '.' + NS + 'row{display:flex;justify-content:space-between;align-items:center;gap:8px;font-size:12px;padding:8px 0;border-bottom:1px dashed var(--line)}',
    '.' + NS + 'row:last-child{border-bottom:0}',
    '.' + NS + 'row span{color:var(--text-secondary);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.' + NS + 'row b{white-space:nowrap}',
    '.' + NS + 'table{width:100%;border-collapse:collapse;font-size:12px}',
    '.' + NS + 'table th{text-align:left;color:var(--text-secondary);font-weight:500;padding:7px 8px;border-bottom:1px solid var(--line);font-size:11px}',
    '.' + NS + 'table td{padding:7px 8px;border-bottom:1px dashed var(--line);word-break:break-word}',
    '.' + NS + 'table tr:last-child td{border-bottom:0}',
    '.' + NS + 'chart{display:flex;align-items:flex-end;gap:6px;height:122px;padding:6px 2px 21px;position:relative}',
    '.' + NS + 'col{flex:1;min-width:14px;height:100%;display:flex;flex-direction:column-reverse;justify-content:flex-start;gap:1px;position:relative}',
    '.' + NS + 'col i{display:block;width:100%;border-radius:3px 3px 0 0;min-height:0}',
    '.' + NS + 'col i.ok{background:var(--ok,#2e9e5b);opacity:.85}',
    '.' + NS + 'col i.no{background:var(--danger,#d9534f);opacity:.8}',
    '.' + NS + 'col.empty{background:var(--line);opacity:.4;border-radius:4px 4px 0 0}',
    '.' + NS + 'col em{position:absolute;bottom:-19px;left:-5px;right:-5px;text-align:center;font-size:9.5px;font-style:normal;color:var(--text-secondary);white-space:nowrap}',
    '.' + NS + 'legend{display:flex;gap:12px;font-size:11px;color:var(--text-secondary);margin-top:4px}',
    '.' + NS + 'legend i{display:inline-block;width:9px;height:9px;border-radius:2px;margin-right:4px;vertical-align:0}',
    '.' + NS + 'field{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:9px 0;border-bottom:1px dashed var(--line);font-size:12px}',
    '.' + NS + 'field:last-child{border-bottom:0}',
    '.' + NS + 'field label{color:var(--text-secondary)}',
    '.' + NS + 'field select,.dm-field input{border:1px solid var(--line);border-radius:8px;background:var(--bg-muted,var(--glass-bg));color:var(--text-primary);padding:5px 9px;font-size:12px}',
    '.' + NS + 'empty{color:var(--text-secondary);font-size:12px;line-height:1.8;padding:16px 0;text-align:center}',
    '.' + NS + 'ic{display:inline-flex;align-items:center;justify-content:center;width:15px;height:15px;vertical-align:-2px}',
    '.' + NS + 'ic svg{width:15px;height:15px;fill:none;stroke:currentColor;stroke-width:1.8}',
    '.' + NS + 'prog{height:8px;border-radius:99px;background:var(--line);overflow:hidden;margin:7px 0 3px}',
    '.' + NS + 'prog i{display:block;height:100%;border-radius:99px;background:var(--accent-text)}',
    '.' + NS + 'panel{display:flex;flex-direction:column;gap:8px;font-size:12px}',
    '.' + NS + 'panel .kpi{display:flex;justify-content:space-between;align-items:center}',
    '.' + NS + 'panel .kpi b{font-size:19px;color:var(--accent-text)}',
    '@media(max-width:820px){.' + NS + 'kpis{grid-template-columns:repeat(2,1fr)}.' + NS + 'grid2{grid-template-columns:1fr}}',
    'html[data-theme="night"] .' + NS + 'col i.ok{opacity:.7}'
  ].join('\n')

  function style(ctx) {
    try { if (ctx && ctx.css && typeof ctx.css.add === 'function') ctx.css.add(CSS, 'skin') } catch (e) { }
  }

  /* ══════════════ 6. 视图 ══════════════ */

  /** 回忆卡主体：翻卡前只有题干和"先自己想"提示，翻卡后才出现答案与自评按钮。 */
  function recallCard(m, flipped, prefix, index, total) {
    if (!m) return '<div class="' + NS + 'empty">队列空了。去错题本加题，或者切到「历史」看看之前的自评。</div>'
    var front = esc(m.stem || m.desc || '')
    var opts = (Array.isArray(m.options) && m.options.length)
      ? m.options.map(function (o) { return esc(o) }).join('<br>') : ''
    var subject = subjectOfMistake(m)
    /* prefix 决定用哪一组 data-act，避免在视图里再判断当前是哪个页面 */
    var flipAct = prefix + '-flip'
    var okAct = prefix + '-ok'
    var noAct = prefix + '-no'
    var out = []
    out.push('<div class="' + NS + 'recall">')
    out.push('<div class="' + NS + 'meta"><span class="' + NS + 'tag">' + esc(subject) + '</span>'
      + '<span class="' + NS + 'tag">' + esc(agoText(m.reviewedAt)) + '</span>'
      + (m.needRetell ? '<span class="' + NS + 'tag warn">待重述</span>' : '')
      + (index != null ? '<span class="' + NS + 'tag">' + (index + 1) + ' / ' + total + '</span>' : '')
      + '</div>')
    out.push('<div class="' + NS + 'stem">' + front + '</div>')
    if (opts) out.push('<div class="' + NS + 'opts">' + opts + '</div>')
    if (!flipped) {
      out.push('<div class="' + NS + 'hint">' + I('cpBrain', '想')
        + ' 先自己想一遍：思路是什么、答案是什么、容易错在哪一步。想过了再翻答案自评。</div>')
      out.push('<div class="' + NS + 'acts"><button class="' + NS + 'btn pri" data-act="' + flipAct
        + '" data-v="' + esc(String(m.id == null ? '' : m.id)) + '">' + I('eye', '翻') + ' 翻开答案与解析</button></div>')
    } else {
      out.push('<div class="' + NS + 'ans"><b>答案：</b>' + esc(m.answer == null ? '—' : m.answer)
        + (m.solution ? '<br><b>解析：</b>' + esc(m.solution) : '')
        + '<br><b>来源：</b>' + esc(m.desc || '错题本') + '</div>')
      out.push('<div class="' + NS + 'acts"><span class="muted-sm" style="font-size:11.5px">对照后如实自评：</span>'
        + '<button class="' + NS + 'btn ok" data-act="' + okAct + '" data-v="' + esc(String(m.id == null ? '' : m.id)) + '">'
        + I('cpCheck', '记') + ' 记住了</button>'
        + '<button class="' + NS + 'btn no" data-act="' + noAct + '" data-v="' + esc(String(m.id == null ? '' : m.id)) + '">'
        + I('cpCross', '忘') + ' 没记住</button>'
        + '<button class="' + NS + 'btn" data-act="' + flipAct + '" data-v="' + esc(String(m.id == null ? '' : m.id)) + '">收起答案</button></div>')
    }
    out.push('</div>')
    return out.join('')
  }

  function viewToday(ctx, S) {
    var out = []
    var today = histOfDay(S.hist, dkey())
    var tok = today.filter(function (x) { return x.remembered }).length
    var tno = today.length - tok
    out.push('<div class="' + NS + 'hero"><h3>' + I('clock', '时') + ' 今日唤醒</h3>'
      + '<p>每天 21:00 弹一张最久没回顾的题。今晚这张就是队列里排第一的。'
      + '待唤醒 <b>' + S.dueList.length + '</b> 道 · 今天已自评 <b>' + today.length + '</b> 次。</p></div>')
    out.push('<div class="' + NS + 'kpis">'
      + kpi('待唤醒', String(S.dueList.length), '道')
      + kpi('今天自评', String(today.length), '次')
      + kpi('记住了', String(tok), '今天')
      + kpi('没记住', String(tno), '今天') + '</div>')
    out.push('<section class="' + NS + 'card"><div class="' + NS + 'card-hd"><h4>'
      + I('cpBrain', '想') + ' 今晚这张</h4><span class="muted-sm" style="font-size:11px">先自己想，再翻开答案自评</span></div>')
    out.push(recallCard(S.dueList[0], S.flipToday, 'today', null, null))
    out.push('</section>')
    out.push('<div class="' + NS + 'grid2">')
    out.push('<section class="' + NS + 'card"><h4>' + I('eye', '看') + ' 最近自评</h4>'
      + (S.hist.length ? S.hist.slice(-6).reverse().map(function (x) {
        return '<div class="' + NS + 'row"><span>' + esc(trunc(x.stem || '（无题干）', 28)) + '</span>'
          + '<b style="color:' + (x.remembered ? 'var(--ok,#2e9e5b)' : 'var(--danger,#d9534f)') + '">'
          + (x.remembered ? '记住了' : '没记住') + '</b></div>'
      }).join('') : '<div class="' + NS + 'empty">还没有自评记录。</div>') + '</section>')
    out.push('<section class="' + NS + 'card"><h4>' + I('cpBrain', '判') + ' 从记录里读出的判断</h4>'
      + S.insights.slice(0, 3).map(function (x) { return note(x) }).join('') + '</section>')
    out.push('</div>')
    return out.join('')
  }
  function histOfDay(hist, day) {
    return (hist || []).filter(function (x) { return x.day === day })
  }
  function kpi(label, value, extra) {
    return '<div class="' + NS + 'kpi"><b>' + esc(value) + '</b><span>' + esc(label)
      + (extra ? '<i>' + esc(extra) + '</i>' : '') + '</span></div>'
  }
  function note(x) {
    return '<div class="' + NS + 'note ' + esc(x.level) + '"><div><b>' + esc(x.title) + '</b>'
      + esc(x.body) + '</div></div>'
  }

  function viewCards(ctx, S) {
    var out = []
    var m = S.dueList[S.cardIndex]
    out.push('<div class="' + NS + 'hero"><h3>' + I('layers', '卡') + ' 回忆卡</h3>'
      + '<p>一张一张过。翻卡前看不到答案，这点是刻意的：先看能想起多少，再对照，'
      + '否则"看起来都认识"会骗过自己。自评会同时写回错题本并留一条历史。</p></div>')
    out.push('<section class="' + NS + 'card">')
    if (!S.dueList.length) {
      out.push('<div class="' + NS + 'empty">待唤醒队列是空的。去「待唤醒队列」切到「全部」看看，或先到错题本添加。</div>')
    } else {
      out.push(recallCard(m, S.flipCard, 'card', S.cardIndex, S.dueList.length))
      out.push('<div class="' + NS + 'acts">'
        + '<button class="' + NS + 'btn" data-act="card-prev">上一张</button>'
        + '<button class="' + NS + 'btn" data-act="card-next">下一张</button>'
        + '<span class="muted-sm" style="font-size:11px">共 ' + S.dueList.length + ' 张待唤醒</span></div>')
      var rec = S.fails[String(m.id == null ? '' : m.id)]
      if (rec && rec.miss > 0) {
        var iv = intervalOf(rec, S.cfg, m)
        out.push('<div class="' + NS + 'note warn" style="margin-top:10px"><div><b>这张的历史</b>'
          + '自评 ' + (rec.ok + rec.miss) + ' 次：记住 ' + rec.ok + ' 次、没记住 ' + rec.miss + ' 次。' + esc(iv.text) + '。</div></div>')
      }
    }
    out.push('</section>')
    return out.join('')
  }

  function viewQueue(ctx, S) {
    var out = []
    var items = S.shown.slice()
    if (S.subject !== '全部') items = items.filter(function (m) { return subjectOfMistake(m) === S.subject })
    if (S.sort === 'weak') {
      items.sort(function (a, b) {
        var ra = S.fails[String(a.id == null ? '' : a.id)] || { miss: 0 }
        var rb = S.fails[String(b.id == null ? '' : b.id)] || { miss: 0 }
        if (rb.miss !== ra.miss) return rb.miss - ra.miss
        return String(a.reviewedAt || a.createdAt || '').localeCompare(String(b.reviewedAt || b.createdAt || ''))
      })
    }
    out.push('<div class="' + NS + 'hero"><h3>' + I('list', '列') + ' 待唤醒队列</h3>'
      + '<p>和 21:00 提醒同一份口径：没有 reviewedAt 或打了 needRetell 的题。'
      + '可按科目筛选、按"忘得最多"排序。这里自评与弹窗自评写的是同一字段。</p></div>')
    out.push('<section class="' + NS + 'card"><div class="' + NS + 'card-hd"><h4>筛选</h4>'
      + '<span class="muted-sm" style="font-size:11px">显示 ' + items.length + ' / ' + S.all.length + ' 道</span></div>')
    out.push('<div style="font-size:11px;color:var(--text-secondary);margin-bottom:6px">状态</div>')
    out.push('<div class="' + NS + 'chips">'
      + ['due', 'all', 'done'].map(function (f) {
        return '<button class="' + NS + 'chip' + (S.viewFilter === f ? ' on' : '') + '" data-act="filter" data-v="' + f + '">'
          + esc(FILTER_LABEL[f]) + '</button>'
      }).join('') + '</div>')
    out.push('<div style="font-size:11px;color:var(--text-secondary);margin:10px 0 6px">科目</div>')
    out.push('<div class="' + NS + 'chips">'
      + ['全部'].concat(S.subjects).map(function (s) {
        return '<button class="' + NS + 'chip' + (S.subject === s ? ' on' : '') + '" data-act="subject" data-v="' + esc(s) + '">'
          + esc(s) + '</button>'
      }).join('') + '</div>')
    out.push('<div class="' + NS + 'acts" style="margin-top:10px">'
      + '<button class="' + NS + 'btn' + (S.sort === 'oldest' ? ' pri' : '') + '" data-act="sort" data-v="oldest">按最久未回顾</button>'
      + '<button class="' + NS + 'btn' + (S.sort === 'weak' ? ' pri' : '') + '" data-act="sort" data-v="weak">按忘得最多</button></div>')
    out.push('</section>')
    out.push('<section class="' + NS + 'card"><h4>题目</h4>')
    if (!items.length) {
      out.push('<div class="' + NS + 'empty">这个筛选下暂时没有题。切到「全部」或「已记住」看看。</div>')
    } else {
      items.slice(0, 40).forEach(function (m, i) {
        var id = String(m.id == null ? '' : m.id)
        var rec = S.fails[id] || { miss: 0, ok: 0 }
        var opened = !!S.openIds[id]
        out.push('<div class="' + NS + 'item"><div class="' + NS + 'top"><div class="' + NS + 't">'
          + '<b>' + (i + 1) + '.</b> ' + esc(trunc(m.stem || m.desc || '', 110))
          + (Array.isArray(m.options) && m.options.length
            ? '<br><span style="color:var(--text-secondary);font-size:11.5px">' + esc(m.options.join(' / ')) + '</span>' : '')
          + '</div><div style="text-align:right;white-space:nowrap;font-size:11px;color:var(--text-secondary)">'
          + esc(subjectOfMistake(m)) + '<br>' + esc(agoText(m.reviewedAt)) + '</div></div>')
        out.push('<div class="' + NS + 'meta" style="margin:7px 0 0">'
          + '<span class="' + NS + 'tag">' + esc(isDue(m) ? '待唤醒' : '已记住') + '</span>'
          + (rec.miss ? '<span class="' + NS + 'tag warn">忘过 ' + rec.miss + ' 次</span>' : '')
          + (rec.ok ? '<span class="' + NS + 'tag">记住过 ' + rec.ok + ' 次</span>' : '') + '</div>')
        out.push('<div class="' + NS + 'acts"><button class="' + NS + 'btn" data-act="open" data-v="' + esc(id) + '">'
          + I('eye', '翻') + ' ' + (opened ? '收起答案' : '先看题干再翻答案') + '</button>'
          + (opened ? '<button class="' + NS + 'btn ok" data-act="one-ok" data-v="' + esc(id) + '">记住了</button>'
            + '<button class="' + NS + 'btn no" data-act="one-no" data-v="' + esc(id) + '">没记住</button>' : '')
          + '</div>')
        if (opened) {
          out.push('<div class="' + NS + 'ans" style="margin-top:9px;border-top:1px dashed var(--line);padding-top:9px;font-size:12px;line-height:1.8;color:var(--text-secondary)">'
            + '<b>答案：</b>' + esc(m.answer == null ? '—' : m.answer)
            + (m.solution ? '<br><b>解析：</b>' + esc(m.solution) : '') + '</div>')
        }
        out.push('</div>')
      })
      if (items.length > 40) out.push('<p class="muted-sm" style="font-size:11px">只显示前 40 道，其余可用筛选继续缩小范围。</p>')
    }
    out.push('</section>')
    return out.join('')
  }

  function viewStats(ctx, S) {
    var out = []
    var st = S.st7
    var rec = recurringStats(S.hist)
    out.push('<div class="' + NS + 'hero"><h3>' + I('barChart', '图') + ' 历史统计</h3>'
      + '<p>这里所有数字都来自自评事件流（' + S.hist.length + ' 条，上限 ' + MAX_HISTORY
      + ' 条）。判断只在证据够时才给，否则明说数据不足。</p></div>')
    out.push('<div class="' + NS + 'kpis">'
      + kpi('累计自评', String(st.all), '次')
      + kpi('近 7 天记住率', st.all ? st.rate + '%' : '—', '近 7 天')
      + kpi('反复忘记的题', String(rec.multi), '忘过 2 次以上')
      + kpi('待唤醒', String(S.dueList.length), '当前') + '</div>')
    out.push('<div class="' + NS + 'grid2">')
    out.push('<section class="' + NS + 'card"><div class="' + NS + 'card-hd"><h4>近 7 天自评</h4>'
      + '<span class="muted-sm" style="font-size:11px">记住 ' + st.ok + ' · 没记住 ' + st.no + '</span></div>'
      + gradeChart(st.series)
      + '<div class="' + NS + 'legend"><span><i style="background:var(--ok,#2e9e5b)"></i>记住了</span>'
      + '<span><i style="background:var(--danger,#d9534f)"></i>没记住</span></div></section>')
    out.push('<section class="' + NS + 'card"><h4>' + I('cpBrain', '判') + ' 判断与证据</h4>'
      + S.insights.map(note).join('') + '</section>')
    out.push('</div>')
    out.push('<section class="' + NS + 'card"><div class="' + NS + 'card-hd"><h4>反复没记住的题</h4>'
      + '<span class="muted-sm" style="font-size:11px">阈值 ' + S.cfg.weakTimes + ' 次（设置页可调）</span></div>')
    if (!S.weak.length) {
      out.push('<div class="' + NS + 'empty">' + (S.hist.length < 3
        ? '自评记录不足 ' + S.hist.length + ' 条，还不能说哪些题"反复"忘记。'
        : '目前没有题目累计忘到 ' + S.cfg.weakTimes + ' 次以上。') + '</div>')
    } else {
      out.push('<table class="' + NS + 'table"><thead><tr><th>题目</th><th>科目</th><th>忘/记</th><th>间隔建议</th></tr></thead><tbody>')
      S.weak.slice(0, 15).forEach(function (r) {
        var iv = intervalOf(r, S.cfg, null)
        out.push('<tr><td>' + esc(trunc(r.stem || '（无题干）', 46)) + '</td><td>' + esc(r.subject)
          + '</td><td>' + r.miss + ' / ' + r.ok + '</td><td>' + esc(iv.text) + '</td></tr>')
      })
      out.push('</tbody></table>')
    }
    out.push('</section>')
    out.push('<section class="' + NS + 'card"><h4>每日待唤醒数量</h4>'
      + (S.daily.length ? '<table class="' + NS + 'table"><thead><tr><th>日期</th><th>待唤醒</th><th>总数</th><th>当天自评</th></tr></thead><tbody>'
        + S.daily.slice(-14).reverse().map(function (r) {
          return '<tr><td>' + esc(r.day) + '</td><td>' + r.due + '</td><td>' + r.total + '</td><td>' + r.graded + '</td></tr>'
        }).join('') + '</tbody></table>' : '<div class="' + NS + 'empty">还没有每日快照。打开插件页或自评一次就会记一条。</div>')
      + '</section>')
    return out.join('')
  }
  function gradeChart(series) {
    if (!series.length) return '<div class="' + NS + 'empty">还没有数据。</div>'
    var max = 1
    series.forEach(function (x) { max = Math.max(max, x.ok + x.no) })
    return '<div class="' + NS + 'chart">' + series.map(function (x) {
      var hOk = Math.round(x.ok / max * 88), hNo = Math.round(x.no / max * 88)
      if (hOk + hNo === 0 && !x.has) {
        return '<div class="' + NS + 'col empty" title="' + esc(x.day + ' · 无记录') + '"><em>' + esc(x.day.slice(5)) + '</em></div>'
      }
      return '<div class="' + NS + 'col" title="' + esc(x.day + ' · 记住 ' + x.ok + ' / 没记住 ' + x.no) + '">'
        + '<i class="ok" style="height:' + hOk + 'px"></i>'
        + '<i class="no" style="height:' + hNo + 'px"></i>'
        + '<em>' + esc(x.day.slice(5)) + '</em></div>'
    }).join('') + '</div>'
  }

  function viewData(ctx, S) {
    var out = []
    out.push('<div class="' + NS + 'hero"><h3>' + I('download', '导') + ' 数据与导出</h3>'
      + '<p>自评事件与每日快照只存在本机插件数据（ctx.data）里，不上传、不进云同步的 Store 主集合。'
      + '导出用站点统一的下载接口，清空前建议先导出 JSON。</p></div>')
    out.push('<section class="' + NS + 'card"><div class="' + NS + 'card-hd"><h4>导出</h4>'
      + '<span class="muted-sm" style="font-size:11px">' + S.hist.length + ' 条事件 · ' + S.daily.length + ' 条日快照</span></div>'
      + '<div class="' + NS + 'acts" style="margin-top:0">'
      + '<button class="' + NS + 'btn pri" data-act="export-json">导出 JSON 快照</button>'
      + '<button class="' + NS + 'btn" data-act="export-md">导出 Markdown 报告</button></div>'
      + '<p class="muted-sm" style="font-size:11.5px;line-height:1.8">JSON 含自评事件、每日快照与当前待唤醒题干；'
      + 'Markdown 是可直接读的报告，含判断与证据。两个文件都不含 Store 全量数据。</p></section>')
    out.push('<section class="' + NS + 'card"><h4>自评事件（最近 40 条）</h4>'
      + (S.hist.length ? '<table class="' + NS + 'table"><thead><tr><th>时间</th><th>题目</th><th>科目</th><th>结果</th></tr></thead><tbody>'
        + S.hist.slice(-40).reverse().map(function (x) {
          return '<tr><td>' + esc(x.day) + '</td><td>' + esc(trunc(x.stem || '（无题干）', 40)) + '</td><td>'
            + esc(x.subject) + '</td><td>' + (x.remembered ? '记住了' : '没记住') + '</td></tr>'
        }).join('') + '</tbody></table>' : '<div class="' + NS + 'empty">还没有自评事件。</div>')
      + '</section>')
    out.push('<section class="' + NS + 'card"><div class="' + NS + 'card-hd"><h4>危险操作</h4></div>'
      + '<button class="' + NS + 'btn no" data-act="clear-history">清空自评历史</button>'
      + '<p class="muted-sm" style="font-size:11.5px;line-height:1.8">只清空本插件的 ' + S.hist.length
      + ' 条自评事件，不改错题本里的 reviewedAt / needRetell。操作不可撤销。</p></section>')
    return out.join('')
  }

  function viewConfig(ctx, S) {
    var c = S.cfg
    var out = []
    out.push('<div class="' + NS + 'hero"><h3>' + I('settings', '设') + ' 设置</h3>'
      + '<p>这里只改本插件的偏好与本机数据；站点 config 的 focusOnOpen 仍是打开工具页时的默认筛选来源。</p></div>')
    out.push('<section class="' + NS + 'card"><h4>插件偏好</h4>')
    out.push('<div class="' + NS + 'field"><label>打开时默认筛选（跟随站点 focusOnOpen）</label><select data-act="cfg-focus">'
      + ['待唤醒', '全部', '已记住'].map(function (x) {
        return '<option value="' + esc(x) + '"' + (c.focusOnOpen === x ? ' selected' : '') + '>' + esc(x) + '</option>'
      }).join('') + '</select></div>')
    out.push('<div class="' + NS + 'field"><label>显示常驻面板</label>'
      + '<button class="' + NS + 'btn' + (c.showPanel ? ' pri' : '') + '" data-act="cfg-panel">'
      + (c.showPanel ? '显示' : '隐藏') + '</button></div>')
    out.push('<div class="' + NS + 'field"><label>每天自动记录待唤醒快照</label>'
      + '<button class="' + NS + 'btn' + (c.autoRecord ? ' pri' : '') + '" data-act="cfg-auto">'
      + (c.autoRecord ? '已开启' : '已关闭') + '</button></div>')
    out.push('<div class="' + NS + 'field"><label>基础间隔（忘过 1 次时用）</label><select data-act="cfg-interval">'
      + [3, 5, 7].map(function (n) {
        return '<option value="' + n + '"' + (c.baseInterval === n ? ' selected' : '') + '>' + n + ' 天</option>'
      }).join('') + '</select></div>')
    out.push('<div class="' + NS + 'field"><label>判定"反复忘记"的次数</label><select data-act="cfg-weak">'
      + [2, 3, 4, 5].map(function (n) {
        return '<option value="' + n + '"' + (c.weakTimes === n ? ' selected' : '') + '>' + n + ' 次</option>'
      }).join('') + '</select></div>')
    out.push('</section>')
    out.push('<section class="' + NS + 'card"><h4>唤醒规则（与 21:00 定时器完全一致）</h4>'
      + '<p style="font-size:12px;line-height:1.85;color:var(--text-secondary);margin:0">'
      + '每次选 reviewedAt / createdAt 最早的一题；先自己回忆，再翻开答案；点「记住了」写入当前时间戳，'
      + '点「没记住」额外打 needRetell，明天优先再来。间隔建议只是按自评次数给的经验区间，'
      + '不是记忆算法，也不是站内真实权重。数据不足时插件会如实说不足。</p></section>')
    out.push('<section class="' + NS + 'card"><h4>兼容说明</h4>'
      + '<p style="font-size:12px;line-height:1.85;color:var(--text-secondary);margin:0">'
      + '21:00 定时器 id 与触发逻辑、查询 dm-due 的口径、快捷键 alt+m、config key focusOnOpen、'
      + '面板 id dm-due、工具 id daily-mistake-drill-page 均沿用旧版；'
      + '写回字段仍是 reviewedAt / needRetell，老数据无需迁移。</p></section>')
    return out.join('')
  }

  var VIEWS = [
    { k: 'today', t: '今日唤醒', f: viewToday },
    { k: 'cards', t: '回忆卡', f: viewCards },
    { k: 'queue', t: '待唤醒队列', f: viewQueue },
    { k: 'stats', t: '历史统计', f: viewStats },
    { k: 'data', t: '数据导出', f: viewData },
    { k: 'config', t: '设置', f: viewConfig },
  ]

  /* ══════════════ 7. Shell：动作分发 + 事件委托 ══════════════ */

  function reportMD(ctx, S) {
    var lines = []
    lines.push('# 每日错题唤醒 · 自评报告')
    lines.push('')
    lines.push('> 生成时间：' + new Date().toLocaleString())
    lines.push('> 自评事件：' + S.hist.length + ' 条（上限 ' + MAX_HISTORY + '）')
    lines.push('> 每日快照：' + S.daily.length + ' 条（上限 ' + MAX_DAILY + '）')
    lines.push('')
    lines.push('## 当前状态')
    lines.push('')
    lines.push('- 错题总数：' + S.all.length)
    lines.push('- 待唤醒：' + S.dueList.length + ' 道')
    lines.push('- 近 7 天自评：' + S.st7.all + ' 次，记住 ' + S.st7.ok + ' 次，没记住 ' + S.st7.no + ' 次（记住率 '
      + (S.st7.all ? S.st7.rate + '%' : '无数据') + '）')
    lines.push('')
    lines.push('## 有依据的判断')
    lines.push('')
    S.insights.forEach(function (x) { lines.push('- **' + x.title + '**：' + x.body) })
    lines.push('')
    lines.push('## 反复没记住的题')
    lines.push('')
    if (!S.weak.length) lines.push('- 没有题目累计忘到 ' + S.cfg.weakTimes + ' 次以上。')
    else S.weak.forEach(function (r) {
      lines.push('- ' + flat(r.stem || '（无题干）') + '（' + r.subject + '，忘 ' + r.miss + ' / 记 ' + r.ok
        + '）：' + intervalOf(r, S.cfg, null).text)
    })
    lines.push('')
    lines.push('## 自评事件')
    lines.push('')
    lines.push('| 日期 | 题目 | 科目 | 结果 |')
    lines.push('|---|---|---|---|')
    S.hist.slice().reverse().forEach(function (x) {
      lines.push('| ' + x.day + ' | ' + flat(x.stem || '（无题干）').replace(/\|/g, '\\|')
        + ' | ' + x.subject + ' | ' + (x.remembered ? '记住了' : '没记住') + ' |')
    })
    lines.push('')
    lines.push('## 每日待唤醒快照')
    lines.push('')
    lines.push('| 日期 | 待唤醒 | 总数 | 当天自评 |')
    lines.push('|---|---|---|---|')
    S.daily.slice().reverse().forEach(function (r) {
      lines.push('| ' + r.day + ' | ' + r.due + ' | ' + r.total + ' | ' + r.graded + ' |')
    })
    return lines.join('\n')
  }

  function snapshotJSON(S) {
    return JSON.stringify({
      plugin: PID, version: VERSION, exportedAt: new Date().toISOString(),
      current: {
        total: S.all.length, due: S.dueList.length,
        questions: S.dueList.map(function (m) {
          return {
            id: String(m.id == null ? '' : m.id), stem: flat(m.stem || m.desc || ''),
            subject: subjectOfMistake(m), reviewedAt: m.reviewedAt || null, needRetell: !!m.needRetell,
            answer: m.answer == null ? '' : flat(m.answer)
          }
        })
      },
      history: S.hist, daily: S.daily, config: S.cfg
    }, null, 2)
  }

  /** 找到当前待唤醒队列里指定 id 的题（自评按钮传的是 id，不传索引，重排后也不会错位） */
  function findDue(S, id) {
    var found = null
    S.dueList.forEach(function (m) { if (String(m.id == null ? '' : m.id) === String(id)) found = m })
    return found
  }
  function findAny(S, id) {
    var found = null
    S.all.forEach(function (m) { if (String(m.id == null ? '' : m.id) === String(id)) found = m })
    return found
  }

  function gradeAndRender(ctx, S, m, remembered) {
    if (!m) return
    mark(ctx, m, remembered)
    S.flipToday = false
    S.flipCard = false
    refresh(S, ctx)
    render(S.root, ctx, S)
  }

  function doAct(ctx, S, act, v) {
    if (act === 'tab') { setView(ctx, S, v); render(S.root, ctx, S); return }
    if (act === 'filter') { setFilter(ctx, v); S.viewFilter = v; refresh(S, ctx); render(S.root, ctx, S); return }
    if (act === 'subject') { setSubject(ctx, v); S.subject = v; render(S.root, ctx, S); return }
    if (act === 'sort') { S.sort = v === 'weak' ? 'weak' : 'oldest'; render(S.root, ctx, S); return }
    if (act === 'today-flip' || act === 'card-flip') {
      if (act === 'today-flip') S.flipToday = !S.flipToday
      else S.flipCard = !S.flipCard
      render(S.root, ctx, S)
      return
    }
    if (act === 'today-ok' || act === 'today-no') {
      gradeAndRender(ctx, S, S.dueList[0], act === 'today-ok')
      return
    }
    if (act === 'card-ok' || act === 'card-no') {
      gradeAndRender(ctx, S, findDue(S, v), act === 'card-ok')
      return
    }
    if (act === 'card-prev' || act === 'card-next') {
      if (!S.dueList.length) return
      S.cardIndex = (S.cardIndex + (act === 'card-next' ? 1 : -1) + S.dueList.length) % S.dueList.length
      S.flipCard = false
      render(S.root, ctx, S)
      return
    }
    if (act === 'open') { S.openIds[v] = !S.openIds[v]; render(S.root, ctx, S); return }
    if (act === 'one-ok' || act === 'one-no') {
      gradeAndRender(ctx, S, findAny(S, v), act === 'one-ok')
      return
    }
    if (act === 'export-json') {
      try {
        ctx.api.download('错题唤醒_快照_' + dkey() + '.json', snapshotJSON(S), 'application/json')
        toast(ctx, '已导出 ' + S.hist.length + ' 条自评事件', 'success')
      } catch (e) { toast(ctx, '导出失败：' + ((e && e.message) || e), 'danger') }
      return
    }
    if (act === 'export-md') {
      try {
        ctx.api.download('错题唤醒_报告_' + dkey() + '.md', reportMD(ctx, S), 'text/markdown;charset=utf-8')
        toast(ctx, '报告已导出', 'success')
      } catch (e) { toast(ctx, '导出失败：' + ((e && e.message) || e), 'danger') }
      return
    }
    if (act === 'clear-history') {
      var ok = true
      try { if (ctx.api && typeof ctx.api.confirm === 'function') ok = ctx.api.confirm('清空 ' + S.hist.length + ' 条自评事件？此操作不能撤销。') }
      catch (e) { ok = true }
      if (!ok) return
      S.hist = historySave(ctx, [])
      refresh(S, ctx)
      toast(ctx, '自评历史已清空（错题本标记未改）', 'info')
      render(S.root, ctx, S)
      return
    }
    if (act === 'cfg-panel' || act === 'cfg-auto') {
      var key = act === 'cfg-panel' ? 'showPanel' : 'autoRecord'
      var patch = {}
      patch[key] = !S.cfg[key]
      S.cfg = cfgSet(ctx, patch)
      render(S.root, ctx, S)
      return
    }
  }

  function render(root, ctx, S) {
    if (!root) return
    S.root = root
    var header = '<div class="' + NS + 'tabs" role="tablist">'
      + VIEWS.map(function (v) {
        return '<button class="' + NS + 'tab' + (S.view === v.k ? ' on' : '') + '" data-act="tab" data-v="' + v.k
          + '" role="tab" aria-selected="' + (S.view === v.k ? 'true' : 'false') + '">' + esc(v.t) + '</button>'
      }).join('') + '</div>'
    var cur = VIEWS.filter(function (v) { return v.k === S.view })[0] || VIEWS[0]
    var body = ''
    try { body = cur.f(ctx, S) } catch (e) { body = '<div class="' + NS + 'empty">这个视图渲染失败了：' + esc((e && e.message) || e) + '</div>' }
    root.innerHTML = '<div class="' + NS + 'page">' + header + body + '</div>'
  }

  function mount(el, ctx) {
    style(ctx)
    if (cfgGet(ctx).autoRecord) recordDaily(ctx, false)
    var S = stateOf(ctx)
    render(el, ctx, S)
    var onClick = function (ev) {
      var t = ev.target
      /* 从事件目标向上找 data-act（图标内部元素也要能点），最多 5 层 */
      for (var i = 0; i < 5 && t && t !== el; i++, t = t.parentElement) {
        var act = t.getAttribute && t.getAttribute('data-act')
        if (!act) continue
        ev.preventDefault()
        doAct(ctx, S, act, t.getAttribute('data-v'))
        return
      }
    }
    var onChange = function (ev) {
      var t = ev.target
      if (!t || !t.getAttribute) return
      var act = t.getAttribute('data-act')
      if (act === 'cfg-focus') {
        S.cfg = cfgSet(ctx, { focusOnOpen: t.value })
        S.viewFilter = FILTER_FROM_CONFIG[t.value] || 'due'
        setFilter(ctx, S.viewFilter)
        refresh(S, ctx)
        render(el, ctx, S)
      } else if (act === 'cfg-interval') {
        S.cfg = cfgSet(ctx, { baseInterval: num(t.value, 3) })
        refresh(S, ctx)
        render(el, ctx, S)
      } else if (act === 'cfg-weak') {
        S.cfg = cfgSet(ctx, { weakTimes: clamp(t.value, 2, 5, 2) })
        refresh(S, ctx)
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

  /* ══════════════ 8. 面板（保留 id dm-due） ══════════════ */

  function panel(ctx) {
    style(ctx)
    if (!cfgGet(ctx).showPanel) return ''
    var all = list(ctx), due = dueOf(all).length
    var hist = historyGet(ctx)
    var last = hist.length ? hist[hist.length - 1] : null
    var today = histOfDay(hist, dkey()).length
    return '<div class="' + NS + 'panel">'
      + '<div style="display:flex;justify-content:space-between;align-items:center;gap:6px">'
      + '<span>' + I('clock', '时') + ' 每日错题唤醒</span>'
      + '<span class="muted-sm" style="font-size:11px">今日自评 ' + today + ' 次</span></div>'
      + '<div class="' + NS + 'kpi"><span>今日待唤醒</span><b>' + due + ' 道</b></div>'
      + '<div style="color:var(--text-secondary);font-size:11.5px">'
      + (last ? '最近自评：' + esc(trunc(last.stem || '（无题干）', 18)) + ' · '
        + (last.remembered ? '记住了' : '没记住') : '还没有自评记录，21:00 会弹最久未回顾那道')
      + '</div>'
      + '<button class="btn btn-sm btn-ghost">打开错题唤醒（alt+m）</button></div>'
  }

  /* ══════════════ 9. 注册 ══════════════ */

  var api = {
    id: PID,
    name: '每日错题唤醒',
    version: VERSION,
    author: '内置',
    desc: '每天 21:00 弹一张最久未回顾的错题：先自己想，再翻开答案自评。' +
      '今日唤醒 / 回忆卡 / 待唤醒队列（按科目筛选）/ 历史统计 / 数据导出 / 设置；' +
      '自评写回错题本并留本机历史，教练可查同一份判断。',
    tools: [{
      id: 'daily-mistake-drill-page', title: '错题唤醒', icon: '' + I('clock', '时') + '',
      mount: function (el, ctx) { return mount(el, ctx) }
    }],
    init: function (ctx) {
      try { if (cfgGet(ctx).autoRecord) recordDaily(ctx, false) } catch (e) { }
    },
    shortcuts: [{ key: 'alt+m', label: '打开错题唤醒', run: function (ctx) {
      try { if (ctx && ctx.api && ctx.api.goTool) ctx.api.goTool('daily-mistake-drill-page') } catch (e) { }
    } }],
    panels: [{
      id: 'dm-due', title: '每日错题唤醒', icon: '' + I('clock', '时') + '', width: 320, height: 190,
      render: panel
    }],
    config: [
      { key: 'focusOnOpen', label: '打开工具页时默认筛选', type: 'select', default: '待唤醒', options: ['待唤醒', '全部', '已记住'] },
      { key: 'showPanel', label: '显示常驻面板', type: 'bool', default: true },
      { key: 'autoRecord', label: '每天自动记录待唤醒快照', type: 'bool', default: true },
    ],
    hooks: {
      /* 只在"当天还没有快照"时补一条，保证历史趋势不断档；不写 Store */
      focusDone: function (ctx) { try { if (cfgGet(ctx).autoRecord) recordDaily(ctx, false) } catch (e) { } },
      taskDone: function (ctx) { try { if (cfgGet(ctx).autoRecord) recordDaily(ctx, false) } catch (e) { } },
    },
    queries: [
      /* 原 dm-due：key / label / 核心口径原样保留 */
      { key: 'dm-due', label: '待唤醒错题', run: function (ctx) {
        var all = list(ctx), due = dueOf(all).length
        return due ? '错题队列里有 ' + due + ' 题待唤醒（共 ' + all.length + ' 题），最久未回顾的那道会先来。'
          : '错题队列目前全部已回顾。'
      } },
      { key: 'dm-today', label: '今日自评进度', run: function (ctx) {
        var hist = historyGet(ctx), today = histOfDay(hist, dkey())
        var ok = today.filter(function (x) { return x.remembered }).length
        var due = dueOf(list(ctx)).length
        return '今天已自评 ' + today.length + ' 次（记住 ' + ok + ' / 没记住 ' + (today.length - ok)
          + '），当前还有 ' + due + ' 道待唤醒。每天 21:00 会弹最久未回顾的一张。'
      } },
      { key: 'dm-stats', label: '错题自评记住率', run: function (ctx) {
        var hist = historyGet(ctx)
        if (hist.length < 3) return '自评记录只有 ' + hist.length + ' 条，还不足以算记住率趋势（至少 3 条）。'
        var st = statsOf(hist, 7)
        var dir = st.trend === 'up' ? '在回升' : st.trend === 'down' ? '在下降' : '基本持平'
        return '近 7 天自评 ' + st.all + ' 次，记住 ' + st.ok + ' 次（' + st.rate + '%），'
          + '与前半段相比' + dir + '（' + (st.delta >= 0 ? '+' : '') + st.delta + ' 个百分点）。'
      } },
      { key: 'dm-weak', label: '反复没记住的错题', run: function (ctx) {
        var cfg = cfgGet(ctx), hist = historyGet(ctx)
        var rec = recurringStats(hist)
        if (hist.length < 3) return '自评记录只有 ' + hist.length + ' 条，还不能判断哪些题"反复"忘记（至少 3 条）。'
        if (!rec.multi) return '已自评的 ' + rec.total + ' 道题里，没有哪道忘过两次以上。'
        var weak = weakList(failureMap(hist), cfg.weakTimes)
        return '在 ' + rec.total + ' 道被自评过的题里，' + rec.multi + ' 道至少忘过两次；最该插队的是「'
          + trunc(weak[0].stem || '未命名题目', 30) + '」，忘 ' + weak[0].miss + ' 次、记住 ' + weak[0].ok
          + ' 次。' + intervalOf(weak[0], cfg, null).text + '。'
      } },
      { key: 'dm-interval', label: '错题该隔多久再唤醒', run: function (ctx) {
        var cfg = cfgGet(ctx), m = dueOf(list(ctx))[0]
        if (!m) return '当前没有待唤醒的错题，不需要安排间隔。'
        var r = failureMap(historyGet(ctx))[String(m.id == null ? '' : m.id)]
        var iv = intervalOf(r, cfg, m)
        return '最久未回顾的题是「' + trunc(m.stem || m.desc || '未命名题目', 28) + '」。'
          + (r ? '历史自评 ' + (r.ok + r.miss) + ' 次（记住 ' + r.ok + ' / 没记住 ' + r.miss + '）。' : '还没有自评记录。')
          + iv.text + '。间隔只是按自评次数给的经验区间，不是记忆算法。'
      } },
    ],
    memory: '用户装有「每日错题唤醒」插件：每天 21:00 弹最久未回顾的一题，先自己想再翻答案自评（记住了/没记住），'
      + '写回 reviewedAt / needRetell 并留本机自评历史。工具页有今日唤醒/回忆卡/待唤醒队列/历史统计/数据导出/设置六个视图。'
      + '用户问「今天该复习哪道错题」「待唤醒多少」（dm-due）、「今天自评了多少」（dm-today）、'
      + '「记住率怎么样」（dm-stats）、「哪些题反复错」（dm-weak）、「隔多久再复习」（dm-interval）时查对应接口；'
      + '数据不足时如实说明，不要编造趋势或结论。',

    /* 原定时器语义保持：21:00、选 ms[0]、翻卡自评三按钮、写回字段一个都不改 */
    timers: [{ at: '21:00', label: '每日错题唤醒', run: function (ctx) {
      var ms = list(ctx)
      if (!ms.length) return
      var m = ms[0]
      var front = esc(m.stem || m.desc || '')
      if (Array.isArray(m.options) && m.options.length) front += '<br>' + m.options.map(function (o) { return esc(o) }).join('<br>')
      var html = '<div class=\'card\'><div style=\'font-weight:600;margin-bottom:6px\'>先自己回忆这道题的思路与答案：</div>'
        + '<div class=\'report\'>' + front + '</div>'
        + '<details style=\'margin-top:8px\'><summary style=\'cursor:pointer;font-size:12px\'>' + I('eye', '翻') + ' 翻开答案与解析</summary>'
        + '<div class=\'report\' style=\'margin-top:6px\'><b>答案：</b>' + esc(m.answer == null ? '—' : m.answer) + '</div>'
        + (m.solution ? '<div class=\'report\' style=\'margin-top:4px\'><b>解析：</b>' + esc(m.solution) + '</div>' : '')
        + '</details>'
        + '<div class=\'muted-sm\' style=\'margin-top:8px\'>来源：' + esc(m.desc || '错题本') + '</div></div>'
      ctx.openModal({ title: '' + I('clock', '时') + ' 今日错题唤醒', wide: true, html: html, actions: [
        { label: '' + I('cpCheck', '记') + ' 记住了', kind: 'btn-primary', onClick: function () { mark(ctx, m, true) } },
        { label: '' + I('cpCross', '忘') + ' 没记住', onClick: function () { mark(ctx, m, false) } },
        { label: '关闭' }
      ] })
    } }],
  }

  if (typeof window !== 'undefined' && window.__DM_DEBUG__) {
    window.__dmInternals = {
      esc: esc, num: num, clamp: clamp, flat: flat, trunc: trunc, dkey: dkey,
      shiftDay: shiftDay, dayDiff: dayDiff, agoText: agoText, rate: rate,
      cfgGet: cfgGet, cfgSet: cfgSet, list: list, dueOf: dueOf, shownOf: shownOf,
      subjectOfMistake: subjectOfMistake, historyGet: historyGet, historySave: historySave,
      dailyGet: dailyGet, dailySave: dailySave, recordDaily: recordDaily, mark: mark,
      failureMap: failureMap, weakList: weakList, recurringStats: recurringStats,
      gradeSeries: gradeSeries, statsOf: statsOf, intervalOf: intervalOf, insightsOf: insightsOf,
      stateOf: stateOf, refresh: refresh, reportMD: reportMD, snapshotJSON: snapshotJSON,
      mount: mount, panel: panel, VIEWS: VIEWS,
      MAX_HISTORY: MAX_HISTORY, MAX_DAILY: MAX_DAILY, VERSION: VERSION
    }
  }

  PluginBus.register(api)
})()
