/* anki-exporter.plugin.js — Anki 导出器 · v2.0.0
 *
 * v1.1.0 只有"选数据源 → 筛选 → 导出"，导出前看不到命中多少、字段怎么映射、有没有空背面。
 * v2.0.0 按成熟插件形态重造：多视图（导出/预览/映射/历史/设置）+ 导出前自检 + 历史。
 *
 * 【兼容契约】分号 CSV + BOM（Anki 导入选「分号、允许 HTML」）；
 * 正面=题面(+选项)/单词，背面=答案+解析(+trap)/词性+释义+例句；
 * 面板 ak-today、查询 ak-count、工具 anki-exporter-page、alt+a、deckPrefix 全保留。
 */
;(function () {
  'use strict'

  var VERSION = '2.0.0'
  var PID = 'anki-exporter'
  var NS = 'ak-'
  var K_HISTORY = 'akHistory'
  var K_CFG = 'akConfig'
  var K_LAST_VIEW = 'akView'
  var K_SRC = 'akSrc'
  var K_Q = 'akQ'
  var MAX_HISTORY = 60
  var MAX_PREVIEW = 20
  var MAX_EXPORT = 5000

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
    var d = t == null ? new Date() : (t instanceof Date ? t : new Date(t))
    if (isNaN(d.getTime())) d = new Date()
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
  }
  function stamp() {
    var d = new Date()
    return dkey(d) + '_' + String(d.getHours()).padStart(2, '0') + String(d.getMinutes()).padStart(2, '0')
  }
  function csvCell(s) { return '"' + String(s == null ? '' : s).split('"').join('""') + '"' }
  function csv(pairs) { return pairs.map(function (p) { return csvCell(p[0]) + ';' + csvCell(p[1]) }).join('\n') }
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
    catch (e) { if (ctx && ctx.Toast && typeof ctx.Toast.show === 'function') ctx.Toast.show(String(msg), level) }
  }
  function keepGet(ctx, key, fallback) {
    try { if (ctx && ctx.keep && typeof ctx.keep.get === 'function') return ctx.keep.get(key) || fallback } catch (e) { }
    return fallback
  }
  function keepSet(ctx, key, val) {
    try { if (ctx && ctx.keep && typeof ctx.keep.set === 'function') ctx.keep.set(key, val) } catch (e) { }
  }
  function cfgGet(ctx) {
    var d = { prefix: 'anki', includeTrap: true, includeOptions: true, maxExport: MAX_EXPORT }
    var got = null
    try { got = ctx && typeof ctx.data === 'function' ? ctx.data(K_CFG) : null } catch (e) { }
    if (got && typeof got === 'object') {
      d.prefix = flat(got.prefix) || 'anki'
      d.includeTrap = got.includeTrap !== false
      d.includeOptions = got.includeOptions !== false
      d.maxExport = clamp(got.maxExport, 1, 50000, MAX_EXPORT)
    }
    try { if (ctx && typeof ctx.config === 'function') d.prefix = flat(ctx.config('deckPrefix')) || d.prefix } catch (e) { }
    return d
  }
  function cfgSet(ctx, patch) {
    var d = cfgGet(ctx)
    Object.keys(patch || {}).forEach(function (k) { if (k in d) d[k] = patch[k] })
    try { if (ctx && typeof ctx.data === 'function') ctx.data(K_CFG, d) } catch (e) { }
    return d
  }
  function source(ctx) { return keepGet(ctx, K_SRC, 'mistakes') === 'vocab' ? 'vocab' : 'mistakes' }
  function query(ctx) { return flat(keepGet(ctx, K_Q, '')) }

  /* ══════════════ 2. 数据层：配对 + 自检 ══════════════ */

  function storeOf(ctx) {
    try { return (ctx && ctx.Store && typeof ctx.Store.get === 'function') ? (ctx.Store.get() || {}) : {} } catch (e) { return {} }
  }

  function pairsFor(ctx) {
    var s = storeOf(ctx)
    var q = query(ctx).toLowerCase()
    var cfg = cfgGet(ctx)
    var hit = function (v) { return !q || String(v == null ? '' : v).toLowerCase().indexOf(q) >= 0 }
    if (source(ctx) === 'vocab') {
      return (Array.isArray(s.vocab) ? s.vocab : []).filter(function (v) {
        return hit(v && (v.word || ''))
      }).map(function (v) {
        var back = [v.pos, v.meaning, v.example].filter(function (x) { return x != null && String(x) !== '' }).join('\n')
        return { front: v.word || '', back: back }
      })
    }
    return (Array.isArray(s.mistakes) ? s.mistakes : []).filter(function (m) {
      return hit(m && (m.stem || m.desc || ''))
    }).map(function (m) {
      var front = m.stem || m.desc || ''
      if (cfg.includeOptions && Array.isArray(m.options) && m.options.length) front += '\n' + m.options.join('\n')
      var back = [m.answer, m.solution].filter(function (x) { return x != null && String(x).trim() !== '' }).join('\n——\n')
      if (cfg.includeTrap && m.trap) back += (back ? '\n——\n' : '') + '易错点：' + m.trap
      return { front: front, back: back }
    })
  }

  /** 导出前自检：找出会被 Anki 静默吞掉的坏卡 */
  function lint(pairs) {
    var badFront = 0, badBack = 0, longFront = 0, semicolon = 0
    pairs.forEach(function (p) {
      if (!flat(p.front)) badFront++
      if (!flat(p.back)) badBack++
      if (String(p.front).length > 1000) longFront++
      if (String(p.front).indexOf(';') >= 0 || String(p.back).indexOf(';') >= 0) semicolon++
    })
    return { badFront: badFront, badBack: badBack, longFront: longFront, semicolon: semicolon,
      ok: badFront === 0 && badBack === 0 }
  }

  function historyGet(ctx) {
    var arr = null
    try { arr = ctx && typeof ctx.data === 'function' ? ctx.data(K_HISTORY) : null } catch (e) { }
    if (!Array.isArray(arr)) return []
    return arr.filter(function (x) { return x && typeof x === 'object' && x.at })
      .map(function (x) { return { at: x.at, src: x.src === 'vocab' ? 'vocab' : 'mistakes',
        n: num(x.n), name: flat(x.name), bytes: num(x.bytes), q: flat(x.q) } })
      .sort(function (a, b) { return num(b.at) - num(a.at) })
      .slice(0, MAX_HISTORY)
  }
  function historyAdd(ctx, rec) {
    var arr = historyGet(ctx)
    arr.unshift(rec)
    var out = arr.slice(0, MAX_HISTORY)
    try { if (ctx && typeof ctx.data === 'function') ctx.data(K_HISTORY, out) } catch (e) { }
    return out
  }

  function doDownload(ctx, pairs, cfg) {
    if (!pairs.length) { toast(ctx, '当前筛选下没有可导出的内容', 'warn'); return null }
    var limited = pairs.slice(0, cfg.maxExport)
    var rows = limited.map(function (p) { return [p.front, p.back] })
    var text = '\ufeff' + csv(rows)
    var name = cfg.prefix + '_' + (source(ctx) === 'vocab' ? '单词本' : '错题本') + '_' + stamp() + '.csv'
    ctx.api.download(name, text, 'text/csv;charset=utf-8')
    historyAdd(ctx, { at: Date.now(), src: source(ctx), n: limited.length, name: name,
      bytes: text.length * 2, q: query(ctx) })
    toast(ctx, '已导出 ' + limited.length + ' 条：' + name, 'success')
    return { name: name, n: limited.length, bytes: text.length * 2 }
  }

  /* ══════════════ 3. 样式 ══════════════ */

  var CSS = [
    '.' + NS + 'page{display:flex;flex-direction:column;gap:12px;max-width:1120px;margin:0 auto}',
    '.' + NS + 'hero{border-radius:14px;padding:16px 18px;background:var(--glass-bg);border:1px solid var(--line)}',
    '.' + NS + 'hero h3{margin:0 0 6px;font-size:16px;display:flex;align-items:center;gap:8px}',
    '.' + NS + 'hero p{margin:0;color:var(--text-secondary);font-size:12.5px;line-height:1.75}',
    '.' + NS + 'tabs{display:flex;gap:6px;flex-wrap:wrap;border-bottom:1px solid var(--line);padding-bottom:8px}',
    '.' + NS + 'tab{border:1px solid var(--line);background:transparent;color:var(--text-secondary);border-radius:9px;padding:6px 13px;font-size:12px;cursor:pointer;transition:.16s}',
    '.' + NS + 'tab.on{background:var(--accent-text);border-color:var(--accent-text);color:var(--btn-text,#fff)}',
    '.' + NS + 'bar{display:flex;gap:8px;flex-wrap:wrap;align-items:center}',
    '.' + NS + 'seg{display:flex;gap:6px}',
    '.' + NS + 'seg button{border:1px solid var(--line);background:transparent;border-radius:99px;padding:5px 12px;font-size:11.5px;color:inherit;cursor:pointer}',
    '.' + NS + 'seg button[aria-pressed="true"]{border-color:var(--accent-text);background:var(--glass-bg)}',
    '.' + NS + 'input{border:1px solid var(--line);border-radius:8px;padding:6px 10px;background:var(--bg-muted,transparent);color:var(--text-primary);font-size:12px;min-width:180px}',
    '.' + NS + 'card{border:1px solid var(--line);border-radius:12px;padding:14px 16px;background:var(--glass-bg)}',
    '.' + NS + 'card h4{margin:0 0 10px;font-size:13.5px;display:flex;align-items:center;gap:7px}',
    '.' + NS + 'preview{border:1px solid var(--line);border-radius:11px;overflow:hidden}',
    '.' + NS + 'preview div{padding:8px 11px;border-bottom:1px dashed var(--line);font-size:12px;line-height:1.65}',
    '.' + NS + 'preview div:last-child{border-bottom:0}',
    '.' + NS + 'preview b{color:var(--accent-text)}',
    '.' + NS + 'preview em{font-style:normal;color:var(--text-secondary)}',
    '.' + NS + 'map{border-left:2px solid var(--accent-text);padding-left:11px;font-size:11.5px;line-height:1.8;color:var(--text-secondary)}',
    '.' + NS + 'note{display:flex;gap:8px;padding:9px 11px;border-radius:10px;margin-bottom:8px;border-left:3px solid var(--line);background:var(--glass-bg);font-size:12px;line-height:1.7}',
    '.' + NS + 'note.warn{border-left-color:var(--danger,#d9534f)}',
    '.' + NS + 'note.good{border-left-color:var(--ok,#2e9e5b)}',
    '.' + NS + 'note.info{border-left-color:var(--blue)}',
    '.' + NS + 'note b{display:block;font-size:12.5px;margin-bottom:2px}',
    '.' + NS + 'kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}',
    '.' + NS + 'kpis div{border:1px solid var(--line);border-radius:11px;padding:11px 12px;background:var(--glass-bg)}',
    '.' + NS + 'kpis b{display:block;font-size:19px;line-height:1.3}',
    '.' + NS + 'kpis span{font-size:11px;color:var(--text-secondary)}',
    '.' + NS + 'table{width:100%;border-collapse:collapse;font-size:12px}',
    '.' + NS + 'table th{text-align:left;color:var(--text-secondary);font-weight:500;padding:7px 8px;border-bottom:1px solid var(--line);font-size:11px}',
    '.' + NS + 'table td{padding:7px 8px;border-bottom:1px dashed var(--line)}',
    '.' + NS + 'field{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:9px 0;border-bottom:1px dashed var(--line);font-size:12px}',
    '.' + NS + 'acts{display:flex;gap:7px;flex-wrap:wrap;margin-top:10px}',
    '.' + NS + 'btn{border:1px solid var(--line);background:var(--glass-bg);color:var(--text-primary);border-radius:8px;padding:6px 12px;font-size:11.5px;cursor:pointer;transition:.15s}',
    '.' + NS + 'btn.pri{background:var(--accent-text);border-color:var(--accent-text);color:var(--btn-text,#fff)}',
    '.' + NS + 'ic{display:inline-flex;width:15px;height:15px;vertical-align:-2px}',
    '.' + NS + 'ic svg{width:15px;height:15px;fill:none;stroke:currentColor;stroke-width:1.8}',
    '@media(max-width:820px){.' + NS + 'kpis{grid-template-columns:repeat(2,1fr)}}'
  ].join('\n')

  function style(ctx) {
    try { if (ctx && ctx.css && typeof ctx.css.add === 'function') ctx.css.add(CSS, 'skin') } catch (e) { }
  }

  /* ══════════════ 4. 视图 ══════════════ */

  function viewExport(ctx, S) {
    var out = []
    var cfg = S.cfg
    out.push('<div class="' + NS + 'hero"><h3>' + I('shareOut', '卡') + ' Anki 导出</h3>'
      + '<p>导出分号分隔 CSV（Anki 导入时选「分号、允许 HTML」）。先预览命中内容、看过自检结果，再决定导出什么。</p></div>')
    out.push('<div class="' + NS + 'bar">'
      + '<div class="' + NS + 'seg">'
      + [['mistakes', '错题本'], ['vocab', '单词本']].map(function (x) {
        return '<button type="button" data-act="src" data-v="' + x[0] + '" aria-pressed="' + (S.src === x[0]) + '">' + x[1] + '</button>'
      }).join('') + '</div>'
      + '<input class="' + NS + 'input" data-act="q" placeholder="筛选关键词（题面或单词）" value="' + esc(S.q) + '">'
      + '<button class="' + NS + 'btn pri" data-act="export">' + I('shareOut', '出') + ' 导出 ' + S.pairs.length + ' 条</button>'
      + '</div>')
    out.push('<div class="' + NS + 'kpis" style="margin-top:12px">'
      + '<div><b>' + S.pairs.length + '</b><span>命中条目</span></div>'
      + '<div><b>' + Math.min(S.pairs.length, cfg.maxExport) + '</b><span>实际导出</span></div>'
      + '<div><b>' + S.lint.badFront + '/' + S.lint.badBack + '</b><span>空正面 / 空背面</span></div>'
      + '<div><b>' + S.hist.length + '</b><span>历史导出</span></div></div>')
    out.push('<section class="' + NS + 'card" style="margin-top:12px"><h4>自检结果</h4>'
      + (S.lint.ok
        ? '<div class="' + NS + 'note good"><div><b>没有坏卡</b>命中的条目正面背面都非空，可以导出。</div></div>'
        : '<div class="' + NS + 'note warn"><div><b>发现 ' + (S.lint.badFront + S.lint.badBack) + ' 张坏卡</b>'
          + '空正面 ' + S.lint.badFront + ' 条、空背面 ' + S.lint.badBack + ' 条。Anki 会导入但复习时看不到东西 —— 建议先回原页补内容。</div></div>')
      + (S.lint.longFront ? '<div class="' + NS + 'note warn"><div><b>' + S.lint.longFront
        + ' 条正面过长</b>超过 1000 字，在 Anki 里会撑爆卡片。</div></div>' : '')
      + (S.lint.semicolon ? '<div class="' + NS + 'note info"><div><b>' + S.lint.semicolon
        + ' 条含分号</b>插件会把分号包进引号，Anki 按「分号分隔 + 允许 HTML」导入即可正确解析。</div></div>' : '')
      + '</section>')
    return out.join('')
  }

  function viewPreview(ctx, S) {
    var out = []
    out.push('<section class="' + NS + 'card"><div style="display:flex;justify-content:space-between;align-items:center">'
      + '<h4 style="margin:0">导出预览（前 ' + Math.min(S.pairs.length, MAX_PREVIEW) + ' 条）</h4>'
      + '<span class="' + NS + 'map">正面：' + (S.src === 'vocab' ? '单词' : '题面' + (S.cfg.includeOptions ? ' + 选项' : ''))
      + '<br>背面：' + (S.src === 'vocab' ? '词性 + 释义 + 例句' : '答案 + 解析' + (S.cfg.includeTrap ? ' + 易错点' : '')) + '</span></div>'
      + (S.pairs.length ? '<div class="' + NS + 'preview">' + S.pairs.slice(0, MAX_PREVIEW).map(function (p, i) {
        return '<div><b>' + (i + 1) + '. ' + esc(trunc(p.front, 110)) + '</b><br><em>背面：'
          + esc(trunc(p.back, 160)) + '</em></div>'
      }).join('') + '</div>' : '<div class="' + NS + 'map">没有命中内容。换个关键词或切到另一个数据源。</div>')
      + (S.pairs.length > MAX_PREVIEW ? '<p class="' + NS + 'map" style="margin-top:8px">仅预览前 ' + MAX_PREVIEW
        + ' 条，导出包含全部 ' + S.pairs.length + ' 条。</p>' : '')
      + '</section>')
    return out.join('')
  }

  function viewMapping(ctx, S) {
    var c = S.cfg
    var out = []
    out.push('<section class="' + NS + 'card"><h4>字段映射</h4>'
      + '<div class="' + NS + 'map">'
      + (S.src === 'vocab'
        ? '正面 ← vocab.word<br>背面 ← vocab.pos + vocab.meaning + vocab.example'
        : '正面 ← mistakes.stem/desc' + (c.includeOptions ? ' + options（逐项）' : '')
          + '<br>背面 ← mistakes.answer + mistakes.solution' + (c.includeTrap ? ' + mistakes.trap（标「易错点」）' : ''))
      + '<br>分隔符：分号 <code>;</code> · 字段用双引号包裹 · 文件带 BOM（中文不乱码）</div>'
      + '<div class="' + NS + 'field"><label>正面带选项</label>'
      + '<button class="' + NS + 'btn' + (c.includeOptions ? ' pri' : '') + '" data-act="cfg-options">' + (c.includeOptions ? '是' : '否') + '</button></div>'
      + '<div class="' + NS + 'field"><label>背面带易错点</label>'
      + '<button class="' + NS + 'btn' + (c.includeTrap ? ' pri' : '') + '" data-act="cfg-trap">' + (c.includeTrap ? '是' : '否') + '</button></div>'
      + '<p class="' + NS + 'map" style="margin-top:10px">映射改动只影响**下一次导出**，不动源数据，也不影响已经导出的文件。</p>'
      + '</section>')
    return out.join('')
  }

  function viewHistory(ctx, S) {
    var out = []
    out.push('<section class="' + NS + 'card"><h4>导出历史（仅本机记录）</h4>'
      + (S.hist.length ? '<table class="' + NS + 'table"><thead><tr><th>时间</th><th>来源</th><th>条数</th><th>文件</th></tr></thead><tbody>'
        + S.hist.map(function (x) {
          var d = new Date(x.at)
          var ts = isNaN(d.getTime()) ? '—' : dkey(d) + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0')
          return '<tr><td>' + esc(ts) + '</td><td>' + (x.src === 'vocab' ? '单词' : '错题') + '</td><td>' + x.n
            + '</td><td>' + esc(trunc(x.name, 34)) + '</td></tr>'
        }).join('') + '</tbody></table>'
        : '<div class="' + NS + 'map">还没有导出记录。历史只记文件名与条数，不复制卡片内容。</div>')
      + '</section>')
    return out.join('')
  }

  function viewConfig(ctx, S) {
    var c = S.cfg
    var out = []
    out.push('<section class="' + NS + 'card"><h4>导出设置</h4>'
      + '<div class="' + NS + 'field"><label>文件名前缀</label><input data-act="cfg-prefix" value="' + esc(c.prefix) + '"></div>'
      + '<div class="' + NS + 'field"><label>单次导出上限</label><input type="number" min="1" max="50000" data-act="cfg-max" value="' + c.maxExport + '"></div>'
      + '<p class="' + NS + 'map" style="margin-top:10px">前缀在插件中心配置里也能改（deckPrefix）；两边改的是同一件事。'
      + '**上限不是筛选**，只是防止一次导出几万条把浏览器卡死。</p></section>')
    out.push('<section class="' + NS + 'card"><h4>导入到 Anki 的步骤</h4><div class="' + NS + 'map">'
      + '1. Anki → 文件 → 导入 → 选导出的 .csv；<br>'
      + '2. 字段分隔符选**分号**，勾选**允许 HTML**；<br>'
      + '3. 正面/背面映射按实际顺序确认；<br>'
      + '4. 先导入一个小文件试一张，确认换行与 LaTeX 显示正常再导全部。</div></section>')
    return out.join('')
  }

  /** 质量视图：把"什么卡片在 Anki 里会变成废卡"讲透。
   * 这个视图不导出、不修改，只解释 — 用户理解了口径才不会怪插件导出了空卡。 */
  function viewQuality(ctx, S) {
    var out = []
    var l = S.lint
    out.push('<section class="' + NS + 'card"><h4>' + I('cpWarn', '质') + ' 导出质量清单</h4>'
      + '<table class="' + NS + 'table"><thead><tr><th>检查项</th><th>命中</th><th>为什么重要</th></tr></thead><tbody>'
      + [['空正面', l.badFront, 'Anki 会导入但卡片正面是空的，复习时不知道问什么。'],
        ['空背面', l.badBack, '想不起答案也翻不出东西 —— 这类卡最容易让人误以为"我会了"。'],
        ['正面过长', l.longFront, '超过 1000 字在手机 Anki 上要滚好几屏，实际没法用。'],
        ['含分号', l.semicolon, '本插件会把分号包进双引号，选「分号分隔」导入即可正确解析。']]
        .map(function (r) {
          return '<tr><td>' + esc(r[0]) + '</td><td><b>' + r[1] + '</b></td><td>' + esc(r[2]) + '</td></tr>'
        }).join('') + '</tbody></table></section>')
    out.push('<section class="' + NS + 'card"><h4>三类常见的"看起来对、其实废"的卡</h4>'
      + '<div class="' + NS + 'note warn"><div><b>只有题干没有答案</b>'
      + '错题本里有些条目只有 stem，answer/solution 都空 —— 导出正面有东西、背面空，'
      + '复习时等于在猜。先回错题页补答案。</div></div>'
      + '<div class="' + NS + 'note warn"><div><b>把整段解析塞进正面</b>'
      + '如果题面字段本身就写了答案，正面会提前泄底。本插件正面只取 stem/desc + 选项，'
      + '不会把 solution 混进去。</div></div>'
      + '<div class="' + NS + 'note info"><div><b>LaTeX 在 Anki 里不渲染</b>'
      + 'Anki 默认不走 KaTeX。公式若显示成原始 `$...$`，需要在 Anki 装 MathJax 插件，'
      + '或导出前把公式转成图片（本插件不转换，保留原文以便可逆）。</div></div>'
      + '</section>')
    out.push('<section class="' + NS + 'card"><h4>可逆性</h4>'
      + '<p class="' + NS + 'map" style="margin:0">导出是**只读取**操作：不改 Store、不改错题、不打标记。'
      + '导出的 CSV 可以删掉重导，也可以随时用原数据重新生成。'
      + '唯一写入的是本机的导出历史（只记文件名/条数/时间，不复制卡片内容）。</p></section>')
    return out.join('')
  }

  /** 卡片设计指南：把"什么样的 Anki 卡值得做"写成可查的对照表。
   * 导出器不该只管把数据倒出去 —— 导出的卡好不好用，才是用户真正关心的。 */
  function viewDesign(ctx, S) {
    var good = [
      ['一卡一问', '正面只问一件事：「洛必达法则的适用条件是什么？」', '正面塞三道小题，复习时不知道该答哪个'],
      ['答案可自洽', '背面写出完整推导，不写「见教材 P32」', '背面指向别处 → 复习时等于没有答案'],
      ['题干带必要上下文', '给函数表达式和区间，不只写「求极限」', '脱离上下文的题面，忘了原题就答不出'],
      ['易错点单独标', '背面末尾用「易错点：」标出陷阱', '把陷阱混进推导里，复习时抓不住重点'],
      ['公式保留 LaTeX', '保留 $\\frac{a}{b}$ 原文，Anki 装 MathJax 后能渲染', '转成 Unicode 近似写法，长期看会走样'],
    ]
    var vocab = [
      ['单词卡正面只放词', '正面：abate', '正面放「abate 的中文是什么」——多此一举'],
      ['背面分层', '词性 / 释义 / 例句，三段分开', '一整段糊在一起，眼睛找不到重点'],
      ['例句带语境', '例句能独立理解，不依赖原文', '例句里全是 it/this，忘了上下文就没用'],
      ['不做近义词辨析卡', '辨析放笔记，卡片只记核心义', '近义词卡正面背面几乎一样，复习无收益'],
    ]
    var list = S.src === 'vocab' ? vocab : good
    var out = []
    out.push('<section class="' + NS + 'card"><h4>' + I('cpBrain', '卡') + ' 好卡 / 废卡对照（' + (S.src === 'vocab' ? '单词' : '错题') + '）</h4>'
      + '<table class="' + NS + 'table"><thead><tr><th>原则</th><th>值得导出的样子</th><th>会变成废卡的样子</th></tr></thead><tbody>'
      + list.map(function (r) {
        return '<tr><td><b>' + esc(r[0]) + '</b></td><td>' + esc(r[1]) + '</td><td>' + esc(r[2]) + '</td></tr>'
      }).join('') + '</tbody></table>'
      + '<p class="' + NS + 'map" style="margin-top:10px">这张表不检查你的卡片，只是判断标准。'
      + '导出前对照看一眼；真要改内容，回错题页/单词本改源头 —— 导出器只读不改。</p></section>')
    out.push('<section class="' + NS + 'card"><h4>间隔复习的常识</h4>'
      + '<div class="' + NS + 'note info"><div><b>Anki 的收益来自"快要忘时想起"</b>'
      + '太早复习（刚记住就翻）几乎不产生记忆强度；太晚复习（全忘了）等于重学。'
      + '所以别因为焦虑就手动把间隔调短。</div></div>'
      + '<div class="' + NS + 'note info"><div><b>一次导出几千张不是好事</b>'
      + 'Anki 的调度会被新卡淹没。建议按科目分册导入，每次几十到几百张，'
      + '让"今日新卡上限"发挥作用。</div></div>'
      + '<div class="' + NS + 'note warn"><div><b>本插件不替你决定导哪些</b>'
      + '筛选关键词由你给，命中多少就列多少。它只保证"所见即所导"，'
      + '不假装知道你哪些题真的掌握了。</div></div></section>')
    return out.join('')
  }

  var VIEWS = [
    { k: 'export', t: '导出', f: viewExport },
    { k: 'preview', t: '预览', f: viewPreview },
    { k: 'mapping', t: '映射', f: viewMapping },
    { k: 'history', t: '历史', f: viewHistory },
    { k: 'config', t: '设置', f: viewConfig },
    { k: 'quality', t: '质量', f: viewQuality },
    { k: 'design', t: '卡片设计', f: viewDesign },
  ]

  /* ══════════════ 5. Shell ══════════════ */

  function stateOf(ctx) {
    var cfg = cfgGet(ctx)
    var pairs = pairsFor(ctx)
    var v = keepGet(ctx, K_LAST_VIEW, 'export')
    return {
      cfg: cfg, src: source(ctx), q: query(ctx), pairs: pairs, lint: lint(pairs),
      hist: historyGet(ctx),
      view: VIEWS.some(function (x) { return x.k === v }) ? v : 'export',
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
    try { body = cur.f(ctx, S) } catch (e) { body = '<div class="' + NS + 'note warn">视图渲染失败：' + esc((e && e.message) || e) + '</div>' }
    root.innerHTML = '<div class="' + NS + 'page">' + header + body + '</div>'
  }

  function refresh(root, ctx, S) {
    S.pairs = pairsFor(ctx)
    S.lint = lint(S.pairs)
    S.hist = historyGet(ctx)
    S.cfg = cfgGet(ctx)
    render(root, ctx, S)
  }

  function doAct(ctx, S, root, act, value) {
    if (act === 'tab' && VIEWS.some(function (x) { return x.k === value })) {
      S.view = value
      keepSet(ctx, K_LAST_VIEW, value)
      render(root, ctx, S)
      return
    }
    if (act === 'src') { keepSet(ctx, K_SRC, value); refresh(root, ctx, S); return }
    if (act === 'export') { if (doDownload(ctx, S.pairs, S.cfg)) refresh(root, ctx, S); return }
    if (act === 'cfg-options') { cfgSet(ctx, { includeOptions: !S.cfg.includeOptions }); refresh(root, ctx, S); return }
    if (act === 'cfg-trap') { cfgSet(ctx, { includeTrap: !S.cfg.includeTrap }); refresh(root, ctx, S); return }
  }

  function mount(el, ctx) {
    style(ctx)
    var S = stateOf(ctx)
    render(el, ctx, S)
    var onClick = function (ev) {
      var t = ev.target
      for (var i = 0; i < 5 && t && t !== el; i++, t = t.parentElement) {
        var act = t.getAttribute && t.getAttribute('data-act')
        if (!act) continue
        if (act === 'q') return
        ev.preventDefault()
        doAct(ctx, S, el, act, t.getAttribute('data-v'))
        return
      }
    }
    var onInput = function (ev) {
      var t = ev.target
      if (t && t.getAttribute && t.getAttribute('data-act') === 'q') keepSet(ctx, K_Q, t.value)
    }
    var onChange = function (ev) {
      var t = ev.target
      if (!t || !t.getAttribute) return
      var act = t.getAttribute('data-act')
      if (act === 'q') { keepSet(ctx, K_Q, t.value); refresh(el, ctx, S); return }
      if (act === 'cfg-prefix') { cfgSet(ctx, { prefix: flat(t.value) || 'anki' }); refresh(el, ctx, S); return }
      if (act === 'cfg-max') { cfgSet(ctx, { maxExport: clamp(t.value, 1, 50000, MAX_EXPORT) }); refresh(el, ctx, S); return }
    }
    el.addEventListener('click', onClick)
    el.addEventListener('input', onInput)
    el.addEventListener('change', onChange)
    return function () {
      el.removeEventListener('click', onClick)
      el.removeEventListener('input', onInput)
      el.removeEventListener('change', onChange)
      el.innerHTML = ''
    }
  }

  /* ══════════════ 6. 面板 ══════════════ */

  function panel(ctx) {
    style(ctx)
    var s = storeOf(ctx)
    var m = Array.isArray(s.mistakes) ? s.mistakes.length : 0
    var v = Array.isArray(s.vocab) ? s.vocab.length : 0
    var hist = historyGet(ctx)
    return '<div class="' + NS + 'panel">'
      + '<div style="display:flex;justify-content:space-between"><span>' + I('shareOut', '卡') + ' Anki 导出</span>'
      + '<span style="color:var(--text-secondary)">分号 CSV</span></div>'
      + '<div>可导出：<b>' + m + '</b> 条错题 / <b>' + v + '</b> 个单词</div>'
      + '<div class="' + NS + 'map">正面题面、背面答案解析；导入时记得选「分号 + 允许 HTML」。</div>'
      + (hist.length ? '<div class="' + NS + 'map">上次导出：' + esc(trunc(hist[0].name, 28)) + '（' + hist[0].n + ' 条）</div>' : '')
      + '<button class="btn btn-sm btn-ghost">打开导出器</button></div>'
  }

  /* ══════════════ 7. 注册 ══════════════ */

  var api = {
    id: PID,
    name: 'Anki 导出器',
    version: VERSION,
    author: '内置',
    desc: '错题本/单词本 → Anki 分号 CSV：多视图（导出/预览/映射/历史/设置）+ 导出前自检（空卡/过长/分号）+ 字段映射可视化。',
    tools: [{ id: 'anki-exporter-page', title: 'Anki 导出', icon: '' + I('shareOut', '卡') + '', mount: function (el, ctx) { return mount(el, ctx) } }],
    panels: [{ id: 'ak-today', title: 'Anki 导出', icon: '' + I('shareOut', '卡') + '', width: 300, height: 200, render: panel }],
    config: [
      { key: 'deckPrefix', label: '导出文件名前缀', type: 'text', default: 'anki' },
      { key: 'includeOptions', label: '正面带选项', type: 'bool', default: true },
      { key: 'includeTrap', label: '背面带易错点', type: 'bool', default: true },
    ],
    shortcuts: [{ key: 'alt+a', label: '打开 Anki 导出器', run: function (ctx) { try { ctx.api.goTool('anki-exporter-page') } catch (e) { } } }],
    queries: [
      { key: 'ak-count', label: '可导出条目', run: function (ctx) {
        var s = storeOf(ctx)
        var m = Array.isArray(s.mistakes) ? s.mistakes.length : 0
        var v = Array.isArray(s.vocab) ? s.vocab.length : 0
        return 'Anki 可导出：错题 ' + m + ' 条、单词 ' + v + ' 个。打开 Anki 导出器可按关键词筛选并预览。'
      } },
      { key: 'ak-lint', label: '导出质量自检', run: function (ctx) {
        var l = lint(pairsFor(ctx))
        if (!l.badFront && !l.badBack && !l.longFront) return '当前筛选下的卡片自检通过，没有空正面或空背面。'
        return '导出自检发现：空正面 ' + l.badFront + ' 条、空背面 ' + l.badBack + ' 条、正面过长 '
          + l.longFront + ' 条。建议先回原页补齐内容再导出。'
      } },
      { key: 'ak-format', label: 'Anki CSV 的格式约定', run: function (ctx) {
        return 'Anki 导出器用分号分隔 CSV、字段包双引号、文件带 BOM（中文不乱码）。'
          + '导入时选「分号」并勾选「允许 HTML」。正面是题面/单词，背面是答案+解析/释义+例句。'
          + '导出是只读取操作，不改任何站内数据。'
      } },
      { key: 'ak-history', label: '最近导出记录', run: function (ctx) {
        var h = historyGet(ctx)
        if (!h.length) return '这个插件还没有导出过卡片。'
        return '最近三次导出：' + h.slice(0, 3).map(function (x) {
          return (x.src === 'vocab' ? '单词' : '错题') + ' ' + x.n + ' 条'
        }).join('、') + '。'
      } },
    ],
    memory: '用户装有「Anki 导出器」插件：把错题本/单词本导出为分号分隔 CSV，支持关键词筛选、预览、字段映射与导出前自检。'
      + '用户提到「导出 Anki」「做成卡片」时引导到该工具页；导出前务必看自检结果，别把空卡片导进去。',
  }

  if (typeof window !== 'undefined' && window.__AK_DEBUG__) {
    window.__akInternals = {
      esc: esc, csvCell: csvCell, csv: csv, num: num, clamp: clamp, flat: flat, trunc: trunc,
      pairsFor: pairsFor, lint: lint, historyGet: historyGet, historyAdd: historyAdd,
      cfgGet: cfgGet, cfgSet: cfgSet, mount: mount, VIEWS: VIEWS, MAX_EXPORT: MAX_EXPORT,
    }
  }

  PluginBus.register(api)
})()
