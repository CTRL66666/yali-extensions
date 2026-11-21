PluginBus.register({
  id: 'daily-boost', name: '今日动力面板', version: '1.0', author: '内置',
  desc: '常驻面板：实时进度 + 数据变化自动刷新 + 导出快照',
  panels: [{ id: 'daily-boost', title: '今日动力', icon: '' + U.icon('rocket') + '', width: 320, height: 380,
    render: function (ctx, box) {
      let s = ctx.Store.get();
      let left = ctx.U.daysTo ? ctx.U.daysTo(s.settings.examDate) : 0;
      let st = ctx.Store.todayTaskStats ? ctx.Store.todayTaskStats() : {};
      let done = 0, total = 0; Object.keys(st).forEach(function (k) { done += st[k][0]; total += st[k][1]; });
      let pct = total ? Math.round(done / total * 100) : 0;
      let mood = (s.mental || []).filter(function (m) { return m.date === ctx.dkey(); })[0];
      let moodTxt = mood && mood.mood != null ? (mood.mood + '/10 ' + (mood.note || '')) : '今天还没记录心情';
      let moti = ['稳住，我们能赢', '今天多背一页，考场少慌一秒', '冲刺阶段，慢就是快', '一题一题来，分数一分一分攒'][Math.floor(Date.now() / 86400000) % 4];
      box.innerHTML = '';
      box.innerHTML = '<div style=\'text-align:center\'><div style=\'font-size:44px;font-weight:600;color:var(--danger)\'>' + left + '</div>'
        + '<div class=\'muted-sm\'>距考研还有 ' + left + ' 天</div>'
        + '<div style=\'margin:10px 0 4px\'>今日任务 <b>' + done + '/' + total + '</b>（' + pct + '%）</div>'
        + '<div class=\'pbar\' style=\'height:8px;max-width:240px;margin:0 auto\'><div class=\'pbar-fill\' style=\'width:' + pct + '%;background:var(--ok)\'></div></div>'
        + '<div class=\'muted-sm\' style=\'margin:8px 0\'>😊 ' + ctx.U.esc(moodTxt) + '</div>'
        + '<div style=\'font-size:12.5px;color:var(--text-secondary);margin-bottom:10px\'>' + U.icon('cpChat') + ' ' + moti + '</div>'
        + '<button class=\'btn btn-sm btn-primary\' data-g=\'dashboard\'>去仪表盘</button> '
        + '<button class=\'btn btn-sm btn-ghost\' data-g=\'focus\'>专注</button> '
        + '<button class=\'btn btn-sm btn-ghost\' data-dl=\'1\'>导出快照</button></div>';
      let go = box.querySelector('[data-g=dashboard]');
      if (go) go.onclick = function () { ctx.api.go('dashboard'); };
      let go2 = box.querySelector('[data-g=focus]');
      if (go2) go2.onclick = function () { ctx.api.go('focus'); };
      let dl = box.querySelector('[data-dl]');
      if (dl) dl.onclick = function () {
        let snap = { at: new Date().toISOString(), left: left, task: { done: done, total: total }, mood: mood || null };
        ctx.api.download('今日快照_' + ctx.dkey() + '.json', JSON.stringify(snap, null, 2), 'application/json');
        ctx.log('已导出今日数据快照');
      };
    } }],
  init: function (ctx) {
    let panelDef = ctx.PluginBus.panels().filter(function (p) { return p.pid === ctx.pid; })[0];
    ctx.unsub = ctx.PluginBus.subscribe(ctx.pid, function () {
      let p = document.getElementById('plg-panel-daily-boost');
      if (p && panelDef) { let box = p.querySelector('.plg-panel-b'); if (box) { try { panelDef.render(ctx, box); } catch (e) {} } }
    });
    ctx.log('动力面板已就绪（数据变化自动刷新）');
  },
  onDisable: function (ctx) { if (ctx.unsub) ctx.unsub(); ctx.log('动力面板已停止'); }
});