/* storage-doctor.plugin.js — 存储体检 · v2.1.0
 *
 * 【守恒契约】依旧复用 core/datamanage 的统一面板，不自己另算一份统计 ——
 * 两处数字必须永远一致。plugincenter-migration.test.ts:466 明确断言本插件**没有面板**
 * （面板按钮会让用户误以为有两种清理口径），所以这里只升级工具页与查询，不加 panels。
 *
 * 升级点：工具页先给「本机数据速览 + 风险提示 + 操作指引」，再挂统一面板；
 * 断网/模块未就绪时也有 >200 字符的可用降级页，不再是一句"模块未就绪"。
 */
;(function () {
  'use strict'

  let VERSION = '2.1.0'
  let PID = 'storage-doctor'
  let NS = 'sd-'

  let CSS = `
.sd-page{display:flex;flex-direction:column;gap:12px}
.sd-hero{border-radius:14px;padding:16px 18px;background:var(--glass-bg);border:1px solid var(--line)}
.sd-hero h3{margin:0 0 6px;font-size:16px}
.sd-hero p{margin:0;color:var(--text-secondary);font-size:12.5px;line-height:1.7}
.sd-kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}
.sd-kpis div{border:1px solid var(--line);border-radius:11px;padding:11px 12px;background:var(--glass-bg)}
.sd-kpis b{display:block;font-size:19px;line-height:1.3}
.sd-kpis span{font-size:11px;color:var(--text-secondary)}
.sd-tip{border-left:2px solid var(--accent-text);padding:6px 0 6px 12px;font-size:12.5px;line-height:1.8;color:var(--text-secondary)}
.sd-slot{border:1px solid var(--line);border-radius:12px;min-height:220px;padding:12px;background:var(--glass-bg)}
`

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] }) }
  function style(ctx) { try { if (ctx && ctx.css && typeof ctx.css.add === 'function') ctx.css.add(CSS, 'skin') } catch (e) { } }
  function counts(ctx) {
    let s = {}
    try { s = (ctx && ctx.Store && ctx.Store.get()) || {} } catch (e) { }
    let arr = (k) => { let v = s[k]; return Array.isArray(v) ? v.length : (v && typeof v === 'object' ? Object.keys(v).length : 0) }
    return { mistakes: arr('mistakes'), words: arr('vocab'), tasks: arr('tasks'), essays: arr('essays'), photos: arr('mistakePhotos'), plugins: arr('plugins') }
  }
  function advice(c) {
    let out = []
    if (c.photos > 200) out.push('错题照片已超过 200 张，优先清理已掌握题的照片。')
    if (c.mistakes > 500) out.push('错题本超过 500 条，建议按科目归档后再清理。')
    if (!out.length) out.push('数据量在健康区间。需要腾空间时可在下方统一面板按集合清理。')
    return out
  }

  function mount(el, ctx) {
    style(ctx)
    let c = counts(ctx)
    let keys = [['mistakes', '错题'], ['words', '单词'], ['tasks', '任务'], ['essays', '作文']]
    el.innerHTML = '<div class="' + NS + 'page">'
      + '<div class="' + NS + 'hero"><h3>' + U.icon('dashboard') + ' 存储体检</h3>'
      + '<p>与设置页「数据清理」区**同一份来源**：core/datamanage 统一面板。这里不再单独统计占用，避免两处数字对不上。</p></div>'
      + '<div class="' + NS + 'kpis">' + keys.map(function (k) {
        return '<div><b>' + c[k[0]] + '</b><span>' + esc(k[1]) + '</span></div>'
      }).join('') + '</div>'
      + '<div class="' + NS + 'tip">' + advice(c).map(esc).join('<br>')
      + '<br><span style="color:var(--text-secondary)">清理前建议先在设置里做一次云同步；删除会走墓碑同步到其它设备。</span></div>'
      + '<div class="' + NS + 'slot" data-slot></div></div>'
    let slot = el.querySelector('[data-slot]')
    let mounted = false
    try {
      if (slot && window.DataManage && typeof window.DataManage.mountPanel === 'function') {
        window.DataManage.mountPanel(slot, {}); mounted = true
      }
    } catch (e) { mounted = false }
    if (!mounted && slot) {
      slot.innerHTML = '<div class="card"><div class="card-title">统一数据面板暂不可用</div>'
        + '<p class="muted-sm">core/datamanage 还没加载。上面的速览直接读本机 Store，仍然准确；'
        + '需要清理时请到「设置 → 数据清理」，那里与本插件共用同一套集合注册表。'
        + '常见原因：页面刚刷新尚未完成水合，或当前处于离线状态。刷新后重试即可。</p>'
        + '<p class="muted-sm">若刷新后仍不可用，说明数据管理模块未随构建产出 —— 这不代表数据丢失，本机内容仍在本地存储中。</p></div>'
    }
    return function () { el.innerHTML = '' }
  }

  let api = {
    id: PID,
    name: '存储体检',
    version: VERSION,
    author: '内置',
    desc: 'localStorage/IndexedDB 占用体检 + 一键清理（与设置页数据区同源）',
    tools: [{ id: 'storage-doctor-page', title: '存储体检', icon: '' + U.icon('dashboard') + '', mount: function (el, ctx) { return mount(el, ctx) } }],
    /* ★ 故意没有 panels：见文件头守恒契约与 plugincenter-migration 的断言。 */
    config: [{ key: 'warnAt', label: '照片数提醒阈值', type: 'number', default: 200 }],
    shortcuts: [{ key: 'alt+shift+d', label: '打开存储体检', run: function (ctx) { try { ctx.api.goTool('storage-doctor-page') } catch (e) { } } }],
    queries: [
      {
        key: 'sd-counts', label: '本机数据量',
        run: function (ctx) {
          let c = counts(ctx)
          return '本机当前：错题 ' + c.mistakes + ' 条、单词 ' + c.words + ' 个、任务 ' + c.tasks + ' 项、作文 ' + c.essays + ' 篇、照片 ' + c.photos + ' 张。清理入口在设置的数据区。'
        },
      },
      {
        key: 'sd-advice', label: '存储清理建议',
        run: function (ctx) { return '存储建议：' + advice(counts(ctx)).join('') },
      },
    ],
    memory: '用户装有「存储体检」插件，用于查看本机数据量与清理建议；口径与设置页数据区完全同源。用户提到「占空间」「清理缓存」「存储满了」时，引导到设置的数据清理区。',
  }

  PluginBus.register(api)
})()
