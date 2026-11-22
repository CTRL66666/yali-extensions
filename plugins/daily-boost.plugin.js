/* daily-boost.plugin.js — 今日动力面板 · v1.1.0
 *
 * 早期版本只有一个 380px 面板，且面板文案里有装饰性 emoji。本版：
 *   · 保留原面板 id / 数据订阅自动刷新 / 导出快照 / ctx.U.esc 转义；
 *   · 文案去 emoji，改图标 key；
 *   · 新增完整工具页（倒计时 / 任务 / 心情 / 快捷入口 / 导出）、查询与快捷键。
 */
;(function () {
  'use strict'

  let VERSION = '1.1.0'
  let PID = 'daily-boost'
  let NS = 'db-'
  let MOTIS = ['稳住，我们能赢', '今天多背一页，考场少慌一秒', '冲刺阶段，慢就是快', '一题一题来，分数一分一分攒']

  let CSS = `
.db-page{display:flex;flex-direction:column;gap:12px}
.db-hero{border-radius:14px;padding:18px;background:var(--glass-bg);border:1px solid var(--line);text-align:center}
.db-days{font-size:46px;font-weight:600;color:var(--danger);line-height:1.15}
.db-hero p{margin:5px 0 0;color:var(--text-secondary);font-size:12.5px}
.db-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}
.db-card{border:1px solid var(--line);border-radius:12px;padding:13px 15px;background:var(--glass-bg)}
.db-card h4{margin:0 0 9px;font-size:13px}
.db-num{font-size:22px;font-weight:600;line-height:1.25}
.db-sub{font-size:11.5px;color:var(--text-secondary)}
.db-bar{height:8px;border-radius:8px;background:var(--chart-track);overflow:hidden;margin-top:8px}
.db-bar i{display:block;height:100%;background:var(--ok);border-radius:8px;transition:width .25s}
.db-task{display:flex;justify-content:space-between;gap:9px;font-size:12px;padding:6px 0;border-bottom:1px dashed var(--line)}
.db-task:last-child{border-bottom:0}
.db-task span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text-secondary)}
.db-panel{display:flex;flex-direction:column;gap:8px;font-size:12px;text-align:center}
.db-panel .db-days{font-size:38px}
.db-quote{font-size:12px;color:var(--text-secondary);line-height:1.7}
`
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] }) }
  function style(ctx) { try { if (ctx && ctx.css && typeof ctx.css.add === 'function') ctx.css.add(CSS, 'skin') } catch (e) { } }
  function stats(ctx) {
    let s = {}
    try { s = (ctx && ctx.Store && ctx.Store.get()) || {} } catch (e) { }
    let left = 0
    try { left = (ctx && ctx.U && typeof ctx.U.daysTo === 'function') ? ctx.U.daysTo((s.settings || {}).examDate) : 0 } catch (e) { }
    let st = {}
    try { st = (ctx && ctx.Store && typeof ctx.Store.todayTaskStats === 'function') ? ctx.Store.todayTaskStats() : {} } catch (e) { }
    let done = 0, total = 0
    Object.keys(st || {}).forEach(function (k) { done += st[k][0] || 0; total += st[k][1] || 0 })
    let mood = (Array.isArray(s.mental) ? s.mental : []).filter(function (m) { return m && m.date === ctx.dkey() })[0] || null
    let tasks = Array.isArray(s.tasks) ? s.tasks : []
    let streak = 0
    try { streak = (ctx && ctx.Store && typeof ctx.Store.studyStreak === 'function') ? ctx.Store.studyStreak() : 0 } catch (e) { }
    let pct = total ? Math.round(done / total * 100) : 0
    return { s: s, left: left, done: done, total: total, pct: pct, mood: mood, tasks: tasks, streak: streak }
  }
  function motto(ctx) {
    let v = '轮换'
    try { v = String((ctx && ctx.config && ctx.config('motto')) || '轮换') } catch (e) { }
    if (v === '固定第一句') return MOTIS[0]
    return MOTIS[Math.floor(Date.now() / 86400000) % MOTIS.length]
  }
  function moodText(m) {
    if (!m || m.mood == null) return '今天还没记录心情'
    return m.mood + '/10 ' + (m.note || '')
  }

  function mount(el, ctx) {
    style(ctx)
    function render() {
      let d = stats(ctx)
      let open = d.tasks.filter(function (t) { return t && !t.done }).slice(0, 5)
      el.innerHTML = '<div class="' + NS + 'page">'
        + '<div class="' + NS + 'hero"><div class="' + NS + 'days">' + d.left + '</div>'
        + '<p>距考研还有 ' + d.left + ' 天 · 连续打卡 ' + d.streak + ' 天</p>'
        + '<p class="' + NS + 'quote">' + U.icon('cpChat') + ' ' + esc(motto(ctx)) + '</p></div>'
        + '<div class="' + NS + 'grid">'
        + '<div class="' + NS + 'card"><h4>今日任务</h4><div class="' + NS + 'num">' + d.done + '/' + d.total + '</div>'
        + '<div class="' + NS + 'sub">完成率 ' + d.pct + '%</div><div class="' + NS + 'bar"><i style="width:' + d.pct + '%"></i></div></div>'
        + '<div class="' + NS + 'card"><h4>今日心情</h4><div class="' + NS + 'num">' + (d.mood && d.mood.mood != null ? d.mood.mood : '—') + '</div>'
        + '<div class="' + NS + 'sub">' + esc(moodText(d.mood)) + '</div></div>'
        + '<div class="' + NS + 'card"><h4>待办速览</h4><div class="' + NS + 'num">' + Math.max(0, d.tasks.length - d.done) + '</div>'
        + '<div class="' + NS + 'sub">未完成任务（最多列 5 项）</div></div></div>'
        + '<div class="' + NS + 'card"><h4>接下来</h4>'
        + (open.length ? open.map(function (t) {
          return '<div class="' + NS + 'task"><span>' + esc(t.text || '(未命名任务)') + '</span><b>' + esc(t.subject || '') + '</b></div>'
        }).join('') : '<div class="muted-sm" style="font-size:12px">当前没有未完成的任务。可以去排程页安排今天的学习。</div>')
        + '<div class="btn-row" style="margin-top:10px">'
        + '<button class="btn btn-sm btn-primary" data-g="dashboard">去仪表盘</button>'
        + '<button class="btn btn-sm btn-ghost" data-g="focus">去专注</button>'
        + '<button class="btn btn-sm btn-ghost" data-dl>导出快照</button></div></div>'
        + '<details><summary style="font-size:12px;color:var(--text-secondary);cursor:pointer">数据口径与刷新 ⓘ</summary>'
        + '<p style="font-size:12px;line-height:1.8;color:var(--text-secondary)">倒计时读 settings.examDate；任务统计来自今日任务口径；心情取当天的 mental 记录。'
        + '常驻面板会随 Store 变化自动重绘，这里与它同源，数字一致。</p></details></div>'
      Array.prototype.forEach.call(el.querySelectorAll('[data-g]'), function (b) {
        b.onclick = function () { try { ctx.api.go(b.getAttribute('data-g')) } catch (e) { } }
      })
      let dl = el.querySelector('[data-dl]')
      if (dl) dl.onclick = function () { exportSnap(ctx, d) }
    }
    render()
    return function () { el.innerHTML = '' }
  }
  function exportSnap(ctx, d) {
    let snap = { at: new Date().toISOString(), left: d.left, streak: d.streak,
      task: { done: d.done, total: d.total }, mood: d.mood || null, motto: motto(ctx) }
    ctx.api.download('今日快照_' + ctx.dkey() + '.json', JSON.stringify(snap, null, 2), 'application/json')
    ctx.log('已导出今日数据快照')
  }

  /* ★ 原面板 id / 订阅自动刷新 / 导出快照 / ctx.U.esc 全保留，只把 emoji 换成图标 */
  function panelRender(ctx, box) {
    style(ctx)
    let d = stats(ctx)
    box.innerHTML = '<div class="' + NS + 'panel">'
      + '<div class="' + NS + 'days">' + d.left + '</div>'
      + '<div class="' + NS + 'sub">距考研还有 ' + d.left + ' 天</div>'
      + '<div>今日任务 <b>' + d.done + '/' + d.total + '</b>（' + d.pct + '%）</div>'
      + '<div class="' + NS + 'bar"><i style="width:' + d.pct + '%"></i></div>'
      + '<div class="' + NS + 'sub">' + U.icon('cpChat') + ' ' + esc(moodText(d.mood)) + '</div>'
      + '<div class="' + NS + 'quote">' + esc(motto(ctx)) + '</div>'
      + '<div class="btn-row" style="justify-content:center">'
      + '<button class="btn btn-sm btn-primary" data-g="dashboard">仪表盘</button>'
      + '<button class="btn btn-sm btn-ghost" data-g="focus">专注</button>'
      + '<button class="btn btn-sm btn-ghost" data-dl>导出快照</button></div></div>'
    let go = box.querySelector('[data-g=dashboard]')
    if (go) go.onclick = function () { ctx.api.go('dashboard') }
    let go2 = box.querySelector('[data-g=focus]')
    if (go2) go2.onclick = function () { ctx.api.go('focus') }
    let dl = box.querySelector('[data-dl]')
    if (dl) dl.onclick = function () { exportSnap(ctx, d) }
  }

  let api = {
    id: PID,
    name: '今日动力面板',
    version: VERSION,
    author: '内置',
    desc: '倒计时 / 今日任务 / 心情 / 待办一屏总览；常驻面板随数据变化自动刷新，也能导出快照。',
    tools: [{ id: 'daily-boost-page', title: '今日动力', icon: '' + U.icon('rocket') + '', mount: function (el, ctx) { return mount(el, ctx) } }],
    panels: [{ id: 'daily-boost', title: '今日动力', icon: '' + U.icon('rocket') + '', width: 320, height: 420, render: panelRender }],
    config: [{ key: 'motto', label: '每日一句', type: 'select', default: '轮换', options: ['轮换', '固定第一句'] }],
    shortcuts: [{ key: 'alt+b', label: '打开今日动力', run: function (ctx) { try { ctx.api.goTool('daily-boost-page') } catch (e) { } } }],
    queries: [
      { key: 'db-today', label: '今日进度', run: function (ctx) {
        let d = stats(ctx)
        /* 查询文本进教练提示词，绝不能做 HTML 转义（实体会被模型原样读出来） */
        return '距考研 ' + d.left + ' 天，今日任务完成 ' + d.done + '/' + d.total + '（' + d.pct + '%），连续打卡 ' + d.streak + ' 天。' + moodText(d.mood) + '。'
      } },
    ],
    memory: '用户装有「今日动力面板」插件：常驻显示考研倒计时、今日任务完成率与心情。用户问「还有多少天」「今天进度」时可用其查询。',
    init: function (ctx) {
      try {
        let panelDef = ctx.PluginBus.panels().filter(function (p) { return p.pid === ctx.pid })[0]
        ctx.unsub = ctx.PluginBus.subscribe(ctx.pid, function () {
          let p = document.getElementById('plg-panel-daily-boost')
          if (p && panelDef) {
            let box = p.querySelector('.plg-panel-b')
            if (box) { try { panelDef.render(ctx, box) } catch (e) { } }
          }
        })
        ctx.log('动力面板已就绪（数据变化自动刷新）')
      } catch (e) { }
    },
    onDisable: function (ctx) { try { if (ctx.unsub) ctx.unsub(); ctx.log('动力面板已停止') } catch (e) { } },
  }

  PluginBus.register(api)
})()
