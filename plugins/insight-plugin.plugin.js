/* insight-plugin.plugin.js — 学习洞察 · v2.0.0
 *
 * v1.1.0 只有一个数字条 + 一条 focusWeek 查询（147 行），"洞察"两个字名不副实：
 * 它把数字摆出来了，却没回答"比之前好还是差""为什么""接下来先做什么"。
 * v2.0.0 按成熟插件的形态重造（多视图 shell + 历史快照 + 趋势分析 + 可导出报告），
 * 目标：教练问"我这周怎么样"时，插件能给出**有依据的判断**，而不只是复读总数。
 *
 * 【兼容契约 · 不许改】
 *   · 查询 focusWeek 的 key / label / 算法原样保留（老用户提示词与测试都依赖它）；
 *   · maintabs 的 id 'insight-tab' 原样保留；
 *   · 工具页 mount(el, ctx) 签名、ctx.api.download（不是 ctx.download）不变。
 *
 * 【数据口径 · 单一来源】
 *   本插件**不另算一份统计**：所有"当前值"都从 ctx.Store.get() 现读；
 *   只有"历史快照"是自己落的（ctx.data('ipHistory')），用于算趋势。
 *   快照每天最多记一条（同日重写），所以不会把云同步撑爆。
 */
;(function () {
  'use strict'

  var VERSION = '2.0.0'
  var PID = 'insight-plugin'
  var NS = 'ip-'
  var K_HISTORY = 'ipHistory'       // 历史快照（每天一条）
  var K_CFG = 'ipConfig'            // 用户配置
  var K_LAST_VIEW = 'ipLastView'    // 记住上次看的视图
  var MAX_HISTORY = 180             // 半年，超出丢最老的
  var MAX_TODO = 60                 // 待办明细上限
  var DAY = 86400000

  /* ══════════════ 1. 基础工具（无依赖，可单测） ══════════════ */

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
    var parts = String(key || dkey()).split('-')
    var d = new Date(num(parts[0], 1970), num(parts[1], 1) - 1, num(parts[2], 1))
    d.setDate(d.getDate() + delta)
    return dkey(d)
  }
  function dayDiff(a, b) {
    var pa = String(a).split('-'), pb = String(b).split('-')
    var da = Date.UTC(num(pa[0]), num(pa[1]) - 1, num(pa[2]))
    var db = Date.UTC(num(pb[0]), num(pb[1]) - 1, num(pb[2]))
    return Math.round((db - da) / DAY)
  }
  function fmtH(hours) {
    var h = num(hours)
    if (Math.abs(h) >= 100) return String(Math.round(h)) + 'h'
    return (Math.round(h * 10) / 10) + 'h'
  }
  function hashStr(s) {
    var h = 2166136261
    s = String(s)
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) }
    return h >>> 0
  }
  /** 图标统一走站内 I()，拿不到就退成文字 —— 绝不写原生 emoji（用户明确要求） */
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
  function safeStore(ctx) {
    try { return (ctx && ctx.Store && typeof ctx.Store.get === 'function') ? (ctx.Store.get() || {}) : {} }
    catch (e) { return {} }
  }
  function cfgGet(ctx) {
    var d = { days: 14, autoRecord: true, warnLowHours: 1.5, focusOnDue: true, showPanel: true,
      goalHours: 10, goalTasks: 5 }
    var got = null
    try { got = ctx && typeof ctx.data === 'function' ? ctx.data(K_CFG) : null } catch (e) { }
    if (!got || typeof got !== 'object') return d
    if ([7, 14, 30].indexOf(num(got.days, 14)) >= 0) d.days = num(got.days, 14)
    d.autoRecord = got.autoRecord !== false
    d.warnLowHours = clamp(got.warnLowHours, 0, 12, 1.5)
    d.focusOnDue = got.focusOnDue !== false
    d.showPanel = got.showPanel !== false
    d.goalHours = clamp(got.goalHours, 0, 100, 10)
    d.goalTasks = clamp(got.goalTasks, 0, 100, 5)
    return d
  }
  function cfgSet(ctx, patch) {
    var d = cfgGet(ctx)
    Object.keys(patch || {}).forEach(function (k) { if (k in d) d[k] = patch[k] })
    try { if (ctx && typeof ctx.data === 'function') ctx.data(K_CFG, d) } catch (e) { }
    return d
  }

  /* ══════════════ 2. 数据层：当前快照 + 历史 ══════════════ */

  /**
   * 当前快照：只读 Store，不缓存（缓存 = 第二份事实，会和站内页面数字分叉）。
   * 字段和 v1 保持一致（hours/tasks/done/mistakes/due/vocab/streak/left/raw），
   * 新增的字段都是**派生的**，不写回 Store。
   */
  function snap(ctx) {
    var s = safeStore(ctx)
    var hours = s.studyHours || {}
    var mins = 0
    Object.keys(hours).forEach(function (k) { mins += num(hours[k]) * 60 })
    var tasks = Array.isArray(s.tasks) ? s.tasks : []
    var done = tasks.filter(function (t) { return t && t.done }).length
    var mistakes = Array.isArray(s.mistakes) ? s.mistakes : []
    var due = mistakes.filter(function (m) { return m && !m.reviewedAt }).length
    var photos = Array.isArray(s.mistakePhotos) ? s.mistakePhotos : []
    /* 拍题待回顾：只做粗筛（有 reviewPlan 且还没全打勾），界面一律标"约" ——
     * 精确判定在 core/photoReview，插件不抄第二份口径。 */
    var photoDue = photos.filter(function (p) {
      if (!p || !p.reviewPlan || !p.reviewPlan.start) return false
      var doneKeys = p.reviewPlan.done || {}
      return [1, 3, 7, 15].some(function (st) { return !doneKeys['d' + st] })
    }).length
    var streak = 0
    try { streak = (ctx && ctx.Store && typeof ctx.Store.studyStreak === 'function') ? num(ctx.Store.studyStreak()) : 0 } catch (e) { }
    var left = 0
    try { left = (ctx && ctx.U && typeof ctx.U.daysTo === 'function') ? num(ctx.U.daysTo((s.settings || {}).examDate)) : 0 } catch (e) { }
    return {
      hours: mins / 60, tasks: tasks.length, done: done,
      rate: tasks.length ? Math.round(done / tasks.length * 100) : 0,
      mistakes: mistakes.length, due: due, photoDue: photoDue,
      vocab: Array.isArray(s.vocab) ? s.vocab.length : 0,
      streak: streak, left: left, raw: hours,
      at: Date.now()
    }
  }

  function historyGet(ctx) {
    var arr = null
    try { arr = ctx && typeof ctx.data === 'function' ? ctx.data(K_HISTORY) : null } catch (e) { }
    if (!Array.isArray(arr)) return []
    /* 防御脏数据：快照必须带合法 day 且字段可数，否则丢掉（一条坏记录别把趋势图撑塌） */
    return arr.filter(function (x) { return x && typeof x === 'object' && /^\d{4}-\d{2}-\d{2}$/.test(String(x.day || '')) })
      .map(function (x) {
        return {
          day: x.day, hours: num(x.hours), tasks: num(x.tasks), done: num(x.done),
          mistakes: num(x.mistakes), due: num(x.due), vocab: num(x.vocab),
          streak: num(x.streak), left: num(x.left), at: num(x.at, Date.now())
        }
      })
      .sort(function (a, b) { return String(a.day).localeCompare(String(b.day)) })
      .slice(-MAX_HISTORY)
  }

  function historySave(ctx, arr) {
    var out = (arr || []).slice(-MAX_HISTORY)
    try { if (ctx && typeof ctx.data === 'function') ctx.data(K_HISTORY, out) } catch (e) { }
    return out
  }

  /** 每天只落一条。force=true 用于手动"记录此刻"（同日覆盖）。 */
  function recordToday(ctx, force) {
    var d = snap(ctx)
    var day = dkey()
    var arr = historyGet(ctx)
    var last = arr.length ? arr[arr.length - 1] : null
    if (last && last.day === day && !force) return arr
    var rec = {
      day: day, hours: d.hours, tasks: d.tasks, done: d.done,
      mistakes: d.mistakes, due: d.due, vocab: d.vocab,
      streak: d.streak, left: d.left, at: d.at
    }
    if (last && last.day === day) arr[arr.length - 1] = rec
    else arr.push(rec)
    return historySave(ctx, arr)
  }

  /* ══════════════ 3. 分析层：趋势 / 判断 / 待办 ══════════════ */

  /** 取最近 N 天序列（缺失日补 0，不跳格 —— 跳格会让"连续下降"看不出来） */
  function seriesOf(hist, days, field) {
    var map = {}
    ;(hist || []).forEach(function (x) { map[x.day] = num(x[field]) })
    var today = dkey()
    var out = []
    for (var i = days - 1; i >= 0; i--) {
      var k = shiftDay(today, -i)
      out.push({ day: k, v: map[k] || 0, has: Object.prototype.hasOwnProperty.call(map, k) })
    }
    return out
  }

  function statsOf(series) {
    var vals = (series || []).map(function (x) { return x.v })
    var n = vals.length || 1
    var sum = vals.reduce(function (a, b) { return a + b }, 0)
    var avg = sum / n
    var max = Math.max.apply(null, vals.concat([0]))
    var min = Math.min.apply(null, vals.concat([0]))
    var half = Math.floor(vals.length / 2)
    var head = vals.slice(0, half), tail = vals.slice(half)
    var avgOf = function (a) { return a.length ? a.reduce(function (x, y) { return x + y }, 0) / a.length : 0 }
    var delta = avgOf(tail) - avgOf(head)
    return { sum: sum, avg: avg, max: max, min: min, delta: delta,
      trend: Math.abs(delta) < 0.05 ? 'flat' : (delta > 0 ? 'up' : 'down') }
  }

  /** 从快照 + 历史生成**有依据的**判断，每条必须带证据数字，不写"加油"这种空话 */
  function insightsOf(d, hist, ctx) {
    var out = []
    var cfg = cfgGet(ctx)
    var h7 = statsOf(seriesOf(hist, 7, 'hours'))
    var h14 = statsOf(seriesOf(hist, 14, 'hours'))
    var prev7 = Math.max(0, h14.avg * 2 - h7.avg)
    if (hist.length >= 3) {
      if (h7.trend === 'down' && h7.avg < h14.avg) {
        out.push({ level: 'warn', title: '专注时长在往下走',
          body: '近 7 天日均 ' + fmtH(h7.avg) + '，前一段 ' + fmtH(prev7)
            + '。先看是不是某个固定时段被占掉了，而不是笼统地"多学一点"。' })
      } else if (h7.trend === 'up') {
        out.push({ level: 'good', title: '专注在回升',
          body: '近 7 天日均 ' + fmtH(h7.avg) + '，比前一段多 ' + fmtH(Math.abs(h7.delta)) + '。保持当前时段安排。' })
      }
    }
    if (d.hours < cfg.warnLowHours && d.tasks > 0) {
      out.push({ level: 'warn', title: '今天还没有学习时长记录',
        body: '当前记录 ' + fmtH(d.hours) + '。数据来自专注页；如果刚做完一轮但这里没变，先确认那轮是否真的计入了 studyHours。' })
    }
    if (d.due >= 5) {
      out.push({ level: 'warn', title: '错题待回顾已经堆起来了',
        body: d.due + ' 道还没标"已回顾"。按最早那道先清，比一次翻完更抗遗忘。' })
    }
    if (d.photoDue > 0) {
      out.push({ level: 'info', title: '拍题复习计划有未完成的节点',
        body: '约 ' + d.photoDue + ' 道还有 D1/3/7/15 没打勾（粗筛口径，精确值以拍题页为准）。' })
    }
    if (d.tasks && d.rate < 40) {
      out.push({ level: 'info', title: '任务完成率偏低',
        body: d.done + '/' + d.tasks + '（' + d.rate + '%）。更像任务粒度太大，而不是执行力问题 —— 试试把最大的那条拆成两步。' })
    }
    if (d.streak >= 7) {
      out.push({ level: 'good', title: '连续打卡 ' + d.streak + ' 天',
        body: '习惯已经立住了。这个阶段更该盯"学什么"，而不是"学没学"。' })
    }
    if (!out.length) {
      out.push({ level: 'info', title: '数据还不足以给出判断',
        body: '插件每天只记一条快照。' + Math.max(0, 3 - hist.length) + ' 天后就能看出趋势，在那之前这里不编结论。' })
    }
    return out.slice(0, 6)
  }

  /** 待办：统一的 {kind,title,detail,score,act} 形状，按"最该先做"排序 */
  function todosOf(d) {
    var out = []
    if (d.due > 0) out.push({ kind: 'due', title: '清错题待回顾', detail: d.due + ' 道未标已回顾', score: 100, act: 'go-mistakes' })
    if (d.photoDue > 0) out.push({ kind: 'photo', title: '拍题复习节点', detail: '约 ' + d.photoDue + ' 道未完成', score: 90, act: 'go-photo' })
    var leftTasks = Math.max(0, d.tasks - d.done)
    if (leftTasks > 0) out.push({ kind: 'task', title: '推进未完成任务', detail: leftTasks + ' 项待办', score: 80, act: 'go-tasks' })
    if (d.hours < 1.5) out.push({ kind: 'focus', title: '补一轮专注', detail: '今日 ' + fmtH(d.hours), score: 60, act: 'go-focus' })
    if (d.left > 0 && d.left <= 30) out.push({ kind: 'exam', title: '距初试 ' + d.left + ' 天', detail: '进入冲刺窗口', score: 70, act: '' })
    return out.sort(function (a, b) { return b.score - a.score }).slice(0, MAX_TODO)
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
    '.' + NS + 'bars{display:flex;align-items:flex-end;gap:7px;height:112px;padding:8px 2px 22px;position:relative}',
    '.' + NS + 'bars i{flex:1;min-width:12px;border-radius:5px 5px 0 0;background:linear-gradient(180deg,var(--accent-text),var(--blue));opacity:.85;position:relative;transition:height .3s ease}',
    '.' + NS + 'bars i.empty{background:var(--line);opacity:.5}',
    '.' + NS + 'bars i:hover{opacity:1}',
    '.' + NS + 'bars i span{position:absolute;bottom:-19px;left:-4px;right:-4px;text-align:center;font-size:9.5px;color:var(--text-secondary);white-space:nowrap}',
    '.' + NS + 'note{display:flex;gap:9px;padding:9px 11px;border-radius:10px;margin-bottom:8px;border-left:3px solid var(--line);background:var(--glass-bg);font-size:12px;line-height:1.7}',
    '.' + NS + 'note.warn{border-left-color:var(--danger,#d9534f)}',
    '.' + NS + 'note.good{border-left-color:var(--ok,#2e9e5b)}',
    '.' + NS + 'note.info{border-left-color:var(--blue)}',
    '.' + NS + 'note b{display:block;font-size:12.5px;margin-bottom:2px}',
    '.' + NS + 'row{display:flex;justify-content:space-between;align-items:center;gap:8px;font-size:12px;padding:8px 0;border-bottom:1px dashed var(--line)}',
    '.' + NS + 'row:last-child{border-bottom:0}',
    '.' + NS + 'row span{color:var(--text-secondary);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.' + NS + 'row b{white-space:nowrap}',
    '.' + NS + 'g{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;text-align:center}',
    '.' + NS + 'g div{border-radius:9px;padding:8px 4px;background:var(--glass-bg);border:1px solid var(--line)}',
    '.' + NS + 'g b{display:block;font-size:15px}',
    '.' + NS + 'g span{font-size:10.5px;color:var(--text-secondary)}',
    '.' + NS + 'table{width:100%;border-collapse:collapse;font-size:12px}',
    '.' + NS + 'table th{text-align:left;color:var(--text-secondary);font-weight:500;padding:7px 8px;border-bottom:1px solid var(--line);font-size:11px}',
    '.' + NS + 'table td{padding:7px 8px;border-bottom:1px dashed var(--line)}',
    '.' + NS + 'table tr:last-child td{border-bottom:0}',
    '.' + NS + 'empty{color:var(--text-secondary);font-size:12px;line-height:1.8;padding:12px 0;text-align:center}',
    '.' + NS + 'acts{display:flex;gap:7px;flex-wrap:wrap;margin-top:10px}',
    '.' + NS + 'btn{border:1px solid var(--line);background:var(--glass-bg);color:var(--text-primary);border-radius:8px;padding:6px 12px;font-size:11.5px;cursor:pointer;transition:.15s}',
    '.' + NS + 'btn:hover{border-color:var(--accent-text);color:var(--accent-text)}',
    '.' + NS + 'btn.pri{background:var(--accent-text);border-color:var(--accent-text);color:var(--btn-text,#fff)}',
    '.' + NS + 'field{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:9px 0;border-bottom:1px dashed var(--line);font-size:12px}',
    '.' + NS + 'field:last-child{border-bottom:0}',
    '.' + NS + 'field label{color:var(--text-secondary)}',
    '.' + NS + 'field select,.ip-field input{border:1px solid var(--line);border-radius:8px;background:var(--bg-muted,var(--glass-bg));color:var(--text-primary);padding:5px 9px;font-size:12px}',
    '.' + NS + 'ic{display:inline-flex;align-items:center;justify-content:center;width:15px;height:15px;vertical-align:-2px}',
    '.' + NS + 'ic svg{width:15px;height:15px;fill:none;stroke:currentColor;stroke-width:1.8}',
    '.' + NS + 'spark{display:flex;align-items:flex-end;gap:3px;height:30px;margin-top:7px}',
    '.' + NS + 'spark i{flex:1;background:var(--accent-text);opacity:.7;border-radius:2px 2px 0 0;min-height:2px}',
    '.' + NS + 'prog{height:8px;border-radius:99px;background:var(--line);overflow:hidden;margin:6px 0 2px}',
    '.' + NS + 'prog i{display:block;height:100%;border-radius:99px;background:var(--accent-text);transition:width .3s ease}',
    '.' + NS + 'prog i.ok{background:var(--ok,#2e9e5b)}',
    '@media(max-width:820px){.' + NS + 'kpis{grid-template-columns:repeat(2,1fr)}.' + NS + 'grid2{grid-template-columns:1fr}}',
    'html[data-theme="night"] .' + NS + 'bars i{opacity:.72}',
    'html[data-theme="night"] .' + NS + 'note.good{border-left-color:#6ddc9a}'
  ].join('\n')

  function style(ctx) {
    try { if (ctx && ctx.css && typeof ctx.css.add === 'function') ctx.css.add(CSS, 'skin') } catch (e) { }
  }

  /* ══════════════ 5. 视图 ══════════════ */

  function barChart(series, field) {
    if (!series.length) return '<div class="' + NS + 'empty">还没有快照数据。</div>'
    var vals = series.map(function (x) { return x.v })
    var max = Math.max.apply(null, vals.concat([0.01]))
    return '<div class="' + NS + 'bars">' + series.map(function (x) {
      var h = Math.max(3, Math.round(x.v / max * 78))
      return '<i class="' + (x.has ? '' : 'empty') + '" style="height:' + h + 'px" title="'
        + esc(x.day + ' · ' + (field === 'hours' ? fmtH(x.v) : x.v))
        + '"><span>' + esc(String(x.day).slice(5)) + '</span></i>'
    }).join('') + '</div>'
  }

  function viewOverview(ctx, S) {
    var out = []
    var d = S.snap
    var h7 = statsOf(S.series7)
    out.push('<div class="' + NS + 'hero"><h3>' + I('barChart', '图') + ' 学习洞察</h3>'
      + '<p>所有数字现读本机 Store，不另算一份口径。距考试 <b>' + d.left + '</b> 天 · '
      + '连续打卡 <b>' + d.streak + '</b> 天 · 已有 <b>' + S.hist.length + '</b> 条历史快照。</p></div>')
    out.push('<div class="' + NS + 'kpis">')
    ;[['本周时长', fmtH(d.hours), ''],
      ['任务完成', d.done + '/' + d.tasks, d.rate + '%'],
      ['错题', String(d.mistakes), '待回顾 ' + d.due],
      ['拍题待复习', String(d.photoDue), '约'],
      ['词汇', String(d.vocab), '词']].forEach(function (x) {
        out.push('<div class="' + NS + 'kpi"><b>' + esc(x[1]) + '</b><span>' + esc(x[0])
          + (x[2] ? '<i>' + esc(x[2]) + '</i>' : '') + '</span></div>')
      })
    out.push('</div>')
    out.push('<div class="' + NS + 'grid2">')
    out.push('<section class="' + NS + 'card"><div class="' + NS + 'card-hd"><h4>近 7 天专注时长</h4>'
      + '<span class="muted-sm" style="font-size:11px">日均 ' + fmtH(h7.avg) + '</span></div>'
      + barChart(S.series7, 'hours') + '</section>')
    out.push('<section class="' + NS + 'card"><h4>' + I('cpBrain', '判') + ' 从数据里读出的判断</h4>'
      + S.insights.map(function (x) {
        return '<div class="' + NS + 'note ' + esc(x.level) + '"><div><b>' + esc(x.title) + '</b>' + esc(x.body) + '</div></div>'
      }).join('') + '</section>')
    out.push('</div>')
    out.push('<section class="' + NS + 'card"><div class="' + NS + 'card-hd"><h4>接下来最该做的</h4>'
      + '<button class="' + NS + 'btn" data-act="record">记录此刻快照</button></div>'
      + (S.todos.length ? S.todos.slice(0, 5).map(function (t) {
        return '<div class="' + NS + 'row"><span>' + esc(t.title) + ' · ' + esc(t.detail) + '</span><b>' + t.score + '</b></div>'
      }).join('') : '<div class="' + NS + 'empty">当前没有待办。这不是"没数据"，是各页确实都清完了。</div>')
      + '</section>')
    return out.join('')
  }

  function viewTrend(ctx, S) {
    var out = []
    var series = seriesOf(S.hist, S.cfg.days, 'hours')
    var st = statsOf(series)
    out.push('<section class="' + NS + 'card"><div class="' + NS + 'card-hd">'
      + '<h4>专注趋势 · 近 ' + S.cfg.days + ' 天</h4>'
      + '<span class="' + NS + 'acts" style="margin:0">'
      + [7, 14, 30].map(function (n) {
        return '<button class="' + NS + 'btn' + (S.cfg.days === n ? ' pri' : '') + '" data-act="days" data-v="' + n + '">' + n + ' 天</button>'
      }).join('') + '</span></div>')
    out.push('<div class="' + NS + 'g"><div><b>' + fmtH(st.sum) + '</b><span>累计</span></div>'
      + '<div><b>' + fmtH(st.avg) + '</b><span>日均</span></div>'
      + '<div><b>' + fmtH(st.max) + '</b><span>最高一天</span></div></div>')
    out.push(barChart(series, 'hours'))
    out.push('</section>')
    out.push('<section class="' + NS + 'card"><h4>逐日明细</h4>'
      + '<table class="' + NS + 'table"><thead><tr><th>日期</th><th>时长</th><th>任务</th><th>错题</th><th>待回顾</th></tr></thead><tbody>'
      + series.slice().reverse().map(function (x) {
        var rec = null
        S.hist.forEach(function (r) { if (r.day === x.day) rec = r })
        return '<tr><td>' + esc(x.day) + '</td><td>' + fmtH(x.v) + '</td><td>'
          + (rec ? rec.done + '/' + rec.tasks : '—') + '</td><td>' + (rec ? rec.mistakes : '—')
          + '</td><td>' + (rec ? rec.due : '—') + '</td></tr>'
      }).join('') + '</tbody></table></section>')
    return out.join('')
  }

  function viewTodos(ctx, S) {
    var out = []
    out.push('<section class="' + NS + 'card"><h4>待办优先级（分数越高越该先做）</h4>')
    if (!S.todos.length) out.push('<div class="' + NS + 'empty">当前没有待办。</div>')
    else S.todos.forEach(function (t, i) {
      out.push('<div class="' + NS + 'row"><span>' + (i + 1) + '. ' + esc(t.title) + ' · ' + esc(t.detail) + '</span>'
        + '<span>' + (t.act ? '<button class="' + NS + 'btn" data-act="goto" data-v="' + esc(t.act) + '">去处理</button> ' : '')
        + '<b>' + t.score + '</b></span></div>')
    })
    out.push('</section>')
    out.push('<section class="' + NS + 'card"><h4>口径说明</h4>'
      + '<p style="font-size:12px;line-height:1.8;color:var(--text-secondary);margin:0">'
      + '分数是本插件按"离遗忘最近 / 离考试最近"排的启发式顺序，**不是站内真实权重**。'
      + '错题待回顾取自 mistakes 的 reviewedAt；拍题待复习只做粗筛（标"约"），精确值以拍题页为准。'
      + '教练问「接下来做什么」走的 ip-todo 查询，与这里同一份判断。</p></section>')
    return out.join('')
  }

  function viewHistory(ctx, S) {
    var out = []
    out.push('<section class="' + NS + 'card"><div class="' + NS + 'card-hd"><h4>历史快照（每天最多一条）</h4>'
      + '<span class="' + NS + 'acts" style="margin:0">'
      + '<button class="' + NS + 'btn" data-act="record-force">立即记录</button>'
      + '<button class="' + NS + 'btn" data-act="export-json">导出 JSON</button>'
      + '<button class="' + NS + 'btn" data-act="export-md">导出报告</button>'
      + '<button class="' + NS + 'btn" data-act="clear-history">清空历史</button>'
      + '</span></div>')
    if (!S.hist.length) {
      out.push('<div class="' + NS + 'empty">还没有快照。插件每天自动记一条；也可以在上面手动"立即记录"。</div>')
    } else {
      out.push('<table class="' + NS + 'table"><thead><tr><th>日期</th><th>时长</th><th>任务</th><th>错题</th><th>词汇</th></tr></thead><tbody>')
      S.hist.slice().reverse().slice(0, 60).forEach(function (r) {
        out.push('<tr><td>' + esc(r.day) + '</td><td>' + fmtH(r.hours) + '</td><td>'
          + r.done + '/' + r.tasks + '</td><td>' + r.mistakes + '</td><td>' + r.vocab + '</td></tr>')
      })
      out.push('</tbody></table>')
      if (S.hist.length > 60) out.push('<p class="muted-sm" style="font-size:11px">仅显示最近 60 条，导出文件里是全部 ' + S.hist.length + ' 条。</p>')
    }
    out.push('</section>')
    return out.join('')
  }

  /** 目标视图：目标值存在插件配置里；进度用近 7 天快照求和（不是凭感觉打百分比） */
  function viewGoals(ctx, S) {
    var out = []
    var c = S.cfg
    var week = statsOf(seriesOf(S.hist, 7, 'hours'))
    var hoursPct = c.goalHours > 0 ? Math.min(100, Math.round(week.sum / c.goalHours * 100)) : 0
    var taskPct = c.goalTasks > 0 ? Math.min(100, Math.round(S.snap.done / c.goalTasks * 100)) : 0
    var duePct = S.snap.mistakes > 0 ? Math.min(100, Math.round((S.snap.mistakes - S.snap.due) / S.snap.mistakes * 100)) : 100
    var row = function (title, now, target, pct, hint) {
      return '<div style="padding:9px 0;border-bottom:1px dashed var(--line)">'
        + '<div style="display:flex;justify-content:space-between;font-size:12px;gap:8px">'
        + '<span>' + esc(title) + '</span><b>' + esc(now) + ' / ' + esc(target) + '（' + pct + '%）</b></div>'
        + '<div class="' + NS + 'prog"><i class="' + (pct >= 100 ? 'ok' : '') + '" style="width:' + pct + '%"></i></div>'
        + (hint ? '<div class="muted-sm" style="font-size:11px">' + esc(hint) + '</div>' : '')
        + '</div>'
    }
    out.push('<section class="' + NS + 'card"><div class="' + NS + 'card-hd"><h4>本周目标</h4>'
      + '<span class="muted-sm" style="font-size:11px">目标只存本机，不改站内任何设置</span></div>'
      + row('学习时长', fmtH(week.sum), fmtH(c.goalHours), hoursPct,
        week.sum === 0 && S.hist.length < 2 ? '还没有足够快照，先记几天再说达成率' : '近 7 天快照求和')
      + row('完成任务', String(S.snap.done), String(c.goalTasks), taskPct, '当前 Store 的 tasks 完成数')
      + row('错题回顾', String(S.snap.mistakes - S.snap.due), String(S.snap.mistakes), duePct,
        S.snap.mistakes ? '已标 reviewedAt / 全部错题' : '还没有错题')
      + '</section>')
    out.push('<section class="' + NS + 'card"><h4>调整目标</h4>'
      + '<div class="' + NS + 'field"><label>每周专注小时</label>'
      + '<input type="number" min="0" max="100" step="1" value="' + c.goalHours + '" data-act="goal-hours" style="width:82px"></div>'
      + '<div class="' + NS + 'field"><label>每周完成任务数</label>'
      + '<input type="number" min="0" max="100" step="1" value="' + c.goalTasks + '" data-act="goal-tasks" style="width:82px"></div>'
      + '<p class="muted-sm" style="font-size:11.5px;line-height:1.8">'
      + '达成率按"当前 / 目标"直接算，不预测、不加权。目标定得过高反而让人放弃 —— 先定一个能连续两周做到的数，再往上调。</p>'
      + '</section>')
    return out.join('')
  }

  function viewConfig(ctx, S) {
    var c = S.cfg
    var out = []
    out.push('<section class="' + NS + 'card"><h4>插件设置</h4>')
    out.push('<div class="' + NS + 'field"><label>趋势默认天数</label><select data-act="cfg-days">'
      + [7, 14, 30].map(function (n) { return '<option value="' + n + '"' + (c.days === n ? ' selected' : '') + '>' + n + ' 天</option>' }).join('')
      + '</select></div>')
    out.push('<div class="' + NS + 'field"><label>每天自动记录快照</label>'
      + '<button class="' + NS + 'btn' + (c.autoRecord ? ' pri' : '') + '" data-act="cfg-auto">' + (c.autoRecord ? '已开启' : '已关闭') + '</button></div>')
    out.push('<div class="' + NS + 'field"><label>低时长提醒阈值（小时）</label>'
      + '<input type="number" min="0" max="12" step="0.5" value="' + c.warnLowHours + '" data-act="cfg-warn" style="width:74px"></div>')
    out.push('<div class="' + NS + 'field"><label>待办里优先考虑错题</label>'
      + '<button class="' + NS + 'btn' + (c.focusOnDue ? ' pri' : '') + '" data-act="cfg-focus">' + (c.focusOnDue ? '是' : '否') + '</button></div>')
    out.push('<div class="' + NS + 'field"><label>常驻面板</label>'
      + '<button class="' + NS + 'btn' + (c.showPanel ? ' pri' : '') + '" data-act="cfg-panel">' + (c.showPanel ? '显示' : '隐藏') + '</button></div>')
    out.push('</section>')
    out.push('<section class="' + NS + 'card"><h4>数据与隐私</h4><p style="font-size:12px;line-height:1.8;color:var(--text-secondary);margin:0">'
      + '快照只存在本机插件数据（ctx.data）里，最多 ' + MAX_HISTORY + ' 条，不上传、不进云同步的 Store 主集合。'
      + '清空历史会删掉全部快照，不能撤销 —— 建议先导出 JSON。</p></section>')
    return out.join('')
  }

  /** 数据体检：找出会让"洞察"失真的脏数据。这是镜子，不是修数据的地方 ——
   * 修数据要回原页（专注页/错题页），插件只报告，避免第三份写入口径。 */
  function viewAudit(ctx, S) {
    var out = []
    var d = S.snap
    var issues = []
    var hours = d.raw || {}
    var future = 0, negative = 0, huge = 0, todayKey = dkey()
    Object.keys(hours).forEach(function (k) {
      var v = num(hours[k])
      if (/^\d{4}-\d{2}-\d{2}$/.test(k) && k > todayKey) future++
      if (v < 0) negative++
      if (v > 24) huge++
    })
    if (future) issues.push({ level: 'warn', title: future + ' 条未来日期的时长',
      body: 'studyHours 里有晚于今天的日期。可能是时区或测试写入，会让"本周时长"虚高。回专注页核对。' })
    if (negative) issues.push({ level: 'warn', title: negative + ' 条负数时长',
      body: '负数时长会把日均拉低。这类数据本插件只读不改。' })
    if (huge) issues.push({ level: 'warn', title: huge + ' 条超过 24 小时',
      body: '单日时长不可能超过 24 小时。通常是把分钟当成小时写进去了。' })
    if (!Object.keys(hours).length) issues.push({ level: 'info', title: '还没有学习时长记录',
      body: '专注页完成一轮后这里才有数据。在那之前本插件不会用"虚构的 0"去做趋势判断。' })
    if (d.tasks && d.done > d.tasks) issues.push({ level: 'warn', title: '完成任务数大于任务总数',
      body: d.done + ' > ' + d.tasks + '。可能是任务被删除后计数没同步，完成率会失真。' })
    if (!issues.length) issues.push({ level: 'good', title: '没发现明显脏数据',
      body: '时长、任务、错题的基本形态都正常。这不能证明数据完整，只是没看到自相矛盾的值。' })
    out.push('<section class="' + NS + 'card"><h4>' + I('cpWarn', '检') + ' 数据体检</h4>'
      + issues.map(function (x) {
        return '<div class="' + NS + 'note ' + esc(x.level) + '"><div><b>' + esc(x.title) + '</b>' + esc(x.body) + '</div></div>'
      }).join('') + '</section>')
    out.push('<section class="' + NS + 'card"><h4>口径对照表</h4>'
      + '<table class="' + NS + 'table"><thead><tr><th>指标</th><th>来源</th><th>本插件是否改写</th></tr></thead><tbody>'
      + [['当前时长', 'Store.studyHours', '只读'], ['任务完成', 'Store.tasks[].done', '只读'],
        ['错题待回顾', 'Store.mistakes[].reviewedAt', '只读'], ['连续打卡', 'Store.studyStreak()', '只读'],
        ['距考试', 'settings.examDate + U.daysTo', '只读'], ['历史快照', 'ctx.data(ipHistory)', '写（每天一条）']]
        .map(function (r) { return '<tr><td>' + esc(r[0]) + '</td><td>' + esc(r[1]) + '</td><td>' + esc(r[2]) + '</td></tr>' }).join('')
      + '</tbody></table>'
      + '<p class="muted-sm" style="font-size:11.5px;margin-top:10px">这张表存在的理由：'
      + '用户问"你怎么算的"时，能当场回答，而不是含糊说"从数据里来的"。</p></section>')
    return out.join('')
  }

  /** 提问示例：把"能问什么"摆出来。教练查询注册了不等于用户知道该问什么 ——
   * 这一页把每条 query 配一句真实说法，点一下就能复制。 */
  function viewAsk(ctx, S) {
    var examples = [
      { q: 'focusWeek', t: '我这周学了多久？', hint: '本周专注' },
      { q: 'ip-trend', t: '最近学习是在变好还是变差？', hint: '学习趋势判断' },
      { q: 'ip-todo', t: '接下来我最该做什么？', hint: '接下来该做什么' },
      { q: 'ip-streak', t: '我连续打卡多少天了？背了多少词？', hint: '连续打卡与单词量' },
      { q: 'ip-insights', t: '根据我的记录，有什么值得注意的？', hint: '学习洞察的关键判断' },
      { q: 'ip-goal', t: '这周目标完成了多少？', hint: '本周目标达成率' },
      { q: 'ip-exam', t: '还剩多少天，我准备得怎么样？', hint: '考前剩余与准备度' },
      { q: 'ip-source', t: '你说的这些数字从哪来的？', hint: '洞察数字的数据来源' },
      { q: 'ip-audit', t: '我的学习数据有没有问题？', hint: '洞察数据是否可信' },
    ]
    var out = []
    out.push('<section class="' + NS + 'card"><h4>' + I('cpChat', '问') + ' 可以怎么问教练</h4>'
      + '<p class="' + NS + 'tip">下面每句都对应本插件注册的一条查询。'
      + '点「复制说法」后在教练里粘贴即可 —— 不用记查询 key。</p>'
      + '<table class="' + NS + 'table"><thead><tr><th>你可以这样问</th><th>对应查询</th><th></th></tr></thead><tbody>'
      + examples.map(function (x) {
        return '<tr><td>' + esc(x.t) + '</td><td>' + esc(x.hint) + '</td>'
          + '<td><button class="' + NS + 'btn" data-act="copy" data-v="' + esc(x.t) + '">复制说法</button></td></tr>'
      }).join('') + '</tbody></table></section>')
    return out.join('')
  }

  /** 术语表：把仪表盘上的词和它背后的 Store 字段一一对应。
   * 用户说"时长不对"时，最有效的回复是"你看到的 X 来自 Y 字段"，而不是争辩。 */
  function viewTerms(ctx, S) {
    var rows = [
      ['本周时长', 'studyHours 的全部键求和 × 60 分钟', '名字叫"本周"但算法是**全部记录**。字段里没有分周结构，插件不假装能做到。'],
      ['任务完成', 'tasks 数组里 done === true 的条数', '与排程页「今日任务」不是同一口径；这里是全量 tasks。'],
      ['错题待回顾', 'mistakes 里 reviewedAt 为空的条数', 'reviewedAt 由错题页写，插件只读。'],
      ['拍题待复习', 'mistakePhotos 里有 reviewPlan 且 D1/3/7/15 未全勾', '粗筛，界面标"约"。精确到期判定在 core/photoReview。'],
      ['连续打卡', 'Store.studyStreak()', '站内算法，插件原样显示；不在插件里另算一份。'],
      ['距考试', 'settings.examDate → ctx.U.daysTo()', '没设日期时为 0，0 表示"未配置"不是"今天考"。'],
      ['历史快照', 'ctx.data(ipHistory) 每天一条', '只有这个字段是插件写的；最多 180 条，超出丢最老。'],
    ]
    var out = []
    out.push('<section class="' + NS + 'card"><h4>' + I('cpGear', '词') + ' 术语与字段对照</h4>'
      + '<table class="' + NS + 'table"><thead><tr><th>界面上的词</th><th>实际算法</th><th>容易误读的地方</th></tr></thead><tbody>'
      + rows.map(function (r) { return '<tr><td><b>' + esc(r[0]) + '</b></td><td>' + esc(r[1]) + '</td><td>' + esc(r[2]) + '</td></tr>' }).join('')
      + '</tbody></table>'
      + '<p class="' + NS + 'tip" style="margin-top:10px">这张表是插件给自己写的"免责声明"：'
      + '名字里带"本周"不一定真是本周，带"待复习"不一定精确。'
      + '把口径摊开，比把数字做得好看更重要。</p></section>')
    return out.join('')
  }

  var VIEWS = [
    { k: 'overview', t: '总览', f: viewOverview },
    { k: 'trend', t: '趋势', f: viewTrend },
    { k: 'todos', t: '待办', f: viewTodos },
    { k: 'history', t: '历史', f: viewHistory },
    { k: 'goals', t: '目标', f: viewGoals },
    { k: 'config', t: '设置', f: viewConfig },
    { k: 'audit', t: '数据体检', f: viewAudit },
    { k: 'ask', t: '怎么问', f: viewAsk },
    { k: 'terms', t: '术语', f: viewTerms },
  ]

  /* ══════════════ 6. Shell：状态 + 事件委托 ══════════════ */

  function stateOf(ctx) {
    var cfg = cfgGet(ctx)
    var hist = historyGet(ctx)
    var snapNow = snap(ctx)
    var v = 'overview'
    try { if (ctx && ctx.keep && typeof ctx.keep.get === 'function') v = ctx.keep.get(K_LAST_VIEW) || v } catch (e) { }
    return {
      cfg: cfg, hist: hist, snap: snapNow,
      series7: seriesOf(hist, 7, 'hours'),
      insights: insightsOf(snapNow, hist, ctx),
      todos: todosOf(snapNow),
      view: VIEWS.some(function (x) { return x.k === v }) ? v : 'overview',
    }
  }

  function reportMD(ctx, S) {
    var lines = []
    lines.push('# 学习洞察报告')
    lines.push('')
    lines.push('> 生成时间：' + new Date().toLocaleString())
    lines.push('> 快照条数：' + S.hist.length)
    lines.push('')
    lines.push('## 当前状态')
    lines.push('')
    lines.push('- 距初试：' + S.snap.left + ' 天')
    lines.push('- 连续打卡：' + S.snap.streak + ' 天')
    lines.push('- 学习时长（当前记录口径）：' + fmtH(S.snap.hours))
    lines.push('- 任务：' + S.snap.done + '/' + S.snap.tasks)
    lines.push('- 错题：' + S.snap.mistakes + ' 条，待回顾 ' + S.snap.due + ' 条')
    lines.push('- 词汇：' + S.snap.vocab)
    lines.push('')
    lines.push('## 数据判断')
    lines.push('')
    S.insights.forEach(function (x) { lines.push('- **' + x.title + '**：' + x.body) })
    lines.push('')
    lines.push('## 逐日快照')
    lines.push('')
    lines.push('| 日期 | 时长 | 任务 | 错题 | 待回顾 | 词汇 |')
    lines.push('|---|---|---|---|---|---|')
    S.hist.slice().reverse().forEach(function (r) {
      lines.push('| ' + r.day + ' | ' + fmtH(r.hours) + ' | ' + r.done + '/' + r.tasks
        + ' | ' + r.mistakes + ' | ' + r.due + ' | ' + r.vocab + ' |')
    })
    return lines.join('\n')
  }

  function doAct(ctx, S, root, act, value) {
    if (act === 'tab' && VIEWS.some(function (x) { return x.k === value })) {
      S.view = value
      try { if (ctx && ctx.keep && typeof ctx.keep.set === 'function') ctx.keep.set(K_LAST_VIEW, value) } catch (e) { }
      render(root, ctx, S)
      return
    }
    if (act === 'days') {
      S.cfg = cfgSet(ctx, { days: num(value, 14) })
      render(root, ctx, S)
      return
    }
    if (act === 'record' || act === 'record-force') {
      S.hist = recordToday(ctx, act === 'record-force')
      S.snap = snap(ctx)
      S.insights = insightsOf(S.snap, S.hist, ctx)
      toast(ctx, '已记录今天的快照', 'success')
      render(root, ctx, S)
      return
    }
    if (act === 'export-json') {
      try {
        ctx.api.download('学习洞察_快照_' + dkey() + '.json', JSON.stringify(S.hist, null, 2), 'application/json')
        toast(ctx, '已导出 ' + S.hist.length + ' 条快照', 'success')
      } catch (e) { toast(ctx, '导出失败：' + ((e && e.message) || e), 'danger') }
      return
    }
    if (act === 'export-md') {
      try {
        ctx.api.download('学习洞察_报告_' + dkey() + '.md', reportMD(ctx, S), 'text/markdown;charset=utf-8')
        toast(ctx, '报告已导出', 'success')
      } catch (e) { toast(ctx, '导出失败：' + ((e && e.message) || e), 'danger') }
      return
    }
    if (act === 'clear-history') {
      var ok = true
      try { if (ctx.api && typeof ctx.api.confirm === 'function') ok = ctx.api.confirm('清空 ' + S.hist.length + ' 条历史快照？此操作不能撤销。') } catch (e) { ok = true }
      if (!ok) return
      S.hist = historySave(ctx, [])
      S.insights = insightsOf(S.snap, S.hist, ctx)
      toast(ctx, '历史已清空', 'info')
      render(root, ctx, S)
      return
    }
    if (act === 'cfg-auto' || act === 'cfg-focus' || act === 'cfg-panel') {
      var key = act === 'cfg-auto' ? 'autoRecord' : act === 'cfg-focus' ? 'focusOnDue' : 'showPanel'
      var patch = {}
      patch[key] = !S.cfg[key]
      S.cfg = cfgSet(ctx, patch)
      render(root, ctx, S)
      return
    }
    if (act === 'copy') {
      try {
        if (navigator && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
          navigator.clipboard.writeText(String(value || '')).then(function () { toast(ctx, '说法已复制，去教练里粘贴', 'success') },
            function () { toast(ctx, '复制失败，请手动选中', 'warn') })
        } else toast(ctx, '当前环境不支持剪贴板，请手动选中', 'warn')
      } catch (e) { toast(ctx, '复制失败，请手动选中', 'warn') }
      return
    }
    if (act === 'goto') {
      var map = { 'go-mistakes': 'mistakes', 'go-photo': 'photomistake', 'go-tasks': 'scheduler', 'go-focus': 'focus' }
      var target = map[value]
      if (!target) return
      try { if (ctx.api && ctx.api.goTool) ctx.api.goTool(target); else if (window.App) window.App.go(target) } catch (e) { }
      return
    }
  }

  function render(root, ctx, S) {
    if (!root) return
    var header = '<div class="' + NS + 'tabs" role="tablist">'
      + VIEWS.map(function (v) {
        return '<button class="' + NS + 'tab' + (S.view === v.k ? ' on' : '') + '" data-act="tab" data-v="' + v.k + '" role="tab"'
          + ' aria-selected="' + (S.view === v.k ? 'true' : 'false') + '">' + esc(v.t) + '</button>'
      }).join('') + '</div>'
    var cur = VIEWS.filter(function (v) { return v.k === S.view })[0] || VIEWS[0]
    var body = ''
    try { body = cur.f(ctx, S) } catch (e) { body = '<div class="' + NS + 'empty">这个视图渲染失败了：' + esc((e && e.message) || e) + '</div>' }
    root.innerHTML = '<div class="' + NS + 'page">' + header + body + '</div>'
  }

  function mount(el, ctx) {
    style(ctx)
    if (cfgGet(ctx).autoRecord) recordToday(ctx, false)
    var S = stateOf(ctx)
    render(el, ctx, S)
    var onClick = function (ev) {
      var t = ev.target
      /* 从事件目标向上找 data-act（图标内部元素也要能点），最多 5 层 */
      for (var i = 0; i < 5 && t && t !== el; i++, t = t.parentElement) {
        var act = t.getAttribute && t.getAttribute('data-act')
        if (!act) continue
        ev.preventDefault()
        doAct(ctx, S, el, act, t.getAttribute('data-v'))
        return
      }
    }
    var onChange = function (ev) {
      var t = ev.target
      if (!t || !t.getAttribute) return
      var act = t.getAttribute('data-act')
      if (act === 'cfg-days') {
        S.cfg = cfgSet(ctx, { days: num(t.value, 14) })
        render(el, ctx, S)
      } else if (act === 'cfg-warn') {
        S.cfg = cfgSet(ctx, { warnLowHours: clamp(t.value, 0, 12, 1.5) })
        S.insights = insightsOf(S.snap, S.hist, ctx)
        render(el, ctx, S)
      } else if (act === 'goal-hours' || act === 'goal-tasks') {
        var patch2 = {}
        patch2[act === 'goal-hours' ? 'goalHours' : 'goalTasks'] = clamp(t.value, 0, 100, act === 'goal-hours' ? 10 : 5)
        S.cfg = cfgSet(ctx, patch2)
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

  /* ══════════════ 7. 面板 / 主 tab ══════════════ */

  function panel(ctx) {
    style(ctx)
    if (!cfgGet(ctx).showPanel) return ''
    var d = snap(ctx)
    var hist = historyGet(ctx)
    var s7 = seriesOf(hist, 7, 'hours')
    var spark = s7.map(function (x) {
      return '<i style="height:' + Math.max(2, Math.min(28, Math.round(x.v * 8))) + 'px"></i>'
    }).join('')
    return '<div class="' + NS + 'panel">'
      + '<div style="display:flex;justify-content:space-between;align-items:center;gap:6px">'
      + '<span>' + I('barChart', '图') + ' 学习洞察</span>'
      + '<span class="muted-sm" style="font-size:11px">距考 ' + d.left + ' 天</span></div>'
      + '<div class="' + NS + 'g"><div><b>' + d.streak + '</b><span>连续打卡</span></div>'
      + '<div><b>' + fmtH(d.hours) + '</b><span>当前时长</span></div>'
      + '<div><b>' + d.due + '</b><span>待回顾题</span></div></div>'
      + '<div class="' + NS + 'spark">' + spark + '</div>'
      + '</div>'
  }

  function maintab(ctx, el) {
    style(ctx)
    if (cfgGet(ctx).autoRecord) recordToday(ctx, false)
    var S = stateOf(ctx)
    el.innerHTML = '<div class="card"><div class="card-title">' + I('barChart', '图') + ' 学习洞察（插件主 tab）</div>'
      + '<div class="' + NS + 'kpis" style="grid-template-columns:repeat(4,minmax(0,1fr))">'
      + [['连续打卡', S.snap.streak + ' 天'], ['本周时长', fmtH(S.snap.hours)],
        ['错题', S.snap.mistakes + ' 条'], ['待回顾', S.snap.due + ' 条']].map(function (x) {
        return '<div class="' + NS + 'kpi"><b>' + esc(x[1]) + '</b><span>' + esc(x[0]) + '</span></div>'
      }).join('') + '</div>'
      + '<div style="margin-top:8px">' + S.insights.slice(0, 2).map(function (x) {
        return '<div class="' + NS + 'note ' + esc(x.level) + '"><div><b>' + esc(x.title) + '</b>' + esc(x.body) + '</div></div>'
      }).join('') + '</div>'
      + '<div class="muted-sm" style="font-size:11.5px;margin-top:8px">本 tab 由「学习洞察」插件注册 —— 底部导航扩展，卸载即消失。完整视图与导出见插件页。</div></div>'
  }

  /* ══════════════ 8. 注册 ══════════════ */

  var api = {
    id: PID,
    name: '学习洞察',
    version: VERSION,
    author: '内置',
    desc: '把散在各页的数字收进一屏，并用每天一条的历史快照回答"比之前好还是差"：总览 / 趋势 / 待办优先级 / 历史导出 / 设置。教练可查同一份数据。',
    tools: [{
      id: 'insight-page', title: '学习洞察', icon: '' + I('barChart', '图') + '',
      mount: function (el, ctx) { return mount(el, ctx) }
    }],
    init: function (ctx) {
      try { if (cfgGet(ctx).autoRecord) recordToday(ctx, false) } catch (e) { }
    },
    shortcuts: [
      { key: 'alt+i', label: '打开学习洞察', run: function (ctx) {
        try { if (ctx && ctx.api && ctx.api.goTool) ctx.api.goTool('insight-page') } catch (e) { }
      } },
    ],
    panels: [{
      id: 'ip-today', title: '学习洞察', icon: '' + I('barChart', '图') + '', width: 320, height: 210,
      render: panel
    }],
    config: [
      { key: 'days', label: '趋势默认天数', type: 'select', default: '14', options: ['7', '14', '30'] },
      { key: 'autoRecord', label: '每天自动记录快照', type: 'bool', default: true },
      { key: 'warnLowHours', label: '低时长提醒阈值（小时）', type: 'number', default: 1.5 },
      { key: 'focusOnDue', label: '待办优先考虑错题', type: 'bool', default: true },
      { key: 'showPanel', label: '显示常驻面板', type: 'bool', default: true },
    ],
    hooks: {
      /* 本页本来就现读 Store，hooks 里只补"当天还没有快照"这一条，保证趋势不断档 */
      focusDone: function (ctx) { try { if (cfgGet(ctx).autoRecord) recordToday(ctx, false) } catch (e) { } },
      taskDone: function (ctx) { try { if (cfgGet(ctx).autoRecord) recordToday(ctx, false) } catch (e) { } },
    },
    queries: [
      /* ★ 原样的 focusWeek：key / label / 算法都不变 */
      {
        key: 'focusWeek', label: '本周专注',
        run: function (ctx) {
          var s = ctx.Store.get()
          var mins = 0
          Object.keys(s.studyHours || {}).forEach(function (k) { mins += s.studyHours[k] * 60 })
          return '本周累计学习 ' + Math.round(mins / 60 * 10) / 10 + ' 小时'
        }
      },
      { key: 'ip-todo', label: '接下来该做什么', run: function (ctx) {
        var d = snap(ctx)
        var t = todosOf(d)
        if (!t.length) return '当前各页待办都清完了，不需要新的任务建议。'
        return '当前最该做的三件事：' + t.slice(0, 3).map(function (x, i) {
          return (i + 1) + '）' + x.title + '（' + x.detail + '）'
        }).join('；') + '。距考研 ' + d.left + ' 天。'
      } },
      { key: 'ip-streak', label: '连续打卡与单词量', run: function (ctx) {
        var d = snap(ctx)
        return '已连续打卡 ' + d.streak + ' 天，词汇库 ' + d.vocab + ' 词；当前记录的学习时长 '
          + fmtH(d.hours) + '。'
      } },
      { key: 'ip-trend', label: '学习趋势判断', run: function (ctx) {
        var h = historyGet(ctx)
        if (h.length < 3) return '历史快照只有 ' + h.length + ' 条，还不足以判断趋势（至少 3 天）。'
        var st = statsOf(seriesOf(h, 7, 'hours'))
        var direction = st.trend === 'up' ? '在回升' : st.trend === 'down' ? '在下降' : '基本持平'
        return '近 7 天日均 ' + fmtH(st.avg) + '，' + direction + '（与前半段相比 '
          + (st.delta >= 0 ? '+' : '-') + fmtH(Math.abs(st.delta)) + '）。最高一天 ' + fmtH(st.max) + '。'
      } },
      { key: 'ip-insights', label: '学习洞察的关键判断', run: function (ctx) {
        var d = snap(ctx), h = historyGet(ctx)
        return insightsOf(d, h, ctx).map(function (x) { return x.title + '：' + x.body }).join('\n')
      } },
      { key: 'ip-goal', label: '本周目标达成率', run: function (ctx) {
        var c = cfgGet(ctx), h = historyGet(ctx), d = snap(ctx)
        var w = statsOf(seriesOf(h, 7, 'hours'))
        var hp = c.goalHours > 0 ? Math.round(w.sum / c.goalHours * 100) : 0
        var tp = c.goalTasks > 0 ? Math.round(d.done / c.goalTasks * 100) : 0
        return '本周目标：专注 ' + fmtH(w.sum) + '/' + fmtH(c.goalHours) + '（' + Math.min(100, hp) + '%），'
          + '任务 ' + d.done + '/' + c.goalTasks + '（' + Math.min(100, tp) + '%）。'
          + '目标值可在插件页「目标」视图调整。'
      } },
      { key: 'ip-source', label: '洞察数字的数据来源', run: function (ctx) {
        return '学习洞察的当前值全部现读本机 Store：学习时长取 studyHours，任务取 tasks[].done，'
          + '错题待回顾取 mistakes[].reviewedAt，连续打卡取 studyStreak()，距考试取 settings.examDate。'
          + '只有历史快照是插件自己存的（ctx.data，每天一条）。本插件不改写任何站内数据。'
      } },
      { key: 'ip-audit', label: '洞察数据是否可信', run: function (ctx) {
        var d = snap(ctx), issues = []
        var hours = d.raw || {}, todayKey = dkey()
        var future = 0, neg = 0, huge = 0
        Object.keys(hours).forEach(function (k) {
          var v = num(hours[k])
          if (/^\d{4}-\d{2}-\d{2}$/.test(k) && k > todayKey) future++
          if (v < 0) neg++
          if (v > 24) huge++
        })
        if (future) issues.push('未来日期时长 ' + future + ' 条')
        if (neg) issues.push('负数时长 ' + neg + ' 条')
        if (huge) issues.push('超 24 小时 ' + huge + ' 条')
        if (d.tasks && d.done > d.tasks) issues.push('完成任务数大于总数')
        return issues.length ? '数据体检发现问题：' + issues.join('、') + '。建议回原页核对，本插件只读不改。'
          : '数据体检未发现自相矛盾的值；但这只说明形态正常，不代表数据完整。'
      } },
      { key: 'ip-exam', label: '考前剩余与准备度', run: function (ctx) {
        var d = snap(ctx)
        return '距初试 ' + d.left + ' 天；任务完成 ' + d.done + '/' + d.tasks + '（' + d.rate + '%），'
          + '错题待回顾 ' + d.due + ' 道，连续打卡 ' + d.streak + ' 天。'
      } },
    ],
    memory: '用户装有「学习洞察」插件：工具页有总览/趋势/待办/历史/设置五个视图，每天自动记一条本机快照（不上传）。'
      + '用户问「这周学了多久」（focusWeek）、「学习是变好还是变差」（ip-trend）、「接下来做什么」（ip-todo）、'
      + '「打卡多少天」（ip-streak）、「本周目标达成多少」（ip-goal）时可查对应接口；'
      + '给出的判断都带证据数字，不要编造没有记录的趋势。',

    /* ★ 保留原 id 与注册方式 */
    maintabs: [{ id: 'insight-tab', name: '洞察', icon: '' + I('barChart', '图') + '', render: function (ctx, el) { return maintab(ctx, el) } }],
  }

  if (typeof window !== 'undefined' && window.__IP_DEBUG__) {
    window.__ipInternals = {
      esc: esc, num: num, clamp: clamp, flat: flat, trunc: trunc, dkey: dkey,
      shiftDay: shiftDay, dayDiff: dayDiff, fmtH: fmtH, hashStr: hashStr,
      snap: snap, historyGet: historyGet, historySave: historySave, recordToday: recordToday,
      seriesOf: seriesOf, statsOf: statsOf, insightsOf: insightsOf, todosOf: todosOf,
      reportMD: reportMD, mount: mount, VIEWS: VIEWS, MAX_HISTORY: MAX_HISTORY,
    }
  }

  PluginBus.register(api)
})()
