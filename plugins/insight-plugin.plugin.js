/* insight-plugin.plugin.js — 学习洞察 · v1.1.0
 *
 * 早期版本只有一个数字条 + 一条 focusWeek 查询。本版把它做成真正的"数据总览"：
 * 工具页 KPI / 学习时长分布 / 错题待办 / 任务进度，主 tab 同步升级，常驻面板 + 查询 + 快捷键。
 * 【保留】focusWeek 的 key、label 与算法，以及 maintabs 的 id，老用户/老测试不受影响。
 */
;(function () {
  'use strict'

  let VERSION = '1.1.0'
  let PID = 'insight-plugin'
  let NS = 'ip-'

  let CSS = `
.ip-page{display:flex;flex-direction:column;gap:12px}
.ip-hero{border-radius:14px;padding:16px 18px;background:var(--glass-bg);border:1px solid var(--line)}
.ip-hero h3{margin:0 0 6px;font-size:16px}
.ip-hero p{margin:0;color:var(--text-secondary);font-size:12.5px;line-height:1.7}
.ip-kpis{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:9px}
.ip-kpis div{border:1px solid var(--line);border-radius:11px;padding:11px 12px;background:var(--glass-bg)}
.ip-kpis b{display:block;font-size:19px;line-height:1.3}
.ip-kpis span{font-size:11px;color:var(--text-secondary)}
.ip-card{border:1px solid var(--line);border-radius:12px;padding:14px 16px;background:var(--glass-bg)}
.ip-card h4{margin:0 0 10px;font-size:13.5px}
.ip-bars{display:flex;align-items:flex-end;gap:7px;height:96px}
.ip-bars i{flex:1;min-width:14px;border-radius:5px 5px 0 0;background:linear-gradient(180deg,var(--accent-text),var(--blue));opacity:.85;position:relative}
.ip-bars i span{position:absolute;bottom:-18px;left:0;right:0;text-align:center;font-size:10px;color:var(--text-secondary)}
.ip-row{display:flex;justify-content:space-between;gap:8px;font-size:12px;padding:6px 0;border-bottom:1px dashed var(--line)}
.ip-row:last-child{border-bottom:0}
.ip-row span{color:var(--text-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ip-panel{display:flex;flex-direction:column;gap:7px;font-size:12px}
.ip-g{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;text-align:center}
.ip-g div{border-radius:9px;padding:8px 4px;background:var(--glass-bg)}
.ip-g b{display:block;font-size:15px}
.ip-g span{font-size:10.5px;color:var(--text-secondary)}
`
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] }) }
  function style(ctx) { try { if (ctx && ctx.css && typeof ctx.css.add === 'function') ctx.css.add(CSS, 'skin') } catch (e) { } }
  function snap(ctx) {
    let s = {}
    try { s = (ctx && ctx.Store && ctx.Store.get()) || {} } catch (e) { }
    let hours = s.studyHours || {}
    let mins = 0
    Object.keys(hours).forEach(function (k) { mins += (Number(hours[k]) || 0) * 60 })
    let tasks = Array.isArray(s.tasks) ? s.tasks : []
    let done = tasks.filter(function (t) { return t && t.done }).length
    let mistakes = Array.isArray(s.mistakes) ? s.mistakes : []
    let due = mistakes.filter(function (m) { return m && !m.reviewedAt }).length
    let streak = 0
    try { streak = (ctx && ctx.Store && typeof ctx.Store.studyStreak === 'function') ? ctx.Store.studyStreak() : 0 } catch (e) { }
    let left = 0
    try { left = (ctx && ctx.U && typeof ctx.U.daysTo === 'function') ? ctx.U.daysTo((s.settings || {}).examDate) : 0 } catch (e) { }
    return { hours: mins / 60, tasks: tasks.length, done: done, mistakes: mistakes.length, due: due,
      vocab: Array.isArray(s.vocab) ? s.vocab.length : 0, streak: streak, left: left, raw: hours }
  }
  function bars(raw) {
    let ks = Object.keys(raw || {}).slice(-7)
    if (!ks.length) return '<div class="muted-sm" style="font-size:12px">还没有学习时长记录。去专注页开始一轮，这里就会出现分布。</div>'
    let vals = ks.map(function (k) { return Number(raw[k]) || 0 })
    let max = Math.max.apply(null, vals.concat([1]))
    return '<div class="' + NS + 'bars">' + vals.map(function (v, i) {
      return '<i style="height:' + Math.max(4, Math.round(v / max * 78)) + 'px" title="' + esc(ks[i]) + ' ' + v + ' 小时"><span>' + esc(String(ks[i]).slice(-2)) + '</span></i>'
    }).join('') + '</div>'
  }

  function mount(el, ctx) {
    style(ctx)
    let d = snap(ctx)
    el.innerHTML = '<div class="' + NS + 'page">'
      + '<div class="' + NS + 'hero"><h3>' + U.icon('barChart') + ' 学习洞察</h3>'
      + '<p>把散在各页的数字收在一屏：距考试还有 <b>' + d.left + '</b> 天，'
      + '连续打卡 <b>' + d.streak + '</b> 天。下面所有数字都直接来自本机 Store，不另算一份口径。</p></div>'
      + '<div class="' + NS + 'kpis">'
      + [['本周时长', Math.round(d.hours * 10) / 10 + 'h'], ['任务完成', d.done + '/' + d.tasks],
        ['错题', d.mistakes + ' 条'], ['待回顾', d.due + ' 条'], ['单词', d.vocab + ' 个']].map(function (x) {
        return '<div><b>' + esc(x[1]) + '</b><span>' + x[0] + '</span></div>'
      }).join('') + '</div>'
      + '<div class="' + NS + 'card"><h4>最近 7 天学习时长</h4>' + bars(d.raw) + '</div>'
      + '<div class="' + NS + 'card"><h4>接下来最该做的三件事</h4>'
      + '<div class="' + NS + 'row"><span>错题待回顾（最早的那道优先）</span><b>' + d.due + ' 条</b></div>'
      + '<div class="' + NS + 'row"><span>未完成任务</span><b>' + Math.max(0, d.tasks - d.done) + ' 项</b></div>'
      + '<div class="' + NS + 'row"><span>距考研</span><b>' + d.left + ' 天</b></div>'
      + '<details style="margin-top:9px"><summary style="font-size:12px;color:var(--text-secondary);cursor:pointer">数据口径说明 ⓘ</summary>'
      + '<p style="font-size:12px;line-height:1.8;color:var(--text-secondary)">时长取自 studyHours（按学习页记录折算为小时）；任务完成看 tasks 的 done 标记；'
      + '错题待回顾看 reviewedAt 是否为空。教练说「查一下本周专注」走的是 focusWeek 查询，与本页同一份数字。</p></details></div></div>'
    return function () { el.innerHTML = '' }
  }

  function panel(ctx) {
    style(ctx)
    let d = snap(ctx)
    return '<div class="' + NS + 'panel">'
      + '<div style="display:flex;justify-content:space-between"><span>' + U.icon('barChart') + ' 学习洞察</span><span style="color:var(--text-secondary)">距考 ' + d.left + ' 天</span></div>'
      + '<div class="' + NS + 'g"><div><b>' + d.streak + '</b><span>连续打卡</span></div>'
      + '<div><b>' + Math.round(d.hours * 10) / 10 + 'h</b><span>本周时长</span></div>'
      + '<div><b>' + d.due + '</b><span>待回顾题</span></div></div>'
      + '<button class="btn btn-sm btn-ghost">查看完整洞察</button></div>'
  }

  function maintab(ctx, el) {
    style(ctx)
    let d = snap(ctx)
    el.innerHTML = '<div class="card"><div class="card-title">' + U.icon('barChart') + ' 学习洞察（插件主 tab）</div>'
      + '<div class="' + NS + 'kpis" style="grid-template-columns:repeat(4,minmax(0,1fr))">'
      + [['连续打卡', d.streak + ' 天'], ['单词', d.vocab + ' 词'], ['错题', d.mistakes + ' 条'], ['待回顾', d.due + ' 条']].map(function (x) {
        return '<div><b>' + esc(x[1]) + '</b><span>' + x[0] + '</span></div>'
      }).join('') + '</div>'
      + '<div class="muted-sm" style="font-size:11.5px;margin-top:8px">本 tab 由「学习洞察」插件注册 —— 底部导航扩展，卸载即消失。完整分布见插件页。</div></div>'
  }

  let api = {
    id: PID,
    name: '学习洞察',
    version: VERSION,
    author: '内置',
    desc: '把学习时长、任务、错题、单词收进一屏：KPI 总览 + 七日分布 + 待办优先级，教练也能查。',
    tools: [{ id: 'insight-page', title: '学习洞察', icon: '' + U.icon('barChart') + '', mount: function (el, ctx) { return mount(el, ctx) } }],
    panels: [{ id: 'ip-today', title: '学习洞察', icon: '' + U.icon('barChart') + '', width: 320, height: 190, render: panel }],
    config: [{ key: 'bars', label: '分布图显示天数', type: 'select', default: '7 天', options: ['7 天', '5 天', '3 天'] }],
    shortcuts: [{ key: 'alt+i', label: '打开学习洞察', run: function (ctx) { try { ctx.api.goTool('insight-page') } catch (e) { } } }],
    queries: [
      /* ★ 原样的 focusWeek：key / label / 算法都不变 */
      {
        key: 'focusWeek', label: '本周专注',
        run: function (ctx) {
          let s = ctx.Store.get()
          let mins = 0; Object.keys(s.studyHours || {}).forEach(function (k) { mins += s.studyHours[k] * 60 })
          return '本周累计学习 ' + Math.round(mins / 60 * 10) / 10 + ' 小时'
        }
      },
      { key: 'ip-todo', label: '接下来该做什么', run: function (ctx) {
        let d = snap(ctx)
        return '当前待回顾错题 ' + d.due + ' 条、未完成任务 ' + Math.max(0, d.tasks - d.done) + ' 项、距考研 ' + d.left + ' 天。建议先清待回顾错题，再补未完成任务。'
      } },
      { key: 'ip-streak', label: '连续打卡与单词量', run: function (ctx) {
        let d = snap(ctx)
        return '已连续打卡 ' + d.streak + ' 天，词汇库 ' + d.vocab + ' 词；本周学习 ' + Math.round(d.hours * 10) / 10 + ' 小时。'
      } },
    ],
    memory: '用户装有「学习洞察」插件：工具页集中显示学习时长、任务、错题、单词与连续打卡。用户问「这周学了多久」「接下来做什么」「打卡多少天」时可用其查询。',

    /* ★ 保留原 id 与注册方式，只把内容做成真正的总览 */
    maintabs: [{ id: 'insight-tab', name: '洞察', icon: '' + U.icon('barChart') + '', render: function (ctx, el) { return maintab(ctx, el) } }],
  }

  PluginBus.register(api)
})()
