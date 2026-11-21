/* 存储体检：自身不再实现统计（旧版口径与设置页对不上，且漏统计 IndexedDB 与工程台产物库、还用了 emoji）。
   现在直接挂载 core/datamanage 的统一面板——与设置页「数据清理」区同一份 HTML、同一套交互，
   因此两处数字永远一致。新增可清理集合只要进 datamanage 的 COLLECTIONS 注册表，这里自动出现。 */
PluginBus.register({
  id: 'storage-doctor', name: '存储体检', version: '2.0', author: '内置',
  desc: 'localStorage/IndexedDB 占用体检 + 一键清理（与设置页数据区同源）',
  tools: [{ id: 'storage-doctor-page', title: '存储体检', icon: '' + U.icon('dashboard') + '', mount: function (el, ctx) {
    if (window.DataManage && window.DataManage.mountPanel) {
      window.DataManage.mountPanel(el, {});
    } else {
      el.innerHTML = '<div class=\'card\'><div class=\'muted-sm\'>数据管理模块未就绪（core/datamanage 未加载）。</div></div>';
    }
  } }]
});