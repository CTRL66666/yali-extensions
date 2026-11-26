/* daily-boost.plugin.js — 今日动力面板 · v2.0.0
 *
 * v1.1.0 是"今天这一刻"的快照：倒计时 / 任务 / 心情 / 待办（165 行）。它回答不了
 * "我的心情在变好还是变差""这周任务是不是一直在拖""离下个节点还有几天"。
 * v2.0.0 按成熟插件形态重造：多视图 shell + 本机心情/快照历史 + 里程碑 + 可导出报告。
 *
 * 【兼容契约 · 不许改】
 *   · 面板 id 'daily-boost'、订阅自动刷新、导出快照、ctx.api.go / ctx.U.esc；
 *   · 查询 db-today 的 key 与核心口径（倒计时/今日任务/心情/连续打卡）；
 *   · 工具 id 'daily-boost-page'、快捷键 alt+b、init/onDisable 的订阅与退订。
 *
 * 【口径纪律】当前值全部现读 Store（心情取当天 mental、任务取 todayTaskStats），
 * 插件只存**历史**（ctx.data），不复制一份"当前状态"——复制就等于埋一颗数字分叉的雷。
 */
;(function () {
  'use strict'

  var VERSION = '2.0.0'
  var PID = 'daily-boost'
  var NS = 'db-'
  var K_HISTORY = 'dbHistory'     // 每日快照（一条/天）
  var K_MOTTO = 'dbCustomMotto'   // 自定义每日一句
  var K_CFG = 'dbConfig'
  var MAX_HISTORY = 180
  var DAY = 86400000
  var MOTIS = [
    '稳住，我们能赢',
    '今天多背一页，考场少慌一秒',
    '冲刺阶段，慢就是快',
    '一题一题来，分数一分一分攒',
    '别追完美的一天，追连续的一天',
    '状态不好就把任务切小，别把目标砍掉',
  ]
  var MILESTONES = [100, 80, 60, 30, 14, 7, 1]

  /* ══════════════ 1. 工具 ══════════════ */

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
    })
  }
  function num(v, d) { var n = Number(v); return isFinite(n) ? n : (d === undefined ? 0 : d) }
  function clamp(v, a, b, d) { var n = num(v, d === undefined ? a : d); return Math.max(a, Math.min(b, n)) }
  function flat(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim() }
  function trunc(s, n) { s = flat(s); return s.length > n ? s.slice(0, n - 1) + '…' : s }
  function dkey(t) {
    var x = t == null ? new Date() : (t instanceof Date ? t : new Date(t))
    if (isNaN(x.getTime())) x = new Date()
    return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0')
  }
  function shiftDay(key, delta) {
    var p = String(key || dkey()).split('-')
    var d = new Date(num(p[0], 1970), num(p[1], 1) - 1, num(p[2], 1))
    d.setDate(d.getDate() + delta)
    return dkey(d)
  }
  function daysBetween(a, b) {
    var pa = String(a).split('-'), pb = String(b).split('-')
    return Math.round((Date.UTC(num(pb[0]), num(pb[1]) - 1, num(pb[2])) -
      Date.UTC(num(pa[0]), num(pa[1]) - 1, num(pa[2]))) / DAY)
  }
  function I(key, text) {
    try {
      if (typeof U !== 'undefined' && U && typeof U.icon === 'function') {
        var svg = U.icon(key)
        if (svg) return '<span class="' + NS + 'ic" aria-hidden="true">' + svg + '</span>'
      }
    } catch (e) { }
    return '<span class="' + NS + 'ic" aria-hidden="true">' + esc(text || '·') + '</span>'
  }
  function toast(ctx, msg, level) {
    try { if (ctx && typeof ctx.notify === 'function') ctx.notify({ title: String(msg), level: level || 'info', timeout: 3200 }) }
    catch (e) { }
  }
  function cfgGet(ctx) {
    var d = { moodGoal: 7, taskGoal: 5, showMood: true }
    var got = null
    try { got = ctx && typeof ctx.data === 'function' ? ctx.data(K_CFG) : null } catch (e) { }
    if (got && typeof got === 'object') {
      d.moodGoal = clamp(got.moodGoal, 0, 10, 7)
      d.taskGoal = clamp(got.taskGoal, 0, 50, 5)
      d.showMood = got.showMood !== false
    }
    return d
  }
  function cfgSet(ctx, patch) {
    var d = cfgGet(ctx)
    Object.keys(patch || {}).forEach(function (k) { if (k in d) d[k] = patch[k] })
    try { if (ctx && typeof ctx.data === 'function') ctx.data(K_CFG, d) } catch (e) { }
    return d
  }
  function configRead(ctx, key, fallback) {
    try { if (ctx && typeof ctx.config === 'function') return ctx.config(key) || fallback } catch (e) { }
    return fallback
  }
  function mottoOf(ctx) {
    var v = flat(configRead(ctx, 'motto', '轮换'))
    if (v === '自定义') {
      var custom = ''
      try { custom = flat(ctx && typeof ctx.data === 'function' ? ctx.data(K_MOTTO) : '') } catch (e) { }
      return custom || '（自定义还没写，去设置里填一句）'
    }
    if (v === '固定第一句') return MOTIS[0]
    return MOTIS[Math.floor(Date.now() / DAY) % MOTIS.length]
  }

  /* ══════════════ 2. 当前状态（现读 Store） ══════════════ */

  function stats(ctx) {
    var s = {}
    try { s = (ctx && ctx.Store && ctx.Store.get && ctx.Store.get()) || {} } catch (e) { }
    var left = 0
    try { left = (ctx && ctx.U && typeof ctx.U.daysTo === 'function') ? num(ctx.U.daysTo((s.settings || {}).examDate)) : 0 } catch (e) { }
    var st = {}
    try { st = (ctx && ctx.Store && typeof ctx.Store.todayTaskStats === 'function') ? ctx.Store.todayTaskStats() : {} } catch (e) { }
    var done = 0, total = 0
    Object.keys(st || {}).forEach(function (k) { done += num(st[k] && st[k][0]); total += num(st[k] && st[k][1]) })
    var mental = Array.isArray(s.mental) ? s.mental : []
    var mood = mental.filter(function (m) { return m && m.date === ctx.dkey() })[0] || null
    var tasks = Array.isArray(s.tasks) ? s.tasks : []
    var streak = 0
    try { streak = (ctx && ctx.Store && typeof ctx.Store.studyStreak === 'function') ? num(ctx.Store.studyStreak()) : 0 } catch (e) { }
    return {
      s: s, left: Math.max(0, left), done: done, total: total,
      pct: total ? Math.round(done / total * 100) : 0,
      mood: mood, mental: mental, tasks: tasks, streak: streak,
      open: tasks.filter(function (t) { return t && !t.done }).slice(0, MAX_HISTORY),
      motto: mottoOf(ctx), at: Date.now(),
    }
  }

  function moodText(m) {
    if (!m || m.mood == null) return '今天还没记录心情'
    return num(m.mood) + '/10 ' + (flat(m.note) || '（没写备注）')
  }
  function moodLevel(v) { return v == null ? '—' : (num(v) >= 8 ? '很好' : num(v) >= 6 ? '还行' : num(v) >= 4 ? '一般' : '偏低') }

  function historyGet(ctx) {
    var arr = null
    try { arr = ctx && typeof ctx.data === 'function' ? ctx.data(K_HISTORY) : null } catch (e) { }
    if (!Array.isArray(arr)) return []
    return arr.filter(function (x) { return x && /^\d{4}-\d{2}-\d{2}$/.test(String(x.day || '')) })
      .map(function (x) { return { day: x.day, left: num(x.left), done: num(x.done), total: num(x.total),
        mood: x.mood == null ? null : num(x.mood), moodNote: flat(x.moodNote), streak: num(x.streak), at: num(x.at, Date.now()) } })
      .sort(function (a, b) { return String(a.day).localeCompare(String(b.day)) })
      .slice(-MAX_HISTORY)
  }
  function historySave(ctx, arr) {
    var out = (arr || []).slice(-MAX_HISTORY)
    try { if (ctx && typeof ctx.data === 'function') ctx.data(K_HISTORY, out) } catch (e) { }
    return out
  }
  function recordToday(ctx, force, d) {
    d = d || stats(ctx)
    var day = dkey(), arr = historyGet(ctx)
    var last = arr.length ? arr[arr.length - 1] : null
    if (last && last.day === day && !force) return arr
    var rec = {
      day: day, left: d.left, done: d.done, total: d.total,
      mood: d.mood && d.mood.mood != null ? num(d.mood.mood) : null,
      moodNote: d.mood ? flat(d.mood.note) : '', streak: d.streak, at: d.at,
    }
    if (last && last.day === day) arr[arr.length - 1] = rec
    else arr.push(rec)
    return historySave(ctx, arr)
  }

  /* ══════════════ 3. 分析 ══════════════ */

  function trendOf(hist, days, field) {
    var map = {}
    ;(hist || []).forEach(function (x) { map[x.day] = x[field] })
    var out = []
    for (var i = days - 1; i >= 0; i--) {
      var k = shiftDay(dkey(), -i)
      out.push({ day: k, v: map[k] == null ? null : num(map[k]), has: map[k] != null })
    }
    return out
  }
  function avgOf(vals) {
    var xs = (vals || []).filter(function (x) { return x != null })
    return xs.length ? xs.reduce(function (a, b) { return a + b }, 0) / xs.length : null
  }
  function deltaOf(hist, field) {
    var a = avgOf(hist.slice(-7).map(function (x) { return x[field] }))
    var b = avgOf(hist.slice(-14, -7).map(function (x) { return x[field] }))
    if (a == null || b == null) return null
    return Math.round((a - b) * 10) / 10
  }
  function milestoneOf(left) {
    var found = null
    MILESTONES.forEach(function (n) { if (left <= n && (found == null || n < found.n)) found = { n: n, left: left } })
    return found
  }
  function insightsOf(d, hist) {
    var out = []
    var cfg = cfgGet(null)
    var dm = deltaOf(hist, 'mood')
    if (dm != null && Math.abs(dm) >= 0.5) {
      out.push({ level: dm > 0 ? 'good' : 'warn', title: dm > 0 ? '心情在回升' : '心情在往下走',
        body: '近 7 天平均 ' + (dm > 0 ? '高' : '低') + ' ' + Math.abs(dm) + ' 分（对比前 7 天）。先看是否和任务压力同步变化。' })
    }
    var dd = deltaOf(hist, 'done')
    if (dd != null && dd < -0.5 && d.total >= cfg.taskGoal) {
      out.push({ level: 'warn', title: '每日完成任务数在下降', body: '近 7 天平均少完成 ' + Math.abs(dd) + ' 项。更可能是任务堆得太大，而不是偷懒。' })
    }
    if (d.mood && num(d.mood.mood) <= 4) {
      out.push({ level: 'warn', title: '今天心情偏低', body: '当前记录 ' + num(d.mood.mood) + '/10。低分日先把任务切小，别硬上难题。' })
    }
    if (d.left > 0 && d.left <= 7) {
      out.push({ level: 'info', title: '进入最后一周', body: '距初试 ' + d.left + ' 天。这个阶段查漏比刷新题更重要。' })
    }
    if (d.streak >= 7) {
      out.push({ level: 'good', title: '连续打卡 ' + d.streak + ' 天', body: '节奏已经稳了，继续按原计划走，别临时改打法。' })
    }
    if (!out.length) {
      out.push({ level: 'info', title: '还没有足够历史可判断', body: '每天记一条快照，' + Math.max(0, 4 - hist.length) + ' 天后这里会给出有依据的变化判断。' })
    }
    return out.slice(0, 6)
  }

  /* ══════════════ 4. 样式 ══════════════ */

  var CSS = [
    '.' + NS + 'page{display:flex;flex-direction:column;gap:12px;max-width:1080px;margin:0 auto}',
    '.' + NS + 'hero{border-radius:14px;padding:18px;background:var(--glass-bg);border:1px solid var(--line);text-align:center;position:relative;overflow:hidden}',
    '.' + NS + 'hero:after{content:"";position:absolute;left:50%;top:-80px;transform:translateX(-50%);width:240px;height:180px;border-radius:50%;background:radial-gradient(circle,var(--danger,#d9534f),transparent 70%);opacity:.08;pointer-events:none}',
    '.' + NS + 'days{font-size:46px;font-weight:600;color:var(--danger,#d9534f);line-height:1.15;position:relative}',
    '.' + NS + 'hero p{margin:5px 0 0;color:var(--text-secondary);font-size:12.5px}',
    '.' + NS + 'quote{font-size:12px;color:var(--text-secondary);line-height:1.7;margin-top:10px !important}',
    '.' + NS + 'tabs{display:flex;gap:6px;flex-wrap:wrap;border-bottom:1px solid var(--line);padding-bottom:8px}',
    '.' + NS + 'tab{border:1px solid var(--line);background:transparent;color:var(--text-secondary);border-radius:9px;padding:6px 13px;font-size:12px;cursor:pointer;transition:.16s}',
    '.' + NS + 'tab.on{background:var(--accent-text);border-color:var(--accent-text);color:var(--btn-text,#fff)}',
    '.' + NS + 'grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}',
    '.' + NS + 'card{border:1px solid var(--line);border-radius:12px;padding:13px 15px;background:var(--glass-bg)}',
    '.' + NS + 'card h4{margin:0 0 9px;font-size:13px;display:flex;align-items:center;gap:7px}',
    '.' + NS + 'num{font-size:22px;font-weight:600;line-height:1.25}',
    '.' + NS + 'sub{font-size:11.5px;color:var(--text-secondary)}',
    '.' + NS + 'bar{height:8px;border-radius:8px;background:var(--chart-track,var(--line));overflow:hidden;margin-top:8px}',
    '.' + NS + 'bar i{display:block;height:100%;background:var(--ok,#2e9e5b);border-radius:8px;transition:width .25s}',
    '.' + NS + 'task{display:flex;justify-content:space-between;gap:9px;font-size:12px;padding:6px 0;border-bottom:1px dashed var(--line)}',
    '.' + NS + 'task:last-child{border-bottom:0}',
    '.' + NS + 'task span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text-secondary)}',
    '.' + NS + 'note{display:flex;gap:8px;padding:9px 11px;border-radius:10px;margin-bottom:8px;border-left:3px solid var(--line);background:var(--glass-bg);font-size:12px;line-height:1.7}',
    '.' + NS + 'note.warn{border-left-color:var(--danger,#d9534f)}',
    '.' + NS + 'note.good{border-left-color:var(--ok,#2e9e5b)}',
    '.' + NS + 'note.info{border-left-color:var(--blue)}',
    '.' + NS + 'note b{display:block;font-size:12.5px;margin-bottom:2px}',
    '.' + NS + 'moods{display:flex;gap:5px;flex-wrap:wrap;margin:8px 0}',
    '.' + NS + 'moods button{border:1px solid var(--line);border-radius:8px;background:var(--glass-bg);color:var(--text-primary);padding:6px 11px;font-size:12px;cursor:pointer}',
    '.' + NS + 'moods button.on{background:var(--accent-text);border-color:var(--accent-text);color:var(--btn-text,#fff)}',
    '.' + NS + 'table{width:100%;border-collapse:collapse;font-size:12px}',
    '.' + NS + 'table th{text-align:left;color:var(--text-secondary);font-weight:500;padding:7px 8px;border-bottom:1px solid var(--line);font-size:11px}',
    '.' + NS + 'table td{padding:7px 8px;border-bottom:1px dashed var(--line)}',
    '.' + NS + 'field{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:9px 0;border-bottom:1px dashed var(--line);font-size:12px}',
    '.' + NS + 'field input,.db-field textarea{border:1px solid var(--line);border-radius:8px;background:var(--bg-muted,var(--glass-bg));color:var(--text-primary);padding:6px 9px;font-size:12px;font-family:inherit}',
    '.' + NS + 'acts{display:flex;gap:7px;flex-wrap:wrap;margin-top:10px}',
    '.' + NS + 'btn{border:1px solid var(--line);background:var(--glass-bg);color:var(--text-primary);border-radius:8px;padding:6px 12px;font-size:11.5px;cursor:pointer;transition:.15s}',
    '.' + NS + 'btn:hover{border-color:var(--accent-text);color:var(--accent-text)}',
    '.' + NS + 'btn.pri{background:var(--accent-text);border-color:var(--accent-text);color:var(--btn-text,#fff)}',
    '.' + NS + 'ic{display:inline-flex;width:15px;height:15px;vertical-align:-2px}',
    '.' + NS + 'ic svg{width:15px;height:15px;fill:none;stroke:currentColor;stroke-width:1.8}',
    '.' + NS + 'spark{display:flex;align-items:flex-end;gap:3px;height:34px;margin-top:8px}',
    '.' + NS + 'spark i{flex:1;background:var(--accent-text);opacity:.7;border-radius:2px 2px 0 0;min-height:2px}',
    '@media(max-width:820px){.' + NS + 'grid{grid-template-columns:repeat(2,1fr)}}',
    'html[data-theme="night"] .' + NS + 'days{color:#f0a09a}'
  ].join('\n')

  function style(ctx) {
    try { if (ctx && ctx.css && typeof ctx.css.add === 'function') ctx.css.add(CSS, 'skin') } catch (e) { }
  }

  /* ══════════════ 5. 视图 ══════════════ */

  function sparkline(vals, max) {
    if (!vals.length) return ''
    var m = Math.max.apply(null, vals.concat([max || 0, 0.01]))
    return '<div class="' + NS + 'spark">' + vals.map(function (v) {
      return '<i style="height:' + Math.max(2, Math.round((v == null ? 0 : v) / m * 30)) + 'px;opacity:' + (v == null ? '.25' : '.7') + '"></i>'
    }).join('') + '</div>'
  }

  function viewToday(ctx, S) {
    var out = []
    var d = S.d
    var mile = milestoneOf(d.left)
    out.push('<div class="' + NS + 'hero"><div class="' + NS + 'days">' + d.left + '</div>'
      + '<p>距考研还有 ' + d.left + ' 天 · 连续打卡 ' + d.streak + ' 天'
      + (mile ? ' · 下个节点：' + mile.n + ' 天' : '') + '</p>'
      + '<p class="' + NS + 'quote">' + I('cpChat', '语') + ' ' + esc(d.motto) + '</p></div>')
    out.push('<div class="' + NS + 'grid">')
    out.push('<div class="' + NS + 'card"><h4>今日任务</h4><div class="' + NS + 'num">' + d.done + '/' + d.total + '</div>'
      + '<div class="' + NS + 'sub">完成率 ' + d.pct + '%</div><div class="' + NS + 'bar"><i style="width:' + d.pct + '%"></i></div></div>')
    out.push('<div class="' + NS + 'card"><h4>今日心情</h4><div class="' + NS + 'num">' + (d.mood && d.mood.mood != null ? num(d.mood.mood) : '—') + '</div>'
      + '<div class="' + NS + 'sub">' + esc(moodText(d.mood)) + '</div></div>')
    out.push('<div class="' + NS + 'card"><h4>待办速览</h4><div class="' + NS + 'num">' + d.open.length + '</div>'
      + '<div class="' + NS + 'sub">未完成任务（最多列 20 项）</div></div>')
    out.push('</div>')
    out.push('<section class="' + NS + 'card"><h4>接下来</h4>'
      + (d.open.length ? d.open.slice(0, 20).map(function (t) {
        return '<div class="' + NS + 'task"><span>' + esc(t.text || t.desc || '(未命名任务)') + '</span><b>' + esc(t.subject || '') + '</b></div>'
      }).join('') : '<div class="' + NS + 'sub">当前没有未完成的任务。可以去排程页安排今天的学习。</div>')
      + '<div class="' + NS + 'acts">'
      + '<button class="' + NS + 'btn pri" data-act="go" data-v="dashboard">去仪表盘</button>'
      + '<button class="' + NS + 'btn" data-act="go" data-v="focus">去专注</button>'
      + '<button class="' + NS + 'btn" data-act="go" data-v="scheduler">去排程</button>'
      + '<button class="' + NS + 'btn" data-act="record">记录今天</button>'
      + '<button class="' + NS + 'btn" data-act="export">导出快照</button>'
      + '</div></section>')
    out.push('<section class="' + NS + 'card"><h4>' + I('cpBrain', '判') + ' 从历史里读出的变化</h4>'
      + S.insights.map(function (x) {
        return '<div class="' + NS + 'note ' + esc(x.level) + '"><div><b>' + esc(x.title) + '</b>' + esc(x.body) + '</div></div>'
      }).join('') + '</section>')
    return out.join('')
  }

  function viewMood(ctx, S) {
    var out = []
    var cfg = cfgGet(ctx)
    var series = trendOf(S.hist, 14, 'mood')
    var avg = avgOf(series.map(function (x) { return x.v }))
    out.push('<section class="' + NS + 'card"><h4>今天的心情</h4>'
      + '<p class="' + NS + 'sub" style="margin:0">点一个分数即写入当天的 mental 记录（与设置页同源），并记入插件历史。</p>'
      + '<div class="' + NS + 'moods">' + [2, 4, 6, 8, 10].map(function (n) {
        var cur = S.d.mood && num(S.d.mood.mood) === n
        return '<button data-act="mood" data-v="' + n + '" class="' + (cur ? 'on' : '') + '">' + n + ' 分 · ' + moodLevel(n) + '</button>'
      }).join('') + '</div>'
      + '<div class="' + NS + 'field"><label>备注（可选）</label>'
      + '<input data-act="mood-note" value="' + esc(S.d.mood ? flat(S.d.mood.note) : '') + '" placeholder="为什么是这个分数" style="width:58%;max-width:340px"></div>'
      + '</section>')
    out.push('<section class="' + NS + 'card"><div class="' + NS + 'card-hd"><h4>近 14 天心情</h4>'
      + '<span class="' + NS + 'sub">' + (avg == null ? '还没有记录' : '平均 ' + (Math.round(avg * 10) / 10) + '/10') + '</span></div>'
      + sparkline(series.map(function (x) { return x.v }), 10)
      + (S.hist.length ? '<table class="' + NS + 'table" style="margin-top:12px"><thead><tr><th>日期</th><th>分数</th><th>备注</th></tr></thead><tbody>'
        + S.hist.slice(-10).reverse().filter(function (x) { return x.mood != null }).map(function (x) {
          return '<tr><td>' + esc(x.day) + '</td><td>' + x.mood + '</td><td>' + esc(trunc(x.moodNote || '—', 32)) + '</td></tr>'
        }).join('') + '</tbody></table>' : '<div class="' + NS + 'sub">还没有历史。</div>')
      + '</section>')
    out.push('<section class="' + NS + 'card"><h4>口径说明</h4><p class="' + NS + 'sub" style="margin:0;line-height:1.8">'
      + '当前心情读 Store.mental 里**当天**那条；历史是本插件每天记的快照（最多 ' + MAX_HISTORY + ' 条）。'
      + '目标分 ' + cfg.moodGoal + ' 可在设置里改；插件不会把低分自动改成"还行"——那等于伪造你的感受。</p></section>')
    return out.join('')
  }

  function viewJourney(ctx, S) {
    var out = []
    var d = S.d
    var mile = milestoneOf(d.left)
    var pct = d.left > 0 ? clamp(Math.round((100 - d.left) / 100 * 100), 0, 100) : 100
    out.push('<section class="' + NS + 'card"><h4>' + I('hourglass', '时') + ' 冲刺里程</h4>'
      + '<div class="' + NS + 'sub">距初试 ' + d.left + ' 天 · 已走过 ' + pct + '%（以 100 天为坐标为示意，不是精确备考进度）</div>'
      + '<div class="' + NS + 'bar" style="height:12px"><i style="width:' + pct + '%"></i></div>'
      + '<table class="' + NS + 'table" style="margin-top:12px"><thead><tr><th>节点</th><th>状态</th><th>该做</th></tr></thead><tbody>'
      + MILESTONES.map(function (n) {
        var passed = d.left <= n
        var desc = n >= 60 ? '补基础漏洞，别追难题' : n >= 30 ? '按套卷节奏练，固定时段' : n >= 14 ? '错题回炉 + 限时训练' : '只做熟悉的题，保状态'
        return '<tr><td>' + n + ' 天</td><td>' + (passed ? '已进入' : '还有 ' + (d.left - n) + ' 天') + '</td><td>' + desc + '</td></tr>'
      }).join('') + '</tbody></table>'
      + (mile ? '<p class="' + NS + 'sub">当前所处区间：' + mile.n + ' 天内。</p>' : '')
      + '</section>')
    out.push('<section class="' + NS + 'card"><h4>提醒口径</h4><p class="' + NS + 'sub" style="margin:0;line-height:1.8">'
      + '里程碑是**导航**，不是承诺：天数到了不代表你该恐慌，没到也不代表可以拖。'
      + '它只回答"现在我该把注意力放在补基础还是保状态"。</p></section>')
    return out.join('')
  }

  function viewHistory(ctx, S) {
    var out = []
    out.push('<section class="' + NS + 'card"><div class="' + NS + 'card-hd"><h4>本机快照</h4>'
      + '<span class="' + NS + 'acts" style="margin:0">'
      + '<button class="' + NS + 'btn" data-act="record-force">立即记录</button>'
      + '<button class="' + NS + 'btn" data-act="export">导出 JSON</button>'
      + '<button class="' + NS + 'btn" data-act="export-md">导出报告</button>'
      + '</span></div>')
    if (!S.hist.length) out.push('<div class="' + NS + 'sub">还没有快照。每天会自动记一条，也可以点"立即记录"。</div>')
    else {
      out.push('<table class="' + NS + 'table"><thead><tr><th>日期</th><th>剩余天数</th><th>任务</th><th>心情</th><th>连续</th></tr></thead><tbody>')
      out.push(S.hist.slice().reverse().slice(0, 60).map(function (x) {
        return '<tr><td>' + esc(x.day) + '</td><td>' + x.left + '</td><td>' + x.done + '/' + x.total
          + '</td><td>' + (x.mood == null ? '—' : x.mood + '/10') + '</td><td>' + x.streak + '</td></tr>'
      }).join('') + '</tbody></table>')
      if (S.hist.length > 60) out.push('<p class="' + NS + 'sub">界面只显示 60 条，导出文件是全部 ' + S.hist.length + ' 条。</p>')
    }
    out.push('</section>')
    return out.join('')
  }

  function viewConfig(ctx, S) {
    var c = cfgGet(ctx)
    var out = []
    out.push('<section class="' + NS + 'card"><h4>插件设置</h4>'
      + '<div class="' + NS + 'field"><label>每日一句</label><span class="' + NS + 'sub">在插件中心的配置里改（轮换 / 固定第一句 / 自定义）</span></div>'
      + '<div class="' + NS + 'field"><label>自定义那句</label>'
      + '<input data-act="custom-motto" value="' + esc(flat(ctx && typeof ctx.data === 'function' ? ctx.data(K_MOTTO) : '')) + '" style="width:58%;max-width:340px"></div>'
      + '<div class="' + NS + 'field"><label>心情目标分</label>'
      + '<input type="number" min="0" max="10" value="' + c.moodGoal + '" data-act="cfg-mood" style="width:74px"></div>'
      + '<div class="' + NS + 'field"><label>每日任务目标</label>'
      + '<input type="number" min="0" max="50" value="' + c.taskGoal + '" data-act="cfg-task" style="width:74px"></div>'
      + '<div class="' + NS + 'field"><label>常驻面板</label>'
      + '<button class="' + NS + 'btn' + (c.showMood ? ' pri' : '') + '" data-act="cfg-panel">' + (c.showMood ? '显示' : '隐藏') + '</button></div>'
      + '</section>')
    out.push('<section class="' + NS + 'card"><h4>数据与隐私</h4><p class="' + NS + 'sub" style="margin:0;line-height:1.8">'
      + '快照只存本机 ctx.data，最多 ' + MAX_HISTORY + ' 条，不上传；心情以 Store.mental 为准，插件历史只是它的逐日投影。'
      + '关闭面板不会停止快照记录。</p></section>')
    return out.join('')
  }

  /** 节奏视图：把"每天做了什么"汇总成周节律，回答"我是不是只在某几天用力"。
   * 这是启发式视图，不给"你应该怎样"的说教，只把事实摆出来。 */
  function viewRhythm(ctx, S) {
    var out = []
    var hist = S.hist
    var byDay = {}
    hist.forEach(function (x) { byDay[x.day] = x })
    var days = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
    var counts = [0, 0, 0, 0, 0, 0, 0], totals = [0, 0, 0, 0, 0, 0, 0]
    hist.forEach(function (x) {
      var d = new Date(x.day + 'T00:00:00')
      if (isNaN(d.getTime())) return
      var w = d.getDay()
      counts[w]++
      totals[w] += num(x.done)
    })
    var max = Math.max.apply(null, totals.concat([1]))
    out.push('<section class="' + NS + 'card"><h4>' + I('barChart', '律') + ' 一周节律</h4>'
      + '<p class="' + NS + 'sub" style="margin:0 0 10px">'
      + '按星期几聚合快照：任务完成数的分布。样本还少时只当参考，别据此改计划。</p>'
      + '<table class="' + NS + 'table"><thead><tr><th>星期</th><th>记录天数</th><th>平均完成</th><th>分布</th></tr></thead><tbody>'
      + days.map(function (t, i) {
        var avg = counts[i] ? Math.round(totals[i] / counts[i] * 10) / 10 : 0
        var pct = Math.round(avg / max * 100)
        return '<tr><td>' + t + '</td><td>' + counts[i] + '</td><td>' + avg + '</td>'
          + '<td><div class="' + NS + 'bar" style="width:120px"><i style="width:' + pct + '%"></i></div></td></tr>'
      }).join('') + '</tbody></table></section>')
    var best = -1, worst = -1
    days.forEach(function (_, i) {
      if (!counts[i]) return
      var avg = totals[i] / counts[i]
      if (best < 0 || avg > totals[best] / counts[best]) best = i
      if (worst < 0 || avg < totals[worst] / counts[worst]) worst = i
    })
    if (best >= 0 && worst >= 0 && best !== worst) {
      out.push('<section class="' + NS + 'card"><h4>从节律里读出的</h4>'
        + '<div class="' + NS + 'note info"><div><b>' + days[best] + '完成最多，' + days[worst] + '最少</b>'
        + '（基于 ' + counts[best] + ' / ' + counts[worst] + ' 条快照）。'
        + '如果这两天的任务量差不多，差别更可能来自状态而不是能力 —— 把难任务挪到' + days[best] + '试试。</div></div>'
        + '<p class="' + NS + 'sub" style="margin:8px 0 0">这不是"你必须在哪天学习"的规定。'
        + '它只说明过去这段时间你的实际分布。</p></section>')
    }
    return out.join('')
  }

  /** 口径视图：把每个数字"从哪来、什么时候会不准"写清楚。
   * 动力面板最怕的就是"说你好好的，其实数据早就不对了"。 */
  function viewSource(ctx, S) {
    var out = []
    var rows = [
      ['距考研天数', 'settings.examDate → ctx.U.daysTo()', '没设考试日期时显示 0；0 不代表"今天考"，是"还没配"'],
      ['今日任务', 'ctx.Store.todayTaskStats()', '按科目分组的 [完成, 总数]；跨天不清零时统计口径由站内决定'],
      ['今日心情', 'Store.mental 里 date === 今天的记录', '没有记录时显示"今天还没记录心情"，不会拿昨天的顶上'],
      ['连续打卡', 'ctx.Store.studyStreak()', '站内口径，插件原样显示，不自己算'],
      ['冲刺节点', '固定的 100/80/60/30/14/7/1 天', '导航用的刻度，不是"你该到哪一步"的评价标准'],
      ['变化判断', '插件本机快照（每天一条）', '至少 4 条才给判断；不足时明说不足，不编趋势'],
    ]
    out.push('<section class="' + NS + 'card"><h4>' + I('cpGear', '口') + ' 数字口径</h4>'
      + '<table class="' + NS + 'table"><thead><tr><th>显示</th><th>来自</th><th>什么时候不准</th></tr></thead><tbody>'
      + rows.map(function (r) {
        return '<tr><td>' + esc(r[0]) + '</td><td>' + esc(r[1]) + '</td><td>' + esc(r[2]) + '</td></tr>'
      }).join('') + '</tbody></table>'
      + '<p class="' + NS + 'tip" style="margin-top:10px">这张表的用途：当你觉得"面板数字不对"时，'
      + '先按这行去源头核对，而不是在这个插件里找不存在的设置。插件只做展示与本机历史。</p></section>')
    out.push('<section class="' + NS + 'card"><h4>这个插件不做什么</h4>'
      + '<div class="' + NS + 'note info"><div><b>不改任务、不改考试日期、不改连续打卡</b>'
      + '唯一写入的是"今天的心情分数"（写进 Store.mental，与设置页同源）和本机快照。'
      + '倒计时是提醒，不是催促；心情低分不会被自动改成"还行"。</div></div></section>')
    return out.join('')
  }

  /** 口径字典：把界面词与真实字段钉在一起，避免用户拿错口径做判断。 */
  function viewDict(ctx, S) {
    var rows = [["倒计时", "ctx.U.daysTo(settings.examDate)", "未配置日期返回 0，不是今天考"], ["今日任务", "Store.todayTaskStats() 按科目求和", "跨天口径由站内决定，插件不自己清零"], ["今日心情", "Store.mental 里 date 等于今天", "没有就显示未记录，不拿昨天的顶"], ["连续打卡", "Store.studyStreak()", "站内算法，插件不另算"], ["快照", "插件 ctx.data(dbHistory) 每天一条", "只存条数与分数，不存任务标题"]]
    var out = []
    out.push('<section class="' + NS + 'card"><h4>' + I('cpGear', '字') + ' 口径字典</h4>'
      + '<table class="' + NS + 'table"><thead><tr><th>词</th><th>实际来源</th><th>注意</th></tr></thead><tbody>'
      + rows.map(function (r) { return '<tr><td><b>' + esc(r[0]) + '</b></td><td>' + esc(r[1])
        + '</td><td>' + esc(r[2]) + '</td></tr>' }).join('')
      + '</tbody></table>'
      + '<p class="' + NS + 'tip" style="margin-top:10px">这张表存在的意义：'
      + '当数字看着不对时，先按表去源头核对，而不是在插件里找不存在的开关。</p></section>')
    return out.join('')
  }

  var VIEWS = [
    { k: 'today', t: '今日', f: viewToday },
    { k: 'mood', t: '心情', f: viewMood },
    { k: 'journey', t: '里程', f: viewJourney },
    { k: 'history', t: '历史', f: viewHistory },
    { k: 'config', t: '设置', f: viewConfig },
    { k: 'rhythm', t: '节律', f: viewRhythm },
    { k: 'source', t: '口径', f: viewSource },
    { k: 'dict', t: '字段字典', f: viewDict },
  ]

  /* ══════════════ 6. Shell ══════════════ */

  function stateOf(ctx) {
    var d = stats(ctx)
    var hist = historyGet(ctx)
    var v = 'today'
    try { if (ctx && ctx.keep && typeof ctx.keep.get === 'function') v = ctx.keep.get('dbView') || v } catch (e) { }
    return {
      d: d, hist: hist, insights: insightsOf(d, hist),
      view: VIEWS.some(function (x) { return x.k === v }) ? v : 'today',
    }
  }

  function reportMD(ctx, S) {
    var lines = []
    lines.push('# 今日动力面板报告')
    lines.push('')
    lines.push('> 生成：' + new Date().toLocaleString())
    lines.push('')
    lines.push('- 距初试：' + S.d.left + ' 天')
    lines.push('- 连续打卡：' + S.d.streak + ' 天')
    lines.push('- 今日任务：' + S.d.done + '/' + S.d.total + '（' + S.d.pct + '%）')
    lines.push('- 今日心情：' + moodText(S.d.mood))
    lines.push('- 每日一句：' + S.d.motto)
    lines.push('')
    lines.push('## 变化判断')
    lines.push('')
    S.insights.forEach(function (x) { lines.push('- **' + x.title + '**：' + x.body) })
    lines.push('')
    lines.push('## 逐日快照')
    lines.push('')
    lines.push('| 日期 | 剩余 | 任务 | 心情 | 连续 |')
    lines.push('|---|---|---|---|---|')
    S.hist.slice().reverse().forEach(function (x) {
      lines.push('| ' + x.day + ' | ' + x.left + ' | ' + x.done + '/' + x.total
        + ' | ' + (x.mood == null ? '—' : x.mood) + ' | ' + x.streak + ' |')
    })
    return lines.join('\n')
  }

  function doAct(ctx, S, root, act, value) {
    if (act === 'tab' && VIEWS.some(function (x) { return x.k === value })) {
      S.view = value
      try { if (ctx && ctx.keep && typeof ctx.keep.set === 'function') ctx.keep.set('dbView', value) } catch (e) { }
      render(root, ctx, S)
      return
    }
    if (act === 'go') {
      try { if (ctx.api && typeof ctx.api.go === 'function') ctx.api.go(value); else if (ctx.api && typeof ctx.api.goTool === 'function') ctx.api.goTool(value) } catch (e) { }
      return
    }
    if (act === 'record' || act === 'record-force') {
      S.hist = recordToday(ctx, act === 'record-force', S.d)
      S.insights = insightsOf(S.d, S.hist)
      toast(ctx, '已记录今天的快照', 'success')
      render(root, ctx, S)
      return
    }
    if (act === 'export') {
      try {
        var payload = { at: new Date().toISOString(), left: S.d.left, streak: S.d.streak,
          task: { done: S.d.done, total: S.d.total }, mood: S.d.mood || null, motto: S.d.motto, history: S.hist }
        ctx.api.download('今日快照_' + ctx.dkey() + '.json', JSON.stringify(payload, null, 2), 'application/json')
        if (typeof ctx.log === 'function') ctx.log('已导出今日数据快照')
        toast(ctx, '已导出快照', 'success')
      } catch (e) { toast(ctx, '导出失败：' + ((e && e.message) || e), 'danger') }
      return
    }
    if (act === 'export-md') {
      try {
        ctx.api.download('今日动力_报告_' + ctx.dkey() + '.md', reportMD(ctx, S), 'text/markdown;charset=utf-8')
        toast(ctx, '报告已导出', 'success')
      } catch (e) { toast(ctx, '导出失败：' + ((e && e.message) || e), 'danger') }
      return
    }
    if (act === 'mood') {
      var n = clamp(value, 0, 10, 5)
      var noteInput = root.querySelector('[data-act="mood-note"]')
      var note = noteInput ? flat(noteInput.value).slice(0, 120) : ''
      var day = ctx.dkey()
      var ok = false
      try {
        if (ctx.Store && typeof ctx.Store.update === 'function') {
          ctx.Store.update(function (st) {
            var arr = Array.isArray(st.mental) ? st.mental : (st.mental = [])
            var found = arr.filter(function (m) { return m && m.date === day })[0]
            if (found) { found.mood = n; found.note = note }
            else arr.push({ date: day, mood: n, note: note })
          })
          ok = true
        }
      } catch (e) { ok = false }
      if (!ok) { toast(ctx, '心情写入失败（Store 不可用）', 'danger'); return }
      S.d = stats(ctx)
      S.hist = recordToday(ctx, true, S.d)
      S.insights = insightsOf(S.d, S.hist)
      toast(ctx, '心情已记录：' + n + '/10', 'success')
      render(root, ctx, S)
      return
    }
    if (act === 'cfg-panel') {
      var c = cfgGet(ctx)
      c.showMood = !c.showMood
      cfgSet(ctx, { showMood: c.showMood })
      render(root, ctx, S)
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
    try { body = cur.f(ctx, S) } catch (e) { body = '<div class="' + NS + 'sub">这个视图渲染失败了：' + esc((e && e.message) || e) + '</div>' }
    root.innerHTML = '<div class="' + NS + 'page">' + header + body + '</div>'
  }

  function mount(el, ctx) {
    style(ctx)
    var S = stateOf(ctx)
    S.hist = recordToday(ctx, false, S.d)
    render(el, ctx, S)
    var onClick = function (ev) {
      var t = ev.target
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
      if (act === 'custom-motto') {
        try { if (ctx && typeof ctx.data === 'function') ctx.data(K_MOTTO, flat(t.value).slice(0, 120)) } catch (e) { }
        S.d = stats(ctx)
        toast(ctx, '每日一句已更新', 'success')
      } else if (act === 'cfg-mood') {
        cfgSet(ctx, { moodGoal: clamp(t.value, 0, 10, 7) })
      } else if (act === 'cfg-task') {
        cfgSet(ctx, { taskGoal: clamp(t.value, 0, 50, 5) })
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

  /* ══════════════ 7. 面板（保留 id / 订阅刷新 / 导出） ══════════════ */

  function panelRender(ctx, box) {
    style(ctx)
    if (!cfgGet(ctx).showMood) { box.innerHTML = ''; return }
    var d = stats(ctx)
    var hist = historyGet(ctx)
    var spark = sparkline(trendOf(hist, 7, 'mood').map(function (x) { return x.v }), 10)
    box.innerHTML = '<div class="' + NS + 'panel">'
      + '<div class="' + NS + 'days">' + d.left + '</div>'
      + '<div class="' + NS + 'sub">距考研还有 ' + d.left + ' 天</div>'
      + '<div>今日任务 <b>' + d.done + '/' + d.total + '</b>（' + d.pct + '%）</div>'
      + '<div class="' + NS + 'bar"><i style="width:' + d.pct + '%"></i></div>'
      + '<div class="' + NS + 'sub">' + I('cpChat', '语') + ' ' + esc(moodText(d.mood)) + '</div>'
      + spark
      + '<div class="' + NS + 'quote">' + esc(d.motto) + '</div>'
      + '<div class="btn-row" style="justify-content:center">'
      + '<button class="btn btn-sm btn-primary" data-g="dashboard">仪表盘</button>'
      + '<button class="btn btn-sm btn-ghost" data-g="focus">专注</button>'
      + '<button class="btn btn-sm btn-ghost" data-dl>导出快照</button></div></div>'
    var go = box.querySelector('[data-g=dashboard]')
    if (go) go.onclick = function () { try { ctx.api.go('dashboard') } catch (e) { } }
    var go2 = box.querySelector('[data-g=focus]')
    if (go2) go2.onclick = function () { try { ctx.api.go('focus') } catch (e) { } }
    var dl = box.querySelector('[data-dl]')
    if (dl) dl.onclick = function () {
      try {
        ctx.api.download('今日快照_' + ctx.dkey() + '.json', JSON.stringify({ at: new Date().toISOString(), left: d.left,
          streak: d.streak, task: { done: d.done, total: d.total }, mood: d.mood || null, motto: d.motto, history: hist }, null, 2), 'application/json')
        if (typeof ctx.log === 'function') ctx.log('已导出今日数据快照')
      } catch (e) { }
    }
  }

  /* ══════════════ 8. 注册 ══════════════ */

  var api = {
    id: PID,
    name: '今日动力面板',
    version: VERSION,
    author: '内置',
    desc: '倒计时 / 今日任务 / 心情 / 待办一屏总览，外加冲刺里程、心情与快照历史、可导出报告；常驻面板随数据变化自动刷新。',
    tools: [{ id: 'daily-boost-page', title: '今日动力', icon: '' + I('rocket', '力') + '', mount: function (el, ctx) { return mount(el, ctx) } }],
    panels: [{ id: 'daily-boost', title: '今日动力', icon: '' + I('rocket', '力') + '', width: 320, height: 440, render: panelRender }],
    config: [
      { key: 'motto', label: '每日一句', type: 'select', default: '轮换', options: ['轮换', '固定第一句', '自定义'] },
      { key: 'moodGoal', label: '心情目标分（0-10）', type: 'number', default: 7 },
      { key: 'taskGoal', label: '每日任务目标', type: 'number', default: 5 },
    ],
    shortcuts: [{ key: 'alt+b', label: '打开今日动力', run: function (ctx) { try { ctx.api.goTool('daily-boost-page') } catch (e) { } } }],
    queries: [
      /* ★ 原 db-today：核心口径原样保留（查询文本不做 HTML 转义，否则实体会被模型读出来） */
      { key: 'db-today', label: '今日进度', run: function (ctx) {
        var d = stats(ctx)
        return '距考研 ' + d.left + ' 天，今日任务完成 ' + d.done + '/' + d.total + '（' + d.pct + '%），连续打卡 '
          + d.streak + ' 天。' + moodText(d.mood) + '。'
      } },
      { key: 'db-mood-trend', label: '心情变化趋势', run: function (ctx) {
        var h = historyGet(ctx)
        if (h.length < 4) return '心情历史只有 ' + h.length + ' 条，还不足以判断趋势。'
        var dm = deltaOf(h, 'mood')
        if (dm == null) return '还没有足够的心情分数记录。'
        return '近 7 天平均心情 ' + (dm > 0 ? '高' : '低') + ' ' + Math.abs(dm)
          + ' 分（对比前 7 天）。当前 ' + moodText(stats(ctx).mood) + '。'
      } },
      { key: 'db-countdown', label: '倒计时与冲刺阶段', run: function (ctx) {
        var d = stats(ctx)
        var m = milestoneOf(d.left)
        return '距初试 ' + d.left + ' 天' + (m ? '，已进入 ' + m.n + ' 天区间' : '') + '。'
          + (d.left <= 14 ? '这个阶段以查漏和保状态为主。' : d.left <= 60 ? '按套卷节奏练、固定时段。' : '还在基础补漏期，别急着追难题。')
      } },
      { key: 'db-rhythm', label: '一周节律', run: function (ctx) {
        var h = historyGet(ctx)
        if (h.length < 7) return '快照只有 ' + h.length + ' 条，样本不够判断星期节律。'
        var days = ['周日','周一','周二','周三','周四','周五','周六']
        var totals = [0,0,0,0,0,0,0], counts = [0,0,0,0,0,0,0]
        h.forEach(function (x) {
          var d = new Date(x.day + 'T00:00:00')
          if (isNaN(d.getTime())) return
          var w = d.getDay(); counts[w]++; totals[w] += num(x.done)
        })
        var best = -1
        days.forEach(function (_, i) { if (counts[i] && (best < 0 || totals[i]/counts[i] > totals[best]/counts[best])) best = i })
        return best < 0 ? '节律数据不足。' : '过去快照里 ' + days[best] + ' 平均完成任务最多；这只反映实际分布，不是安排建议。'
      } },
      { key: 'db-source', label: '动力面板数字的来源', run: function (ctx) {
        return '倒计时取 settings.examDate，经 ctx.U.daysTo 计算；今日任务取 Store.todayTaskStats()；'
          + '心情取 Store.mental 里当天那条；连续打卡取 Store.studyStreak()。'
          + '本插件只写当天心情与本机快照，不改任务/考试日期/打卡。'
      } },
      { key: 'db-motto', label: '当前的每日一句', run: function (ctx) {
        return '用户设置的每日一句：' + mottoOf(ctx) + '。（可在插件中心配置 motto：轮换 / 固定第一句 / 自定义。）'
      } },
      { key: 'db-task-trend', label: '每日完成任务变化', run: function (ctx) {
        var h = historyGet(ctx)
        var dd = deltaOf(h, 'done')
        if (dd == null) return '任务完成历史不足，无法判断变化。'
        return '近 7 天平均每天完成 ' + (dd >= 0 ? '多' : '少') + ' ' + Math.abs(dd)
          + ' 项（对比前 7 天）。今日 ' + stats(ctx).done + '/' + stats(ctx).total + '。'
      } },
    ],
    memory: '用户装有「今日动力面板」插件：常驻显示考研倒计时、今日任务完成率与心情，另有冲刺里程、心情/快照历史与导出。'
      + '用户问「还有多少天」（db-countdown）、「今天进度」（db-today）、「心情最近怎么样」（db-mood-trend）、'
      + '「任务是不是在拖」（db-task-trend）时可查对应接口。所有判断都基于本机快照，数据不足时如实说不足。',
    init: function (ctx) {
      try {
        var panelDef = ctx.PluginBus.panels().filter(function (p) { return p.pid === ctx.pid })[0]
        ctx.unsub = ctx.PluginBus.subscribe(ctx.pid, function () {
          var p = document.getElementById('plg-panel-daily-boost')
          if (p && panelDef) {
            var box = p.querySelector('.plg-panel-b')
            if (box) { try { panelDef.render(ctx, box) } catch (e) { } }
          }
        })
        if (typeof ctx.log === 'function') ctx.log('动力面板已就绪（数据变化自动刷新）')
        recordToday(ctx, false)
      } catch (e) { }
    },
    onDisable: function (ctx) { try { if (ctx.unsub) ctx.unsub(); if (typeof ctx.log === 'function') ctx.log('动力面板已停止') } catch (e) { } },
  }

  if (typeof window !== 'undefined' && window.__DB_DEBUG__) {
    window.__dbInternals = {
      esc: esc, num: num, clamp: clamp, flat: flat, trunc: trunc, dkey: dkey, shiftDay: shiftDay,
      stats: stats, moodText: moodText, historyGet: historyGet, historySave: historySave,
      recordToday: recordToday, trendOf: trendOf, avgOf: avgOf, deltaOf: deltaOf,
      milestoneOf: milestoneOf, insightsOf: insightsOf, reportMD: reportMD, mount: mount, VIEWS: VIEWS,
    }
  }

  PluginBus.register(api)
})()
