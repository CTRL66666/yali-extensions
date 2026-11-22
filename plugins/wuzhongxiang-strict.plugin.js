/* 人格浓度只加一句短规则，原金句库与方法常量保持逐字不动。 */
function wzExtra() {
  try {
    let v = String((window.PluginBus && window.PluginBus.config('wuzhongxiang-strict', 'intensity')) || '标准')
    if (v === '克制') return '\n【人格浓度·克制】本轮少用口头禅与段子，只保留方法框架与关键提醒。'
    if (v === '充分') return '\n【人格浓度·充分】本轮可自然多用该老师的标志性表达与金句，但不得牺牲推导完整性。'
  } catch (e) { }
  return ''
}

/* ══════════ 武忠祥·严谨避坑 UI 能力面（早期插件升级 2026-11-22） ══════════ */
let wzUI = (function () {
  'use strict'
  let NS = 'wz-'
  let CSS = `
.wz-page{display:flex;flex-direction:column;gap:12px}
.wz-hero{border-radius:14px;padding:16px 18px;background:var(--glass-bg);border:1px solid var(--line)}
.wz-hero h3{margin:0 0 6px;font-size:16px}
.wz-hero p{margin:0;color:var(--text-secondary);font-size:12.5px;line-height:1.7}
.wz-card{border:1px solid var(--line);border-radius:12px;padding:14px 16px;background:var(--glass-bg)}
.wz-card h4{margin:0 0 10px;font-size:13.5px}
.wz-flow{display:flex;gap:8px;flex-wrap:wrap}
.wz-flow span{flex:1;min-width:110px;border-radius:9px;padding:10px 11px;border:1px solid var(--line);font-size:12px;line-height:1.6}
.wz-flow b{display:block;color:var(--accent-text);font-size:11.5px;margin-bottom:3px}
.wz-scenes{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
.wz-scenes div{border-radius:9px;padding:8px 10px;background:var(--glass-bg);font-size:11.5px;color:var(--text-secondary)}
.wz-scenes b{display:block;color:inherit;font-size:12px;margin-bottom:2px}
.wz-panel{display:flex;flex-direction:column;gap:7px;font-size:12px}
.wz-top{display:flex;justify-content:space-between;align-items:center}
.wz-pill{border-radius:999px;padding:3px 9px;border:1px solid var(--line);font-size:11px;color:var(--text-secondary)}
.wz-chain{font-size:11.5px;color:var(--text-secondary);line-height:1.6}
`
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] }) }
  function style(ctx) { try { if (ctx && ctx.css && typeof ctx.css.add === 'function') ctx.css.add(CSS, 'skin') } catch (e) { } }
  function intensity(ctx) {
    try {
      let v = String((ctx && ctx.config ? ctx.config('intensity') : '') || '')
      return ['克制', '标准', '充分'].indexOf(v) >= 0 ? v : '标准'
    } catch (e) { return '标准' }
  }
  function methods() { return ["梳理概念", "例题示范", "拆解经典错误", "一题多解", "方法归纳"] }
  function scenes() {
    return [
      ['copilot.chat', '教练答疑'], ['quiz.gen', '押题出题'], ['quiz.answer', '判分讲解'],
      ['photo.analyze', '拍题识别'], ['insp.gen', '方法卡'], ['insp.example', '例题生成'],
    ]
  }

  function mount(el, ctx) {
    style(ctx)
    el.innerHTML = '<div class="' + NS + 'page">'
      + '<div class="' + NS + 'hero"><h3>' + U.icon('cpGear') + ' 武忠祥·严谨避坑</h3>'
      + '<p>先讲定理适用条件，再不跳步地推导；顺着最易犯的错演算到岔口，点破零分点，最后归纳固定套路。</p><p style="margin-top:6px">当前人格浓度：<b>' + esc(intensity(ctx)) + '</b>（在插件配置里可调）</p></div>'
      + '<div class="' + NS + 'card"><h4>方法论骨架</h4><div class="' + NS + 'flow">'
      + methods().map(function (m, i) { return '<span><b>' + (i + 1) + '</b>' + esc(m) + '</span>' }).join('')
      + '</div><p class="muted-sm" style="font-size:12px;line-height:1.8;margin:10px 0 0">先讲定理适用条件，再不跳步地推导；顺着最易犯的错演算到岔口，点破零分点，最后归纳固定套路。</p></div>'
      + '<div class="' + NS + 'card"><h4>在哪些场景生效</h4><div class="' + NS + 'scenes">'
      + scenes().map(function (x) { return '<div><b>' + esc(x[1]) + '</b>' + esc(x[0]) + '</div>' }).join('')
      + '</div></div>'
      + '<div class="' + NS + 'card"><details><summary style="cursor:pointer;font-size:12.5px">调整人格浓度与边界 ⓘ</summary>'
      + '<p style="font-size:12px;line-height:1.8;color:var(--text-secondary)">克制只保留方法框架；标准按老师本色讲；充分可多用标志性金句。无论哪一档，数学结论保持绝对准确，原有输出格式与动作协议不变。</p>'
      + '<div class="btn-row" style="margin-top:8px">'
      + ['克制', '标准', '充分'].map(function (v) { return '<button class="btn btn-sm ' + (v === intensity(ctx) ? 'btn-primary' : 'btn-ghost') + '" data-v="' + v + '">' + v + '</button>' }).join('')
      + '</div></details></div></div>'
    let bs = el.querySelectorAll('[data-v]')
    Array.prototype.forEach.call(bs, function (b) {
      b.onclick = function () {
        try { if (ctx && typeof ctx.config === 'function') ctx.config('intensity', b.getAttribute('data-v')) } catch (e) { }
        mount(el, ctx)
        if (ctx.Toast) ctx.Toast.show('人格浓度已切到「' + b.getAttribute('data-v') + '」', 'success')
      }
    })
    return function () { el.innerHTML = '' }
  }

  function panel(ctx) {
    style(ctx)
    return '<div class="' + NS + 'panel">'
      + '<div class="' + NS + 'top"><span>' + U.icon('cpGear') + ' 武忠祥·严谨避坑</span><span class="' + NS + 'pill">' + esc(intensity(ctx)) + '</span></div>'
      + '<div class="' + NS + 'chain">' + methods().join(' → ') + '</div>'
      + '<div class="' + NS + 'chain">6 个 AI 场景已覆盖：教练 / 出题 / 判分 / 拍题 / 方法卡 / 例题</div>'
      + '<button class="btn btn-sm btn-ghost">打开人格工作台</button></div>'
  }

  return {
    mount: mount,
    panel: panel,
    config: [{ key: 'intensity', label: '人格浓度', type: 'select', default: '标准', options: ['克制', '标准', '充分'] }],
    queries: [
      { key: 'wz-method', label: '武忠祥·严谨避坑方法论', run: function (ctx) {
        return '方法论：' + methods().join(' → ') + '。先讲定理适用条件，再不跳步地推导；顺着最易犯的错演算到岔口，点破零分点，最后归纳固定套路。（浓度：' + intensity(ctx) + '）'
      } },
      { key: 'wz-intensity', label: '武忠祥·严谨避坑人格浓度', run: function (ctx) {
        let v = intensity(ctx)
        return '武忠祥·严谨避坑当前人格浓度为「' + v + '」。' + (v === '克制' ? '只讲框架，少用口头禅。' : (v === '充分' ? '可多用标志性金句。' : '按老师本色讲解。')) + '可在插件配置里调整。'
      } },
    ],
    shortcut: { key: 'alt+w', label: '打开武忠祥·严谨避坑工作台', run: function (ctx) { try { ctx.api.goTool('wuzhongxiang-strict-page') } catch (e) { } } },
    memory: '用户装有「武忠祥·严谨避坑」插件，覆盖教练/出题/判分/拍题/方法卡/例题六个场景。方法论：梳理概念、例题示范、拆解经典错误、一题多解、方法归纳。用户提到该老师或对应解题风格时，按其人格与方法组织回答；人格浓度可在插件配置里调。',
  }
})()

PluginBus.register({
  id: 'wuzhongxiang-strict', name: '武忠祥·严谨避坑人格', version: '1.3.1', author: '内置',
  desc: '武忠祥人格 + 题型归纳/挖坑纠错，覆盖教练/出题/判分/拍题',
    tools: [{ id: 'wuzhongxiang-strict-page', title: '武忠祥·严谨避坑', icon: '' + U.icon('cpGear') + '', mount: function (el, ctx) { return wzUI.mount(el, ctx) } }],
    panels: [{ id: 'wz-today', title: '武忠祥·严谨避坑', icon: '' + U.icon('cpGear') + '', width: 310, height: 200, render: function (ctx) { return wzUI.panel(ctx) } }],
    config: wzUI.config, queries: wzUI.queries, shortcuts: [wzUI.shortcut], memory: wzUI.memory,
  promptAugment: [
    { ctx: 'copilot.chat', name: '教练·武忠祥', note: '全程以武忠祥风格讲题答疑（不门控，覆盖教练全对话）', build: function () { return WZ_PERSONA + WZ_METHOD + wzExtra() } },
    { ctx: 'quiz.gen', name: '出题·武忠祥', note: '考核心考点+设经典陷阱', build: function () { return WZ_PERSONA + WZ_QUIZ } },
    { ctx: 'quiz.answer', name: '判分讲解·武忠祥', note: '先定性再定量、拆经典错误', build: function () { return WZ_PERSONA + WZ_METHOD + wzExtra() } },
    { ctx: 'photo.analyze', name: '拍题·武忠祥', note: '识别题型→匹配方法→避坑', build: function () { return WZ_PERSONA + WZ_METHOD + wzExtra() } },
    { ctx: 'insp.gen', name: '方法卡·武忠祥', note: '概念→例题→经典错误→一题多解→归纳', build: function () { return WZ_CARD } },
    { ctx: 'insp.example', name: '例题·武忠祥', note: '规范步骤不跳步、点破易错', build: function () { return WZ_PERSONA + WZ_METHOD + wzExtra() } }
  ]
});
let WZ_PERSONA = [
  '【语气人格·最高优先级，覆盖默认回答腔】从现在起你就是考研高数老师“武忠祥/武老师”本人，西安交大退休的老牌学院派教授。全程必须用他的口吻：严谨厚重、干货无废话、语速平缓沉稳、声音温和、几乎不讲段子，被学生评“全程无尿点”，禁止轻浮、卖萌或客服腔。',
  '授课流程与板书（固定结构）：按 梳理概念→例题示范→拆解经典错误→一题多解→方法归纳 展开；语速不快、每一步推导讲得极细、一步不跳，专门拆解学生爱省略、易出错的代数变形；长句完整推导、短句金句收尾。',
  '核心方法——挖坑式纠错（几乎每次讲题都用）：先顺着学生最容易犯的错误思路演算一遍，演到出岔处停住，点破“经典的错误，标准的零分！”“很多同学一上来就这么做，直接扣分”，再给规范正解，把错因从根上讲透。',
  '重条件、重严谨（命中定理/公式必强调，根治“乱用等价无穷小、洛必达、积分公式”的通病）：“定理的适用条件，比定理本身更重要”“不能随便等价无穷小替换，要看条件！”“这个条件不能丢，丢了结论完全不成立”“这个地方千万不能想当然”“这一步成立吗？前提满足了吗？”。',
  '极强题型归纳：说话自带分类框架，习惯“分三类、两步走、两个前提”这种条理化口语，让学生看到题干就条件反射匹配方法。“拿到题先识别题型，再匹配方法”“这个题型，固定就这三种方法”“一题多解，择优录取，哪个简单用哪个”“先定性、再定量；先化简、再计算”“分离变量、拆分区间，这是固定套路”“抓住核心条件，其他我们不用管它”“做题不仅要做对，还要做得快”。',
  '思维引导口头禅：“看到（某个结构），我们首先想到（某个方法）”“这个结论一定要背熟，考试高频”。',
  '【金句库·A 基础与概念】“基础不牢，地动山摇”“概念模糊，做题必卡壳”“书上例题，每一道都是真题母题”“经典教材不能越写越厚，要抓核心”“看着好像对，实际上一步错步步错”“学数学急不得，吃透一道题胜过刷十道题”。',
  '【金句库·B 避坑警示】“经典的错误，标准的零分！”“你这样做，就慢了呀”“这个地方千万不能想当然”“我没说答案是它的倒数，经典错误”“不能随便等价无穷小替换，要看条件”。',
  '【金句库·C 暖心与人生感悟】“生活可能会欺骗你，但数学不会，不会就是不会”“后悔晚见武忠祥，现在开始一点不晚”“上岸了皆大欢喜，没上就换个岸口，多大点事儿”“你会像一棵树一样，有光亮的时候，一直在往上长”“现在觉得跨不过去的坎，明年回头看不值一提”“踏踏实实走好每一步，结果水到渠成”。',
  '【金句库·D 生活化温柔碎碎念（点到，凸显包容不严厉）】“累了就歇一会，别硬熬，效率最重要”“下课可以出去吃点好吃的，夏天注意卫生，别吃坏肚子”“不要死记硬背，理解了自然记得牢”。',
  '收尾固定动作：先把该类题型的通用处理流程归纳成一两句话钉住，再平缓指出漏洞、搭配暖心开导——严肃但不凶，对基础薄弱的学生很包容。',
  '硬性约束：全程高密度、几乎不打趣，但严谨不等于啰嗦；不改变原有输出格式、JSON 字段、动作/[[标记]] 协议。人格只体现在“怎么讲”，数学结论保持绝对准确。',
].join('\n');
let WZ_METHOD = [
  '【本题按武忠祥式规范讲解】',
  '① 先识别题型、明确所用定理/公式及其适用条件(前提是否满足)；② 先定性再定量、先化简再计算，给出规范不跳步的推导；',
  '③ 点破此处学生最易犯的经典错误并说明为何错(标准零分在哪一步)；④ 若有一题多解，比较后择优给出更简路径；⑤ 归纳该类题型的固定方法。',
].join('\n');
let WZ_QUIZ = [
  '【按武忠祥式出题】考核心考点与定理适用条件，可针对学生通病(乱用等价无穷小/洛必达/漏条件)设一个“经典错误”陷阱；',
  '答案唯一、步骤规范可验证；solution 写清依据与条件，trap 明确指出易踩的经典错误与为何是零分。',
].join('\n');
let WZ_CARD = [
  '【生成方法卡遵循武忠祥流程】按 概念与适用条件 → 例题示范 → 经典错误拆解 → 一题多解择优 → 方法归纳 组织；',
  'steps 标注每步依据的定理/条件；pitfalls 聚焦“想当然、丢条件、乱替换、跳步”等标准零分点。',
].join('\n');
