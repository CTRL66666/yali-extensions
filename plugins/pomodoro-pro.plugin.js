/* 计时核心放 register 之前的顶层闭包：hooks/panels/tools 直接共享，不靠事件绕圈。 */
let PK = 'kaoyan_pomo_state', PS = 'kaoyan_pomo_stats';
let PMODE = { focus: '专注', short: '短休', long: '长休' };
function pLoad() { try { return JSON.parse(localStorage.getItem(PK) || 'null') || { mode: 'idle', endAt: 0, remain: 0, round: 1 }; } catch (e) { return { mode: 'idle', endAt: 0, remain: 0, round: 1 }; } }
function pSave(st) { try { localStorage.setItem(PK, JSON.stringify(st)); } catch (e) { } }
function pStats() {
  let d = new Date(); let day = d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
  let s = {}; try { s = JSON.parse(localStorage.getItem(PS) || 'null') || {}; } catch (e) { }
  if (!s.day || s.day !== day) s = { day: day, focusN: 0, focusMin: 0 };
  return s;
}
function pSaveStats(x) { try { localStorage.setItem(PS, JSON.stringify(x)); } catch (e) { } }
function pDur(cfg, mode) {
  if (mode === 'focus') return (Number(cfg('focusMin')) || 25) * 60;
  if (mode === 'short') return (Number(cfg('shortMin')) || 5) * 60;
  return (Number(cfg('longMin')) || 15) * 60;
}
function pFmt(sec) { let m = Math.floor(sec / 60), s2 = sec % 60; return (m < 10 ? '0' : '') + m + ':' + (s2 < 10 ? '0' : '') + s2; }
function pRemain(st) { return st.mode === 'idle' ? 0 : (st.endAt > 0 ? Math.max(0, Math.round((st.endAt - Date.now()) / 1000)) : Math.max(0, st.remain || 0)); }
function pBeep(soundOn) {
  if (!soundOn) return;
  try {
    let AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    let ac = new AC(); [0, 0.28, 0.56].forEach(function (t) {
      let o = ac.createOscillator(), g = ac.createGain();
      o.connect(g); g.connect(ac.destination); o.frequency.value = 880; o.type = 'sine';
      g.gain.setValueAtTime(0.12, ac.currentTime + t); g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + t + 0.22);
      o.start(ac.currentTime + t); o.stop(ac.currentTime + t + 0.24);
    });
  } catch (e) { }
}
function pRefresh(cfg) {
  let st = pLoad(); let left = pRemain(st);
  document.querySelectorAll('[data-pomo-clock]').forEach(function (el) { el.textContent = st.mode === 'idle' ? pFmt(pDur(cfg, 'focus')) : pFmt(left); });
  document.querySelectorAll('[data-pomo-mode]').forEach(function (el) { el.textContent = st.mode === 'idle' ? '未开始 · 建议先专注 25 分钟' : PMODE[st.mode] + ' · 第 ' + st.round + ' 轮'; });
  let s2 = pStats();
  document.querySelectorAll('[data-pomo-stat]').forEach(function (el) { el.textContent = '今日 🍅 ' + (s2.focusN || 0) + ' 个 · 专注 ' + (s2.focusMin || 0) + ' 分钟'; });
}
PluginBus.register({
  id: 'pomodoro-pro', name: '番茄钟计时器 Pro', version: '1.2', author: '内置',
  desc: '专注/短休/长休状态机 + 浮窗 + 统计 + 提示音',
  config: [
    { key: 'focusMin', label: '专注时长（分钟）', type: 'number', default: 25 },
    { key: 'shortMin', label: '短休时长（分钟）', type: 'number', default: 5 },
    { key: 'longMin', label: '长休时长（分钟）', type: 'number', default: 15 },
    { key: 'rounds', label: '几轮后长休', type: 'number', default: 4 },
    { key: 'autoRun', label: '一段结束自动开始下一段', type: 'bool', default: true },
    { key: 'sound', label: '完成提示音', type: 'bool', default: true }
  ],
  init: function (ctx) {
    let finGuard = 0;
    function finish(st) {
      let done = st.mode;
      if (done === 'focus') {
      let x = pStats(); x.focusN += 1; x.focusMin += Math.round(pDur(ctx.config, 'focus') / 60); pSaveStats(x);
      }
      pBeep(ctx.config('sound'));
      ctx.Toast.show(done === 'focus' ? ('🍅 专注 ' + Math.round(pDur(ctx.config, 'focus') / 60) + ' 分钟完成！休息一下') : '休息结束，回来继续专注', 'success', 5000);
      ctx.log('番茄钟：' + PMODE[done] + ' 完成');
      try { PluginBus.emit('pomodoro:done', { mode: done, mins: Math.round(pDur(ctx.config, done) / 60), _silent: true }); } catch (e) { }
      let next = done === 'focus' ? (st.round % (Number(ctx.config('rounds')) || 4) === 0 ? 'long' : 'short') : 'focus';
      let round = done === 'focus' ? st.round + 1 : st.round;
      pSave({ mode: next, endAt: 0, remain: pDur(ctx.config, next), round: round });
      if (ctx.config('autoRun')) pStart();
      pRefresh(ctx.config);
    }
    function pStart() {
      let st = pLoad();
      if (st.mode === 'idle') st = { mode: 'focus', endAt: 0, remain: pDur(ctx.config, 'focus'), round: 1 };
      if (!st.endAt) st.endAt = Date.now() + (st.remain || pDur(ctx.config, st.mode)) * 1000;
      pSave(st); pRefresh(ctx.config);
    }
    function pPause() { let st = pLoad(); if (st.mode === 'idle' || !st.endAt) return; st.remain = Math.max(0, Math.round((st.endAt - Date.now()) / 1000)); st.endAt = 0; pSave(st); pRefresh(ctx.config); }
    function pReset() { pSave({ mode: 'idle', endAt: 0, remain: 0, round: 1 }); pRefresh(ctx.config); }
    function pSkip() { let st = pLoad(); if (st.mode === 'idle') return; st.endAt = Date.now() - 1; pSave(st); finish(st); }
    window.PomoPro = { start: pStart, pause: pPause, skip: pSkip, reset: pReset, refresh: function () { pRefresh(ctx.config); } };
    if (window.__pomoTimer) clearInterval(window.__pomoTimer);
    window.__pomoTimer = setInterval(function () {
      let st = pLoad();
      if (st.mode !== 'idle' && st.endAt && Date.now() >= st.endAt) {
        if (Date.now() - finGuard > 1500) { finGuard = Date.now(); finish(st); return; }
      }
      pRefresh(ctx.config);
    }, 1000);
    pRefresh(ctx.config);
  },
  panels: [{ id: 'pomodoro-mini', title: '番茄钟', icon: 'clock',
    render: function (ctx, box) {
      box.innerHTML = '<div style=\'text-align:center;padding:4px 0 8px\'>'
        + '<div data-pomo-mode class=\'muted-sm\' style=\'font-size:11.5px\'></div>'
        + '<div data-pomo-clock style=\'font-size:44px;font-weight:500;font-variant-numeric:tabular-nums;line-height:1.2\'></div>'
        + '<div style=\'display:flex;gap:8px;justify-content:center;margin-top:6px\'>'
        + '<button class=\'btn btn-sm btn-primary\' data-pomo-act=\'start\'>开始</button>'
        + '<button class=\'btn btn-sm btn-ghost\' data-pomo-act=\'pause\'>暂停</button>'
        + '<button class=\'btn btn-sm btn-ghost\' data-pomo-act=\'skip\'>跳过</button>'
        + '</div>'
        + '<div data-pomo-stat class=\'muted-sm\' style=\'margin-top:8px;font-size:11.5px\'></div>'
        + '</div>';
      box.querySelectorAll('[data-pomo-act]').forEach(function (b) {
        b.onclick = function () { let C = window.PomoPro || {}; let a = b.getAttribute('data-pomo-act'); if (C[a]) C[a](); };
      });
      pRefresh(ctx.config);
    } }],
  hooks: {
    'pomodoro:done': function (ctx, p) { ctx.data('doneTotal', (ctx.data('doneTotal') || 0) + 1); }
  },
  tools: [{ id: 'pomodoro-pro', title: '番茄钟', icon: 'clock',
    render: function (ctx) {
      return '<div class=\'card\' style=\'text-align:center\'>'
        + '<div data-pomo-mode class=\'muted-sm\'></div>'
        + '<div data-pomo-clock style=\'font-size:64px;font-weight:500;font-variant-numeric:tabular-nums;line-height:1.15\'></div>'
        + '<div style=\'display:flex;gap:8px;justify-content:center;flex-wrap:wrap\'>'
        + '<button class=\'btn btn-primary\' data-pomo-act=\'start\'>▶ 开始专注</button>'
        + '<button class=\'btn btn-ghost\' data-pomo-act=\'pause\'>⏸ 暂停</button>'
        + '<button class=\'btn btn-ghost\' data-pomo-act=\'skip\'>⏭ 跳过</button>'
        + '<button class=\'btn btn-ghost\' data-pomo-act=\'reset\'>↺ 重置</button>'
        + '</div>'
        + '<div data-pomo-stat class=\'muted-sm\' style=\'margin-top:14px\'></div>'
        + '<div class=\'muted-sm\' style=\'margin-top:6px;font-size:11.5px\'>时长在插件中心「配置」里调；默认一段结束自动进入下一段（可关）。每收一段广播 pomodoro:done 事件，其他插件可接。</div>'
        + '</div>';
    },
    mount: function (el, ctx) {
      el.querySelectorAll('[data-pomo-act]').forEach(function (b) {
        b.onclick = function () { let C = window.PomoPro || {}; let a = b.getAttribute('data-pomo-act'); if (C[a]) C[a](); };
      });
      pRefresh(ctx.config);
    } }],
    /* 【2026-11-22 边缘升级】只补能力面，状态机/init/panels/tools/hooks 一字未动。
     * newtab-2026-10-07.test.ts 深度重放本文件（start/pause/skip/finish 与 DOM 元素），
     * 因此这里不碰任何既有函数，也不注入新的全局监听。 */
    queries: [
      { key: 'pp-today', label: '今日番茄统计', run: function (ctx) {
        let x = pStats()
        return '今天完成 ' + (x.focusN || 0) + ' 个番茄，累计专注 ' + (x.focusMin || 0) + ' 分钟。'
      } },
      { key: 'pp-state', label: '当前计时状态', run: function (ctx) {
        let st = pLoad()
        if (st.mode === 'idle') return '番茄钟当前未开始。'
        let min = Math.ceil(pRemain(st) / 60)
        return '番茄钟当前是' + PMODE[st.mode] + '，第 ' + st.round + ' 轮，约剩 ' + min + ' 分钟。'
      } },
    ],
    shortcuts: [{ key: 'alt+shift+p', label: '打开番茄钟', run: function (ctx) {
      try { ctx.api.goTool('pomodoro-pro') } catch (e) { }
    } }],
    memory: '用户装有「番茄钟计时器 Pro」历史插件：专注/短休/长休状态机、今日番茄统计、完成广播。用户问「今天专注了多久」「番茄钟状态」时查它。',
  onDisable: function () { if (window.__pomoTimer) { clearInterval(window.__pomoTimer); window.__pomoTimer = 0; } },
});