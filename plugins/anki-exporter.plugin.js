/* anki-exporter.plugin.js — Anki 导出器 · v1.1.0
 *
 * 早期版本只有两个导出按钮，导出前看不到会带走哪些内容、命中多少条。
 * 本版保留分号 CSV 与字段映射（Anki 导入选「分号、允许 HTML」不变），补：
 * 数据源切换 / 关键词筛选 / 前若干条预览 / 导出统计 / 面板 / 查询 / 快捷键。
 */
;(function () {
  'use strict'

  let VERSION = '1.1.0'
  let PID = 'anki-exporter'
  let NS = 'ak-'

  let CSS = `
.ak-page{display:flex;flex-direction:column;gap:12px}
.ak-hero{border-radius:14px;padding:16px 18px;background:var(--glass-bg);border:1px solid var(--line)}
.ak-hero h3{margin:0 0 6px;font-size:16px}
.ak-hero p{margin:0;color:var(--text-secondary);font-size:12.5px;line-height:1.7}
.ak-bar{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.ak-tabs{display:flex;gap:6px}
.ak-tabs button{border:1px solid var(--line);background:transparent;border-radius:999px;padding:5px 12px;font-size:11.5px;color:inherit;cursor:pointer}
.ak-tabs button[aria-pressed="true"]{border-color:var(--accent-text);background:var(--glass-bg)}
.ak-input{border:1px solid var(--line);border-radius:8px;padding:6px 10px;background:transparent;color:inherit;font-size:12px;min-width:180px}
.ak-preview{border:1px solid var(--line);border-radius:11px;overflow:hidden}
.ak-preview div{padding:8px 11px;border-bottom:1px dashed var(--line);font-size:12px;line-height:1.65}
.ak-preview div:last-child{border-bottom:0}
.ak-preview b{color:var(--accent-text)}
.ak-preview em{font-style:normal;color:var(--text-secondary)}
.ak-panel{display:flex;flex-direction:column;gap:7px;font-size:12px}
.ak-map{border-left:2px solid var(--accent-text);padding-left:11px;font-size:11.5px;line-height:1.8;color:var(--text-secondary)}
`
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] }) }
  function csvCell(s) { return '"' + String(s == null ? '' : s).split('"').join('""') + '"' }
  function csv(pairs) { return pairs.map(function (p) { return csvCell(p[0]) + ';' + csvCell(p[1]) }).join('\n') }
  function style(ctx) { try { if (ctx && ctx.css && typeof ctx.css.add === 'function') ctx.css.add(CSS, 'skin') } catch (e) { } }
  function source(ctx) {
    try { return String((ctx && ctx.keep && ctx.keep.get('akSrc')) || 'mistakes') } catch (e) { return 'mistakes' }
  }
  function query(ctx) {
    try { return String((ctx && ctx.keep && ctx.keep.get('akQ')) || '') } catch (e) { return '' }
  }
  function pairsFor(ctx) {
    let s = {}
    try { s = (ctx && ctx.Store && ctx.Store.get()) || {} } catch (e) { }
    let q = query(ctx).trim().toLowerCase()
    function hit(v) { return !q || String(v == null ? '' : v).toLowerCase().indexOf(q) >= 0 }
    if (source(ctx) === 'vocab') {
      return (Array.isArray(s.vocab) ? s.vocab : []).filter(function (v) { return hit(v && (v.word || '')) }).map(function (v) {
        return [v.word || '', [v.pos, v.meaning, v.example].filter(function (x) { return x != null && String(x) !== '' }).join('\n')]
      })
    }
    return (Array.isArray(s.mistakes) ? s.mistakes : []).filter(function (m) { return hit(m && (m.stem || m.desc || '')) }).map(function (m) {
      let front = m.stem || m.desc || ''
      if (Array.isArray(m.options) && m.options.length) front += '\n' + m.options.join('\n')
      let back = [m.answer, m.solution].filter(function (x) { return x != null && String(x).trim() !== '' }).join('\n——\n')
      if (m.trap) back += (back ? '\n——\n' : '') + U.icon('cpWarn') + ' 易错点：' + m.trap
      return [front, back]
    })
  }
  function download(ctx, rows) {
    if (!rows.length) { if (ctx.Toast) ctx.Toast.show('当前筛选下没有可导出的内容', 'warn'); return }
    let prefix = 'anki'
    try { prefix = String((ctx && ctx.config && ctx.config('deckPrefix')) || 'anki') } catch (e) { }
    let name = prefix + '_' + (source(ctx) === 'vocab' ? '单词本' : '错题本') + '_' + ctx.dkey() + '.csv'
    ctx.api.download(name, '\ufeff' + csv(rows), 'text/csv;charset=utf-8')
    if (ctx.Toast) ctx.Toast.show('已导出 ' + rows.length + ' 条：' + name, 'success')
  }

  function mount(el, ctx) {
    style(ctx)
    function render() {
      let rows = pairsFor(ctx), isVocab = source(ctx) === 'vocab'
      el.innerHTML = '<div class="' + NS + 'page">'
        + '<div class="' + NS + 'hero"><h3>' + U.icon('shareOut') + ' Anki 导出</h3>'
        + '<p>导出分号分隔 CSV（Anki 导入时选「分号、允许 HTML」）。先预览命中内容，再决定导出什么。</p></div>'
        + '<div class="' + NS + 'bar"><div class="' + NS + 'tabs">'
        + [['mistakes', '错题本'], ['vocab', '单词本']].map(function (x) {
          return '<button type="button" data-src="' + x[0] + '" aria-pressed="' + (!isVocab === (x[0] === 'mistakes')) + '">' + x[1] + '</button>'
        }).join('') + '</div>'
        + '<input class="' + NS + 'input" data-q placeholder="筛选关键词（题面或单词）" value="' + esc(query(ctx)) + '">'
        + '<button class="btn btn-sm btn-primary" data-do>' + U.icon('shareOut') + ' 导出 ' + rows.length + ' 条</button></div>'
        + '<div class="' + NS + 'preview">' + (rows.length ? rows.slice(0, 8).map(function (r, i) {
          return '<div><b>' + (i + 1) + '. ' + esc(String(r[0]).slice(0, 90)) + '</b><br><em>背面：' + esc(String(r[1]).slice(0, 120)) + '</em></div>'
        }).join('') + '<div class="muted-sm">仅显示前 8 条预览，导出包含全部 ' + rows.length + ' 条。</div>'
          : '<div class="muted-sm">没有命中内容。换个关键词或切到另一个数据源试试。</div>') + '</div>'
        + '<div class="' + NS + 'map">正面：' + (isVocab ? '单词' : '题面 + 选项') + '<br>背面：'
        + (isVocab ? '词性 + 释义 + 例句' : '答案 + 解析（含 trap 提示）')
        + '<br>文件名前缀由插件配置 deckPrefix 决定；每次导出都带当天日期，便于分册导入。</div></div>'
      let input = el.querySelector('[data-q]')
      if (input) {
        input.oninput = function () { try { if (ctx.keep) ctx.keep.set('akQ', input.value) } catch (e) { } }
        input.onchange = function () { try { if (ctx.keep) ctx.keep.set('akQ', input.value) } catch (e) { } render() }
      }
      Array.prototype.forEach.call(el.querySelectorAll('[data-src]'), function (b) {
        b.onclick = function () { try { if (ctx.keep) ctx.keep.set('akSrc', b.getAttribute('data-src')) } catch (e) { } render() }
      })
      let btn = el.querySelector('[data-do]')
      if (btn) btn.onclick = function () { download(ctx, pairsFor(ctx)) }
    }
    render()
    return function () { el.innerHTML = '' }
  }

  function panel(ctx) {
    style(ctx)
    let s = {}
    try { s = (ctx && ctx.Store && ctx.Store.get()) || {} } catch (e) { }
    let m = Array.isArray(s.mistakes) ? s.mistakes.length : 0
    let v = Array.isArray(s.vocab) ? s.vocab.length : 0
    return '<div class="' + NS + 'panel">'
      + '<div style="display:flex;justify-content:space-between"><span>' + U.icon('shareOut') + ' Anki 导出</span><span style="color:var(--text-secondary)">分号 CSV</span></div>'
      + '<div>可导出：<b>' + m + '</b> 条错题 / <b>' + v + '</b> 个单词</div>'
      + '<div class="' + NS + 'map">正面题面、背面答案解析；导入时记得选「分号 + 允许 HTML」。</div>'
      + '<button class="btn btn-sm btn-ghost">打开导出器</button></div>'
  }

  let api = {
    id: PID,
    name: 'Anki 导出器',
    version: VERSION,
    author: '内置',
    desc: '错题本/单词本 → Anki 分号 CSV：先预览命中内容，支持关键词筛选与分册命名。',
    tools: [{ id: 'anki-exporter-page', title: 'Anki 导出', icon: '' + U.icon('shareOut') + '', mount: function (el, ctx) { return mount(el, ctx) } }],
    panels: [{ id: 'ak-today', title: 'Anki 导出', icon: '' + U.icon('shareOut') + '', width: 300, height: 185, render: panel }],
    config: [{ key: 'deckPrefix', label: '导出文件名前缀', type: 'text', default: 'anki' }],
    shortcuts: [{ key: 'alt+a', label: '打开 Anki 导出器', run: function (ctx) { try { ctx.api.goTool('anki-exporter-page') } catch (e) { } } }],
    queries: [
      { key: 'ak-count', label: '可导出条目', run: function (ctx) {
        let s = ctx.Store.get()
        let m = Array.isArray(s.mistakes) ? s.mistakes.length : 0
        let v = Array.isArray(s.vocab) ? s.vocab.length : 0
        return 'Anki 可导出：错题 ' + m + ' 条、单词 ' + v + ' 个。打开 Anki 导出器可按关键词筛选并预览。'
      } },
    ],
    memory: '用户装有「Anki 导出器」插件：把错题本/单词本导出为分号分隔 CSV，支持关键词筛选与预览。用户提到「导出 Anki」「做成卡片」时引导到该工具页。',
  }

  PluginBus.register(api)
})()
