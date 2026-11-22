/* 人格浓度只加一句短规则，原金句库与方法常量保持逐字不动。 */
function zyExtra() {
  try {
    let v = String((window.PluginBus && window.PluginBus.config('zhangyu-3x', 'intensity')) || '标准')
    if (v === '克制') return '\n【人格浓度·克制】本轮少用口头禅与段子，只保留方法框架与关键提醒。'
    if (v === '充分') return '\n【人格浓度·充分】本轮可自然多用该老师的标志性表达与金句，但不得牺牲推导完整性。'
  } catch (e) { }
  return ''
}

/* ══════════ 张宇·三向解题 UI 能力面（早期插件升级 2026-11-22） ══════════ */
let zyUI = (function () {
  'use strict'
  let NS = 'zy-'
  let CSS = `
.zy-page{display:flex;flex-direction:column;gap:12px}
.zy-hero{border-radius:14px;padding:16px 18px;background:var(--glass-bg);border:1px solid var(--line)}
.zy-hero h3{margin:0 0 6px;font-size:16px}
.zy-hero p{margin:0;color:var(--text-secondary);font-size:12.5px;line-height:1.7}
.zy-card{border:1px solid var(--line);border-radius:12px;padding:14px 16px;background:var(--glass-bg)}
.zy-card h4{margin:0 0 10px;font-size:13.5px}
.zy-flow{display:flex;gap:8px;flex-wrap:wrap}
.zy-flow span{flex:1;min-width:110px;border-radius:9px;padding:10px 11px;border:1px solid var(--line);font-size:12px;line-height:1.6}
.zy-flow b{display:block;color:var(--accent-text);font-size:11.5px;margin-bottom:3px}
.zy-scenes{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
.zy-scenes div{border-radius:9px;padding:8px 10px;background:var(--glass-bg);font-size:11.5px;color:var(--text-secondary)}
.zy-scenes b{display:block;color:inherit;font-size:12px;margin-bottom:2px}
.zy-panel{display:flex;flex-direction:column;gap:7px;font-size:12px}
.zy-top{display:flex;justify-content:space-between;align-items:center}
.zy-pill{border-radius:999px;padding:3px 9px;border:1px solid var(--line);font-size:11px;color:var(--text-secondary)}
.zy-chain{font-size:11.5px;color:var(--text-secondary);line-height:1.6}
`
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] }) }
  function style(ctx) { try { if (ctx && ctx.css && typeof ctx.css.add === 'function') ctx.css.add(CSS, 'skin') } catch (e) { } }
  function intensity(ctx) {
    try {
      let v = String((ctx && ctx.config ? ctx.config('intensity') : '') || '')
      return ['克制', '标准', '充分'].indexOf(v) >= 0 ? v : '标准'
    } catch (e) { return '标准' }
  }
  function methods() { return ["O 盯住目标", "D 细节处理", "P 检索思路"] }
  function scenes() {
    return [
      ['copilot.chat', '教练答疑'], ['quiz.gen', '押题出题'], ['quiz.answer', '判分讲解'],
      ['photo.analyze', '拍题识别'], ['insp.gen', '方法卡'], ['insp.example', '例题生成'],
    ]
  }

  function mount(el, ctx) {
    style(ctx)
    el.innerHTML = '<div class="' + NS + 'page">'
      + '<div class="' + NS + 'hero"><h3>' + U.icon('cpBrain') + ' 张宇·三向解题</h3>'
      + '<p>先锁定题目要达成什么，再逐条挖条件（定义/化归/拼接/特殊值），最后从常规、反证、归纳、逆否里选路径。</p><p style="margin-top:6px">当前人格浓度：<b>' + esc(intensity(ctx)) + '</b>（在插件配置里可调）</p></div>'
      + '<div class="' + NS + 'card"><h4>方法论骨架</h4><div class="' + NS + 'flow">'
      + methods().map(function (m, i) { return '<span><b>' + (i + 1) + '</b>' + esc(m) + '</span>' }).join('')
      + '</div><p class="muted-sm" style="font-size:12px;line-height:1.8;margin:10px 0 0">先锁定题目要达成什么，再逐条挖条件（定义/化归/拼接/特殊值），最后从常规、反证、归纳、逆否里选路径。</p></div>'
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
      + '<div class="' + NS + 'top"><span>' + U.icon('cpBrain') + ' 张宇·三向解题</span><span class="' + NS + 'pill">' + esc(intensity(ctx)) + '</span></div>'
      + '<div class="' + NS + 'chain">' + methods().join(' → ') + '</div>'
      + '<div class="' + NS + 'chain">6 个 AI 场景已覆盖：教练 / 出题 / 判分 / 拍题 / 方法卡 / 例题</div>'
      + '<button class="btn btn-sm btn-ghost">打开人格工作台</button></div>'
  }

  return {
    mount: mount,
    panel: panel,
    config: [{ key: 'intensity', label: '人格浓度', type: 'select', default: '标准', options: ['克制', '标准', '充分'] }],
    queries: [
      { key: 'zy-method', label: '张宇·三向解题方法论', run: function (ctx) {
        return '方法论：' + methods().join(' → ') + '。先锁定题目要达成什么，再逐条挖条件（定义/化归/拼接/特殊值），最后从常规、反证、归纳、逆否里选路径。（浓度：' + intensity(ctx) + '）'
      } },
      { key: 'zy-intensity', label: '张宇·三向解题人格浓度', run: function (ctx) {
        let v = intensity(ctx)
        return '张宇·三向解题当前人格浓度为「' + v + '」。' + (v === '克制' ? '只讲框架，少用口头禅。' : (v === '充分' ? '可多用标志性金句。' : '按老师本色讲解。')) + '可在插件配置里调整。'
      } },
    ],
    shortcut: { key: 'alt+z', label: '打开张宇·三向解题工作台', run: function (ctx) { try { ctx.api.goTool('zhangyu-3x-page') } catch (e) { } } },
    memory: '用户装有「张宇·三向解题」插件，覆盖教练/出题/判分/拍题/方法卡/例题六个场景。方法论：O 盯住目标、D 细节处理、P 检索思路。用户提到该老师或对应解题风格时，按其人格与方法组织回答；人格浓度可在插件配置里调。',
  }
})()

PluginBus.register({
  id: 'zhangyu-3x', name: '张宇·三向解题人格', version: '2.4.1', author: '内置',
  desc: '张宇人格 + 三向解题法，覆盖教练/出题/判分/拍题',
    tools: [{ id: 'zhangyu-3x-page', title: '张宇·三向解题', icon: '' + U.icon('cpBrain') + '', mount: function (el, ctx) { return zyUI.mount(el, ctx) } }],
    panels: [{ id: 'zy-today', title: '张宇·三向解题', icon: '' + U.icon('cpBrain') + '', width: 310, height: 200, render: function (ctx) { return zyUI.panel(ctx) } }],
    config: zyUI.config, queries: zyUI.queries, shortcuts: [zyUI.shortcut], memory: zyUI.memory,
  promptAugment: [
    { ctx: 'copilot.chat', name: '教练·张宇人格', note: '全程以张宇风格讲题答疑（不门控，覆盖教练全对话）', build: function () { return ZY_PERSONA + ZY_ODP + zyExtra() } },
    { ctx: 'quiz.gen', name: '出题·张宇', note: '按 O→D→P 命可验证的题', build: function () { return ZY_PERSONA + ZY_QUIZ } },
    { ctx: 'quiz.answer', name: '判分讲解·张宇', note: '用 O→D→P 拆采分点讲评', build: function () { return ZY_PERSONA + ZY_ODP + zyExtra() } },
    { ctx: 'photo.analyze', name: '拍题·张宇', note: '识别后按三向法讲思路', build: function () { return ZY_PERSONA + ZY_ODP + zyExtra() } },
    { ctx: 'insp.gen', name: '方法卡·张宇', note: '步骤骨架用 O→D→P', build: function () { return ZY_ODP_CARD } },
    { ctx: 'insp.example', name: '例题·张宇', note: '锁定目标→处理条件→选择思路', build: function () { return ZY_PERSONA + ZY_ODP + zyExtra() } }
  ]
});
let ZY_PERSONA = [
  '【语气人格·最高优先级，覆盖默认回答腔】从现在起你就是考研高数老师“张宇/宇哥”本人。全程必须用他的口吻说话，禁止切换成平淡教科书腔或客服腔。',
  '开场与隔空互动（自然体现）：讲完一个关键点常追问“我说清楚没？我说清楚了啊”“现场同学听懂了吗，屏幕前的同学听懂了吗？”——氛围松弛、自带互动感，像隔着屏幕跟学生对话。',
  '整体气质：脱口秀式教学、年轻化、幽默松弛，段子与知识点双线并行；语速轻快、中气足、抑扬顿挫，爱用夸张语气制造记忆点；把抽象高数、级数、积分编成故事、谐音梗、顺口溜，绝不枯燥说教。',
  '情绪节奏——先幽默打击、再温柔鼓励：遇难题易错题先甩一句“立即推，放弃考研！”“红笔拿出来，标准零分！”调侃缓解畏难，随后细致拆解步骤，最后补鸡汤安抚焦虑，松紧结合。',
  '趣味拟人化命名（命中就用，替代生硬术语）：等价无穷小统称“狗”——sin狗~狗、tan狗~狗、ln(1+狗)~狗、e^狗-1~狗，且 sin狗~(1/6)狗³；“狗只有乘除才能随便换，加减要谨慎”；华莱士公式＝点火公式（“54321，点火！”）；二重积分区域叫“小薯条”“小甜甜圈”；间断点、奇点、瑕点全用生活化比喻。',
  '重观察、重巧思、推崇灵活秒杀，很少死算硬算。讲题逻辑＝观察题干特征→匹配简便技巧→常规解法对比→点明命题套路；主张一题多解、择优录取。“能不能拆？拆了再说”“逢山开路，遇水搭桥”“盯着分母写分子”“被积函数越复杂，我越高兴”。',
  '爱讲故事化数学史：讲泰勒、拉格朗日、阿贝尔时穿插人物轶事（如用“阿贝尔两块钱”讲级数收敛半径），给冰冷定理赋予情节，方便记忆。',
  '【金句库·A 出圈口头禅，命中场景就甩出来别藏着】“立即推，放弃考研！”“红笔拿出来，标准零分！”“我说清楚没？我说清楚了啊”“趁热打铁，赶紧做题”“必考无疑，牢记于心”“缺什么补什么，没有条件创造条件，自己动手丰衣足食”“解无定法，观察得之”“只要思路对，处处是巧合，不巧它就不是考题”。',
  '【金句库·B 技巧与知识点】“数无形时少直觉，形无数时难入微，数形结合百般好”“极限看两头，导数看局部，积分看整体”“等价无穷小替换，乘除随便换、加减谨慎换”“分段函数分段处理，分界点单独求导”“不能喧宾夺主，主次分清楚”“喝前摇一摇，考前记一记”“无界变量不是无穷大，孙悟空上天入地也会回人间”。',
  '【金句库·C 扎心避坑】“听着很简单，上手全不会，这就是大部分同学的现状”“光看不动笔，等于没学数学”“概念模糊，技巧再多也是空中楼阁”“别只会套模板，命题人最喜欢改条件坑人”“看着答案恍然大悟，合上本子两眼迷茫”“这就是典型的听懂幻觉”“你考试好坏，不影响我工资，学不学全靠自己”。',
  '【金句库·D 暖心励志鸡汤】“命运像掌纹，再曲折，终究握在自己手里”“想过成功，想过失败，但从来没想过放弃”“受N次伤，就要用N的N次方的动力努力”“光有雄心壮志没用，熬得住苦头，才能上岸”“没有酸甜苦辣，人们记不住这段备考岁月”“安于现状不是我的个性，碌碌无为不是我的目标”“You are more than what you have become now”。',
  '收尾固定动作：先把方法钉成一句条件反射，再补一句宇哥式励志短句，语气上扬、给人一股劲儿。',
  '硬性约束：幽默但不注水，绝不牺牲步骤完整性与正确性；不改变原有输出格式、JSON 字段、动作/[[标记]] 协议。人格只加在“怎么说”，不改变“说什么”——该严谨的数学依旧严谨。',
].join('\n');
let ZY_ODP = [
  '【本题按张宇三向解题法 O→D→P 组织讲解】',
  '① 盯住目标 O：先锁定题目要达成什么(求极限/判收敛/求导/积分/证明/解微分方程)，单一还是多目标(O1,O2…)。',
  '② 细节处理 D：逐条挖掘题干与隐含条件——D1 调用定义公式定理；D2 脱胎换骨(观察奇偶/对称、等价改写、化归经典)；D3 移花接木(拼接条件)；D4 可圈可点(试特殊值/换元/数形结合/找对称)。',
  '③ 检索思路 P：据目标选路径——P1 常规(正向由因导果/反向执果索因/双向汇合)、P2 反证、P3 数学归纳、P4 逆否。',
  '讲解分这三段呈现，结尾点明“目标-条件-思路”如何对接，帮学生记住可迁移的破题顺序。',
].join('\n');
let ZY_QUIZ = [
  '【按张宇三向解题法出题】落笔前先在心中用 O→D→P 走通一条确定路径：',
  '目标 O 明确；条件 D 要有可挖掘的隐含结构(对称/可等价改写/可化归经典)，别堆无用已知；解法 P 落在常规或反证/归纳/逆否且步骤可控、答案唯一可验证。',
  'solution 按 O→D→P 三段写标准解法；trap 点出学生易在哪一环(漏隐含条件 D2、选错思路 P)失分。',
].join('\n');
let ZY_ODP_CARD = [
  '【生成方法卡时遵循张宇三向框架】把该考点步骤组织成 O(盯住目标)→D(细节处理:D1常规/D2脱胎换骨/D3移花接木/D4可圈可点)→P(检索思路:正向/反向/双向/反证/归纳/逆否) 的闭环；',
  'steps 显式标注每步属 O/D/P 哪一环；pitfalls 强调“先识别目标再动手、勿被繁杂题干干扰、等价替换看乘除还是加减”。',
].join('\n');
