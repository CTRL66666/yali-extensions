/* storage-doctor.plugin.js — 存储体检 · v3.0.0
 *
 * 【守恒契约 · 不许破】依旧复用 core/datamanage 的统一面板，**不自己另算一份占用数字**；
 * 本插件**故意没有 panels**（plugincenter-migration.test.ts 明确定性：加面板会让用户误以为
 * 存在两种清理口径）。保留查询 sd-counts / sd-advice 与工具 id / 快捷键。
 *
 * v2.1.0 只有一个速览 + 一个面板槽（103 行），"体检"两个字名不副实：它列了几个数字，
 * 却没回答"哪些集合在涨""涨到什么程度该清理""清理后能不能还原"。
 * v3.0.0 按成熟插件形态重造：多视图 + 本机快照历史 + 风险分级 + 报告导出。
 * 所有"当前值"现读 Store / localStorage，历史只记趋势，不复制当前状态。
 */
;(function () {
  'use strict'

  var VERSION = '3.0.0'
  var PID = 'storage-doctor'
  var NS = 'sd-'
  var K_HISTORY = 'sdHistory'     // 每日快照（不记敏感内容，只记条数/体积）
  var K_CFG = 'sdConfig'
  var K_LAST_VIEW = 'sdView'
  var MAX_HISTORY = 120
  var DAY = 86400000

  /* ══════════════ 1. 基础工具 ══════════════ */

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
  function shiftDay(key, delta) {
    var p = String(key || dkey()).split('-')
    var d = new Date(num(p[0], 1970), num(p[1], 1) - 1, num(p[2], 1))
    d.setDate(d.getDate() + delta)
    return dkey(d)
  }
  function fmtSize(n) {
    var v = num(n)
    if (v < 1024) return String(Math.round(v)) + ' B'
    if (v < 1048576) return (Math.round(v / 102.4) / 10) + ' KB'
    return (Math.round(v / 104857.6) / 10) + ' MB'
  }
  function fmtCount(n) { return String(num(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',') }
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
    var d = { warnAt: 200, warnMistakes: 500, autoRecord: true }
    var got = null
    try { got = ctx && typeof ctx.data === 'function' ? ctx.data(K_CFG) : null } catch (e) { }
    if (got && typeof got === 'object') {
      d.warnAt = clamp(got.warnAt, 1, 100000, 200)
      d.warnMistakes = clamp(got.warnMistakes, 1, 100000, 500)
      d.autoRecord = got.autoRecord !== false
    }
    /* warnAt 也读插件中心 config（老用户可能在那里设过），以那边为准 */
    try {
      if (ctx && typeof ctx.config === 'function') d.warnAt = clamp(ctx.config('warnAt'), 1, 100000, d.warnAt)
    } catch (e) { }
    return d
  }
  function cfgSet(ctx, patch) {
    var d = cfgGet(ctx)
    Object.keys(patch || {}).forEach(function (k) { if (k in d) d[k] = patch[k] })
    try { if (ctx && typeof ctx.data === 'function') ctx.data(K_CFG, d) } catch (e) { }
    return d
  }

  /* ══════════════ 2. 数据层：只读扫描，不另算占用 ══════════════ */

  var COLLECTIONS = [
    { k: 'mistakePhotos', t: '拍题照片', note: 'base64 常驻 localStorage/IndexedDB，体积最大' },
    { k: 'mistakes', t: '错题', note: '结构化条目，含选项与解析' },
    { k: 'vocab', t: '单词', note: '词卡与例句' },
    { k: 'tasks', t: '任务', note: '排程与完成标记' },
    { k: 'essays', t: '作文', note: '批改记录与历史版本' },
    { k: 'plugins', t: '插件', note: '已安装插件的元数据与数据' },
    { k: 'mental', t: '心情', note: '每日心情记录' },
    { k: 'studyHours', t: '学习时长', note: '按日键值' },
    { k: 'noticeLog', t: '通知', note: '通知中心历史' },
  ]

  function sizeOf(v) {
    try {
      var s = typeof v === 'string' ? v : JSON.stringify(v)
      return s ? s.length * 2 : 0   /* JS 字符串按 UTF-16 粗估，不做精确字节承诺 */
    } catch (e) { return 0 }
  }

  function counts(ctx) {
    var s = {}
    try { s = (ctx && ctx.Store && typeof ctx.Store.get === 'function') ? (ctx.Store.get() || {}) : {} } catch (e) { }
    var arr = function (k) {
      var v = s[k]
      return Array.isArray(v) ? v.length : (v && typeof v === 'object' ? Object.keys(v).length : 0)
    }
    var c = {
      mistakes: arr('mistakes'), words: arr('vocab'), tasks: arr('tasks'),
      essays: arr('essays'), photos: arr('mistakePhotos'), plugins: arr('plugins'),
      mental: arr('mental'), hours: arr('studyHours'), notices: arr('noticeLog'),
    }
    c.total = c.mistakes + c.words + c.tasks + c.essays + c.photos + c.plugins + c.mental + c.hours + c.notices
    return c
  }

  /** 集合明细：条数 + 估算体积。体积只用于**排序找大头**，不当作精确占用。 */
  function detailOf(ctx) {
    var s = {}
    try { s = (ctx && ctx.Store && typeof ctx.Store.get === 'function') ? (ctx.Store.get() || {}) : {} } catch (e) { }
    return COLLECTIONS.map(function (x) {
      var v = s[x.k]
      var n = Array.isArray(v) ? v.length : (v && typeof v === 'object' ? Object.keys(v).length : 0)
      return { k: x.k, t: x.t, note: x.note, n: n, bytes: sizeOf(v) }
    }).sort(function (a, b) { return b.bytes - a.bytes })
  }

  function lsScan() {
    var out = []
    try {
      if (typeof localStorage === 'undefined') return out
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i)
        if (!k) continue
        var raw = ''
        try { raw = localStorage.getItem(k) || '' } catch (e) { raw = '' }
        out.push({ k: k, bytes: raw.length * 2 })
      }
    } catch (e) { }
    return out.sort(function (a, b) { return b.bytes - a.bytes })
  }

  function advise(c, cfg) {
    var out = []
    if (c.photos > cfg.warnAt) {
      out.push({ level: 'warn', title: '拍题照片偏多', body: '当前 ' + fmtCount(c.photos) + ' 张（阈值 ' + fmtCount(c.warnAt)
        + '）。照片是体积大头：先删掉已经掌握、且解析已存成文字的那些。' })
    }
    if (c.mistakes > cfg.warnMistakes) {
      out.push({ level: 'warn', title: '错题条目偏多', body: '当前 ' + fmtCount(c.mistakes) + ' 条（阈值 '
        + fmtCount(c.warnMistakes) + '）。条目本身不大，但会让检索变慢 —— 按科目归档比全删更划算。' })
    }
    if (c.photos > 0 && c.photos < 10) {
      out.push({ level: 'info', title: '拍题记录还很少', body: '只有 ' + c.photos + ' 张。数据健康，不用清理。' })
    }
    if (!out.length) {
      out.push({ level: 'good', title: '数据量在健康区间', body: '各集合都没过阈值。需要腾空间时再用下方统一面板按集合清理，不要批量删。' })
    }
    out.push({ level: 'info', title: '清理口径只有一处', body: '本页下方的面板与「设置 → 数据清理」共用 core/datamanage。'
      + '这里不另算占用数字 —— 两处数字若不一致，以设置页为准。' })
    return out
  }

  function historyGet(ctx) {
    var arr = null
    try { arr = ctx && typeof ctx.data === 'function' ? ctx.data(K_HISTORY) : null } catch (e) { }
    if (!Array.isArray(arr)) return []
    return arr.filter(function (x) { return x && /^\d{4}-\d{2}-\d{2}$/.test(String(x.day || '')) })
      .map(function (x) { return { day: x.day, total: num(x.total), photos: num(x.photos),
        bytes: num(x.bytes), mistakes: num(x.mistakes), at: num(x.at, Date.now()) } })
      .sort(function (a, b) { return String(a.day).localeCompare(String(b.day)) })
      .slice(-MAX_HISTORY)
  }
  function historySave(ctx, arr) {
    var out = (arr || []).slice(-MAX_HISTORY)
    try { if (ctx && typeof ctx.data === 'function') ctx.data(K_HISTORY, out) } catch (e) { }
    return out
  }
  function recordToday(ctx, force) {
    var c = counts(ctx), d = detailOf(ctx)
    var bytes = d.reduce(function (a, x) { return a + x.bytes }, 0)
    var day = dkey(), arr = historyGet(ctx)
    var last = arr.length ? arr[arr.length - 1] : null
    if (last && last.day === day && !force) return arr
    var rec = { day: day, total: c.total, photos: c.photos, mistakes: c.mistakes, bytes: bytes, at: Date.now() }
    if (last && last.day === day) arr[arr.length - 1] = rec
    else arr.push(rec)
    return historySave(ctx, arr)
  }
  function deltaOf(hist, field) {
    var a = hist.slice(-7), b = hist.slice(-14, -7)
    if (!a.length || !b.length) return null
    var avg = function (xs) { return xs.reduce(function (s, x) { return s + num(x[field]) }, 0) / xs.length }
    return Math.round((avg(a) - avg(b)) * 10) / 10
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
    '.' + NS + 'kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}',
    '.' + NS + 'kpis div{border:1px solid var(--line);border-radius:11px;padding:11px 12px;background:var(--glass-bg)}',
    '.' + NS + 'kpis b{display:block;font-size:19px;line-height:1.3;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.' + NS + 'kpis span{font-size:11px;color:var(--text-secondary)}',
    '.' + NS + 'tip{border-left:2px solid var(--accent-text);padding:6px 0 6px 12px;font-size:12.5px;line-height:1.8;color:var(--text-secondary)}',
    '.' + NS + 'note{display:flex;gap:8px;padding:9px 11px;border-radius:10px;margin-bottom:8px;border-left:3px solid var(--line);background:var(--glass-bg);font-size:12px;line-height:1.7}',
    '.' + NS + 'note.warn{border-left-color:var(--danger,#d9534f)}',
    '.' + NS + 'note.good{border-left-color:var(--ok,#2e9e5b)}',
    '.' + NS + 'note.info{border-left-color:var(--blue)}',
    '.' + NS + 'note b{display:block;font-size:12.5px;margin-bottom:2px}',
    '.' + NS + 'card{border:1px solid var(--line);border-radius:12px;padding:14px 16px;background:var(--glass-bg)}',
    '.' + NS + 'card h4{margin:0 0 10px;font-size:13.5px;display:flex;align-items:center;gap:7px}',
    '.' + NS + 'slot{border:1px solid var(--line);border-radius:12px;min-height:220px;padding:12px;background:var(--glass-bg)}',
    '.' + NS + 'table{width:100%;border-collapse:collapse;font-size:12px}',
    '.' + NS + 'table th{text-align:left;color:var(--text-secondary);font-weight:500;padding:7px 8px;border-bottom:1px solid var(--line);font-size:11px}',
    '.' + NS + 'table td{padding:7px 8px;border-bottom:1px dashed var(--line)}',
    '.' + NS + 'meter{height:7px;border-radius:99px;background:var(--line);overflow:hidden;min-width:60px}',
    '.' + NS + 'meter i{display:block;height:100%;border-radius:99px;background:var(--accent-text)}',
    '.' + NS + 'acts{display:flex;gap:7px;flex-wrap:wrap;margin-top:10px}',
    '.' + NS + 'btn{border:1px solid var(--line);background:var(--glass-bg);color:var(--text-primary);border-radius:8px;padding:6px 12px;font-size:11.5px;cursor:pointer;transition:.15s}',
    '.' + NS + 'btn:hover{border-color:var(--accent-text);color:var(--accent-text)}',
    '.' + NS + 'btn.pri{background:var(--accent-text);border-color:var(--accent-text);color:var(--btn-text,#fff)}',
    '.' + NS + 'field{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:9px 0;border-bottom:1px dashed var(--line);font-size:12px}',
    '.' + NS + 'field input{border:1px solid var(--line);border-radius:8px;background:var(--bg-muted,var(--glass-bg));color:var(--text-primary);padding:5px 9px;font-size:12px;width:90px}',
    '.' + NS + 'ic{display:inline-flex;width:15px;height:15px;vertical-align:-2px}',
    '.' + NS + 'ic svg{width:15px;height:15px;fill:none;stroke:currentColor;stroke-width:1.8}',
    '.' + NS + 'spark{display:flex;align-items:flex-end;gap:3px;height:34px;margin-top:8px}',
    '.' + NS + 'spark i{flex:1;background:var(--accent-text);opacity:.7;border-radius:2px 2px 0 0;min-height:2px}',
    '@media(max-width:820px){.' + NS + 'kpis{grid-template-columns:repeat(2,1fr)}}'
  ].join('\n')

  function style(ctx) {
    try { if (ctx && ctx.css && typeof ctx.css.add === 'function') ctx.css.add(CSS, 'skin') } catch (e) { }
  }

  /* ══════════════ 4. 视图 ══════════════ */

  function bar(series, field) {
    if (!series.length) return ''
    var vals = series.map(function (x) { return num(x[field]) })
    var max = Math.max.apply(null, vals.concat([0.01]))
    return '<div class="' + NS + 'spark">' + series.map(function (x) {
      return '<i style="height:' + Math.max(2, Math.round(num(x[field]) / max * 30)) + 'px" title="'
        + esc(x.day + ' · ' + fmtCount(x[field])) + '"></i>'
    }).join('') + '</div>'
  }

  function viewOverview(ctx, S) {
    var out = []
    var c = S.c
    out.push('<div class="' + NS + 'hero"><h3>' + I('dashboard', '存') + ' 存储体检</h3>'
      + '<p>与设置页「数据清理」区**同一份来源**：core/datamanage 统一面板。这里不另算占用，'
      + '只做只读体检与趋势记录 —— 两处数字必须永远一致。</p></div>')
    out.push('<div class="' + NS + 'kpis">'
      + [['条目总数', fmtCount(c.total)], ['拍题照片', fmtCount(c.photos)],
        ['错题', fmtCount(c.mistakes)], ['估算体积', fmtSize(S.bytes)]].map(function (x) {
        return '<div><b>' + esc(x[1]) + '</b><span>' + esc(x[0]) + '</span></div>'
      }).join('') + '</div>')
    out.push('<section class="' + NS + 'card"><h4>' + I('cpBrain', '判') + ' 体检结论</h4>'
      + S.advice.map(function (x) {
        return '<div class="' + NS + 'note ' + esc(x.level) + '"><div><b>' + esc(x.title) + '</b>' + esc(x.body) + '</div></div>'
      }).join('') + '</section>')
    out.push('<section class="' + NS + 'card"><div class="' + NS + 'card-hd" style="display:flex;justify-content:space-between;align-items:center">'
      + '<h4 style="margin:0">统一数据面板</h4><span class="' + NS + 'acts" style="margin:0">'
      + '<button class="' + NS + 'btn" data-act="record">记录此刻</button></span></div>'
      + '<div class="' + NS + 'slot" data-slot></div></section>')
    return out.join('')
  }

  function viewDetail(ctx, S) {
    var max = Math.max.apply(null, S.detail.map(function (x) { return x.bytes }).concat([1]))
    var out = []
    out.push('<section class="' + NS + 'card"><h4>集合明细（按估算体积排序）</h4>'
      + '<table class="' + NS + 'table"><thead><tr><th>集合</th><th>条数</th><th>估算体积</th><th>占比</th><th>说明</th></tr></thead><tbody>'
      + S.detail.map(function (x) {
        var pct = Math.round(x.bytes / max * 100)
        return '<tr><td>' + esc(x.t) + '</td><td>' + fmtCount(x.n) + '</td><td>' + fmtSize(x.bytes)
          + '</td><td><div class="' + NS + 'meter"><i style="width:' + pct + '%"></i></div></td><td>'
          + esc(trunc(x.note, 30)) + '</td></tr>'
      }).join('') + '</tbody></table>'
      + '<p class="' + NS + 'tip" style="margin-top:10px">体积按 UTF-16 粗估，只用来**找大头**；'
      + '精确占用以设置页数据区为准。删除前请确认云同步已完成。</p></section>')
    return out.join('')
  }

  function viewKeys(ctx, S) {
    var out = []
    var keys = S.ls
    out.push('<section class="' + NS + 'card"><h4>localStorage 顶层键（只读）</h4>'
      + '<p class="' + NS + 'tip">这里只列键名与估算体积，**不显示内容**（可能含个人信息）。'
      + '清理要走设置页的统一面板，本页不提供删除按钮。</p>'
      + (keys.length ? '<table class="' + NS + 'table"><thead><tr><th>键</th><th>估算体积</th></tr></thead><tbody>'
        + keys.slice(0, 60).map(function (x) {
          return '<tr><td>' + esc(trunc(x.k, 52)) + '</td><td>' + fmtSize(x.bytes) + '</td></tr>'
        }).join('') + '</tbody></table>' : '<p class="' + NS + 'tip">读不到 localStorage（隐私模式或沙箱限制）。</p>')
      + (keys.length > 60 ? '<p class="' + NS + 'tip">仅显示前 60 个键，共 ' + keys.length + ' 个。</p>' : '')
      + '</section>')
    return out.join('')
  }

  function viewHistory(ctx, S) {
    var out = []
    var dPhotos = deltaOf(S.hist, 'photos')
    var dBytes = deltaOf(S.hist, 'bytes')
    out.push('<section class="' + NS + 'card"><h4>本机快照趋势</h4>'
      + '<div class="' + NS + 'kpis" style="grid-template-columns:repeat(3,1fr)">'
      + '<div><b>' + S.hist.length + '</b><span>快照条数</span></div>'
      + '<div><b>' + (dPhotos == null ? '—' : (dPhotos > 0 ? '+' : '') + dPhotos) + '</b><span>照片日均变化</span></div>'
      + '<div><b>' + (dBytes == null ? '—' : (dBytes > 0 ? '+' : '') + fmtSize(dBytes)) + '</b><span>体积日均变化</span></div>'
      + '</div>'
      + bar(S.hist.slice(-14), 'bytes')
      + '</section>')
    out.push('<section class="' + NS + 'card"><div class="' + NS + 'card-hd" style="display:flex;justify-content:space-between;align-items:center">'
      + '<h4 style="margin:0">逐日快照</h4><span class="' + NS + 'acts" style="margin:0">'
      + '<button class="' + NS + 'btn" data-act="record-force">立即记录</button>'
      + '<button class="' + NS + 'btn" data-act="export-json">导出 JSON</button>'
      + '<button class="' + NS + 'btn" data-act="export-md">导出报告</button></span></div>'
      + (S.hist.length ? '<table class="' + NS + 'table"><thead><tr><th>日期</th><th>条目</th><th>照片</th><th>估算体积</th></tr></thead><tbody>'
        + S.hist.slice().reverse().slice(0, 60).map(function (x) {
          return '<tr><td>' + esc(x.day) + '</td><td>' + fmtCount(x.total) + '</td><td>'
            + fmtCount(x.photos) + '</td><td>' + fmtSize(x.bytes) + '</td></tr>'
        }).join('') + '</tbody></table>' : '<p class="' + NS + 'tip">还没有快照。每天自动记一条，也可以手动记。</p>')
      + '</section>')
    return out.join('')
  }

  function viewConfig(ctx, S) {
    var c = cfgGet(ctx)
    var out = []
    out.push('<section class="' + NS + 'card"><h4>体检阈值</h4>'
      + '<div class="' + NS + 'field"><label>照片数提醒阈值</label><input type="number" min="1" max="100000" value="' + c.warnAt + '" data-act="cfg-photos"></div>'
      + '<div class="' + NS + 'field"><label>错题数提醒阈值</label><input type="number" min="1" max="100000" value="' + c.warnMistakes + '" data-act="cfg-mistakes"></div>'
      + '<div class="' + NS + 'field"><label>每天自动记录快照</label>'
      + '<button class="' + NS + 'btn' + (c.autoRecord ? ' pri' : '') + '" data-act="cfg-auto">' + (c.autoRecord ? '已开启' : '已关闭') + '</button></div>'
      + '<p class="' + NS + 'tip" style="margin-top:10px">阈值只影响本页提醒文案，不改变任何清理行为。'
      + '真正的清理入口只有一处：设置 → 数据清理（与本页下方统一面板同源）。</p></section>')
    out.push('<section class="' + NS + 'card"><h4>隐私说明</h4><p class="' + NS + 'tip" style="margin:0">'
      + '本插件只保存**条数与体积**的逐日快照（最多 ' + MAX_HISTORY + ' 条），不保存任何条目标题、题干或图片内容。'
      + 'localStorage 扫描只列键名与长度，不读取内容到界面、不上传。</p></section>')
    return out.join('')
  }

  /** 清理决策：不同集合该用什么方式清 —— 这里只给**决策依据**，不提供第二个删除入口。
   * 用户看完这段应该知道"我该删什么、删之前要做什么"，而不是在统一面板上一通乱点。 */
  function viewGuide(ctx, S) {
    var out = []
    var cfg = S.cfg
    var rules = [
      { t: '拍题照片', k: 'mistakePhotos', why: '体积最大。删之前先确认 AI 解析已经存成文字，否则删了图就再也看不到原题。', how: '统一面板 → 按集合清理 → 勾"已掌握"的照片' },
      { t: '错题', k: 'mistakes', why: '条目小，但关联着复习计划。删掉等于抹掉复习历史。', how: '优先按科目归档；真要删先做云同步' },
      { t: '单词', k: 'vocab', why: '词卡通常带例句，量大但每条约几百字节。', how: '删已掌握词前确认不在当前背诵计划里' },
      { t: '任务', k: 'tasks', why: '含完成标记与排程。历史任务删了就无法复盘。', how: '只清超过 90 天的已完成任务' },
      { t: '作文', k: 'essays', why: '批改记录可能含 AI 长文本，体积容易被低估。', how: '先导出需要的，再按时间清' },
    ]
    out.push('<section class="' + NS + 'card"><h4>' + I('cpGear', '策') + ' 清理决策表</h4>'
      + '<p class="' + NS + 'tip">本页**没有删除按钮**（这是守恒契约）。'
      + '真正的清理只有一处：下方统一面板 / 设置 → 数据清理。这里只回答"该不该删"。</p>'
      + '<table class="' + NS + 'table"><thead><tr><th>集合</th><th>当前</th><th>为什么谨慎</th><th>建议在统一面板里</th></tr></thead><tbody>'
      + rules.map(function (r) {
        var hit = S.detail.filter(function (x) { return x.k === r.k })[0]
        return '<tr><td>' + esc(r.t) + '</td><td>' + (hit ? fmtCount(hit.n) : '—') + '</td><td>'
          + esc(r.why) + '</td><td>' + esc(r.how) + '</td></tr>'
      }).join('') + '</tbody></table></section>')
    out.push('<section class="' + NS + 'card"><h4>删之前必须做的三件事</h4>'
      + '<div class="' + NS + 'note warn"><div><b>1. 云同步</b>删除会走墓碑同步到其它设备。'
      + '确认设置里的云同步已经跑完，否则别的设备可能把删掉的东西又同步回来。</div></div>'
      + '<div class="' + NS + 'note warn"><div><b>2. 导出备份</b>用本页「趋势 → 导出 JSON」留一份快照。'
      + '快照只含条数与体积，不含内容 —— 真要备份内容请用设置页的导出功能。</div></div>'
      + '<div class="' + NS + 'note info"><div><b>3. 先删一小批</b>别一次清空最大的集合。'
      + '先删 10 条已掌握的，确认页面正常、数据没丢，再继续。</div></div>'
      + '</section>')
    out.push('<section class="' + NS + 'card"><h4>什么时候该清</h4>'
      + '<p class="' + NS + 'tip" style="margin:0">照片 ' + fmtCount(S.c.photos) + ' / 阈值 ' + fmtCount(cfg.warnAt)
      + '，错题 ' + fmtCount(S.c.mistakes) + ' / 阈值 ' + fmtCount(cfg.warnMistakes) + '。'
      + '阈值只决定本页提醒，**不是"到了就必须删"** —— 空间够用就不必动。</p></section>')
    return out.join('')
  }

  /** 术语表：清理工具里最容易误操作的就是"不懂词就点删除"。
   * 这一页把 localStorage / IndexedDB / 墓碑 / 云同步的关系讲清楚。 */
  function viewGlossary(ctx, S) {
    var out = []
    var terms = [
      ['localStorage', '浏览器里的键值存储，同步写入。设置、小状态、学习时长通常在这里。', '清了会丢本地配置；部分数据云同步能补回。'],
      ['IndexedDB', '浏览器里的结构化数据库，适合放大对象（照片 base64、大集合）。', '容量比 localStorage 大得多；清理要走统一面板按表清。'],
      ['Store 集合', '站内的数据集合（mistakes / vocab / tasks 等），可能落在 LS 或 IDB。', '设置页数据区会标注每条落在哪儿；本页只列条数。'],
      ['墓碑 (tombstone)', '删除标记。删一条不是真的消失，而是留个"删过"的记录同步到其它设备。', '直接清 localStorage 不留墓碑 → 其它设备会把数据同步回来。'],
      ['云同步', '把本机变更推到云端、从云端拉回其它设备的变更。', '删除前不同步 = 别处可能恢复；同步后再删才稳。'],
      ['估算体积', '本页按 UTF-16 粗算 JSON 长度，只用来"找大头"。', '不等于磁盘占用；精确值以设置页数据区为准。'],
    ]
    out.push('<section class="' + NS + 'card"><h4>' + I('cpBrain', '词') + ' 术语与风险</h4>'
      + '<table class="' + NS + 'table"><thead><tr><th>术语</th><th>是什么</th><th>清错了会怎样</th></tr></thead><tbody>'
      + terms.map(function (r) {
        return '<tr><td><b>' + esc(r[0]) + '</b></td><td>' + esc(r[1]) + '</td><td>' + esc(r[2]) + '</td></tr>'
      }).join('') + '</tbody></table></section>')
    out.push('<section class="' + NS + 'card"><h4>为什么本插件没有删除按钮</h4>'
      + '<div class="' + NS + 'note good"><div><b>一个事实只能有一个写入口</b>'
      + '设置页「数据清理」与统一面板共用 core/datamanage 的集合注册表与墓碑逻辑。'
      + '如果本插件再做一套删除，两处的口径迟早分叉 —— 用户会遇到"这里说删了、那里还在"。</div></div>'
      + '<p class="' + NS + 'tip" style="margin:0">所以本页只做只读体检、趋势记录和清理决策。'
      + '要动手，往下滚到统一面板，或去设置页。</p></section>')
    return out.join('')
  }

  /** FAQ：把"体检数字和设置页对不上""清理后别处又回来了"这类高频疑问写死。
   * 这不是装饰性帮助页 —— 每一条都对应一个真实会遇到的误判。 */
  function viewFAQ(ctx, S) {
    var faq = [
      ['这里说 200 张照片，设置页说 198 条，谁对？',
       '以设置页数据区为准。本页条数从 Store.get() 现读，若两次读取之间有人删了 Photo，' +
       '或设置页用了不同集合口径（比如排除了墓碑），就会出现 1-2 条的差。本页数字只用于判断量级。'],
      ['为什么体积只是"估算"？',
       '浏览器不提供某个 Store 集合的精确磁盘占用。本页用 JSON 序列化后的 UTF-16 长度粗估，' +
       '只够回答"哪个集合是大头"。精确数字要去设置页的 IndexedDB 统计。'],
      ['我在这里点了清理，为什么别的设备还有？',
       '本插件没有清理按钮（守恒契约）。如果你用的是设置页统一面板，删除会写墓碑同步；' +
       '但如果对方设备没联网、或先删那边又同步回来，数据会"复活"。删除后确认各设备同步完成。'],
      ['快照里存了我的题目内容吗？',
       '没有。快照只记日期、条目数、估算体积、照片数。本页的 localStorage 扫描只列键名与长度，' +
       '不把内容读进界面、不上传。'],
      ['阈值设小了会怎样？',
       '只影响本页的提醒文案（"照片偏多"之类），不触发任何自动清理。这个插件永远不会自动删东西。'],
      ['统一面板打不开，是不是数据丢了？',
       '不是。core/datamanage 晚加载或离线时面板会显示降级说明，上面的速览仍直接读 Store。' +
       '刷新后重试；仍不行说明构建里缺那个模块，数据本身还在本机。'],
      ['为什么故意不做面板（panel）？',
       '历史教训：加面板会让用户以为存在两套清理口径。清理必须只有设置页一个入口，' +
       '所以本插件注册了工具页与查询，但**没有 panels**（有测试钉住这条）。'],
    ]
    var out = []
    out.push('<section class="' + NS + 'card"><h4>' + I('cpChat', '问') + ' 常见问题</h4>'
      + faq.map(function (x, i) {
        return '<details style="padding:8px 0;border-bottom:1px dashed var(--line)">'
          + '<summary style="cursor:pointer;font-size:12.5px">' + (i + 1) + '. ' + esc(x[0]) + '</summary>'
          + '<p style="font-size:12px;line-height:1.8;color:var(--text-secondary);margin:8px 0 0">' + esc(x[1]) + '</p></details>'
      }).join('') + '</section>')
    out.push('<section class="' + NS + 'card"><h4>本页的能力边界</h4>'
      + '<div class="' + NS + 'note good"><div><b>只读体检 + 本机趋势 + 导出报告</b>'
      + '不做：清理、修改 Store、上传、自动删除。'
      + '需要动手时只有一条路：设置 → 数据清理，或本页总览下方的统一面板（同一个东西）。</div></div></section>')
    return out.join('')
  }


var VIEWS = [
    { k: 'overview', t: '总览', f: viewOverview },
    { k: 'detail', t: '集合明细', f: viewDetail },
    { k: 'keys', t: '顶层键', f: viewKeys },
    { k: 'history', t: '趋势', f: viewHistory },
    { k: 'config', t: '设置', f: viewConfig },
    { k: 'guide', t: '清理决策', f: viewGuide },
    { k: 'terms', t: '术语', f: viewGlossary },
    { k: 'faq', t: 'FAQ', f: viewFAQ },
  ]

  /* ══════════════ 5. Shell ══════════════ */

  function stateOf(ctx) {
    var cfg = cfgGet(ctx)
    var c = counts(ctx)
    var d = detailOf(ctx)
    var hist = historyGet(ctx)
    var v = 'overview'
    try { if (ctx && ctx.keep && typeof ctx.keep.get === 'function') v = ctx.keep.get(K_LAST_VIEW) || v } catch (e) { }
    return {
      cfg: cfg, c: c, detail: d, ls: lsScan(), hist: hist,
      bytes: d.reduce(function (a, x) { return a + x.bytes }, 0),
      advice: advise(c, cfg),
      view: VIEWS.some(function (x) { return x.k === v }) ? v : 'overview',
    }
  }

  function reportMD(ctx, S) {
    var lines = []
    lines.push('# 存储体检报告')
    lines.push('')
    lines.push('> 生成：' + new Date().toLocaleString())
    lines.push('')
    lines.push('> ⚠ 体积为 UTF-16 粗估，只用于排序找大头；精确占用以设置页数据区为准。')
    lines.push('')
    lines.push('## 结论')
    lines.push('')
    S.advice.forEach(function (x) { lines.push('- **' + x.title + '**：' + x.body) })
    lines.push('')
    lines.push('## 集合明细')
    lines.push('')
    lines.push('| 集合 | 条数 | 估算体积 |')
    lines.push('|---|---|---|')
    S.detail.forEach(function (x) { lines.push('| ' + x.t + ' | ' + fmtCount(x.n) + ' | ' + fmtSize(x.bytes) + ' |') })
    lines.push('')
    lines.push('## 逐日快照')
    lines.push('')
    lines.push('| 日期 | 条目 | 照片 | 估算体积 |')
    lines.push('|---|---|---|---|')
    S.hist.slice().reverse().forEach(function (x) {
      lines.push('| ' + x.day + ' | ' + fmtCount(x.total) + ' | ' + fmtCount(x.photos) + ' | ' + fmtSize(x.bytes) + ' |')
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
    if (act === 'record' || act === 'record-force') {
      S.hist = recordToday(ctx, act === 'record-force')
      toast(ctx, '已记录本机快照', 'success')
      render(root, ctx, S)
      return
    }
    if (act === 'export-json') {
      try {
        ctx.api.download('存储体检_' + dkey() + '.json', JSON.stringify({ history: S.hist, detail: S.detail, counts: S.c }, null, 2), 'application/json')
        toast(ctx, '已导出', 'success')
      } catch (e) { toast(ctx, '导出失败：' + ((e && e.message) || e), 'danger') }
      return
    }
    if (act === 'export-md') {
      try {
        ctx.api.download('存储体检_报告_' + dkey() + '.md', reportMD(ctx, S), 'text/markdown;charset=utf-8')
        toast(ctx, '报告已导出', 'success')
      } catch (e) { toast(ctx, '导出失败：' + ((e && e.message) || e), 'danger') }
      return
    }
    if (act === 'cfg-auto') {
      var c = cfgGet(ctx)
      cfgSet(ctx, { autoRecord: !c.autoRecord })
      render(root, ctx, S)
      return
    }
  }

  function mountSlot(root, ctx, S) {
    var slot = root.querySelector('[data-slot]')
    if (!slot) return
    var mounted = false
    try {
      if (window.DataManage && typeof window.DataManage.mountPanel === 'function') {
        window.DataManage.mountPanel(slot, {})
        mounted = true
      }
    } catch (e) { mounted = false }
    if (!mounted) {
      /* 降级页必须 >200 字符且可用 —— 这是 v2.1 就立下的契约，别缩回去 */
      slot.innerHTML = '<div class="card"><div class="card-title">统一数据面板暂不可用</div>'
        + '<p class="muted-sm">core/datamanage 还没加载。上面的速览直接读本机 Store，仍然准确；'
        + '需要清理时请到「设置 → 数据清理」，那里与本插件共用同一套集合注册表。'
        + '常见原因：页面刚刷新尚未完成水合，或当前处于离线状态。刷新后重试即可。</p>'
        + '<p class="muted-sm">若刷新后仍不可用，说明数据管理模块未随构建产出 —— 这不代表数据丢失，'
        + '本机内容仍在本地存储中，只是这里暂时看不到统一面板。</p></div>'
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
    try { body = cur.f(ctx, S) } catch (e) { body = '<div class="' + NS + 'tip">这个视图渲染失败了：' + esc((e && e.message) || e) + '</div>' }
    root.innerHTML = '<div class="' + NS + 'page">' + header + body + '</div>'
    if (S.view === 'overview') mountSlot(root, ctx, S)
  }

  function mount(el, ctx) {
    style(ctx)
    var S = stateOf(ctx)
    if (S.cfg.autoRecord) recordToday(ctx, false)
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
      if (act === 'cfg-photos') cfgSet(ctx, { warnAt: clamp(t.value, 1, 100000, 200) })
      else if (act === 'cfg-mistakes') cfgSet(ctx, { warnMistakes: clamp(t.value, 1, 100000, 500) })
    }
    el.addEventListener('click', onClick)
    el.addEventListener('change', onChange)
    return function () {
      el.removeEventListener('click', onClick)
      el.removeEventListener('change', onChange)
      el.innerHTML = ''
    }
  }

  /* ══════════════ 6. 注册（★ 故意没有 panels） ══════════════ */

  var api = {
    id: PID,
    name: '存储体检',
    version: VERSION,
    author: '内置',
    desc: 'localStorage / Store 集合只读体检：风险分级、集合明细、顶层键扫描、逐日快照与报告导出。清理口径始终只有一个 —— 设置页的统一面板。',
    tools: [{ id: 'storage-doctor-page', title: '存储体检', icon: '' + I('dashboard', '存') + '', mount: function (el, ctx) { return mount(el, ctx) } }],
    /* ★ 故意没有 panels：见文件头守恒契约与 plugincenter-migration 的断言。 */
    config: [{ key: 'warnAt', label: '照片数提醒阈值', type: 'number', default: 200 }],
    shortcuts: [{ key: 'alt+shift+d', label: '打开存储体检', run: function (ctx) { try { ctx.api.goTool('storage-doctor-page') } catch (e) { } } }],
    queries: [
      {
        key: 'sd-counts', label: '本机数据量',
        run: function (ctx) {
          var c = counts(ctx)
          return '本机当前：错题 ' + c.mistakes + ' 条、单词 ' + c.words + ' 个、任务 ' + c.tasks + ' 项、作文 '
            + c.essays + ' 篇、照片 ' + c.photos + ' 张。清理入口在设置的数据区。'
        }
      },
      {
        key: 'sd-advice', label: '存储清理建议',
        run: function (ctx) {
          return '存储建议：' + advise(counts(ctx), cfgGet(ctx)).map(function (x) { return x.title + '——' + x.body }).join(' ')
        }
      },
      { key: 'sd-trend', label: '数据量变化趋势', run: function (ctx) {
        var h = historyGet(ctx)
        if (h.length < 4) return '快照只有 ' + h.length + ' 条，还不足以判断数据增长趋势。'
        var d = deltaOf(h, 'total')
        if (d == null) return '快照不足，无法判断趋势。'
        return '本机条目总数近 7 天日均' + (d >= 0 ? '增加 ' : '减少 ') + Math.abs(d)
          + '（对比前 7 天）。照片日均 ' + (deltaOf(h, 'photos') || 0) + '。'
      } },
      { key: 'sd-clean', label: '清理前该做什么', run: function (ctx) {
        return '清理前按顺序做三件事：1）确认云同步已完成（删除会走墓碑同步到其它设备）；'
          + '2）需要的内容先导出备份；3）先小批量删 10 条确认正常再继续。'
          + '清理入口只有一处：设置 → 数据清理（存储体检页下方统一面板同源）。'
      } },
      { key: 'sd-source', label: '体检数字的来源', run: function (ctx) {
        return '存储体检的所有当前值都现读 Store.get() 与 localStorage，**不缓存**：'
          + '集合条目数按数组长度或对象键数计；体积按 UTF-16 粗估，只用于排序找大头。'
          + '精确占用以设置页数据区为准。插件只存条数/体积的逐日快照，不存任何条目标题或内容。'
      } },
      { key: 'sd-heavy', label: '占空间最大的集合', run: function (ctx) {
        var d = detailOf(ctx)
        return '按估算体积排序，前三类：' + d.slice(0, 3).map(function (x) {
          return x.t + ' ' + fmtSize(x.bytes)
        }).join('、') + '。（估算值，只用于找大头；精确占用以设置页为准。）'
      } },
    ],
    memory: '用户装有「存储体检」插件，用于只读查看本机数据量、集合明细、增长趋势与清理建议；口径与设置页数据区完全同源。'
      + '用户提到「占空间」「清理缓存」「存储满了」时，引导到设置的数据清理区。'
      + '可查 sd-counts / sd-advice / sd-trend / sd-heavy；注意本插件**不提供第二个清理入口**。',
  }

  if (typeof window !== 'undefined' && window.__SD_DEBUG__) {
    window.__sdInternals = {
      esc: esc, num: num, clamp: clamp, flat: flat, trunc: trunc, dkey: dkey, shiftDay: shiftDay,
      counts: counts, detailOf: detailOf, lsScan: lsScan, advise: advise, fmtSize: fmtSize,
      historyGet: historyGet, historySave: historySave, recordToday: recordToday, deltaOf: deltaOf,
      reportMD: reportMD, mount: mount, VIEWS: VIEWS, COLLECTIONS: COLLECTIONS,
    }
  }

  PluginBus.register(api)
})()
