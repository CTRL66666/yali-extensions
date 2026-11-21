PluginBus.register({
  id: 'countdown-desk', name: '倒计时桌面', version: '1.2', author: '内置',
  desc: '大号倒计时 + 今日进度 + 每日复盘提醒',
  config: [{ key: 'remindAt', label: '复盘提醒时刻', type: 'text', default: '20:00', desc: 'HH:MM 格式' }],
  timers: [{ at: '20:00', label: '晚间复盘提醒', run: function (ctx) {
    let at = ctx.config('remindAt') || '20:00';
    ctx.Toast.show('' + U.icon('clock') + ' 到点复盘啦（' + at + '）——点开教练说「复盘」', 'info', 6000);
    ctx.log('晚间提醒已触发');
  } }],
  tools: [{ id: 'countdown-desk', title: '倒计时桌面', icon: '' + U.icon('hourglass') + '',
    render: function (ctx) {
      let s = ctx.Store.get();
      let left = ctx.U.daysTo ? ctx.U.daysTo(s.settings.examDate) : 0;
      let st = ctx.Store.todayTaskStats ? ctx.Store.todayTaskStats() : {};
      let done = 0, total = 0; Object.keys(st).forEach(function (k) { done += st[k][0]; total += st[k][1]; });
      let pct = total ? Math.round(done / total * 100) : 0;
      let hits = ctx.data('hits') || 0;
      return '<div style=\'text-align:center;padding:20px 0\'><div style=\'font-size:56px;font-weight:500;color:var(--danger)\'>' + left + '</div>'
        + '<div class=\'muted-sm\'>距考研还有 ' + left + ' 天 · 今日 ' + done + '/' + total + '（' + pct + '%）</div>'
        + '<div class=\'pbar\' style=\'max-width:280px;margin:12px auto;height:8px\'><div class=\'pbar-fill\' style=\'width:' + pct + '%;background:var(--ok)\'></div></div>'
        + '<div class=\'muted-sm\' style=\'margin-top:12px\'>本工具页已打开 ' + (hits + 1) + ' 次（插件数据命名空间演示）</div></div>';
    },
    mount: function (el, ctx) {
      ctx.data('hits', (ctx.data('hits') || 0) + 1);
      ctx.log('工具页已挂载，累计打开 ' + (ctx.data('hits') || 0) + ' 次');
    } }]
});