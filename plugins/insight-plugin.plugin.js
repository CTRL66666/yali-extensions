PluginBus.register({
  id: 'insight-plugin', name: '学习洞察', version: '1.0', author: '内置',
  desc: '演示插件注册数据查询接口 + 底部主 tab',
  queries: [{
    key: 'focusWeek', label: '本周专注',
    run: function (ctx) {
      let s = ctx.Store.get();
      let mins = 0; Object.keys(s.studyHours || {}).forEach(function (k) { mins += s.studyHours[k] * 60; });
      return '本周累计学习 ' + Math.round(mins / 60 * 10) / 10 + ' 小时';
    }
  }],
  maintabs: [{
    id: 'insight-tab', name: '洞察', icon: '' + U.icon('barChart') + '',
    render: function (ctx, el) {
      let s = ctx.Store.get();
      let streak = ctx.Store.studyStreak ? ctx.Store.studyStreak() : 0;
      let vocab = (s.vocab || []).length;
      let mistakes = (s.mistakes || []).length;
      el.innerHTML = '<div class=\'card\'><div class=\'card-title\'>' + U.icon('barChart') + ' 学习洞察（插件主 tab）</div>'
        + '<div style=\'display:flex;gap:12px;flex-wrap:wrap\'>'
        + '<span>连续打卡 <b>' + streak + '</b> 天</span>'
        + '<span>单词 <b>' + vocab + '</b> 词</span>'
        + '<span>错题 <b>' + mistakes + '</b> 条</span>'
        + '</div>'
        + '<div class=\'muted-sm\' style=\'font-size:11.5px;margin-top:6px\'>本 tab 由「学习洞察」插件注册——底部导航扩展，卸载即消失。教练说「查一下本周专注」可触发插件的 focusWeek 查询。</div></div>';
    }
  }]
});