/* english-sentence.plugin.js — 高分句型管家 · v1.1.0（已下架件，保持兼容不再上架）
 *
 * 原版 19 行：一个技能触发词 + 一个收藏 action。补工具页（收藏夹/检索/删除/统计）、
 * 面板、查询、快捷键、作用域样式；原 skill 的 trigger / prompt 与 action.type 一字不改，
 * 收藏数据结构 {text, at} 与 50 条上限也保持。
 */
;(function () {
  'use strict'

  let VERSION = '1.1.0'
  let PID = 'english-sentence'
  let NS = 'es-'
  let CSS = `
.es-page{display:flex;flex-direction:column;gap:11px}
.es-hero{border-radius:14px;padding:16px 18px;background:var(--glass-bg);border:1px solid var(--line)}
.es-hero h3{margin:0 0 6px;font-size:16px}
.es-hero p{margin:0;color:var(--text-secondary);font-size:12.5px;line-height:1.7}
.es-bar{display:flex;gap:8px;flex-wrap:wrap}
.es-input{border:1px solid var(--line);border-radius:8px;padding:7px 10px;background:transparent;color:inherit;font-size:12.5px;flex:1;min-width:200px}
.es-list{display:flex;flex-direction:column;gap:8px}
.es-item{border:1px solid var(--line);border-radius:11px;padding:11px 13px;background:var(--glass-bg);font-size:12.5px;line-height:1.7}
.es-item em{font-style:normal;color:var(--text-secondary);font-size:11px}
.es-item button{float:right;border:0;background:transparent;color:var(--danger);cursor:pointer;font-size:11.5px}
.es-panel{display:flex;flex-direction:column;gap:6px;font-size:12px}
.es-pattern{border-left:2px solid var(--accent-text);padding-left:10px;font-size:11.5px;line-height:1.8;color:var(--text-secondary)}
`
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] }) }
  function style(ctx) { try { if (ctx && ctx.css && typeof ctx.css.add === 'function') ctx.css.add(CSS, 'skin') } catch (e) { } }
  function all(ctx) {
    let list = []
    try { list = (ctx && typeof ctx.data === 'function' && ctx.data('sentences')) || [] } catch (e) { }
    return Array.isArray(list) ? list : []
  }
  function save(ctx, text) {
    if (!text) return 0
    let list = all(ctx)
    list.unshift({ text: String(text).slice(0, 200), at: ctx.dkey() })
    list = list.slice(0, 50)
    try { ctx.data('sentences', list) } catch (e) { }
    return list.length
  }
  function query(ctx) { try { return String((ctx && ctx.keep && ctx.keep.get('esQ')) || '') } catch (e) { return '' } }

  function mount(el, ctx) {
    style(ctx)
    function render() {
      let list = all(ctx), q = query(ctx).trim().toLowerCase()
      let hits = list.filter(function (x) { return !q || String(x.text || '').toLowerCase().indexOf(q) >= 0 })
      el.innerHTML = '<div class="' + NS + 'page">'
        + '<div class="' + NS + 'hero"><h3>' + U.icon('translate') + ' 高分句型管家</h3>'
        + '<p>让教练说「句型」生成模板，看到好的直接收藏到这里。收藏上限 50 条，按时间倒序。</p>'
        + '<div class="' + NS + 'pattern">常见骨架：It is + 强调部分 + that… / Not only…but also… / 分词作状语 / 虚拟语气让步。</div></div>'
        + '<div class="' + NS + 'bar"><input class="' + NS + 'input" data-q placeholder="检索句型关键词" value="' + esc(query(ctx)) + '">'
        + '<button class="btn btn-sm btn-primary" data-add>收藏当前句型</button></div>'
        + (hits.length ? '<div class="' + NS + 'list">' + hits.slice(0, 20).map(function (x, i) {
          return '<div class="' + NS + 'item"><button type="button" data-del="' + i + '">删除</button>'
            + esc(x.text) + '<br><em>' + esc(x.at || '') + '</em></div>'
        }).join('') + '</div>' : '<div class="muted-sm" style="font-size:12px">' + (list.length ? '没有命中，换个关键词。' : '还没收藏句型。让教练用「句型」技能生成，再回来收藏。') + '</div>')
        + '<details><summary style="font-size:12px;color:var(--text-secondary);cursor:pointer">用法与边界 ⓘ</summary>'
        + '<p style="font-size:12px;line-height:1.8;color:var(--text-secondary)">收藏由教练动作「收藏句型」触发，本页也能手动补录。'
        + '每条最多 200 字、总数最多 50 条 —— 这是为了避免把整篇作文塞进本地存储。删除只影响本机收藏夹。</p></details></div>'
      let input = el.querySelector('[data-q]')
      if (input) {
        input.oninput = function () { try { if (ctx.keep) ctx.keep.set('esQ', input.value) } catch (e) { } }
        input.onchange = function () { render() }
      }
      let add = el.querySelector('[data-add]')
      if (add) add.onclick = function () {
        let v = (input && input.value || '').trim()
        if (!v) { ctx.Toast.show('先输入要收藏的句型', 'warn'); return }
        let n = save(ctx, v)
        render()
        if (ctx.Toast) ctx.Toast.show('已收藏，共 ' + n + ' 条', 'success')
      }
      Array.prototype.forEach.call(el.querySelectorAll('[data-del]'), function (b) {
        b.onclick = function () {
          let target = hits[Number(b.getAttribute('data-del'))]
          let rest = all(ctx).filter(function (x) { return x !== target })
          try { ctx.data('sentences', rest) } catch (e) { }
          render()
        }
      })
    }
    render()
    return function () { el.innerHTML = '' }
  }

  function panel(ctx) {
    style(ctx)
    let list = all(ctx)
    return '<div class="' + NS + 'panel">'
      + '<div style="display:flex;justify-content:space-between"><span>' + U.icon('translate') + ' 高分句型</span><span style="color:var(--text-secondary)">' + list.length + '/50</span></div>'
      + (list.length ? '<div class="' + NS + 'pattern">' + esc(String(list[0].text).slice(0, 80)) + '</div>' : '<div style="color:var(--text-secondary)">还没收藏句型。</div>')
      + '<button class="btn btn-sm btn-ghost">打开收藏夹</button></div>'
  }

  let api = {
    id: PID,
    name: '高分句型管家',
    version: VERSION,
    author: '内置',
    desc: '让教练生成考研英语高分句型，一键收藏；工具页可检索、补录、删除。',
    tools: [{ id: 'english-sentence-page', title: '句型收藏夹', icon: '' + U.icon('translate') + '', mount: function (el, ctx) { return mount(el, ctx) } }],
    panels: [{ id: 'es-today', title: '高分句型', icon: '' + U.icon('translate') + '', width: 300, height: 190, render: panel }],
    config: [{ key: 'count', label: '每次生成句数', type: 'number', default: 3, desc: '3-6' }],
    shortcuts: [{ key: 'alt+e', label: '打开句型收藏夹', run: function (ctx) { try { ctx.api.goTool('english-sentence-page') } catch (e) { } } }],
    queries: [
      { key: 'es-count', label: '已收藏句型', run: function (ctx) {
        let list = all(ctx)
        return list.length ? '已收藏 ' + list.length + ' 条句型，最近一条：' + String(list[0].text).slice(0, 60) : '还没收藏句型，让教练说「句型」生成后收藏。'
      } },
    ],
    memory: '用户装有「高分句型管家」历史插件：可让教练生成考研英语高分句型并收藏（最多 50 条）。用户提到「句型」「作文句式」时可查收藏夹。',

    /* ★ 原技能与 action 形态保留：trigger / prompt / type / 数据结构 / 50 条上限 */
    skills: [{
      trigger: '句型',
      title: '高分句型生成',
      prompt: '生成 3-5 个考研英语高分句型模板（作文通用，含句式说明与中文翻译），适合插入大作文/小作文。'
    }],
    actions: [{
      type: 'saveSentence', label: '收藏句型', auto: false,
      run: function (ctx, a) {
        if (!a || !a.text) return '缺句型文本'
        let n = save(ctx, a.text)
        ctx.Toast.show('句型已收藏（共 ' + n + ' 条）', 'success', 2000)
        return '已收藏'
      },
    }],
  }

  PluginBus.register(api)
})()
