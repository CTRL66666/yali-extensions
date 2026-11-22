/* sprint-kicker.plugin.js — 组卷冲刺鼓手 · v1.1.0（已下架件，保持兼容不再上架）
 *
 * 原版 27 行：一个 examGraded hook 记成绩 + 一个走势 render。补：图表化工具页、
 * 趋势面板、查询、快捷键、作用域样式；去掉装饰性 emoji（icon 只用真 key）。
 * 原 hook 的事件名、ctx.data('history') 结构与 30 条上限不变。
 */
;(function () {
  'use strict'

  let VERSION = '1.1.0'
  let PID = 'sprint-kicker'
  let NS = 'sk-'
  let CSS = `
.sk-page{display:flex;flex-direction:column;gap:11px}
.sk-hero{border-radius:14px;padding:16px 18px;background:var(--glass-bg);border:1px solid var(--line)}
.sk-hero h3{margin:0 0 6px;font-size:16px}
.sk-hero p{margin:0;color:var(--text-secondary);font-size:12.5px;line-height:1.7}
.sk-chart{display:flex;align-items:flex-end;gap:6px;height:110px}
.sk-chart i{flex:1;min-width:10px;border-radius:5px 5px 0 0;background:linear-gradient(180deg,var(--accent-text),var(--blue));position:relative}
.sk-chart i span{position:absolute;bottom:-17px;left:0;right:0;text-align:center;font-size:10px;color:var(--text-secondary)}
.sk-row{display:flex;justify-content:space-between;gap:8px;border-bottom:1px dashed var(--line);padding:6px 0;font-size:12px}
.sk-row:last-child{border-bottom:0}
.sk-row em{font-style:normal;color:var(--text-secondary)}
.sk-up{color:var(--ok)}
.sk-panel{display:flex;flex-direction:column;gap:6px;font-size:12px}
.sk-kpi{display:flex;justify-content:space-between;align-items:center}
.sk-kpi b{font-size:20px;color:var(--accent-text)}
`
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] }) }
  function style(ctx) { try { if (ctx && ctx.css && typeof ctx.css.add === 'function') ctx.css.add(CSS, 'skin') } catch (e) { } }
  function hist(ctx) { let h = []; try { h = (ctx && typeof ctx.data === 'function' && ctx.data('history')) || [] } catch (e) { } return Array.isArray(h) ? h : [] }
  function delta(h) {
    if (!h || h.length < 2) return null
    return Number(h[h.length - 1].pct || 0) - Number(h[h.length - 2].pct || 0)
  }
  function chart(h) {
    let last = h.slice(-12)
    if (!last.length) return '<div class="muted-sm" style="font-size:12px">还没有交卷记录。完成一套模拟卷后这里会自动记录。</div>'
    return '<div class="' + NS + 'chart">' + last.map(function (x, i) {
      let v = Number(x.pct) || 0
      return '<i style="height:' + Math.max(5, Math.round(v * 0.9)) + 'px" title="' + esc(x.at) + ' ' + v + '%"><span>' + (i + 1) + '</span></i>'
    }).join('') + '</div>'
  }

  function mount(el, ctx) {
    style(ctx)
    let h = hist(ctx)
    let d = delta(h)
    el.innerHTML = '<div class="' + NS + 'page">'
      + '<div class="' + NS + 'hero"><h3>' + U.icon('barChart') + ' 冲刺成绩走势</h3>'
      + '<p>每次交卷自动记一条（最多 30 条）。看的是<strong>趋势</strong>而不是单次分数：连续进步就保持节奏，回落就回到错题上。</p></div>'
      + '<div class="' + NS + 'card-" style="border:1px solid var(--line);border-radius:12px;padding:14px;background:var(--glass-bg)"><h4 style="margin:0 0 26px;font-size:13.5px">近 12 卷得分率</h4>'
      + chart(h) + '</div>'
      + '<div style="border:1px solid var(--line);border-radius:12px;padding:14px;background:var(--glass-bg)">'
      + '<h4 style="margin:0 0 8px;font-size:13.5px">明细</h4>'
      + (h.length ? h.slice().reverse().map(function (x, i) {
        let prev = h[h.length - 2 - i]
        let up = prev && Number(x.pct) >= Number(prev.pct)
        return '<div class="' + NS + 'row"><span>' + (i + 1) + '. ' + esc(x.at) + ' · ' + x.score + '/' + x.total + '</span>'
          + '<b class="' + (i === 0 && d != null && d >= 0 ? NS + 'up' : '') + '">' + x.pct + '%'
          + (i === 0 && d != null ? '（' + (d >= 0 ? '+' : '') + d + '）' : '') + '</b></div>'
      }).join('') : '<div class="muted-sm" style="font-size:12px">暂无记录。</div>') + '</div>'
      + '<details><summary style="font-size:12px;color:var(--text-secondary);cursor:pointer">记录规则 ⓘ</summary>'
      + '<p style="font-size:12px;line-height:1.8;color:var(--text-secondary)">只记录有 examId 的交卷事件；同一天可记多卷；超出 30 条丢最旧的。'
      + '分数只来自真实交卷结果，本插件不猜分、不编题。</p></details></div>'
    return function () { el.innerHTML = '' }
  }

  function panel(ctx) {
    style(ctx)
    let h = hist(ctx), d = delta(h)
    let last = h[h.length - 1]
    return '<div class="' + NS + 'panel">'
      + '<div class="' + NS + 'kpi"><span>' + U.icon('barChart') + ' 冲刺走势</span><b>' + h.length + ' 卷</b></div>'
      + '<div>' + (last ? '最近 ' + last.pct + '%' + (d != null ? '（' + (d >= 0 ? '+' : '') + d + '）' : '') : '还没有交卷记录') + '</div>'
      + '<button class="btn btn-sm btn-ghost">查看成绩曲线</button></div>'
  }

  let api = {
    id: PID,
    name: '组卷冲刺鼓手',
    version: VERSION,
    author: '内置',
    desc: '交卷自动记成绩走势：近 12 卷得分率曲线、明细与进步提示。',
    tools: [{ id: 'sprint-kicker', title: '冲刺成绩走势', icon: '' + U.icon('barChart') + '', mount: function (el, ctx) { return mount(el, ctx) } }],
    panels: [{ id: 'sk-today', title: '冲刺走势', icon: '' + U.icon('barChart') + '', width: 290, height: 180, render: panel }],
    shortcuts: [{ key: 'alt+k', label: '打开成绩走势', run: function (ctx) { try { ctx.api.goTool('sprint-kicker') } catch (e) { } } }],
    queries: [
      { key: 'sk-trend', label: '模考成绩趋势', run: function (ctx) {
        let h = hist(ctx)
        if (!h.length) return '还没有模考交卷记录。'
        let d = delta(h)
        let last = h[h.length - 1]
        return '已记 ' + h.length + ' 卷，最近一次 ' + last.pct + '%（' + last.score + '/' + last.total + '）'
          + (d != null ? '，比上一卷' + (d >= 0 ? '提高 ' + d : '回落 ' + Math.abs(d)) + ' 个百分点' : '') + '。'
      } },
    ],
    memory: '用户装有「组卷冲刺鼓手」历史插件：交卷后自动记成绩走势（最多 30 条）。用户问「模考进步了吗」「最近几卷多少分」时查它。',

    /* ★ 原 hook 的事件名、数据结构与 30 条上限保持 */
    hooks: {
      examGraded: function (ctx, p) {
        if (!p || !p.examId) return
        let hist = ctx.data('history') || []
        hist.push({ at: ctx.dkey(), score: p.score, total: p.total, pct: p.total ? Math.round(p.score / p.total * 100) : 0 })
        ctx.data('history', hist.slice(-30))
        let last = hist[hist.length - 1]
        let n = hist.length
        if (n >= 2 && last.pct >= hist[hist.length - 2].pct) {
          ctx.Toast.show('第 ' + n + ' 卷 ' + last.pct + '%——在进步，继续冲！', 'success', 3500)
        }
        ctx.log('交卷记录：' + last.score + '/' + last.total)
      }
    },
  }

  PluginBus.register(api)
})()
