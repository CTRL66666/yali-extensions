PluginBus.register({
  id: 'sprint-kicker', name: '组卷冲刺鼓手', version: '1.0', author: '内置',
  desc: '交卷后记录成绩趋势 + 鼓劲',
  hooks: {
    examGraded: function (ctx, p) {
      if (!p || !p.examId) return;
      let hist = ctx.data('history') || [];
      hist.push({ at: ctx.dkey(), score: p.score, total: p.total, pct: p.total ? Math.round(p.score / p.total * 100) : 0 });
      ctx.data('history', hist.slice(-30));
      let last = hist[hist.length - 1];
      let n = hist.length;
      if (n >= 2 && last.pct >= hist[hist.length - 2].pct) {
        ctx.Toast.show('🥁 第 ' + n + ' 卷 ' + last.pct + '%——在进步，继续冲！', 'success', 3500);
      }
      ctx.log('交卷记录：' + last.score + '/' + last.total);
    }
  },
  tools: [{ id: 'sprint-kicker', title: '冲刺成绩走势', icon: 'trophy',
    render: function (ctx) {
      let hist = ctx.data('history') || [];
      if (!hist.length) return '<div class=\'muted-sm\'>还没有交卷记录。完成一套模拟卷后这里会自动记录成绩走势。</div>';
      let rows = hist.slice().reverse().map(function (h, i) {
        return '<div style=\'display:flex;justify-content:space-between;font-size:13px;padding:4px 0;border-bottom:1px solid var(--line)\'>'
          + '<span>' + (i + 1) + '. ' + h.at + '</span><span><b>' + h.pct + '%</b> (' + h.score + '/' + h.total + ')</span></div>';
      }).join('');
      return '<div class=\'card\'><div class=\'card-title-sm\'>🥁 模拟卷成绩走势（' + hist.length + ' 卷）</div>' + rows + '</div>';
    } }]
});