PluginBus.register({
  id: 'anki-exporter', name: 'Anki 导出器', version: '1.0', author: '内置',
  desc: '错题本/单词本 → Anki 分号 CSV',
  tools: [{ id: 'anki-exporter-page', title: 'Anki 导出', icon: '' + U.icon('shareOut') + '', mount: function (el, ctx) {
    function esc(s) { return String(s == null ? '' : s).split('"').join('""'); }
    function csv(pairs) { return pairs.map(function (p) { return '"' + esc(p[0]) + '";"' + esc(p[1]) + '"'; }).join('\n'); }
    el.innerHTML = '<div class=\'card\'><div class=\'card-title\'>' + U.icon('shareOut') + ' Anki 导出</div>'
      + '<div class=\'muted-sm\'>导出分号分隔 CSV（Anki 导入时选「分号、允许 HTML」）。错题本正面=题面+选项，背面=答案+解析；单词本正面=单词，背面=词性+释义+例句。</div>'
      + '<div class=\'btn-row\' style=\'margin-top:8px\'>'
      + '<button class=\'btn btn-sm btn-primary\' id=\'ak-mis\'>导出错题本</button>'
      + '<button class=\'btn btn-sm btn-ghost\' id=\'ak-voc\'>导出单词本</button></div>'
      + '<div id=\'ak-msg\' class=\'muted-sm\' style=\'margin-top:6px\'></div></div>';
    let msg = el.querySelector('#ak-msg');
    el.querySelector('#ak-mis').onclick = function () {
      let ms = (ctx.Store.get().mistakes || []);
      if (!ms.length) { ctx.Toast.show('错题本是空的', 'warn'); return; }
      let pairs = ms.map(function (m) {
        let front = m.stem || m.desc || '';
        if (Array.isArray(m.options) && m.options.length) front += '\n' + m.options.join('\n');
        let back = [m.answer, m.solution].filter(function (x) { return x != null && String(x).trim() !== ''; }).join('\n——\n');
        if (m.trap) back += (back ? '\n——\n' : '') + '' + U.icon('cpWarn') + ' 易错点：' + m.trap;
        return [front, back];
      });
      ctx.api.download('anki_错题本_' + ctx.dkey() + '.csv', '\ufeff' + csv(pairs), 'text/csv;charset=utf-8');
      if (msg) msg.textContent = '已导出错题本 ' + pairs.length + ' 条';
    };
    el.querySelector('#ak-voc').onclick = function () {
      let vs = (ctx.Store.get().vocab || []);
      if (!vs.length) { ctx.Toast.show('单词本是空的', 'warn'); return; }
      let pairs = vs.map(function (v) { return [v.word || '', [v.pos, v.meaning, v.example].filter(Boolean).join('\n')]; });
      ctx.api.download('anki_单词本_' + ctx.dkey() + '.csv', '\ufeff' + csv(pairs), 'text/csv;charset=utf-8');
      if (msg) msg.textContent = '已导出单词本 ' + pairs.length + ' 条';
    };
  } }]
});