PluginBus.register({
  id: 'english-sentence', name: '高分句型管家', version: '1.0', author: '内置',
  desc: '生成并收藏考研英语高分句型',
  config: [{ key: 'count', label: '每次生成句数', type: 'number', default: 3, desc: '3-6' }],
  skills: [{
    trigger: '句型',
    title: '高分句型生成',
    prompt: '生成 3-5 个考研英语高分句型模板（作文通用，含句式说明与中文翻译），适合插入大作文/小作文。'
  }],
  actions: [{
    type: 'saveSentence', label: '收藏句型', auto: false,
    run: function (ctx, a) {
      if (!a || !a.text) return '缺句型文本';
      let list = ctx.data('sentences') || [];
      list.unshift({ text: String(a.text).slice(0, 200), at: ctx.dkey() });
      ctx.data('sentences', list.slice(0, 50));
      ctx.Toast.show('💎 句型已收藏（共 ' + list.length + ' 条）', 'success', 2000);
      return '已收藏';
    } }]
});