PluginBus.register({
  id: 'async-form-action', name: '异步表单动作', version: '1.0', author: '内置',
  desc: '演示插件动作的异步执行 + 表单收参 + 撤销',
  actions: [{
    type: 'batchAddTasks', label: '批量加任务', auto: false,
    needs: { title: '批量加任务', fields: [
      { key: 'subject', label: '科目', type: 'select', options: [{ v: 'math', t: '数学' }, { v: 'eng', t: '英语' }, { v: 'pol', t: '政治' }, { v: 'major', t: '专业课' }] },
      { key: 'text', label: '任务内容', type: 'text', placeholder: '如：极限专题 20 题' },
      { key: 'count', label: '重复数量', type: 'number', placeholder: '默认 1' }
    ] },
    run: function (ctx, a) {
      let n = Math.max(1, Math.min(10, parseInt(a.count, 10) || 1));
      return new Promise(function (resolve, reject) {
        setTimeout(function () {
          try {
            let added = 0;
            for (let i = 0; i < n; i++) {
              ctx.Store.update(function (s) {
                let maxOrder = 0;
                s.tasks.forEach(function (t) { if (t.order != null && t.order > maxOrder) maxOrder = t.order; });
                s.tasks.push({ id: ctx.uid(), subject: a.subject || 'math', text: (n > 1 ? (a.text + '（' + (i + 1) + '/' + n + '）') : a.text), done: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), order: maxOrder + 1 });
              });
              added++;
            }
            ctx.log('异步批量加任务 ' + added + ' 项');
            resolve('已加 ' + added + ' 项任务');
          } catch (e) { reject(e); }
        }, 600);
      });
    },
    undo: function (ctx, a) {
      let base = a.text;
      ctx.Store.update(function (s) {
        s.tasks = s.tasks.filter(function (t) {
          if (t.done) return true;
          return t.text !== base && t.text.indexOf(base + '（') !== 0;
        });
      });
      ctx.log('撤销批量加任务');
    }
  }]
});