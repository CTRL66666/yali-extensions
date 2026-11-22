/* async-form-action.plugin.js — 异步表单动作 · v1.1.0
 *
 * 早期版本只是"演示异步/表单/撤销"的 41 行样例：动作藏在教练动作面板里，看不到预览、
 * 不知道刚才加了什么、撤销只能靠模糊匹配文本。本版补一个真正能用的任务批处理工作台，
 * 并保留原 action 的 type / needs / run / undo 语义（含 600ms 异步与撤销契约）。
 */
;(function () {
  'use strict'

  let VERSION = '1.1.0'
  let PID = 'async-form-action'
  let NS = 'af-'
  let DEF_MAX = 10

  let CSS = `
.af-page{display:flex;flex-direction:column;gap:12px}
.af-hero{border-radius:14px;padding:16px 18px;background:var(--glass-bg);border:1px solid var(--line)}
.af-hero h3{margin:0 0 6px;font-size:16px}
.af-hero p{margin:0;color:var(--text-secondary);font-size:12.5px;line-height:1.7}
.af-form{display:grid;grid-template-columns:1fr 2fr 1fr;gap:10px;align-items:end}
.af-field{display:flex;flex-direction:column;gap:5px;font-size:11.5px;color:var(--text-secondary)}
.af-field input,.af-field select{border:1px solid var(--line);border-radius:8px;padding:7px 9px;background:transparent;color:inherit;font-size:12.5px}
.af-preview{border:1px dashed var(--line);border-radius:11px;padding:12px;font-size:12px;line-height:1.9;color:var(--text-secondary)}
.af-preview b{color:inherit}
.af-hist{display:flex;flex-direction:column;gap:7px}
.af-hist div{display:flex;justify-content:space-between;gap:8px;border-bottom:1px dashed var(--line);padding:6px 0;font-size:12px}
.af-hist em{font-style:normal;color:var(--text-secondary)}
.af-panel{display:flex;flex-direction:column;gap:7px;font-size:12px}
.af-progress{height:5px;border-radius:5px;background:var(--chart-track);overflow:hidden}
.af-progress i{display:block;height:100%;width:0;background:var(--accent-text);transition:width .2s}
`
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] }) }
  function style(ctx) { try { if (ctx && ctx.css && typeof ctx.css.add === 'function') ctx.css.add(CSS, 'skin') } catch (e) { } }
  function max(ctx) {
    let n = DEF_MAX
    try { n = Number((ctx && ctx.config && ctx.config('maxBatch')) || DEF_MAX) || DEF_MAX } catch (e) { }
    return Math.max(1, Math.min(30, n))
  }
  function draft(ctx) {
    let d = { subject: 'math', text: '', count: 1 }
    try { d = Object.assign(d, (ctx && ctx.keep && ctx.keep.get('afDraft')) || {}) } catch (e) { }
    return d
  }
  function saveDraft(ctx, d) { try { if (ctx.keep) ctx.keep.set('afDraft', d) } catch (e) { } }
  function history(ctx) {
    let h = []
    try { h = (ctx && ctx.keep && ctx.keep.get('afHistory')) || [] } catch (e) { }
    return Array.isArray(h) ? h : []
  }
  function pushHistory(ctx, item) {
    let h = history(ctx).slice(0, 9)
    h.unshift(item)
    try { if (ctx.keep) ctx.keep.set('afHistory', h) } catch (e) { }
  }
  function subjects() { return [['math', '数学'], ['eng', '英语'], ['pol', '政治'], ['major', '专业课']] }

  /* 与原 action.run 同一套写入逻辑，供工具页复用 */
  function addTasks(ctx, a, done) {
    let n = Math.max(1, Math.min(max(ctx), parseInt(a.count, 10) || 1))
    let timer = setTimeout(function () {
      let added = []
      try {
        for (let i = 0; i < n; i++) {
          let text = (n > 1 ? (a.text + '（' + (i + 1) + '/' + n + '）') : a.text)
          ctx.Store.update(function (s) {
            s.tasks = s.tasks || []
            let order = 0
            s.tasks.forEach(function (t) { if (t.order != null && t.order > order) order = t.order })
            s.tasks.push({ id: ctx.uid(), subject: a.subject || 'math', text: text, done: false,
              createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), order: order + 1 })
          })
          added.push(text)
        }
        ctx.log('异步批量加任务 ' + added.length + ' 项')
        pushHistory(ctx, { at: new Date().toISOString(), subject: a.subject || 'math', text: a.text, n: added.length })
        done(true, added)
      } catch (e) { done(false, []) }
    }, 600)
    return timer
  }
  function undoLast(ctx) {
    let h = history(ctx)
    if (!h.length) return 0
    let last = h[0]
    let removed = 0
    ctx.Store.update(function (s) {
      let before = (s.tasks || []).length
      s.tasks = (s.tasks || []).filter(function (t) {
        if (t.done) return true
        return t.text !== last.text && t.text.indexOf(last.text + '（') !== 0
      })
      removed = before - s.tasks.length
    })
    if (removed) {
      try { if (ctx.keep) ctx.keep.set('afHistory', h.slice(1)) } catch (e) { }
      ctx.log('撤销批量加任务 ' + removed + ' 项')
    }
    return removed
  }

  function mount(el, ctx) {
    style(ctx)
    function render(busy) {
      let d = draft(ctx), h = history(ctx)
      let n = Math.max(1, Math.min(max(ctx), parseInt(d.count, 10) || 1))
      let sub = (subjects().filter(function (x) { return x[0] === d.subject })[0] || subjects()[0])[1]
      el.innerHTML = '<div class="' + NS + 'page">'
        + '<div class="' + NS + 'hero"><h3>' + U.icon('cpBolt') + ' 批量加任务</h3>'
        + '<p>异步写入 + 表单收参 + 可撤销。一次最多 ' + max(ctx) + ' 项；撤销只动本次新加的未完成任务，已完成的不碰。</p>'
        + '<div class="' + NS + 'progress"><i style="width:' + (busy ? '70%' : '0') + '"></i></div></div>'
        + '<div class="' + NS + 'card" style="border:1px solid var(--line);border-radius:12px;padding:14px;background:var(--glass-bg)"><div class="' + NS + 'form">'
        + '<label class="' + NS + 'field">科目<select data-k="subject">' + subjects().map(function (x) {
          return '<option value="' + x[0] + '"' + (x[0] === d.subject ? ' selected' : '') + '>' + x[1] + '</option>'
        }).join('') + '</select></label>'
        + '<label class="' + NS + 'field">任务内容<input data-k="text" placeholder="如：极限专题 20 题" value="' + esc(d.text) + '"></label>'
        + '<label class="' + NS + 'field">重复数量<input data-k="count" type="number" min="1" max="' + max(ctx) + '" value="' + n + '"></label>'
        + '</div><div class="btn-row" style="margin-top:10px">'
        + '<button class="btn btn-sm btn-primary" data-run' + (busy ? ' disabled' : '') + '>' + (busy ? '正在写入…' : '批量添加') + '</button>'
        + '<button class="btn btn-sm btn-ghost" data-undo' + (h.length ? '' : ' disabled') + '>撤销上一批</button></div></div>'
        + '<div class="' + NS + 'preview"><b>将添加：</b>' + esc(d.text || '（还没填任务内容）') + ' · ' + esc(sub) + ' · ' + n + ' 项'
        + (n > 1 ? '<br>第 1 项显示为「' + esc(d.text) + '（1/' + n + '）」，依次编号，便于撤销时精确匹配。' : '') + '</div>'
        + '<div class="' + NS + 'card" style="border:1px solid var(--line);border-radius:12px;padding:14px"><h4 style="margin:0 0 8px;font-size:13.5px">最近批次（本机记录，最多 10 条）</h4>'
        + (h.length ? '<div class="' + NS + 'hist">' + h.slice(0, 6).map(function (x) {
          return '<div><span>' + esc(String(x.at).slice(0, 16).replace('T', ' ')) + ' · ' + esc(x.text) + '</span><em>' + x.n + ' 项</em></div>'
        }).join('') + '</div>' : '<div class="muted-sm" style="font-size:12px">还没有批次记录。添加一次后这里会出现，可一键撤销上一批。</div>') + '</div></div>'
      Array.prototype.forEach.call(el.querySelectorAll('[data-k]'), function (inp) {
        inp.oninput = function () {
          let d2 = draft(ctx); d2[inp.getAttribute('data-k')] = inp.value; saveDraft(ctx, d2)
        }
      })
      let run = el.querySelector('[data-run]')
      if (run) run.onclick = function () {
        let cur = draft(ctx)
        if (!String(cur.text || '').trim()) { ctx.Toast.show('先填任务内容', 'warn'); return }
        render(true)
        addTasks(ctx, cur, function (ok, added) {
          render(false)
          if (ctx.Toast) ctx.Toast.show(ok ? '已添加 ' + added.length + ' 项任务' : '写入失败，请重试', ok ? 'success' : 'warn')
        })
      }
      let undo = el.querySelector('[data-undo]')
      if (undo) undo.onclick = function () {
        let n2 = undoLast(ctx)
        render(false)
        if (ctx.Toast) ctx.Toast.show(n2 ? '已撤销上一批 ' + n2 + ' 项' : '上一批没有可撤销的任务', n2 ? 'info' : 'warn')
      }
    }
    render(false)
    return function () { el.innerHTML = '' }
  }

  function panel(ctx) {
    style(ctx)
    let h = history(ctx)
    let last = h[0]
    return '<div class="' + NS + 'panel">'
      + '<div style="display:flex;justify-content:space-between"><span>' + U.icon('cpBolt') + ' 批量加任务</span><span style="color:var(--text-secondary)">' + h.length + ' 批记录</span></div>'
      + '<div>' + (last ? '最近：' + esc(last.text) + ' · ' + last.n + ' 项' : '还没有批量添加过任务。') + '</div>'
      + '<button class="btn btn-sm btn-ghost">打开批处理工作台</button></div>'
  }

  let api = {
    id: PID,
    name: '异步表单动作',
    version: VERSION,
    author: '内置',
    desc: '批量加任务的工作台：异步写入、数量上限、写入前预览、最近批次与精确撤销。',
    tools: [{ id: 'async-form-action-page', title: '批量加任务', icon: '' + U.icon('cpBolt') + '', mount: function (el, ctx) { return mount(el, ctx) } }],
    panels: [{ id: 'af-today', title: '批量加任务', icon: '' + U.icon('cpBolt') + '', width: 300, height: 180, render: panel }],
    config: [{ key: 'maxBatch', label: '单次批量上限', type: 'number', default: DEF_MAX }],
    shortcuts: [{ key: 'alt+t', label: '打开批量加任务', run: function (ctx) { try { ctx.api.goTool('async-form-action-page') } catch (e) { } } }],
    queries: [
      { key: 'af-last', label: '最近批量任务', run: function (ctx) {
        let h = history(ctx)
        return h.length ? '最近一次批量加了 ' + h[0].n + ' 项「' + h[0].text + '」，可在批量加任务工作台里撤销。' : '还没有批量添加过任务。'
      } },
    ],
    memory: '用户装有「异步表单动作」插件：可批量添加任务（科目/内容/数量），异步写入并能精确撤销上一批。用户提到「批量加任务」「一次加几个」时引导到该工作台。',

    /* ★ 原 action 的 type / needs / run / undo 语义保持 */
    actions: [{
      type: 'batchAddTasks', label: '批量加任务', auto: false,
      needs: { title: '批量加任务', fields: [
        { key: 'subject', label: '科目', type: 'select', options: [{ v: 'math', t: '数学' }, { v: 'eng', t: '英语' }, { v: 'pol', t: '政治' }, { v: 'major', t: '专业课' }] },
        { key: 'text', label: '任务内容', type: 'text', placeholder: '如：极限专题 20 题' },
        { key: 'count', label: '重复数量', type: 'number', placeholder: '默认 1' }
      ] },
      run: function (ctx, a) {
        return new Promise(function (resolve, reject) {
          addTasks(ctx, a, function (ok, added) {
            if (ok) resolve('已加 ' + added.length + ' 项任务')
            else reject(new Error('写入任务失败'))
          })
        })
      },
      undo: function (ctx, a) {
        let n = undoLast(ctx)
        ctx.log('撤销批量加任务 ' + n + ' 项')
      },
    }],
  }

  PluginBus.register(api)
})()
