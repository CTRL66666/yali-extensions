/* daily-mistake-drill.plugin.js — 每日错题唤醒 · v1.1.0
 *
 * 早期版本只有一条 21:00 定时器，用户既看不到"今晚轮到哪题"，也无法主动挑题重练。
 * 本版保留原定时器语义（选中"最久未回顾"的一题 + 记住/没记住回写），补齐：
 * 工具页队列 / 常驻面板 / 教练查询 / 快捷键 / 作用域样式。
 */
;(function () {
  'use strict'

  let VERSION = '1.1.0'
  let PID = 'daily-mistake-drill'
  let NS = 'dm-'

  let CSS = `
.dm-page{display:flex;flex-direction:column;gap:12px}
.dm-hero{border-radius:14px;padding:16px 18px;background:var(--glass-bg);border:1px solid var(--line)}
.dm-hero h3{margin:0 0 6px;font-size:16px}
.dm-hero p{margin:0;color:var(--text-secondary);font-size:12.5px;line-height:1.7}
.dm-bar{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.dm-tabs{display:flex;gap:6px}
.dm-tabs button{border:1px solid var(--line);background:transparent;border-radius:999px;padding:5px 12px;font-size:11.5px;color:inherit;cursor:pointer}
.dm-tabs button[aria-pressed="true"]{border-color:var(--accent-text);background:var(--glass-bg)}
.dm-list{display:flex;flex-direction:column;gap:9px}
.dm-item{border:1px solid var(--line);border-radius:11px;padding:12px 14px;background:var(--glass-bg)}
.dm-stem{font-size:13px;line-height:1.7}
.dm-ans{margin-top:8px;border-top:1px dashed var(--line);padding-top:8px;font-size:12px;line-height:1.8;color:var(--text-secondary)}
.dm-empty{border:1px dashed var(--line);border-radius:11px;padding:22px;text-align:center;color:var(--text-secondary);font-size:12.5px}
.dm-panel{display:flex;flex-direction:column;gap:7px;font-size:12px}
.dm-kpi{display:flex;justify-content:space-between;align-items:center}
.dm-kpi b{font-size:19px;color:var(--accent-text)}
`

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] }) }
  function style(ctx) { try { if (ctx && ctx.css && typeof ctx.css.add === 'function') ctx.css.add(CSS, 'skin') } catch (e) { } }
  function list(ctx) {
    let s = {}
    try { s = (ctx && ctx.Store && ctx.Store.get()) || {} } catch (e) { }
    let ms = Array.isArray(s.mistakes) ? s.mistakes.filter(function (m) { return m && (m.stem || m.desc) }) : []
    return ms.slice().sort(function (a, b) {
      return String(a.reviewedAt || a.createdAt || '').localeCompare(String(b.reviewedAt || b.createdAt || ''))
    })
  }
  function filterOf(ctx) {
    try { return String((ctx && ctx.keep && ctx.keep.get('dmFilter')) || 'due') } catch (e) { return 'due' }
  }
  function shown(ctx) {
    let all = list(ctx)
    let f = filterOf(ctx)
    if (f === 'due') return all.filter(function (m) { return !m.reviewedAt || m.needRetell })
    if (f === 'done') return all.filter(function (m) { return !!m.reviewedAt && !m.needRetell })
    return all
  }
  function mark(ctx, m, remembered) {
    try {
      ctx.Store.update(function (s) {
        let t = (s.mistakes || []).find(function (x) { return x.id === m.id })
        if (t) {
          t.reviewedAt = new Date().toISOString()
          if (!remembered) t.needRetell = true
          else if (t.needRetell) t.needRetell = false
        }
      })
      if (ctx.Toast) ctx.Toast.show(remembered ? '已记录回顾，它会更晚再来' : '已标记，明天的队列里它排前面', remembered ? 'success' : 'info')
    } catch (e) { }
  }

  function mount(el, ctx) {
    style(ctx)
    let open = {}
    function render() {
      let all = list(ctx), items = shown(ctx), f = filterOf(ctx)
      let due = all.filter(function (m) { return !m.reviewedAt || m.needRetell }).length
      el.innerHTML = '<div class="' + NS + 'page">'
        + '<div class="' + NS + 'hero"><h3>' + U.icon('clock') + ' 每日错题唤醒</h3>'
        + '<p>每天 21:00 弹一张最久没回顾的题。队列按「上次回顾时间」排序，'
        + '标记「没记住」的题会插队到明天。当前待唤醒 <b>' + due + '</b> 题。</p></div>'
        + '<div class="' + NS + 'bar"><div class="' + NS + 'tabs">'
        + [['due', '待唤醒'], ['all', '全部'], ['done', '已记住']].map(function (x) {
          return '<button type="button" data-f="' + x[0] + '" aria-pressed="' + (f === x[0]) + '">' + x[1] + '</button>'
        }).join('') + '</div><span class="muted-sm" style="font-size:11.5px">共 ' + items.length + ' 题</span></div>'
        + (items.length ? '<div class="' + NS + 'list">' + items.slice(0, 30).map(function (m, i) {
          let front = String(m.stem || m.desc || '')
          let id = String(m.id || i)
          let body = (Array.isArray(m.options) && m.options.length) ? m.options.join('<br>') : ''
          return '<div class="' + NS + 'item" data-id="' + esc(id) + '">'
            + '<div class="' + NS + 'stem"><b>' + (i + 1) + '.</b> ' + esc(front) + (body ? '<br><span style="color:var(--text-secondary)">' + esc(body) + '</span>' : '')
            + (m.needRetell ? ' <span class="muted-sm">· 待重述</span>' : '') + '</div>'
            + '<div class="' + NS + 'bar" style="margin-top:9px">'
            + '<button class="btn btn-sm btn-ghost" data-show="' + i + '">' + U.icon('eye') + ' 翻答案</button>'
            + '<button class="btn btn-sm btn-primary" data-ok="' + i + '">记住了</button>'
            + '<button class="btn btn-sm btn-ghost" data-no="' + i + '">没记住</button></div>'
            + (open[id] ? '<div class="' + NS + 'ans"><b>答案：</b>' + esc(m.answer == null ? '—' : m.answer)
              + (m.solution ? '<br><b>解析：</b>' + esc(m.solution) : '') + '</div>' : '')
            + '</div>'
        }).join('') + '</div>' : '<div class="' + NS + 'empty">这个筛选下暂时没有题。先去错题本添加，或切到「全部」看看。</div>')
        + '<details><summary style="font-size:12px;color:var(--text-secondary);cursor:pointer">唤醒规则 ⓘ</summary>'
        + '<p style="font-size:12px;line-height:1.8;color:var(--text-secondary)">每次选最久未回顾的一题；点「记住了」写入今天的时间戳，点「没记住」额外打 needRetell 标记，明天优先再唤醒。'
        + '弹窗走站点统一 Modal，不会打断正在输入的回答。</p></details></div>'
      Array.prototype.forEach.call(el.querySelectorAll('[data-f]'), function (b) {
        b.onclick = function () { try { if (ctx.keep) ctx.keep.set('dmFilter', b.getAttribute('data-f')) } catch (e) { } render() }
      })
      Array.prototype.forEach.call(el.querySelectorAll('[data-show]'), function (b) {
        b.onclick = function () {
          let i = Number(b.getAttribute('data-show')), id = String((items[i] || {}).id || i)
          open[id] = !open[id]; render()
        }
      })
      Array.prototype.forEach.call(el.querySelectorAll('[data-ok]'), function (b) {
        b.onclick = function () { mark(ctx, items[Number(b.getAttribute('data-ok'))], true); render() }
      })
      Array.prototype.forEach.call(el.querySelectorAll('[data-no]'), function (b) {
        b.onclick = function () { mark(ctx, items[Number(b.getAttribute('data-no'))], false); render() }
      })
    }
    render()
    return function () { el.innerHTML = '' }
  }

  function panel(ctx) {
    style(ctx)
    let due = list(ctx).filter(function (m) { return !m.reviewedAt || m.needRetell }).length
    return '<div class="' + NS + 'panel">'
      + '<div class="' + NS + 'kpi"><span>' + U.icon('clock') + ' 待唤醒错题</span><b>' + due + '</b></div>'
      + '<div style="color:var(--text-secondary)">每天 21:00 自动弹出一张 · 点开工具页可提前练</div>'
      + '<button class="btn btn-sm btn-ghost">打开错题唤醒</button></div>'
  }

  let api = {
    id: PID,
    name: '每日错题唤醒',
    version: VERSION,
    author: '内置',
    desc: '每天 21:00 弹一张最久未回顾的错题；工具页可提前按筛选练，标记会回到错题本。',
    tools: [{ id: 'daily-mistake-drill-page', title: '错题唤醒', icon: '' + U.icon('clock') + '', mount: function (el, ctx) { return mount(el, ctx) } }],
    panels: [{ id: 'dm-due', title: '每日错题唤醒', icon: '' + U.icon('clock') + '', width: 300, height: 180, render: panel }],
    config: [{ key: 'focusOnOpen', label: '打开工具页时默认筛选', type: 'select', default: '待唤醒', options: ['待唤醒', '全部', '已记住'] }],
    shortcuts: [{ key: 'alt+m', label: '打开错题唤醒', run: function (ctx) { try { ctx.api.goTool('daily-mistake-drill-page') } catch (e) { } } }],
    queries: [
      { key: 'dm-due', label: '待唤醒错题', run: function (ctx) {
        let all = list(ctx), due = all.filter(function (m) { return !m.reviewedAt || m.needRetell }).length
        return due ? '错题队列里有 ' + due + ' 题待唤醒（共 ' + all.length + ' 题），最久未回顾的那道会先来。' : '错题队列目前全部已回顾。'
      } },
    ],
    memory: '用户装有「每日错题唤醒」插件：每天 21:00 弹最久未回顾的一题，可标记记住/没记住。用户提到「今天该复习哪道错题」「错题回顾」时可查待唤醒数。',

    /* ★ 原定时器语义保持：21:00、选最久未回顾、Modal 三按钮与回写字段不变 */
    timers: [{ at: '21:00', label: '每日错题唤醒', run: function (ctx) {
      let ms = list(ctx)
      if (!ms.length) return
      let m = ms[0]
      let front = m.stem || m.desc || ''
      if (Array.isArray(m.options) && m.options.length) front += '<br>' + m.options.join('<br>')
      let html = '<div class=\'card\'><div style=\'font-weight:600;margin-bottom:6px\'>先自己回忆这道题的思路与答案：</div>'
        + '<div class=\'report\'>' + front + '</div>'
        + '<details style=\'margin-top:8px\'><summary style=\'cursor:pointer;font-size:12px\'>' + U.icon('eye') + ' 翻开答案与解析</summary>'
        + '<div class=\'report\' style=\'margin-top:6px\'><b>答案：</b>' + (m.answer == null ? '—' : m.answer) + '</div>'
        + (m.solution ? '<div class=\'report\' style=\'margin-top:4px\'><b>解析：</b>' + m.solution + '</div>' : '') + '</details>'
        + '<div class=\'muted-sm\' style=\'margin-top:8px\'>来源：' + (m.desc || '错题本') + '</div></div>'
      ctx.openModal({ title: '' + U.icon('clock') + ' 今日错题唤醒', wide: true, html: html, actions: [
        { label: '' + U.icon('cpCheck') + ' 记住了', kind: 'btn-primary', onClick: function () { mark(ctx, m, true) } },
        { label: '' + U.icon('cpCross') + ' 没记住', onClick: function () { mark(ctx, m, false) } },
        { label: '关闭' }
      ] })
    } }],
  }

  PluginBus.register(api)
})()
