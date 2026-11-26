/* zhangyu-3x.plugin.js — 张宇·三向解题人格 · v2.5.0
 *
 * v2.4.1 只有一块瘦 UI：三向骨架 + 六个场景 + 一个浓度开关（148 行）。
 * 「人格浓度」写在提示词里，用户却看不见它到底改了什么、用过哪些示例、好不好用。
 * v2.5.0 按成熟插件形态重造：五视图 shell + 示例/反馈历史 + 可导出报告，
 * 把「张宇怎么讲、讲了哪些题、哪一档更有效」变成可查、可回放的东西。
 *
 * 【兼容契约 · 一个字都不许改】
 *   · api.id 'zhangyu-3x' / version 升到 2.5.0 / 工具 'zhangyu-3x-page'；
 *   · 面板 'zy-today'、查询 'zy-method' / 'zy-intensity'、快捷键 alt+z、config key 'intensity'；
 *   · memory 原样保留（市场测试按关键词检索）；
 *   · ★ 下方 promptAugment 六个 scope（copilot.chat / quiz.gen / quiz.answer /
 *     photo.analyze / insp.gen / insp.example）与 ZY_PERSONA / ZY_ODP / ZY_QUIZ /
 *     ZY_ODP_CARD / zyExtra() 的提示词文本逐字不动 —— 这是人格包的命脉。
 *     本文件只加「能力面」，不碰一个字的「说什么」。
 *
 * 【数据口径】人格提示词是唯一事实源，UI 里的示例/方法论卡只是它的可读投影；
 *   历史记录落在本机 ctx.data（zyHistory），只记「用过哪条示例 + 反馈」，不另算人格结论。
 */
;(function () {
  'use strict'

  var VERSION = '2.5.0'
  var PID = 'zhangyu-3x'
  var NS = 'zy-'
  var K_HISTORY = 'zyHistory'      // 用过哪些示例 + 反馈
  var K_CFG = 'zyCfg'              // UI 层附加设置（不动 api.config 契约）
  var K_LAST_VIEW = 'zyLastView'
  var K_LAST_TOPIC = 'zyLastTopic'
  var MAX_HISTORY = 150
  var LEVELS = ['克制', '标准', '充分']
  var TOPICS = ['全部', '极限', '积分', '级数', '线代', '导数与中值', '多元与微分']

  /* ══════════════ 1. 纯工具函数（无依赖，可单测） ══════════════ */

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
    })
  }
  function num(v, d) { var n = Number(v); return isFinite(n) ? n : (d === undefined ? 0 : d) }
  function clamp(v, a, b, d) { var n = num(v, d === undefined ? a : d); return Math.max(a, Math.min(b, n)) }
  function flat(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim() }
  function trunc(s, n) { s = flat(s); return s.length > n ? s.slice(0, n - 1) + '…' : s }
  function pad2(n) { return n < 10 ? '0' + n : String(n) }
  function dkey(t) {
    var d = t == null ? new Date() : (t instanceof Date ? t : new Date(t))
    if (isNaN(d.getTime())) d = new Date()
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate())
  }
  function hashStr(s) {
    var h = 2166136261
    s = String(s)
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) }
    return h >>> 0
  }
  /** 图标统一走站内 U.icon，拿不到退成文字 —— 绝不写原生 emoji */
  function I(key, text) {
    try {
      if (typeof U !== 'undefined' && U && typeof U.icon === 'function') {
        var svg = U.icon(key)
        if (svg) return '<span class="' + NS + 'ic" aria-hidden="true">' + svg + '</span>'
      }
    } catch (e) { /* 沙箱里没有 U 时静默退化 */ }
    return '<span class="' + NS + 'ic" aria-hidden="true">' + esc(text || '·') + '</span>'
  }
  function toast(ctx, msg, level) {
    try { if (ctx && typeof ctx.notify === 'function') ctx.notify({ title: String(msg), level: level || 'info', timeout: 3000 }); else if (ctx && ctx.Toast && ctx.Toast.show) ctx.Toast.show(String(msg), level || 'success') }
    catch (e) { }
  }
  function storeGet(ctx, key, dflt) {
    var v = null
    try { if (ctx && typeof ctx.data === 'function') v = ctx.data(key) } catch (e) { }
    if (v == null) { try { if (ctx && ctx.keep && typeof ctx.keep.get === 'function') v = ctx.keep.get(key) } catch (e) { } }
    return v == null ? dflt : v
  }
  function storeSet(ctx, key, val) {
    try { if (ctx && typeof ctx.data === 'function') { ctx.data(key, val); return } } catch (e) { }
    try { if (ctx && ctx.keep && typeof ctx.keep.set === 'function') ctx.keep.set(key, val) } catch (e) { }
  }
  function intensity(ctx) {
    try {
      var v = ''
      if (ctx && typeof ctx.config === 'function') v = String(ctx.config('intensity') || '')
      if (!v && typeof window !== 'undefined' && window.PluginBus && typeof window.PluginBus.config === 'function') v = String(window.PluginBus.config(PID, 'intensity') || '')
      return LEVELS.indexOf(v) >= 0 ? v : '标准'
    } catch (e) { return '标准' }
  }
  function setIntensity(ctx, v) {
    if (LEVELS.indexOf(v) < 0) return false
    try { if (ctx && typeof ctx.config === 'function') ctx.config('intensity', v) } catch (e) { }
    try { if (typeof window !== 'undefined' && window.PluginBus && typeof window.PluginBus.config === 'function') window.PluginBus.config(PID, 'intensity', v) } catch (e) { }
    return true
  }
  function cfgGet(ctx) {
    var d = { autoRecord: true, showPanel: true, defaultTopic: '全部', showGolden: true }
    var got = storeGet(ctx, K_CFG, null)
    if (!got || typeof got !== 'object') return d
    d.autoRecord = got.autoRecord !== false
    d.showPanel = got.showPanel !== false
    d.showGolden = got.showGolden !== false
    if (TOPICS.indexOf(got.defaultTopic) >= 0) d.defaultTopic = got.defaultTopic
    return d
  }
  function cfgSet(ctx, patch) {
    var d = cfgGet(ctx)
    Object.keys(patch || {}).forEach(function (k) { if (k in d) d[k] = patch[k] })
    storeSet(ctx, K_CFG, d)
    return d
  }

  /* ══════════════ 2. 人格提示词常量（逐字保留，禁止改动） ══════════════ */

  /* 人格浓度只加一句短规则，原金句库与方法常量保持逐字不动。 */
  function zyExtra() {
    try {
      var v = String((window.PluginBus && window.PluginBus.config('zhangyu-3x', 'intensity')) || '标准')
      if (v === '克制') return '\n【人格浓度·克制】本轮少用口头禅与段子，只保留方法框架与关键提醒。'
      if (v === '充分') return '\n【人格浓度·充分】本轮可自然多用该老师的标志性表达与金句，但不得牺牲推导完整性。'
    } catch (e) { }
    return ''
  }

  var ZY_PERSONA = [
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
  ].join('\n')
  var ZY_ODP = [
    '【本题按张宇三向解题法 O→D→P 组织讲解】',
    '① 盯住目标 O：先锁定题目要达成什么(求极限/判收敛/求导/积分/证明/解微分方程)，单一还是多目标(O1,O2…)。',
    '② 细节处理 D：逐条挖掘题干与隐含条件——D1 调用定义公式定理；D2 脱胎换骨(观察奇偶/对称、等价改写、化归经典)；D3 移花接木(拼接条件)；D4 可圈可点(试特殊值/换元/数形结合/找对称)。',
    '③ 检索思路 P：据目标选路径——P1 常规(正向由因导果/反向执果索因/双向汇合)、P2 反证、P3 数学归纳、P4 逆否。',
    '讲解分这三段呈现，结尾点明“目标-条件-思路”如何对接，帮学生记住可迁移的破题顺序。',
  ].join('\n')
  var ZY_QUIZ = [
    '【按张宇三向解题法出题】落笔前先在心中用 O→D→P 走通一条确定路径：',
    '目标 O 明确；条件 D 要有可挖掘的隐含结构(对称/可等价改写/可化归经典)，别堆无用已知；解法 P 落在常规或反证/归纳/逆否且步骤可控、答案唯一可验证。',
    'solution 按 O→D→P 三段写标准解法；trap 点出学生易在哪一环(漏隐含条件 D2、选错思路 P)失分。',
  ].join('\n')
  var ZY_ODP_CARD = [
    '【生成方法卡时遵循张宇三向框架】把该考点步骤组织成 O(盯住目标)→D(细节处理:D1常规/D2脱胎换骨/D3移花接木/D4可圈可点)→P(检索思路:正向/反向/双向/反证/归纳/逆否) 的闭环；',
    'steps 显式标注每步属 O/D/P 哪一环；pitfalls 强调“先识别目标再动手、勿被繁杂题干干扰、等价替换看乘除还是加减”。',
  ].join('\n')

  /* ══════════════ 3. 数据层：方法论卡 / 示例库 / 题型 / 强度 / 作用域 ══════════════ */

  /** O / D1-D4 / P1-P4 共九张卡；每张都是提示词里那句话的可读展开（不改口径） */
  var ODP_CARDS = [
    { k: 'O', t: '盯住目标', sub: 'O · 先问「求什么」',
      body: '拿到题先别动笔。把题目要达成的东西翻译成一个明确动作：求极限、判敛散、求导、算积分、证不等式、解微分方程。一题多问就编号 O1、O2、O3，逐个击破。',
      cue: '宇哥提醒：目标都没锁死就开算，等于没带地图就上山——走到哪算哪。',
      pit: '最常见失误：把「证明」当成「计算」，写完一堆变形却没给出结论句。' },
    { k: 'D1', t: '调用定义', sub: 'D1 · 定义公式定理',
      body: '把题干里的对象还原成定义：连续、可导、收敛、正交、线性无关……定义本身就是最强的条件。能写出定义式的，先写定义式。',
      cue: '缺什么补什么，没有条件创造条件，自己动手丰衣足食。',
      pit: '只用「记住的结论」不用定义，一遇到条件变形就露馅。' },
    { k: 'D2', t: '脱胎换骨', sub: 'D2 · 等价改写与化归',
      body: '观察奇偶性、对称性、周期性；把复杂式等价改写成经典结构（凑微分、配方法、标准化）。等价无穷小替换在这里只用乘除，加减先放下。',
      cue: '解无定法，观察得之；逢山开路，遇水搭桥。',
      pit: '加减里乱换等价无穷小——这是命题人最爱埋的雷。' },
    { k: 'D3', t: '移花接木', sub: 'D3 · 拼接条件',
      body: '把一个条件拆成两半，分别接上不同的定理；或把两个已知条件相乘、相减、复合，制造出题目想要的新结构。',
      cue: '被积函数越复杂，我越高兴——复杂意味着可拼。',
      pit: '条件拼接后没回头验证是否仍满足定理前提。' },
    { k: 'D4', t: '可圈可点', sub: 'D4 · 特殊值与数形结合',
      body: '代特殊值试探方向、换元简化、画图看趋势、找对称中心。先用特殊值把答案「猜」出来，再回头补严格证明。',
      cue: '数无形时少直觉，形无数时难入微，数形结合百般好。',
      pit: '特殊值只当作验证，不敢用来定位思路，白白浪费一条捷径。' },
    { k: 'P1', t: '常规路径', sub: 'P1 · 正向 / 反向 / 双向',
      body: '正向由因导果：从条件往结论推。反向执果索因：从结论倒推需要什么。双向汇合：两头往中间走，在关键等式处相遇。三条里先试最短的那条。',
      cue: '盯着分母写分子——反向求解常常比正向快一倍。',
      pit: '一条路走到黑，不看另外两条，结果卡在半路。' },
    { k: 'P2', t: '反证', sub: 'P2 · 否定结论',
      body: '结论难正面构造时，假设反面成立，推出与已知条件或公理矛盾的结论。适合「至多/至少」「不存在」「唯一性」类命题。',
      cue: '正面打不通，就绕到背后敲一下。',
      pit: '反证设错对象，或推到一半忘了要导出矛盾。' },
    { k: 'P3', t: '数学归纳', sub: 'P3 · 从 n 到 n+1',
      body: '与正整数有关的恒等式、不等式、递推数列先用归纳：验 n=1、假设 n=k 成立、推 n=k+1。关键是写出从 k 到 k+1 的「桥」。',
      cue: '第一步稳、第二步巧，归纳题的命门在桥不在脚。',
      pit: '只验了几个特例就宣称成立，跳过归纳步骤。' },
    { k: 'P4', t: '逆否', sub: 'P4 · 证逆否命题',
      body: '「若 A 则 B」不好证时，改证「若非 B 则非 A」。逆否与原命题同真同假，常把模糊的否定变成清晰的条件。',
      cue: '换个方向说同一句话，有时就亮堂了。',
      pit: '把逆命题当成逆否命题，逻辑直接翻车。' },
  ]

  /** 六个提示词注入场景的可读说明，与 promptAugment 一一对应 */
  var SCOPES = [
    { ctx: 'copilot.chat', name: '教练答疑', gate: '不门控', build: 'ZY_PERSONA + ZY_ODP + zyExtra()',
      note: '全程以张宇风格讲题答疑，覆盖教练全对话。浓度开关只在末尾追加一句短规则。' },
    { ctx: 'quiz.gen', name: '押题出题', gate: '按场景', build: 'ZY_PERSONA + ZY_QUIZ',
      note: '按 O→D→P 命可验证的题：目标明确、条件含可挖掘结构、解法步骤可控。' },
    { ctx: 'quiz.answer', name: '判分讲解', gate: '按场景', build: 'ZY_PERSONA + ZY_ODP + zyExtra()',
      note: '用 O→D→P 拆采分点讲评，先定性哪里丢分，再给规范路径。' },
    { ctx: 'photo.analyze', name: '拍题识别', gate: '按场景', build: 'ZY_PERSONA + ZY_ODP + zyExtra()',
      note: '识别后按三向法讲思路，不直接甩答案；识别错误先澄清题目。' },
    { ctx: 'insp.gen', name: '方法卡', gate: '按场景', build: 'ZY_ODP_CARD',
      note: '步骤骨架用 O→D→P，steps 显式标注每步属于哪一环。' },
    { ctx: 'insp.example', name: '例题生成', gate: '按场景', build: 'ZY_PERSONA + ZY_ODP + zyExtra()',
      note: '锁定目标→处理条件→选择思路，结尾点明目标-条件-思路如何对接。' },
  ]

  /** 脱口秀式讲题示例库：每段都是可直接回放的师生对话 */
  var EXAMPLES = [
    { id: 'ex-lim-01', topic: '极限', title: '1^∞ 型：别急着洛必达',
      q: '求 lim(x→∞)((x+3)/(x-1))^(x/2)。',
      turns: [
        ['学生', '看到 1 的无穷次方，我直接取对数然后洛必达，对吗？'],
        ['张宇', '红笔拿出来，标准零分！先别急着上刑具。你先盯住目标 O——底数趋于 1、指数趋于无穷，这不就是 1^∞ 的标准相吗？'],
        ['张宇', '细节 D：把它改写成 (1 + 4/(x-1))^(x/2)，这就是「1 + 狗」的型。狗 = 4/(x-1)，乘除可以换，指数上是 x/2，得先把 x/2 凑成 1/狗 的倍数。'],
        ['学生', '所以写成 e 的 lim (x/2)·ln(1+4/(x-1))？'],
        ['张宇', '对喽！ln(1+狗)~狗，指数乘出来是 (x/2)·4/(x-1) → 2，答案 e²。我说清楚没？我说清楚了啊。'],
        ['张宇', '思路 P 是常规里的「等价改写 + 取对数」，不是硬洛。记住：遇 1^∞ 先套 e 的极限式，别一见就上洛必达。'],
      ],
      point: 'O 锁定 1^∞ → D 改写成 1+狗 → P 取对数用 ln(1+狗)~狗；乘除能换、加减谨慎。' },
    { id: 'ex-lim-02', topic: '极限', title: '加减里的等价无穷小陷阱',
      q: '求 lim(x→0)(tan x − sin x)/x³。',
      turns: [
        ['学生', 'tan x~x，sin x~x，减完是 0，极限是 0。'],
        ['张宇', '这就是典型的「听懂幻觉」！听着很简单，上手全不会。等价无穷小乘除随便换、加减要谨慎——你这一减，把主部全减没了。'],
        ['张宇', 'D2 脱胎换骨：tan x − sin x = tan x(1 − cos x)。拆成乘积，就可以放心换了：tan x~x，1−cos x~(1/2)x²。'],
        ['学生', '所以是 x·(1/2)x² / x³ = 1/2。'],
        ['张宇', '漂亮！趁热打铁，赶紧做题。记住这句：狗只有乘除才能随便换，加减要谨慎；非要减，先提出公因式变成乘。'],
      ],
      point: '加减不能直换等价无穷小；先提公因式 tan x，把差变成积再换。' },
    { id: 'ex-lim-03', topic: '极限', title: '夹逼准则的「 sandwiched 直觉」',
      q: '求 lim(n→∞)(1/(n²+1) + 1/(n²+2) + … + 1/(n²+n))。',
      turns: [
        ['学生', '每一项都趋于 0，项数是 n，是不是 0？'],
        ['张宇', '别凭感觉！n 个无穷小加起来，得看它们合起来多大——这就是「极限看两头」。'],
        ['张宇', 'D2 找上下界：每项 ≥ 1/(n²+n)，≤ 1/(n²+1)。n 倍之后，两边都夹到 1。'],
        ['张宇', 'P1 双向汇合：左夹 1、右夹 1，中间只能是 1。夹逼准则，就是「左右夹击，中间老实」。'],
      ],
      point: '无穷多个无穷小求和先估阶；夹逼准则找两侧同极限的界。' },
    { id: 'ex-int-01', topic: '积分', title: '华莱士公式：54321，点火！',
      q: '求 ∫₀^{π/2} sin⁵x dx。',
      turns: [
        ['学生', '要一直分部积分五次吗？太慢了吧。'],
        ['张宇', '你这样做，就慢了呀！这是点火公式——华莱士公式。奇数次幂 5，结果就是 (4/5)·(2/3)·1 = 8/15。54321，点火！'],
        ['张宇', 'D2 化归：∫₀^{π/2} sinⁿx dx 有现成递推，n 为奇数时最后乘到 1，偶数时最后乘 π/2。先把(n−1)/n 一层层写出来。'],
        ['学生', '那 ∫₀^{π/2} cos⁴x dx 就是 (3/4)·(1/2)·(π/2)=3π/16？'],
        ['张宇', '必考无疑，牢记于心！你看，观察出区间是 0 到 π/2、函数是纯三角幂，秒杀。'],
      ],
      point: '识别 [0,π/2] 上三角函数幂 → 直接用华莱士公式，避免多次分部。' },
    { id: 'ex-int-02', topic: '积分', title: '二重积分：小薯条与小甜甜圈',
      q: '交换 ∫₀¹ dx ∫ₓ¹ f(x,y)dy 的积分次序。',
      turns: [
        ['学生', '画不出区域，我老是把上下限写反。'],
        ['张宇', '画区域啊！先画 y=x 这条线，再框 x 从 0 到 1、y 从 x 到 1——这块是不是一个三角形「小薯条」？'],
        ['张宇', 'D4 数形结合：改成先对 x 积分，y 从 0 到 1，固定 y 时 x 从 0 到 y。区域一边，次序一换，清清楚楚。'],
        ['学生', '所以是 ∫₀¹ dy ∫₀ʸ f(x,y)dx。'],
        ['张宇', '对！遇到圆环区域就叫它「小甜甜圈」，用极坐标；遇到三角块就是小薯条，用直角。数形结合百般好。'],
      ],
      point: '交换次序先画区域；三角形区域直角坐标，圆环区域极坐标。' },
    { id: 'ex-int-03', topic: '积分', title: '被积函数越复杂我越高兴',
      q: '求 ∫ x·arctan x dx。',
      turns: [
        ['学生', '这两种函数乘一起，用分部积分？'],
        ['张宇', '被积函数越复杂，我越高兴！分部积分就一条口诀：谁求导变简单谁当 u。arctan x 求导变有理式，x 积分变 x²/2，所以 u=arctan x。'],
        ['张宇', 'P1 常规：∫u dv = uv − ∫v du。写开就是 (x²/2)arctan x − ∫(x²/2)·1/(1+x²)dx，后面那项拆成 1 − 1/(1+x²)。'],
        ['学生', '结果是 (x²/2)arctan x − x/2 + (1/2)arctan x + C。'],
        ['张宇', '漂亮！缺什么补什么——分子次数比分母高，先拆出多项式，别硬算。'],
      ],
      point: '分部积分选 u 的原则：求导后更简单的当 u；有理式先做多项式拆分。' },
    { id: 'ex-series-01', topic: '级数', title: '比值判别法失效的那一秒',
      q: '判断 Σ 1/n 的敛散性。',
      turns: [
        ['学生', '比值法算出来 ρ=1，判别法失效，然后呢？'],
        ['张宇', 'ρ=1 就是判别法举手投降——它说「我不管了，你换人」。这时候别死磕。'],
        ['张宇', 'D1 回到定义：p 级数 Σ1/nᵖ，p≤1 发散、p>1 收敛。这是最基本的事实，比任何判别法都硬。'],
        ['张宇', '讲个故事：阿贝尔当年就靠「两块钱」——收敛半径的端点那一块钱，决定了整个级数的命运。端点单独判，别偷懒。'],
        ['学生', '所以调和级数发散，是因为 p=1 在边界上。'],
        ['张宇', '解无定法，观察得之。ρ=1 先别慌，回定义、找 p、看端点。'],
      ],
      point: '比值/根值法 ρ=1 时失效，回退到 p 级数、比较法或积分判别法。' },
    { id: 'ex-series-02', topic: '级数', title: '交错级数的莱布尼茨条件',
      q: '判断 Σ (−1)ⁿ/√n 的敛散，并说明是否绝对收敛。',
      turns: [
        ['学生', '通项趋于 0，是不是就收敛了？'],
        ['张宇', '通项趋于 0 只是必要条件，不是充分条件——这是概念模糊，技巧再多也是空中楼阁。'],
        ['张宇', 'D1 验条件：交错级数看 |uₙ| 是否单调递减且趋于 0。1/√n 单调降、趋于 0，莱布尼茨判定收敛。'],
        ['张宇', '再看绝对值：Σ1/√n 是 p=1/2 的 p 级数，发散。所以是条件收敛，不是绝对收敛。'],
        ['学生', '哦，收敛和绝对收敛是两码事。'],
        ['张宇', '对！命中交错级数就分两问：先问收不收敛，再问绝对不绝对。两个目标 O1、O2，别漏一个。'],
      ],
      point: '交错级数先验莱布尼茨两条件；再单独判断绝对值级数，区分条件/绝对收敛。' },
    { id: 'ex-lin-01', topic: '线代', title: '秩：矩阵真正的「个子」',
      q: '设 A 为 3×4 矩阵，r(A)=2，讨论 Ax=0 的解空间维数。',
      turns: [
        ['学生', '解空间维数是不是 4−2=2？'],
        ['张宇', '对！但你得说清楚为什么——这是「数形结合」的线性版：秩是矩阵真正站起来的维数，列数减秩就是被压掉的方向数。'],
        ['张宇', 'D1 定义：解空间维数 = n − r(A)，n 是未知量个数 4，r(A)=2，所以 2 个自由变量。'],
        ['张宇', 'P1 正向：写出基础解系含 4−2=2 个线性无关解向量，通解是它们的线性组合。'],
        ['学生', '所以不是看方程个数 3，而是看未知量个数和秩。'],
        ['张宇', '盯着分母写分子——这里就是盯着未知量数减秩。必考无疑，牢记于心！'],
      ],
      point: '齐次方程组解空间维数 = 未知量个数 n − 秩 r(A)，与方程个数无关。' },
    { id: 'ex-lin-02', topic: '线代', title: '相似对角化的充分必要条件',
      q: 'n 阶矩阵 A 可相似对角化的充要条件是什么？',
      turns: [
        ['学生', '有 n 个不同的特征值就可以对角化吧？'],
        ['张宇', '那是充分条件，不是充要条件！概念模糊，技巧再多也是空中楼阁。重特征值时也可能对角化。'],
        ['张宇', 'D1 真正的充要条件：A 有 n 个线性无关的特征向量。等价说法是：每个特征值的几何重数 = 代数重数。'],
        ['张宇', 'P4 逆否视角：某个特征值几何重数小于代数重数，就缺特征向量，不能对角化。'],
        ['学生', '所以要看重根那块能不能凑够无关向量。'],
        ['张宇', '对！拿到题先识别题型——对角化题就三件事：求特征值、求特征向量、数够不够 n 个。'],
      ],
      point: '可对角化充要条件是 n 个线性无关特征向量（几何重数=代数重数）；n 个不同特征值只是充分条件。' },
    { id: 'ex-deriv-01', topic: '导数与中值', title: '分段函数在分界点求导',
      q: 'f(x)=x²(x≤0), x·sin(1/x)(x>0)，讨论 f(x) 在 x=0 的可导性。',
      turns: [
        ['学生', '两边求导再代入 0 就行了。'],
        ['张宇', '分段函数分段处理，分界点单独求导！这是铁律。直接代入？右边那个导数在 0 处根本没定义。'],
        ['张宇', 'D1 回定义：f′(0)=lim(h→0)(f(h)−f(0))/h。左极限 lim h²/h=0；右极限 lim h·sin(1/x)/h = lim sin(1/h) 不存在。'],
        ['学生', '左右导数一个不存在，所以不可导。'],
        ['张宇', '对！连续不一定可导——先证连续（此处连续），再单独用定义求导。一首歌：喝前摇一摇，考前记一记，分界点单独记一记。'],
      ],
      point: '分段函数在分界点必须用导数定义分别求左右导数；不可直接对表达式求导后代入。' },
    { id: 'ex-deriv-02', topic: '导数与中值', title: '拉格朗日中值定理的构造',
      q: '证明：当 x>0 时，ln(1+x) < x。',
      turns: [
        ['学生', '设 f(x)=x−ln(1+x)，求导证单调？'],
        ['张宇', '可以，那是常规路径 P1。我给你看一个「脱胎换骨」：拉格朗日中值定理。'],
        ['张宇', 'D2 构造：对 ln(1+t) 在 [0,x] 用中值定理，存在 ξ∈(0,x) 使 ln(1+x)−ln1 = x·(1/(1+ξ))。'],
        ['张宇', '因为 ξ>0，所以 1/(1+ξ)<1，于是 ln(1+x)=x/(1+ξ)<x。'],
        ['学生', '中值定理还能这么用，把差变成导数乘区间长。'],
        ['张宇', '讲个轶事：拉格朗日当年就是靠这种「把差分变微分」的眼光，把分析学往前推了一大步。'],
      ],
      point: '证明不等式常用中值定理把函数差 c 转化为 f′(ξ)·区间长，再放大缩小导数。' },
    { id: 'ex-multi-01', topic: '多元与微分', title: '多元极值的必要与充分条件',
      q: 'z=f(x,y) 在点 (0,0) 处 fₓ=fᵧ=0，如何判断是否极值？',
      turns: [
        ['学生', '一阶偏导为 0 就是极值点吧？'],
        ['张宇', '一阶为 0 只是驻点，是「候选人」不是「录取通知」。多元函数还有鞍点这一说。'],
        ['张宇', 'D1 充分条件：算二阶 AC−B²。>0 且 A<0 极大，>0 且 A>0 极小，<0 不是极值，=0 判别法失效另想办法。'],
        ['张宇', 'D4 数形结合：马鞍面在原点一阶也全为 0，但沿 x 轴是极小、沿 y 轴是极大——一看图就明白为什么不是极值。'],
        ['学生', '所以二阶判别式才是分水岭。'],
        ['张宇', '数无形时少直觉，形无数时难入微。多元极值，先驻点、再 AC−B²、最后画个马鞍面压阵。'],
      ],
      point: '驻点只是必要条件；用二阶判别式 AC−B² 判定，=0 时需另法（定义或降维）。' },
    { id: 'ex-ode-01', topic: '多元与微分', title: '一阶线性微分方程的积分因子',
      q: '解 y′ + 2y/(1+x) = (1+x)³。',
      turns: [
        ['学生', '这是可分离变量的吗？'],
        ['张宇', '不是可分离，是一阶线性——看到 y′+P(x)y=Q(x) 这个长相，就条件反射：套公式或乘积分因子。'],
        ['张宇', 'D2 化归：积分因子 μ=e^{∫P dx}=e^{2ln(1+x)}=(1+x)²。两边乘它，左边凑成 (y·(1+x)²)′。'],
        ['张宇', 'P1 常规：积分得 y(1+x)² = ∫(1+x)⁵ dx = (1+x)⁶/6 + C，所以 y=(1+x)⁴/6 + C/(1+x)²。'],
        ['学生', '乘积分因子就是把左边凑成乘积的导数。'],
        ['张宇', '缺什么补什么——左边缺一个乘积结构，我们就造一个。这就是「创造条件」。'],
      ],
      point: '一阶线性方程乘积分因子 e^{∫P dx}，把左端化为乘积导数再积分。' },
    { id: 'ex-lim-04', topic: '极限', title: '洛必达不是万能药',
      q: '求 lim(x→0)(x²·sin(1/x))/sin x。',
      turns: [
        ['学生', '0/0 型，直接洛必达，分子求导有 2x sin(1/x) − cos(1/x)……咦，极限不存在？'],
        ['张宇', '停！洛必达的前提是「导数之比的极限存在」。这里导比振荡无极限，不代表原极限不存在——你这是把工具用反了。'],
        ['张宇', 'D2 换路：x²·sin(1/x)/sin x = (x/sin x)·(x·sin(1/x))。第一个因子趋于 1，第二个因子因为 |sin|≤1 被 x 夹成 0。'],
        ['学生', '所以答案是 0，用夹逼而不是洛必达。'],
        ['张宇', '对！无穷小乘有界量还是无穷小——这是「极限看两头」里的 bounded 一头。工具选错，越算越乱。'],
      ],
      point: '洛必达仅当导比极限存在时可用；振荡无导比时改用「无穷小×有界量」或夹逼。' },
    { id: 'ex-int-04', topic: '积分', title: '广义积分先看瑕点在哪',
      q: '判断 ∫₀¹ dx/√(1−x²) 的敛散并求值。',
      turns: [
        ['学生', '直接用反正弦原函数，结果是 π/2。'],
        ['张宇', '答案对，但步骤少了一环——瑕点在 x=1，这是广义积分，得先写成极限再代入。'],
        ['张宇', 'D1 定义：lim(t→1⁻)∫₀ᵗ dx/√(1−x²) = lim(t→1⁻)(arcsin t − 0) = π/2。极限存在，收敛。'],
        ['张宇', '再看 p 判别：瑕点附近 1/√(1−x) 是 p=1/2<1，收敛。两条路互相印证，稳。'],
        ['学生', '所以广义积分必须先找瑕点、再写成极限。'],
        ['张宇', '必考无疑，牢记于心！瑕点找不到，后面全白算。'],
      ],
      point: '广义积分先定位瑕点（或无穷远），写成极限后再求；用 p 判别法交叉验证。' },
    { id: 'ex-series-03', topic: '级数', title: '收敛半径的端点那一块钱',
      q: '求 Σ xⁿ/(n·2ⁿ) 的收敛域。',
      turns: [
        ['学生', '比值法：ρ=|x|/2，所以半径 R=2，收敛域 (−2,2)。'],
        ['张宇', '半径对了，收敛域错了——你漏了端点！阿贝尔的两块钱，就差在端点上。'],
        ['张宇', '端点 x=2：级数变 Σ1/n，调和级数发散。端点 x=−2：变 Σ(−1)ⁿ/n，交错且 1/n 单调降趋于 0，莱布尼茨收敛。'],
        ['学生', '所以收敛域是 [−2,2)。'],
        ['张宇', '对！半径只给开区间，端点必须单独代回去判——记得「喝前摇一摇，端点记一记」。'],
      ],
      point: '先求收敛半径得开区间，再把两个端点分别代入，用 p 级数/交错级数判别法定取舍。' },
    { id: 'ex-lin-03', topic: '线代', title: '特征值的两条快速性质',
      q: '设 3 阶矩阵 A 的特征值为 1, 2, 3，求 |A| 与 tr(A)。',
      turns: [
        ['学生', '要先把特征多项式写出来吗？'],
        ['张宇', '不用！这是送分题，考的是两条性质：行列式 = 特征值之积，迹 = 特征值之和。'],
        ['张宇', 'D1 原因：特征多项式 det(λI−A) 的常数项是 (−1)ⁿ|A|，λⁿ⁻¹ 项系数是 −tr(A)，对比根与系数关系即得。'],
        ['学生', '所以 |A| = 1×2×3 = 6，tr(A) = 1+2+3 = 6。'],
        ['张宇', '巧了，都是 6。相似矩阵特征值相同，所以这两条对相似变换也不变——记这两条，考场上能省半页纸。'],
      ],
      point: '行列式等于特征值之积、迹等于特征值之和；二者都在相似变换下保持不变。' },
  ]

  /** 强度三档的实际效果差异：同一道题在三种浓度下的讲法 */
  var INTENSITY = [
    { k: '克制', meter: 33,
      line: '只保留方法框架与关键提醒，去掉段子和金句。',
      same: 'O→D→P 三段式照走，所有数学结论、步骤、格式与动作协议完全不变。',
      sample: '「目标 O：求极限。条件 D：1^∞ 型。思路 P：取对数后用 ln(1+狗)~狗。结论 e²。」',
      when: '适合考前冲刺、只想要步骤、或同桌一起刷题不想被打扰的场景。',
      risk: '少了记忆钩子，长期看更容易「听懂幻觉」——当时会，隔天忘。' },
    { k: '标准', meter: 66,
      line: '按宇哥本色讲：该吐槽吐槽，该互动互动，推导一步不省。',
      same: '在完整 O→D→P 基础上，自然带出「我说清楚没」和一两句技巧金句。',
      sample: '「红笔拿出来！先盯目标——这是 1^∞。把它写成 (1+4/(x-1))^(x/2)，ln(1+狗)~狗，答案 e²。听懂没？」',
      when: '默认档。日常刷题、看讲解、判分讲评都用它，记忆点与严谨度平衡最好。',
      risk: '个别同学嫌吵——那种情况切「克制」，别硬扛。' },
    { k: '充分', meter: 100,
      line: '可自然多用标志性表达与金句，但绝不牺牲推导完整性。',
      same: '数学 correctness 是底线：段子只是「怎么说」，绝不改变「说什么」。',
      sample: '「立即推，放弃考研——开玩笑的！盯住目标 O，这是 1^∞ 标准相。狗只有乘除能换……54321 点火！答案 e²，命运像掌纹，握在自己手里。」',
      when: '想建立长期记忆、讲枯燥章节（级数证明、线代定理）或给自己打气时用。',
      risk: '信息密度高，别在限时模考里用，容易把节奏带慢。' },
  ]

  /** 金句库的结构化投影（原文逐字收录在 ZY_PERSONA，这里只做分类浏览） */
  var QUOTES = [
    { cat: 'A · 出圈口头禅', items: [
      '立即推，放弃考研！', '红笔拿出来，标准零分！', '我说清楚没？我说清楚了啊',
      '趁热打铁，赶紧做题', '必考无疑，牢记于心', '缺什么补什么，没有条件创造条件，自己动手丰衣足食',
      '解无定法，观察得之', '只要思路对，处处是巧合，不巧它就不是考题',
    ] },
    { cat: 'B · 技巧与知识点', items: [
      '数无形时少直觉，形无数时难入微，数形结合百般好',
      '极限看两头，导数看局部，积分看整体', '等价无穷小替换，乘除随便换、加减谨慎换',
      '分段函数分段处理，分界点单独求导', '不能喧宾夺主，主次分清楚',
      '喝前摇一摇，考前记一记', '无界变量不是无穷大，孙悟空上天入地也会回人间',
    ] },
    { cat: 'C · 扎心避坑', items: [
      '听着很简单，上手全不会，这就是大部分同学的现状', '光看不动笔，等于没学数学',
      '概念模糊，技巧再多也是空中楼阁', '别只会套模板，命题人最喜欢改条件坑人',
      '看着答案恍然大悟，合上本子两眼迷茫', '这就是典型的听懂幻觉',
      '你考试好坏，不影响我工资，学不学全靠自己',
    ] },
    { cat: 'D · 暖心励志', items: [
      '命运像掌纹，再曲折，终究握在自己手里', '想过成功，想过失败，但从来没想过放弃',
      '受N次伤，就要用N的N次方的动力努力', '光有雄心壮志没用，熬得住苦头，才能上岸',
      '没有酸甜苦辣，人们记不住这段备考岁月', '安于现状不是我的个性，碌碌无为不是我的目标',
      'You are more than what you have become now',
    ] },
  ]

  /** 命题套路卡：学生最容易被「改条件」坑到的地方，每张卡给识别信号 + 破法 */
  var TRAPS = [
    { t: '等价无穷小用在加减里', sig: '题目出现两个无穷小相减', why: '主部抵消后高阶项才是答案，直接换会得 0',
      fix: '先提公因式把差变成积，或整体展开到足够阶数',
      say: '狗只有乘除才能随便换，加减要谨慎！' },
    { t: '洛必达导比极限不存在', sig: '0/0 或 ∞/∞ 但求导后振荡', why: '导比无极限不代表原极限不存在，洛必达前提不满足',
      fix: '改用夹逼、单调有界或「无穷小×有界量」',
      say: '别只会套模板，命题人最喜欢改条件坑人。' },
    { t: '分段点直接求导', sig: '函数在分界点两侧表达式不同', why: '右侧导数在分界点未必有定义，代入法失效',
      fix: '用导数定义分别求左右导数，相等才可导',
      say: '分段函数分段处理，分界点单独求导。' },
    { t: '1^∞ 硬上洛必达', sig: '底数趋于 1、指数趋于无穷', why: '直接取对数后仍复杂，容易漏掉指数与狗的匹配',
      fix: '套 e^{lim (指数)·(底数−1)} 的标准式，再用 ln(1+狗)~狗',
      say: '缺什么补什么，没有条件创造条件。' },
    { t: '交错级数只验通项趋零', sig: '级数带 (−1)ⁿ 且要求敛散性', why: '通项趋零只是必要；还须 |uₙ| 单调减',
      fix: '先验莱布尼茨两条件，再单独判断绝对值级数',
      say: '概念模糊，技巧再多也是空中楼阁。' },
    { t: '比值法 ρ=1 就下结论', sig: '比值/根值判别算出 ρ=1', why: 'ρ=1 时判别法完全失效，不能说收敛也不能说发散',
      fix: '回退到 p 级数、比较判别法、积分判别法',
      say: '解无定法，观察得之。' },
    { t: '幂级数漏掉端点', sig: '求「收敛域」而非「收敛半径」', why: '半径只给开区间，端点敛散性要单独判',
      fix: '把 ±R 分别代入，用数项级数判别法定取舍',
      say: '阿贝尔两块钱，端点那一块最值钱。' },
    { t: '多元驻点当极值点', sig: 'fₓ=fᵧ=0 就问是否极值', why: '驻点只是必要条件，马鞍面反例遍地',
      fix: '算二阶 AC−B²：>0 再看 A 符号，<0 非极值，=0 另法',
      say: '数无形时少直觉，画个马鞍面压阵。' },
    { t: '对角化混淆充分与充要', sig: '问「可对角化的充要条件」', why: 'n 个不同特征值只是充分条件，重根也可能对角化',
      fix: '答 n 个线性无关特征向量（几何重数=代数重数）',
      say: '拿到题先识别题型，再匹配方法。' },
    { t: '齐次解空间维数看方程数', sig: 'm×n 矩阵讨论 Ax=0 解空间', why: '维数是 n−r(A)，与方程行数 m 无关',
      fix: '盯住未知量个数 n 减秩 r(A)',
      say: '盯着分母写分子，这里盯着未知量减秩。' },
    { t: '交换积分次序不画区域', sig: '二重积分改次序', why: '上下限写反是最常见失分点',
      fix: '先画积分区域：三角块用直角，圆环用极坐标',
      say: '遇到圆环叫小甜甜圈，三角块叫小薯条。' },
    { t: '分部积分选错 u', sig: '两类不同函数相乘求积分', why: '选错 u 会让积分越积越繁',
      fix: '求导后更简单的当 u（对数、反三角优先）',
      say: '被积函数越复杂，我越高兴——但要会选。' },
  ]

  /* ── 历史：只记「用过哪条示例 + 反馈」，不另算人格结论 ── */
  function historyGet(ctx) {
    var arr = storeGet(ctx, K_HISTORY, null)
    if (!Array.isArray(arr)) return []
    return arr.filter(function (x) {
      return x && typeof x === 'object' && typeof x.id === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(String(x.day || ''))
    }).map(function (x) {
      return { id: String(x.id), title: String(x.title || ''), topic: String(x.topic || ''),
        day: x.day, at: num(x.at, Date.now()), fb: x.fb === 'up' || x.fb === 'down' ? x.fb : '' }
    }).slice(-MAX_HISTORY)
  }
  function historySave(ctx, arr) { storeSet(ctx, K_HISTORY, (arr || []).slice(-MAX_HISTORY)); return arr }
  function exampleById(id) {
    for (var i = 0; i < EXAMPLES.length; i++) if (EXAMPLES[i].id === id) return EXAMPLES[i]
    return null
  }
  function recordUse(ctx, id) {
    var ex = exampleById(id)
    if (!ex) return historyGet(ctx)
    var arr = historyGet(ctx)
    arr.push({ id: ex.id, title: ex.title, topic: ex.topic, day: dkey(), at: Date.now(), fb: '' })
    return historySave(ctx, arr)
  }
  function setFeedback(ctx, id, fb) {
    var arr = historyGet(ctx)
    var target = fb === 'up' ? 'up' : 'down'
    for (var i = arr.length - 1; i >= 0; i--) {
      if (arr[i].id === id) { arr[i].fb = arr[i].fb === target ? '' : target; break }
    }
    return historySave(ctx, arr)
  }

  /* ══════════════ 4. 分析层：覆盖度 / 反馈 / 推荐 ══════════════ */

  function feedbackStats(hist) {
    var up = 0, down = 0
    ;(hist || []).forEach(function (x) { if (x.fb === 'up') up++; else if (x.fb === 'down') down++ })
    return { up: up, down: down, used: (hist || []).length }
  }
  function usedTopics(hist) {
    var set = {}
    ;(hist || []).forEach(function (x) { if (x.topic) set[x.topic] = 1 })
    return Object.keys(set)
  }
  function recommendOf(hist, topic) {
    var used = {}
    ;(hist || []).forEach(function (x) { used[x.id] = 1 })
    var pool = EXAMPLES.filter(function (e) { return topic === '全部' || e.topic === topic })
    if (!pool.length) return null
    var fresh = pool.filter(function (e) { return !used[e.id] })
    return (fresh.length ? fresh : pool)[0]
  }
  function insightsOf(hist, ctx) {
    var out = []
    var st = feedbackStats(hist)
    var topics = usedTopics(hist)
    if (!hist.length) {
      out.push({ level: 'info', title: '还没有用过任何示例', body: '在「示例对话」里点一条「标记用过」，这里就会开始统计你真正看过的讲法。' })
    } else {
      out.push({ level: 'info', title: '已回放 ' + st.used + ' 条示例', body: '覆盖 ' + topics.length + ' 类题型；当前浓度「' + intensity(ctx) + '」决定了这些讲法的语气浓度。' })
    }
    if (st.down > st.up && st.down >= 2) {
      out.push({ level: 'warn', title: '点踩多于点赞', body: '如果某类讲法老是不合口味，去「设置」把浓度切到「克制」——只留方法框架。' })
    }
    if (topics.length >= 4) {
      out.push({ level: 'good', title: '题型覆盖比较全', body: '极限 / 积分 / 级数 / 线代都碰过了。下一步该练「不看讲解自己走一遍 O→D→P」。' })
    }
    var r = recommendOf(hist, '全部')
    if (r) out.push({ level: 'good', title: '下一条建议看：' + r.title, body: '[ ' + r.topic + ' ] ' + r.point })
    return out.slice(0, 5)
  }

  /* ══════════════ 5. 完整样式层（含夜间与窄屏） ══════════════ */

  var CSS = [
    '.' + NS + 'page{display:flex;flex-direction:column;gap:12px;max-width:1180px;margin:0 auto}',
    '.' + NS + 'hero{border-radius:14px;padding:17px 19px;background:var(--glass-bg);border:1px solid var(--line);position:relative;overflow:hidden}',
    '.' + NS + 'hero:after{content:"";position:absolute;right:-40px;top:-60px;width:180px;height:180px;border-radius:50%;background:radial-gradient(circle,var(--accent-text),transparent 70%);opacity:.1;pointer-events:none}',
    '.' + NS + 'hero h3{margin:0 0 6px;font-size:16px;display:flex;align-items:center;gap:8px}',
    '.' + NS + 'hero p{margin:0;color:var(--text-secondary);font-size:12.5px;line-height:1.75}',
    '.' + NS + 'tabs{display:flex;gap:6px;flex-wrap:wrap;border-bottom:1px solid var(--line);padding-bottom:8px}',
    '.' + NS + 'tab{border:1px solid var(--line);background:transparent;color:var(--text-secondary);border-radius:9px;padding:6px 13px;font-size:12px;cursor:pointer;transition:.16s}',
    '.' + NS + 'tab:hover{border-color:var(--accent-text);color:var(--text-primary)}',
    '.' + NS + 'tab.on{background:var(--accent-text);border-color:var(--accent-text);color:var(--btn-text,#fff)}',
    '.' + NS + 'kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:9px}',
    '.' + NS + 'kpi{border:1px solid var(--line);border-radius:11px;padding:11px 12px;background:var(--glass-bg);min-width:0}',
    '.' + NS + 'kpi b{display:block;font-size:19px;line-height:1.35;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.' + NS + 'kpi span{font-size:11px;color:var(--text-secondary)}',
    '.' + NS + 'card{border:1px solid var(--line);border-radius:12px;padding:14px 16px;background:var(--glass-bg)}',
    '.' + NS + 'card h4{margin:0 0 10px;font-size:13.5px;display:flex;align-items:center;gap:7px}',
    '.' + NS + 'card-hd{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:10px;flex-wrap:wrap}',
    '.' + NS + 'card-hd h4{margin:0}',
    '.' + NS + 'grid2{display:grid;grid-template-columns:1fr 1fr;gap:12px}',
    '.' + NS + 'flow{display:flex;gap:8px;flex-wrap:wrap}',
    '.' + NS + 'flow span{flex:1;min-width:120px;border:1px solid var(--line);border-radius:10px;padding:10px 11px;font-size:12px;line-height:1.6}',
    '.' + NS + 'flow b{display:block;color:var(--accent-text);font-size:12px;margin-bottom:3px}',
    '.' + NS + 'odp-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:9px}',
    '.' + NS + 'odp{border:1px solid var(--line);border-radius:10px;padding:11px 12px;background:var(--glass-bg)}',
    '.' + NS + 'odp b{display:block;font-size:12.5px;margin-bottom:4px}',
    '.' + NS + 'odp small{display:block;font-size:10.5px;color:var(--accent-text);margin-bottom:6px}',
    '.' + NS + 'odp p{margin:0 0 6px;font-size:11.5px;line-height:1.7;color:var(--text-secondary)}',
    '.' + NS + 'odp em{font-style:normal;font-size:11px;color:var(--text-secondary);display:block;border-left:2px solid var(--line);padding-left:7px;margin-top:5px;line-height:1.6}',
    '.' + NS + 'topicbar{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px}',
    '.' + NS + 'ex{border:1px solid var(--line);border-radius:11px;padding:12px 14px;background:var(--glass-bg);margin-bottom:10px}',
    '.' + NS + 'ex-hd{display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px}',
    '.' + NS + 'ex-hd b{font-size:13px}',
    '.' + NS + 'tag{display:inline-block;border-radius:999px;padding:2px 8px;border:1px solid var(--line);font-size:10.5px;color:var(--text-secondary);margin-left:6px}',
    '.' + NS + 'q{font-size:12px;background:var(--bg-muted,var(--glass-bg));border-radius:8px;padding:8px 10px;margin-bottom:8px;line-height:1.7}',
    '.' + NS + 'turn{font-size:12px;line-height:1.75;padding:5px 0;border-bottom:1px dashed var(--line)}',
    '.' + NS + 'turn:last-child{border-bottom:0}',
    '.' + NS + 'turn u{text-decoration:none;font-weight:600;color:var(--accent-text);margin-right:4px}',
    '.' + NS + 'turn.st u{color:var(--blue)}',
    '.' + NS + 'point{font-size:11.5px;line-height:1.7;color:var(--text-secondary);background:var(--bg-muted,var(--glass-bg));border-radius:8px;padding:8px 10px;margin-top:8px}',
    '.' + NS + 'acts{display:flex;gap:7px;flex-wrap:wrap;margin-top:9px}',
    '.' + NS + 'btn{border:1px solid var(--line);background:var(--glass-bg);color:var(--text-primary);border-radius:8px;padding:6px 12px;font-size:11.5px;cursor:pointer;transition:.15s}',
    '.' + NS + 'btn:hover{border-color:var(--accent-text);color:var(--accent-text)}',
    '.' + NS + 'btn.pri{background:var(--accent-text);border-color:var(--accent-text);color:var(--btn-text,#fff)}',
    '.' + NS + 'btn.on{border-color:var(--ok,#2e9e5b);color:var(--ok,#2e9e5b)}',
    '.' + NS + 'note{display:flex;gap:9px;padding:9px 11px;border-radius:10px;margin-bottom:8px;border-left:3px solid var(--line);background:var(--glass-bg);font-size:12px;line-height:1.7}',
    '.' + NS + 'note.warn{border-left-color:var(--danger,#d9534f)}',
    '.' + NS + 'note.good{border-left-color:var(--ok,#2e9e5b)}',
    '.' + NS + 'note.info{border-left-color:var(--blue)}',
    '.' + NS + 'note b{display:block;font-size:12.5px;margin-bottom:2px}',
    '.' + NS + 'table{width:100%;border-collapse:collapse;font-size:12px}',
    '.' + NS + 'table th{text-align:left;color:var(--text-secondary);font-weight:500;padding:7px 8px;border-bottom:1px solid var(--line);font-size:11px}',
    '.' + NS + 'table td{padding:7px 8px;border-bottom:1px dashed var(--line)}',
    '.' + NS + 'table tr:last-child td{border-bottom:0}',
    '.' + NS + 'empty{color:var(--text-secondary);font-size:12px;line-height:1.8;padding:12px 0;text-align:center}',
    '.' + NS + 'field{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:9px 0;border-bottom:1px dashed var(--line);font-size:12px}',
    '.' + NS + 'field:last-child{border-bottom:0}',
    '.' + NS + 'field label{color:var(--text-secondary)}',
    '.' + NS + 'meter{height:7px;border-radius:99px;background:var(--line);overflow:hidden;margin:7px 0 2px}',
    '.' + NS + 'meter i{display:block;height:100%;border-radius:99px;background:linear-gradient(90deg,var(--blue),var(--accent-text));transition:width .25s}',
    '.' + NS + 'quote{padding:6px 0;font-size:11.8px;line-height:1.7;color:var(--text-secondary)}',
    '.' + NS + 'quote:before{content:"· ";color:var(--accent-text)}',
    '.' + NS + 'ic{display:inline-flex;align-items:center;justify-content:center;width:15px;height:15px;vertical-align:-2px}',
    '.' + NS + 'ic svg{width:15px;height:15px;fill:none;stroke:currentColor;stroke-width:1.8}',
    '.' + NS + 'panel{display:flex;flex-direction:column;gap:7px;font-size:12px}',
    '.' + NS + 'top{display:flex;justify-content:space-between;align-items:center;gap:6px}',
    '.' + NS + 'pill{border-radius:999px;padding:3px 9px;border:1px solid var(--line);font-size:11px;color:var(--text-secondary)}',
    '.' + NS + 'chain{font-size:11.5px;color:var(--text-secondary);line-height:1.6}',
    '@media(max-width:820px){.' + NS + 'kpis{grid-template-columns:repeat(2,1fr)}.' + NS + 'grid2,.' + NS + 'odp-grid{grid-template-columns:1fr}}',
    'html[data-theme="night"] .' + NS + 'odp em{border-left-color:#4a5568}',
  ].join('\n')
  function style(ctx) { try { if (ctx && ctx.css && typeof ctx.css.add === 'function') ctx.css.add(CSS, 'skin') } catch (e) { } }

  /* ══════════════ 6. 视图 ══════════════ */

  function viewOverview(ctx, S) {
    var out = []
    var st = feedbackStats(S.hist)
    out.push('<div class="' + NS + 'hero"><h3>' + I('cpBrain', '脑') + ' 张宇·三向解题人格</h3>'
      + '<p>先锁定题目要达成什么，再逐条挖条件（定义/化归/拼接/特殊值），最后从常规、反证、归纳、逆否里选路径。'
      + '当前人格浓度：<b>' + esc(S.lv) + '</b>。所有提示词口径逐字保留，本页只是可读投影。</p></div>')
    out.push('<div class="' + NS + 'kpis">')
    ;[['已用示例', String(st.used), '条'], ['覆盖题型', String(usedTopics(S.hist).length), '类'],
      ['点赞', String(st.up), '次'], ['点踩', String(st.down), '次']].forEach(function (x) {
      out.push('<div class="' + NS + 'kpi"><b>' + esc(x[1]) + '</b><span>' + esc(x[0]) + ' ' + esc(x[2]) + '</span></div>')
    })
    out.push('</div>')
    out.push('<div class="' + NS + 'card"><h4>' + I('cpBrain', '法') + ' 三向解题法 O → D → P</h4><div class="' + NS + 'flow">'
      + ODP_CARDS.filter(function (c) { return c.k === 'O' || c.k === 'D1' || c.k === 'P1' }).map(function (c) {
        return '<span><b>' + esc(c.k) + ' · ' + esc(c.t) + '</b>' + esc(flat(c.body).slice(0, 46)) + '…</span>'
      }).join('') + '</div>'
      + '<div class="' + NS + 'acts"><button class="' + NS + 'btn" data-act="tab" data-v="method">看完整九张卡</button></div></div>')
    out.push('<div class="' + NS + 'grid2">')
    out.push('<section class="' + NS + 'card"><h4>' + I('cpBrain', '判') + ' 从你的使用记录里读出的判断</h4>'
      + S.insights.map(function (x) {
        return '<div class="' + NS + 'note ' + esc(x.level) + '"><div><b>' + esc(x.title) + '</b>' + esc(x.body) + '</div></div>'
      }).join('') + '</section>')
    var r = recommendOf(S.hist, '全部')
    out.push('<section class="' + NS + 'card"><h4>' + I('cpBrain', '荐') + ' 下一条建议回放</h4>'
      + (r ? '<div class="' + NS + 'ex" style="margin:0"><div class="' + NS + 'ex-hd"><b>' + esc(r.title) + '</b><span class="' + NS + 'tag">' + esc(r.topic) + '</span></div>'
        + '<div class="' + NS + 'point">' + esc(r.point) + '</div>'
        + '<div class="' + NS + 'acts"><button class="' + NS + 'btn pri" data-act="tab" data-v="examples">去回放</button></div></div>'
        : '<div class="' + NS + 'empty">还没有可推荐的示例。</div>')
      + '</section>')
    out.push('</div>')
    if (S.cfg.showGolden) {
      out.push('<section class="' + NS + 'card"><h4>' + I('cpBrain', '句') + ' 今日金句（每次刷新换一条）</h4>'
        + '<div class="' + NS + 'quote">' + esc(S.golden) + '</div></section>')
    }
    return out.join('')
  }

  function viewMethod(ctx, S) {
    var out = []
    out.push('<section class="' + NS + 'card"><h4>' + I('cpBrain', '法') + ' 九张方法论卡（O / D1-D4 / P1-P4）</h4>'
      + '<p style="font-size:12px;line-height:1.8;color:var(--text-secondary);margin:0 0 10px">'
      + '这九张卡是提示词 ZY_ODP 的可读展开。讲题时严格按 O→D→P 三段呈现，结尾点明「目标-条件-思路」如何对接。</p>'
      + '<div class="' + NS + 'odp-grid">' + ODP_CARDS.map(function (c) {
        return '<div class="' + NS + 'odp"><b>' + esc(c.k) + ' · ' + esc(c.t) + '</b>'
          + '<small>' + esc(c.sub) + '</small><p>' + esc(c.body) + '</p>'
          + '<em>' + esc(c.cue) + '</em><em>' + esc(c.pit) + '</em></div>'
      }).join('') + '</div></section>')
    out.push('<section class="' + NS + 'card"><h4>三段式闭环怎么落地</h4>'
      + '<div class="' + NS + 'flow">'
      + '<span><b>① O 盯住目标</b>先翻译成一个明确动作；一题多问编号 O1、O2。</span>'
      + '<span><b>② D 细节处理</b>定义 → 等价改写 → 拼接条件 → 特殊值，能挖的都挖出来。</span>'
      + '<span><b>③ P 检索思路</b>常规 / 反证 / 归纳 / 逆否，择优录取那一条。</span>'
      + '</div><p style="font-size:12px;line-height:1.8;color:var(--text-secondary);margin:10px 0 0">'
      + '注意：浓度档位只改「怎么说」，这九张卡的顺序、名称与数学结论在任何档位下都不变。'
      + '方法卡（insp.gen）生成时 steps 会显式标注每步属于 O / D / P 哪一环。</p></section>')
    out.push('<section class="' + NS + 'card"><h4>' + I('cpBrain', '坑') + ' 命题套路卡库（' + TRAPS.length + ' 张）</h4>'
      + '<p style="font-size:12px;line-height:1.8;color:var(--text-secondary);margin:0 0 10px">'
      + '每张卡给「识别信号 → 为什么是坑 → 怎么破 → 宇哥口径」。看到信号就该条件反射，别等踩了才想起。</p>'
      + TRAPS.map(function (t, i) {
        return '<div class="' + NS + 'odp" style="margin-bottom:8px"><b>' + (i + 1) + '. ' + esc(t.t) + '</b>'
          + '<small>识别信号：' + esc(t.sig) + '</small>'
          + '<p>为什么是坑：' + esc(t.why) + '</p>'
          + '<em>破法：' + esc(t.fix) + '</em><em>口径：' + esc(t.say) + '</em></div>'
      }).join('') + '</section>')
    return out.join('')
  }

  function exampleCard(ex, S) {
    var used = false
    S.hist.forEach(function (h) { if (h.id === ex.id) used = true })
    var fb = ''
    S.hist.forEach(function (h) { if (h.id === ex.id && h.fb) fb = h.fb })
    var out = ['<div class="' + NS + 'ex"><div class="' + NS + 'ex-hd">']
    out.push('<b>' + esc(ex.title) + '</b><span><span class="' + NS + 'tag">' + esc(ex.topic) + '</span>'
      + '<span class="' + NS + 'tag">' + esc(ex.id) + '</span></span></div>')
    out.push('<div class="' + NS + 'q">' + esc(ex.q) + '</div>')
    ex.turns.forEach(function (t) {
      out.push('<div class="' + NS + 'turn' + (t[0] === '学生' ? ' st' : '') + '"><u>' + esc(t[0]) + '：</u>' + esc(t[1]) + '</div>')
    })
    out.push('<div class="' + NS + 'point">' + esc(ex.point) + '</div>')
    out.push('<div class="' + NS + 'acts">'
      + '<button class="' + NS + 'btn' + (used ? ' pri' : '') + '" data-act="use" data-v="' + esc(ex.id) + '">' + (used ? '已用过 · 再记一次' : '标记用过') + '</button>'
      + '<button class="' + NS + 'btn' + (fb === 'up' ? ' on' : '') + '" data-act="fb" data-v="' + esc(ex.id) + '" data-fb="up">点赞' + (fb === 'up' ? ' 已' : '') + '</button>'
      + '<button class="' + NS + 'btn' + (fb === 'down' ? ' on' : '') + '" data-act="fb" data-v="' + esc(ex.id) + '" data-fb="down">点踩' + (fb === 'down' ? ' 已' : '') + '</button>'
      + '</div></div>')
    return out.join('')
  }

  function viewExamples(ctx, S) {
    var out = []
    out.push('<section class="' + NS + 'card"><div class="' + NS + 'card-hd"><h4>' + I('cpBrain', '例') + ' 脱口秀式讲题示例库</h4>'
      + '<span class="muted-sm" style="font-size:11px">共 ' + EXAMPLES.length + ' 条 · 当前浓度 ' + esc(S.lv) + '</span></div>')
    out.push('<div class="' + NS + 'topicbar">' + TOPICS.map(function (t) {
      var n = t === '全部' ? EXAMPLES.length : EXAMPLES.filter(function (e) { return e.topic === t }).length
      return '<button class="' + NS + 'btn' + (S.topic === t ? ' pri' : '') + '" data-act="topic" data-v="' + esc(t) + '">' + esc(t) + ' ' + n + '</button>'
    }).join('') + '</div>')
    var pool = EXAMPLES.filter(function (e) { return S.topic === '全部' || e.topic === S.topic })
    if (!pool.length) out.push('<div class="' + NS + 'empty">这个题型还没有示例。</div>')
    else pool.forEach(function (e) { out.push(exampleCard(e, S)) })
    out.push('</section>')
    return out.join('')
  }

  function viewScopes(ctx, S) {
    var out = []
    out.push('<section class="' + NS + 'card"><h4>' + I('cpBrain', '域') + ' 作用域与开关（与 promptAugment 一一对应）</h4>'
      + '<p style="font-size:12px;line-height:1.8;color:var(--text-secondary);margin:0 0 10px">'
      + '下表六个 scope 与注册时的 promptAugment 逐条对应。改浓度只影响 build 末尾追加的 zyExtra() 一句，不改动任何 scope 的 ctx 与提示词主体。</p>'
      + '<table class="' + NS + 'table"><thead><tr><th>ctx</th><th>场景</th><th>门控</th><th>build 组成</th><th>说明</th></tr></thead><tbody>'
      + SCOPES.map(function (s) {
        return '<tr><td>' + esc(s.ctx) + '</td><td>' + esc(s.name) + '</td><td>' + esc(s.gate) + '</td>'
          + '<td>' + esc(s.build) + '</td><td>' + esc(s.note) + '</td></tr>'
      }).join('') + '</tbody></table></section>')
    out.push('<section class="' + NS + 'card"><h4>浓度开关实际改了什么</h4>'
      + INTENSITY.map(function (x) {
        return '<div class="' + NS + 'odp" style="margin-bottom:8px"><b>' + esc(x.k) + '（当前' + (x.k === S.lv ? ' · 生效中' : '') + '）</b>'
          + '<div class="' + NS + 'meter"><i style="width:' + x.meter + '%"></i></div>'
          + '<p>' + esc(x.line) + ' ' + esc(x.same) + '</p>'
          + '<em>' + esc(x.sample) + '</em><em>适用：' + esc(x.when) + '</em><em>注意：' + esc(x.risk) + '</em></div>'
      }).join('') + '</section>')
    out.push('<section class="' + NS + 'card"><h4>与其他人格包的分工</h4>'
      + '<p style="font-size:12px;line-height:1.8;color:var(--text-secondary);margin:0">'
      + '苏格拉底模式若同时启用，它决定「这轮给不给答案、给多少」，本插件只决定「用什么口吻说」。'
      + '两者冲突时以苏格拉底的教学流程条款为准 —— 这是原提示词里写死的仲裁规则，本插件不改它。</p></section>')
    return out.join('')
  }

  function viewHistory(ctx, S) {
    var out = []
    out.push('<section class="' + NS + 'card"><div class="' + NS + 'card-hd"><h4>' + I('cpBrain', '史') + ' 使用与反馈历史</h4>'
      + '<span class="' + NS + 'acts" style="margin:0">'
      + '<button class="' + NS + 'btn" data-act="export-json">导出 JSON</button>'
      + '<button class="' + NS + 'btn" data-act="export-md">导出报告</button>'
      + '<button class="' + NS + 'btn" data-act="clear-history">清空历史</button>'
      + '</span></div>')
    if (!S.hist.length) {
      out.push('<div class="' + NS + 'empty">还没有记录。在「示例对话」里点「标记用过」，或在「设置」里关掉自动记录。</div>')
    } else {
      out.push('<table class="' + NS + 'table"><thead><tr><th>日期</th><th>示例</th><th>题型</th><th>反馈</th></tr></thead><tbody>')
      S.hist.slice().reverse().slice(0, 60).forEach(function (h) {
        out.push('<tr><td>' + esc(h.day) + '</td><td>' + esc(h.title) + '</td><td>' + esc(h.topic) + '</td>'
          + '<td>' + (h.fb === 'up' ? '点赞' : h.fb === 'down' ? '点踩' : '—') + '</td></tr>')
      })
      out.push('</tbody></table>')
      if (S.hist.length > 60) out.push('<p class="muted-sm" style="font-size:11px">仅显示最近 60 条，导出文件里是全部 ' + S.hist.length + ' 条。</p>')
    }
    out.push('</section>')
    out.push('<section class="' + NS + 'card"><h4>金句库分类浏览</h4>'
      + QUOTES.map(function (g) {
        return '<div style="margin-bottom:10px"><b style="font-size:12px">' + esc(g.cat) + '</b>'
          + g.items.map(function (q) { return '<div class="' + NS + 'quote">' + esc(q) + '</div>' }).join('') + '</div>'
      }).join('') + '</section>')
    return out.join('')
  }

  function viewConfig(ctx, S) {
    var c = S.cfg
    var out = []
    out.push('<section class="' + NS + 'card"><h4>' + I('cpBrain', '设') + ' 人格浓度（api.config 契约项）</h4>'
      + '<div class="' + NS + 'field"><label>人格浓度（等同插件配置 intensity）</label>'
      + '<span>' + LEVELS.map(function (v) {
        return '<button class="' + NS + 'btn' + (v === S.lv ? ' pri' : '') + '" data-act="level" data-v="' + v + '" style="margin-left:4px">' + v + '</button>'
      }).join('') + '</span></div>'
      + '<p class="muted-sm" style="font-size:11.5px;line-height:1.8">这一项就是注册时 config 里的 intensity；切档会同时写入 ctx.config 与插件配置，提示词里的 zyExtra() 立即生效。</p></section>')
    out.push('<section class="' + NS + 'card"><h4>附加设置（仅 UI 层，不动 api.config）</h4>'
      + '<div class="' + NS + 'field"><label>自动记录示例回放</label>'
      + '<button class="' + NS + 'btn' + (c.autoRecord ? ' pri' : '') + '" data-act="cfg" data-v="autoRecord">' + (c.autoRecord ? '已开启' : '已关闭') + '</button></div>'
      + '<div class="' + NS + 'field"><label>显示常驻面板</label>'
      + '<button class="' + NS + 'btn' + (c.showPanel ? ' pri' : '') + '" data-act="cfg" data-v="showPanel">' + (c.showPanel ? '显示' : '隐藏') + '</button></div>'
      + '<div class="' + NS + 'field"><label>概览页显示今日金句</label>'
      + '<button class="' + NS + 'btn' + (c.showGolden ? ' pri' : '') + '" data-act="cfg" data-v="showGolden">' + (c.showGolden ? '显示' : '隐藏') + '</button></div>'
      + '<div class="' + NS + 'field"><label>默认题型筛选</label><select data-act="cfg-topic">'
      + TOPICS.map(function (t) { return '<option value="' + esc(t) + '"' + (c.defaultTopic === t ? ' selected' : '') + '>' + esc(t) + '</option>' }).join('')
      + '</select></div></section>')
    out.push('<section class="' + NS + 'card"><h4>边界与隐私</h4>'
      + '<p style="font-size:12px;line-height:1.8;color:var(--text-secondary);margin:0">'
      + '本插件不重算任何学习数据，也不上传；历史只存「用过哪条示例 + 点赞/点踩」，最多 ' + MAX_HISTORY + ' 条。'
      + '人格口吻只加在「怎么说」，数学结论保持绝对准确，原有输出格式 / JSON 字段 / 动作协议一律不变。'
      + '清空历史不可撤销，建议先导出。</p></section>')
    return out.join('')
  }

  var VIEWS = [
    { k: 'overview', t: '人格概览', f: viewOverview },
    { k: 'method', t: '方法论', f: viewMethod },
    { k: 'examples', t: '示例对话', f: viewExamples },
    { k: 'scopes', t: '作用域与开关', f: viewScopes },
    { k: 'history', t: '历史', f: viewHistory },
    { k: 'config', t: '设置', f: viewConfig },
  ]

  /* ══════════════ 7. Shell：状态 + 事件委托 ══════════════ */

  function pickGolden(hist) {
    var all = []
    QUOTES.forEach(function (g) { g.items.forEach(function (q) { all.push(q) }) })
    if (!all.length) return ''
    var idx = Math.abs(hashStr((hist || []).length + ':' + dkey())) % all.length
    return all[idx]
  }
  function stateOf(ctx) {
    var cfg = cfgGet(ctx)
    var hist = historyGet(ctx)
    var v = 'overview'
    try { if (ctx && ctx.keep && typeof ctx.keep.get === 'function') v = ctx.keep.get(K_LAST_VIEW) || v } catch (e) { }
    var topic = cfg.defaultTopic
    try { if (ctx && ctx.keep && typeof ctx.keep.get === 'function') topic = ctx.keep.get(K_LAST_TOPIC) || topic } catch (e) { }
    return {
      cfg: cfg, hist: hist, lv: intensity(ctx),
      topic: TOPICS.indexOf(topic) >= 0 ? topic : '全部',
      view: VIEWS.some(function (x) { return x.k === v }) ? v : 'overview',
      insights: insightsOf(hist, ctx), golden: pickGolden(hist),
    }
  }
  function reportMD(ctx, S) {
    var lines = []
    lines.push('# 张宇·三向解题人格 · 使用报告')
    lines.push('')
    lines.push('> 生成时间：' + new Date().toLocaleString())
    lines.push('> 人格浓度：' + S.lv + ' · 示例条目：' + EXAMPLES.length + ' · 历史记录：' + S.hist.length)
    lines.push('')
    lines.push('## 方法论骨架（O → D → P）')
    lines.push('')
    ODP_CARDS.forEach(function (c) { lines.push('- **' + c.k + ' ' + c.t + '**：' + flat(c.body)) })
    lines.push('')
    lines.push('## 作用域清单')
    lines.push('')
    SCOPES.forEach(function (s) { lines.push('- ' + s.ctx + '（' + s.name + '）：' + s.note) })
    lines.push('')
    lines.push('## 强度三档差异')
    lines.push('')
    INTENSITY.forEach(function (x) { lines.push('- **' + x.k + '**：' + x.line + ' 适用：' + x.when) })
    lines.push('')
    lines.push('## 使用与反馈历史')
    lines.push('')
    lines.push('| 日期 | 示例 | 题型 | 反馈 |')
    lines.push('|---|---|---|---|')
    S.hist.slice().reverse().forEach(function (h) {
      lines.push('| ' + h.day + ' | ' + h.title + ' | ' + h.topic + ' | ' + (h.fb || '—') + ' |')
    })
    return lines.join('\n')
  }
  function doAct(ctx, S, root, act, value, fb) {
    if (act === 'tab' && VIEWS.some(function (x) { return x.k === value })) {
      S.view = value
      try { if (ctx && ctx.keep && typeof ctx.keep.set === 'function') ctx.keep.set(K_LAST_VIEW, value) } catch (e) { }
      render(root, ctx, S); return
    }
    if (act === 'topic' && TOPICS.indexOf(value) >= 0) {
      S.topic = value
      try { if (ctx && ctx.keep && typeof ctx.keep.set === 'function') ctx.keep.set(K_LAST_TOPIC, value) } catch (e) { }
      render(root, ctx, S); return
    }
    if (act === 'level' && LEVELS.indexOf(value) >= 0) {
      setIntensity(ctx, value)
      S.lv = value
      S.insights = insightsOf(S.hist, ctx)
      toast(ctx, '人格浓度已切到「' + value + '」', 'success')
      render(root, ctx, S); return
    }
    if (act === 'use') {
      S.hist = recordUse(ctx, value)
      S.insights = insightsOf(S.hist, ctx)
      toast(ctx, '已标记用过这条示例', 'success')
      render(root, ctx, S); return
    }
    if (act === 'fb') {
      S.hist = setFeedback(ctx, value, fb)
      S.insights = insightsOf(S.hist, ctx)
      render(root, ctx, S); return
    }
    if (act === 'cfg') {
      var patch = {}
      patch[value] = !S.cfg[value]
      S.cfg = cfgSet(ctx, patch)
      render(root, ctx, S); return
    }
    if (act === 'export-json') {
      try {
        ctx.api.download('张宇三向解题_历史_' + dkey() + '.json', JSON.stringify(S.hist, null, 2), 'application/json')
        toast(ctx, '已导出 ' + S.hist.length + ' 条历史', 'success')
      } catch (e) { toast(ctx, '导出失败：' + ((e && e.message) || e), 'danger') }
      return
    }
    if (act === 'export-md') {
      try {
        ctx.api.download('张宇三向解题_报告_' + dkey() + '.md', reportMD(ctx, S), 'text/markdown;charset=utf-8')
        toast(ctx, '报告已导出', 'success')
      } catch (e) { toast(ctx, '导出失败：' + ((e && e.message) || e), 'danger') }
      return
    }
    if (act === 'clear-history') {
      var ok = true
      try { if (ctx.api && typeof ctx.api.confirm === 'function') ok = ctx.api.confirm('清空 ' + S.hist.length + ' 条历史记录？此操作不能撤销。') } catch (e) { ok = true }
      if (!ok) return
      S.hist = historySave(ctx, [])
      S.insights = insightsOf(S.hist, ctx)
      toast(ctx, '历史已清空', 'info')
      render(root, ctx, S); return
    }
  }
  function render(root, ctx, S) {
    if (!root) return
    var header = '<div class="' + NS + 'tabs" role="tablist">'
      + VIEWS.map(function (v) {
        return '<button class="' + NS + 'tab' + (S.view === v.k ? ' on' : '') + '" data-act="tab" data-v="' + v.k + '" role="tab"'
          + ' aria-selected="' + (S.view === v.k ? 'true' : 'false') + '">' + esc(v.t) + '</button>'
      }).join('') + '</div>'
    var cur = VIEWS.filter(function (v) { return v.k === S.view })[0] || VIEWS[0]
    var body = ''
    try { body = cur.f(ctx, S) } catch (e) { body = '<div class="' + NS + 'empty">这个视图渲染失败了：' + esc((e && e.message) || e) + '</div>' }
    root.innerHTML = '<div class="' + NS + 'page">' + header + body + '</div>'
  }
  function mount(el, ctx) {
    style(ctx)
    var S = stateOf(ctx)
    render(el, ctx, S)
    var onClick = function (ev) {
      var t = ev.target
      for (var i = 0; i < 5 && t && t !== el; i++, t = t.parentElement) {
        var act = t.getAttribute && t.getAttribute('data-act')
        if (!act) continue
        ev.preventDefault()
        doAct(ctx, S, el, act, t.getAttribute('data-v'), t.getAttribute('data-fb'))
        return
      }
    }
    var onChange = function (ev) {
      var t = ev.target
      if (!t || !t.getAttribute) return
      if (t.getAttribute('data-act') === 'cfg-topic') {
        S.cfg = cfgSet(ctx, { defaultTopic: TOPICS.indexOf(t.value) >= 0 ? t.value : '全部' })
        S.topic = S.cfg.defaultTopic
        render(el, ctx, S)
      }
    }
    el.addEventListener('click', onClick)
    el.addEventListener('change', onChange)
    return function () {
      el.removeEventListener('click', onClick)
      el.removeEventListener('change', onChange)
      el.innerHTML = ''
    }
  }

  /* ══════════════ 8. 常驻面板 ══════════════ */

  function panel(ctx) {
    style(ctx)
    if (!cfgGet(ctx).showPanel) return ''
    var lv = intensity(ctx)
    var st = feedbackStats(historyGet(ctx))
    var meta = INTENSITY.filter(function (x) { return x.k === lv })[0] || INTENSITY[1]
    return '<div class="' + NS + 'panel">'
      + '<div class="' + NS + 'top"><span>' + I('cpBrain', '脑') + ' 张宇·三向解题</span><span class="' + NS + 'pill">' + esc(lv) + '</span></div>'
      + '<div class="' + NS + 'meter"><i style="width:' + meta.meter + '%"></i></div>'
      + '<div class="' + NS + 'chain">O 盯住目标 → D 细节处理 → P 检索思路</div>'
      + '<div class="' + NS + 'chain">已回放 ' + st.used + ' 条示例 · 点赞 ' + st.up + ' / 点踩 ' + st.down + '</div>'
      + '<button class="' + NS + 'btn btn-sm btn-ghost" data-act="open-zy">打开人格工作台</button></div>'
  }

  /* ══════════════ 9. 注册（契约原样保留） ══════════════ */

  var api = {
    id: 'zhangyu-3x', name: '张宇·三向解题人格', version: VERSION, author: '内置',
    desc: '张宇人格 + 三向解题法，覆盖教练/出题/判分/拍题',
    tools: [{ id: 'zhangyu-3x-page', title: '张宇·三向解题', icon: '' + U.icon('cpBrain') + '', mount: function (el, ctx) { return mount(el, ctx) } }],
    panels: [{ id: 'zy-today', title: '张宇·三向解题', icon: '' + U.icon('cpBrain') + '', width: 310, height: 200, render: function (ctx) { return panel(ctx) } }],
    config: [{ key: 'intensity', label: '人格浓度', type: 'select', default: '标准', options: ['克制', '标准', '充分'] }],
    queries: [
      { key: 'zy-method', label: '张宇·三向解题方法论', run: function (ctx) {
        var methods = function () { return ['O 盯住目标', 'D 细节处理', 'P 检索思路'] }
        return '方法论：' + methods().join(' → ') + '。先锁定题目要达成什么，再逐条挖条件（定义/化归/拼接/特殊值），最后从常规、反证、归纳、逆否里选路径。（浓度：' + intensity(ctx) + '）'
      } },
      { key: 'zy-intensity', label: '张宇·三向解题人格浓度', run: function (ctx) {
        var v = intensity(ctx)
        return '张宇·三向解题当前人格浓度为「' + v + '」。' + (v === '克制' ? '只讲框架，少用口头禅。' : (v === '充分' ? '可多用标志性金句。' : '按老师本色讲解。')) + '可在插件配置里调整。'
      } },
    ],
    shortcuts: [{ key: 'alt+z', label: '打开张宇·三向解题工作台', run: function (ctx) { try { ctx.api.goTool('zhangyu-3x-page') } catch (e) { } } }],
    memory: '用户装有「张宇·三向解题」插件，覆盖教练/出题/判分/拍题/方法卡/例题六个场景。方法论：O 盯住目标、D 细节处理、P 检索思路。用户提到该老师或对应解题风格时，按其人格与方法组织回答；人格浓度可在插件配置里调。',

    /* ★ 原样保留：六条 promptAugment 的 ctx / name / note / build 与常量文本逐字不动 */
    promptAugment: [
      { ctx: 'copilot.chat', name: '教练·张宇人格', note: '全程以张宇风格讲题答疑（不门控，覆盖教练全对话）', build: function () { return ZY_PERSONA + ZY_ODP + zyExtra() } },
      { ctx: 'quiz.gen', name: '出题·张宇', note: '按 O→D→P 命可验证的题', build: function () { return ZY_PERSONA + ZY_QUIZ } },
      { ctx: 'quiz.answer', name: '判分讲解·张宇', note: '用 O→D→P 拆采分点讲评', build: function () { return ZY_PERSONA + ZY_ODP + zyExtra() } },
      { ctx: 'photo.analyze', name: '拍题·张宇', note: '识别后按三向法讲思路', build: function () { return ZY_PERSONA + ZY_ODP + zyExtra() } },
      { ctx: 'insp.gen', name: '方法卡·张宇', note: '步骤骨架用 O→D→P', build: function () { return ZY_ODP_CARD } },
      { ctx: 'insp.example', name: '例题·张宇', note: '锁定目标→处理条件→选择思路', build: function () { return ZY_PERSONA + ZY_ODP + zyExtra() } }
    ]
  }

  if (typeof window !== 'undefined' && window.__ZY_DEBUG__) {
    window.__zyInternals = {
      esc: esc, num: num, clamp: clamp, flat: flat, trunc: trunc, dkey: dkey, hashStr: hashStr, I: I,
      intensity: intensity, setIntensity: setIntensity, cfgGet: cfgGet, cfgSet: cfgSet,
      ODP_CARDS: ODP_CARDS, SCOPES: SCOPES, EXAMPLES: EXAMPLES, INTENSITY: INTENSITY, QUOTES: QUOTES, TRAPS: TRAPS,
      historyGet: historyGet, historySave: historySave, recordUse: recordUse, setFeedback: setFeedback,
      feedbackStats: feedbackStats, usedTopics: usedTopics, recommendOf: recommendOf, insightsOf: insightsOf,
      reportMD: reportMD, mount: mount, VIEWS: VIEWS, MAX_HISTORY: MAX_HISTORY,
      ZY_PERSONA: ZY_PERSONA, ZY_ODP: ZY_ODP, ZY_QUIZ: ZY_QUIZ, ZY_ODP_CARD: ZY_ODP_CARD, zyExtra: zyExtra,
    }
  }

  PluginBus.register(api)
})()
