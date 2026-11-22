/* countdown-desk.plugin.js — 倒计时桌面 · v1.3.0（已下架件，保持兼容不再上架）
 *
 * 原版 26 行：一个 render + 一条 20:00 提醒。补齐现代能力面：面板 / 查询 / 快捷键 /
 * 作用域样式 / 打开次数统计的可读展示。原 timer 的 at 与文案、config.remindAt、ctx.data('hits') 全部保留。
 */
;(function () {
  'use strict'

  let VERSION = '1.3.0'
  let PID = 'countdown-desk'
  let NS = 'cd-'
  let CSS = `
.cd-page{display:flex;flex-direction:column;gap:11px}
.cd-hero{border-radius:14px;padding:18px;background:var(--glass-bg);border:1px solid var(--line);text-align:center}
.cd-days{font-size:54px;font-weight:500;color:var(--danger);line-height:1.15}
.cd-sub{font-size:12px;color:var(--text-secondary)}
.cd-bar{height:8px;border-radius:8px;background:var(--chart-track);overflow:hidden;max-width:280px;margin:12px auto}
.cd-bar i{display:block;height:100%;background:var(--ok);border-radius:8px}
.cd-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:9px}
.cd-grid div{border:1px solid var(--line);border-radius:10px;padding:11px;text-align:center;background:var(--glass-bg)}
.cd-grid b{display:block;font-size:18px}
.cd-grid span{font-size:11px;color:var(--text-secondary)}
.cd-panel{display:flex;flex-direction:column;gap:6px;font-size:12px;text-align:center}
`
  function style(ctx) { try { if (ctx && ctx.css && typeof ctx.css.add === 'function') ctx.css.add(CSS, 'skin') } catch (e) { } }
  function snap(ctx) {
    let s = {}
    try { s = (ctx && ctx.Store && ctx.Store.get()) || {} } catch (e) { }
    let left = 0
    try { left = (ctx && ctx.U && typeof ctx.U.daysTo === 'function') ? ctx.U.daysTo((s.settings || {}).examDate) : 0 } catch (e) { }
    let st = {}
    try { st = (ctx && ctx.Store && typeof ctx.Store.todayTaskStats === 'function') ? ctx.Store.todayTaskStats() : {} } catch (e) { }
    let done = 0, total = 0
    Object.keys(st || {}).forEach(function (k) { done += st[k][0] || 0; total += st[k][1] || 0 })
    let hits = 0
    try { hits = Number((ctx && typeof ctx.data === 'function' && ctx.data('hits')) || 0) || 0 } catch (e) { }
    return { left: left, done: done, total: total, pct: total ? Math.round(done / total * 100) : 0, hits: hits }
  }
  function panel(ctx) {
    style(ctx)
    let d = snap(ctx)
    return '<div class="' + NS + 'panel"><div style="display:flex;justify-content:space-between">'
      + '<span>' + U.icon('hourglass') + ' 倒计时桌面</span><span class="cd-sub">今日 ' + d.done + '/' + d.total + '</span></div>'
      + '<div class="' + NS + 'days" style="font-size:32px">' + d.left + '</div>'
      + '<div class="cd-sub">距考研还有 ' + d.left + ' 天</div>'
      + '<button class="btn btn-sm btn-ghost">打开倒计时桌面</button></div>'
  }

  let api = {
    id: PID,
    name: '倒计时桌面',
    version: VERSION,
    author: '内置',
    desc: '大号倒计时 + 今日进度 + 每日复盘提醒（历史下架件，已安装用户仍可继续用）',
    config: [{ key: 'remindAt', label: '复盘提醒时刻', type: 'text', default: '20:00', desc: 'HH:MM 格式' }],
    /* ★ 原 timer 的 at 与文案一字不改 */
    timers: [{ at: '20:00', label: '晚间复盘提醒', run: function (ctx) {
      let at = ctx.config('remindAt') || '20:00';
      ctx.Toast.show('' + U.icon('clock') + ' 到点复盘啦（' + at + '）——点开教练说「复盘」', 'info', 6000);
      ctx.log('晚间提醒已触发');
    } }],
    tools: [{ id: 'countdown-desk', title: '倒计时桌面', icon: '' + U.icon('hourglass') + '',
      render: function (ctx) {
        let d = snap(ctx)
        return '<div class="' + NS + 'page"><div class="' + NS + 'hero"><div class="' + NS + 'days">' + d.left + '</div>'
          + '<div class="' + NS + 'sub">距考研还有 ' + d.left + ' 天 · 今日 ' + d.done + '/' + d.total + '（' + d.pct + '%）</div>'
          + '<div class="' + NS + 'bar"><i style="width:' + d.pct + '%"></i></div>'
          + '<div class="' + NS + 'sub" style="margin-top:8px">本工具页累计打开 ' + (d.hits + 1) + ' 次（插件数据命名空间）</div></div>'
          + '<div class="' + NS + 'grid"><div><b>' + d.left + '</b><span>剩余天数</span></div>'
          + '<div><b>' + d.done + '/' + d.total + '</b><span>今日任务</span></div>'
          + '<div><b>' + d.hits + '</b><span>打开次数</span></div></div></div>'
      },
      mount: function (el, ctx) {
        style(ctx)
        /* ★ 原 hits 计数语义不变：挂载一次 +1 */
        ctx.data('hits', (ctx.data('hits') || 0) + 1)
        ctx.log('工具页已挂载，累计打开 ' + (ctx.data('hits') || 0) + ' 次')
        let d = snap(ctx)
        Array.prototype.forEach.call(el.querySelectorAll('[data-act]'), function (b) {
          b.onclick = function () { try { ctx.api.go(b.getAttribute('data-act')) } catch (e) { } }
        })
        return function () { el.innerHTML = '' }
      } }],
    panels: [{ id: 'cd-today', title: '倒计时桌面', icon: '' + U.icon('hourglass') + '', width: 280, height: 190, render: panel }],
    shortcuts: [{ key: 'alt+c', label: '打开倒计时桌面', run: function (ctx) { try { ctx.api.goTool('countdown-desk') } catch (e) { } } }],
    queries: [
      { key: 'cd-left', label: '距考研还有几天', run: function (ctx) {
        let d = snap(ctx)
        return '距考研还有 ' + d.left + ' 天；今日任务完成 ' + d.done + '/' + d.total + '。复盘提醒设在 ' + (ctx.config('remindAt') || '20:00') + '。'
      } },
    ],
    memory: '用户装有「倒计时桌面」历史插件：大号倒计时、今日进度与晚间复盘提醒。用户问「还有几天考研」时可直接回答。',
  }

  PluginBus.register(api)
})()
