PluginBus.register({
  id: 'daily-mistake-drill', name: '每日错题唤醒', version: '1.0', author: '内置',
  desc: '每天 21:00 弹一张最久未回顾的错题回忆卡',
  timers: [{ at: '21:00', label: '每日错题唤醒', run: function (ctx) {
    let ms = (ctx.Store.get().mistakes || []).filter(function (m) { return m && (m.stem || m.desc); });
    if (!ms.length) return;
    ms.sort(function (a, b) { return String(a.reviewedAt || a.createdAt || '').localeCompare(String(b.reviewedAt || b.createdAt || '')); });
    let m = ms[0];
    let front = m.stem || m.desc || '';
    if (Array.isArray(m.options) && m.options.length) front += '<br>' + m.options.join('<br>');
    let html = '<div class=\'card\'><div style=\'font-weight:600;margin-bottom:6px\'>先自己回忆这道题的思路与答案：</div>'
      + '<div class=\'report\'>' + front + '</div>'
      + '<details style=\'margin-top:8px\'><summary style=\'cursor:pointer;font-size:12px\'>' + U.icon('eye') + ' 翻开答案与解析</summary>'
      + '<div class=\'report\' style=\'margin-top:6px\'><b>答案：</b>' + (m.answer == null ? '—' : m.answer) + '</div>'
      + (m.solution ? '<div class=\'report\' style=\'margin-top:4px\'><b>解析：</b>' + m.solution + '</div>' : '') + '</details>'
      + '<div class=\'muted-sm\' style=\'margin-top:8px\'>来源：' + (m.desc || '错题本') + '</div></div>';
    ctx.openModal({ title: '' + U.icon('clock') + ' 今日错题唤醒', wide: true, html: html, actions: [
      { label: '' + U.icon('cpCheck') + ' 记住了', kind: 'btn-primary', onClick: function () { ctx.Store.update(function (s) { let t = (s.mistakes || []).find(function (x) { return x.id === m.id; }); if (t) t.reviewedAt = new Date().toISOString(); }); ctx.Toast.show('已记录回顾时间，它会更晚再来', 'success'); } },
      { label: '' + U.icon('cpCross') + ' 没记住', onClick: function () { ctx.Store.update(function (s) { let t = (s.mistakes || []).find(function (x) { return x.id === m.id; }); if (t) { t.reviewedAt = new Date().toISOString(); t.needRetell = true; } }); ctx.Toast.show('已标记，明天优先再唤醒它', 'info'); } },
      { label: '关闭' }
    ] });
  } }]
});