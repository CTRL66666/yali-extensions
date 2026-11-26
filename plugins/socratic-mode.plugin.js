/* socratic-mode.plugin.js — 苏格拉底追问模式 · v1.2.0
 *
 * v1.1.0 有一个 promptAugment + 一块瘦 UI（168 行）：档位看得见，但「三档到底差多深、
 * 用什么模板问、什么时候该放弃追问直接讲」都藏在提示词的仲裁条款里，用户看不到。
 * v1.2.0 按成熟插件形态重造：五视图 shell + 会话/反馈历史 + 可导出报告，
 * 把「引导的层级、提问的模板、不给答案的会话、切回直接讲解的判据」变成可查的课。
 *
 * 【绝不改动的契约】下方 api.promptAugment 是历史契约，逐字保留：
 *   market-plugins.test.ts 断言「苏格拉底」「引导」与仲裁段；
 *   prompt-augment.test.ts 真重放后断言只有一条 copilot.chat 拓展器。
 *   本文件只加能力面，不动那一段的任何一个字符。
 *   · id 'socratic-mode' / version 升到 1.2.0 / 工具 'socratic-page' / 面板 'sq-today'；
 *   · 查询 'sq-strength' / config key 'strength' / LEVELS ['轻推','中等','死不松口']；
 *   · 快捷键 alt+s / memory 原样保留。
 *
 * 【数据口径】仲裁条款是唯一事实源；UI 里的层级设计、模板库、会话示例都是它的可读投影。
 *   历史落在本机 ctx.data（sqHistory），只记「看过哪段会话 + 反馈 + 是否突破」。
 */
;(function () {
  'use strict'

  var VERSION = '1.2.0'
  var PID = 'socratic-mode'
  var NS = 'sq-'
  var DEF = '中等'
  var LEVELS = ['轻推', '中等', '死不松口']
  var K_HISTORY = 'sqHistory'
  var K_CFG = 'sqCfg'
  var K_LAST_VIEW = 'sqLastView'
  var MAX_HISTORY = 150
  var CATS = ['全部', '概念澄清', '反例逼问', '边界条件', '迁移应用']

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
  function level(ctx) {
    try {
      var v = String((ctx && ctx.config ? ctx.config('strength') : '') || '')
      return LEVELS.indexOf(v) >= 0 ? v : DEF
    } catch (e) { return DEF }
  }
  function setLevel(ctx, v) {
    if (LEVELS.indexOf(v) < 0) return false
    try { if (ctx && typeof ctx.config === 'function') ctx.config('strength', v) } catch (e) { }
    try { if (ctx && ctx.keep && typeof ctx.keep.set === 'function') ctx.keep.set('sqLevel', v) } catch (e) { }
    return true
  }
  function cfgGet(ctx) {
    var d = { autoRecord: true, showPanel: true, showTemplates: true, defaultCat: '全部' }
    var got = storeGet(ctx, K_CFG, null)
    if (!got || typeof got !== 'object') return d
    d.autoRecord = got.autoRecord !== false
    d.showPanel = got.showPanel !== false
    d.showTemplates = got.showTemplates !== false
    if (CATS.indexOf(got.defaultCat) >= 0) d.defaultCat = got.defaultCat
    return d
  }
  function cfgSet(ctx, patch) {
    var d = cfgGet(ctx)
    Object.keys(patch || {}).forEach(function (k) { if (k in d) d[k] = patch[k] })
    storeSet(ctx, K_CFG, d)
    return d
  }
  function idxOf(v) { var i = LEVELS.indexOf(v); return i < 0 ? 1 : i }

  /** UI 展示用的规则文字，与 api.promptAugment.build 里的三档口径一致（只读投影） */
  function ruleText(st) {
    return st === '轻推'
      ? '先给一个方向性提示；学生仍卡住时再逐步追问。'
      : (st === '死不松口'
        ? '无论学生怎么要，都绝不给出最终答案或完整步骤；只允许追问与最小提示，直到学生自己说出正确思路。'
        : '每轮只给一小步提示或一个反问，把关键推理跳跃留给学生自己完成。')
  }

  /* ══════════════ 2. 三档层级设计 / 提问模板 / 会话 / 判据 ══════════════ */

  /** 三档追问深度：同一句话在三种强度下被拦成什么样 */
  var LEVEL_DESIGN = [
    { k: '轻推', depth: 1, meter: 33, hint: '给方向，卡住再追',
      give: '可以较快给出结论；先给一个方向性提示，学生仍卡住时逐步追问。',
      ask: '每轮 1 个方向性问题，指向「先看哪里」。',
      hold: '首轮不报数；第二轮仍无进展就给关键一步。',
      demo: ['学生：这道题一点思路都没有。', '教练：先别看答案，把已知条件圈出来，告诉我哪一个你最不确定？'],
      fit: '适合刚开始引导、或时间紧但还想让学生自己走第一步。',
      risk: '拦得浅，容易滑回直接给答案——它是「引导入门档」，不是「严格档」。' },
    { k: '中等', depth: 2, meter: 66, hint: '只给一小步，关键跳跃留给你',
      give: '每轮只给一小步提示或一个反问，把关键推理跳跃留给学生自己完成。',
      ask: '每轮 1-2 个具体问题，指向「这一步为什么成立」。',
      hold: '公式与术语可直接给；推导的关键一步留给学生。连续两轮无进展才给该步结论。',
      demo: ['学生：直接告诉我最后等于多少吧。', '教练：先不报数。你现在卡在哪一步？是没认出结构，还是认出了但不敢用？'],
      fit: '默认档。日常刷题与教练答疑平衡最好：既不代写，也不把人卡死。',
      risk: '对基础很弱的同学可能偏硬——那种情况可临时切「轻推」。' },
    { k: '死不松口', depth: 3, meter: 100, hint: '绝不报答案，直到你自己说出来',
      give: '无论学生怎么要，都绝不给出最终答案或完整步骤；只允许追问与最小提示。',
      ask: '每轮只给 1 个最小提示 + 1 个反问，指向「你已经写出的那一行」。',
      hold: '不给数值结论、不给完整步骤；学生自己说出正确思路后才确认。',
      demo: ['学生：就给个数，求你了。', '教练：数与完整步骤都不会给。把你已经写出的第一行发我，我们从那一行往下推。'],
      fit: '适合考前查漏、明知学生会但爱偷懒、或需要建立「自己推」的信心时。',
      risk: '情绪明显烦躁或时间极紧时别硬扛，按下方判据切回直接讲解。' },
  ]

  /** 经典提问模板库：四类，每类给「什么时候用 / 怎么问 / 追问什么」 */
  var TEMPLATES = [
    { cat: '概念澄清', q: '你能用一句话说出这个定理的前提是什么吗？',
      when: '学生把定理当公式套，却说不清适用条件时。', follow: '如果去掉其中一个条件，结论还成立吗？举个反例试试。' },
    { cat: '概念澄清', q: '「连续」和「可导」在你心里是一回事吗？各举一个例子。',
      when: '两个概念被混用时。', follow: '那 |x| 在 0 点属于哪一种？为什么？' },
    { cat: '概念澄清', q: '这个符号在你的式子里到底代表什么：是变量、参数，还是给定的常数？',
      when: '学生把参数当变量、或混淆记号时。', follow: '把它固定成一个具体数，式子会变成什么？' },
    { cat: '概念澄清', q: '如果要把这道题讲给完全没学过的人，第一步你会说什么？',
      when: '学生自以为懂了但讲不出来时（费曼式检验）。', follow: '你刚才那句话里哪个词自己也没定义清楚？' },
    { cat: '概念澄清', q: '题目要求的是「存在」还是「唯一」？这两者的证明差在哪？',
      when: '存在性与唯一性被混为一谈时。', follow: '你现在的证明只覆盖了哪一种？' },
    { cat: '概念澄清', q: '把「收敛」换成你自己的话说一遍，不许用「趋于」两个字。',
      when: '学生只会背定义原文时。', follow: '你这句话里还藏了哪个没说清的量？' },
    { cat: '反例逼问', q: '如果你这个结论是对的，取一个最简单的特殊值试试，还成立吗？',
      when: '学生提出一个看起来很美但可疑的结论时。', follow: '这个反例说明哪一步前提被你偷偷用了？' },
    { cat: '反例逼问', q: '你能构造一个满足条件但结论不成立的例子吗？',
      when: '要让学生自己发现「条件不够」时。', follow: '这个反例里哪个条件是多余的、哪个是缺的？' },
    { cat: '反例逼问', q: '你刚才说「一定」，是「对所有」还是「对很多」？差别在哪？',
      when: '学生把充分条件当充要条件时。', follow: '找一个让它不成立的实例，哪怕很怪。' },
    { cat: '反例逼问', q: '如果把这个条件去掉，你还能找出反例吗？',
      when: '学生记不住定理条件时（用反例钉住条件）。', follow: '这说明该条件在证明里起什么作用？' },
    { cat: '反例逼问', q: '两个函数图像你能画出来吗？交点处原来那个结论还成立吗？',
      when: '抽象命题需要图像直觉时。', follow: '图像告诉你哪一步推导跳了？' },
    { cat: '反例逼问', q: '假设答案是你说的那样，代回原题验一遍会怎样？',
      when: '学生算出答案但没验证时。', follow: '验不过的话，最早出错的是第几步？' },
    { cat: '边界条件', q: '这个式子在端点处有定义吗？你代进去过吗？',
      when: '求收敛域、定义域、分段点时。', follow: '端点的敛散性和区间内部是同一套判据吗？' },
    { cat: '边界条件', q: '你把「开区间」当「闭区间」用了吗？哪一点会被排除？',
      when: '幂级数、广义积分、不等式取等时。', follow: '那个被排除的点，代回去会发生什么？' },
    { cat: '边界条件', q: '这个定理要求闭区间连续、开区间可导，你的函数在端点满足吗？',
      when: '要用中值定理却没验前提时。', follow: '端点不连续的话，定理还给你保证了什么？' },
    { cat: '边界条件', q: 'n=1 的时候你的公式给出什么？和题目对得上吗？',
      when: '归纳法、通项公式、递推式。', follow: '如果 n=1 就要单独讨论，你的证明漏了哪一句？' },
    { cat: '边界条件', q: '分母为零的那个点，你是约掉了还是绕开了？',
      when: '分式化简、等价替换时。', follow: '约掉之后函数的定义域变了吗？' },
    { cat: '边界条件', q: '你说「p≤1 发散」，那 p=1 这个临界值本身属于哪边？',
      when: '临界值判别含糊时。', follow: '把 p=1 代回原式，用定义算一遍。' },
    { cat: '迁移应用', q: '这道题的本质结构，和你上周做过的哪一道是同一类？',
      when: '学生做不出但见过类似题时。', follow: '把两道题的共同点写在纸上，差别写在旁边。' },
    { cat: '迁移应用', q: '如果把题目里的关键条件换掉，解法要改哪一步？',
      when: '想训练「识别题型」而不是背答案时。', follow: '哪一步是题型决定的，哪一步是具体数字决定的？' },
    { cat: '迁移应用', q: '你能自己造一道能用今天这个方法的题吗？',
      when: '检验是否真会（输出比输入更难）。', follow: '你造的题里，陷阱埋在哪一步？' },
    { cat: '迁移应用', q: '这个方法能不能用到另一章？试试看，卡在哪说明什么？',
      when: '跨章节迁移、建立方法网络时。', follow: '卡住的地方恰恰是两章条件的差别，是什么？' },
    { cat: '迁移应用', q: '如果不许用今天这个方法，你还能怎么解？哪种更快？',
      when: '一题多解训练、择优录取时。', follow: '两种解法的分叉点在哪一步？' },
    { cat: '概念澄清', q: '你能指出这道题里哪个条件是「多余」的吗？去掉它会怎样？',
      when: '学生不会抓核心条件、被一堆已知淹没时。', follow: '那真正起作用的那个条件，在证明的哪一步被用了？' },
    { cat: '概念澄清', q: '把「收敛」和「有界」放在一起说：它们之间谁推出谁？反过来呢？',
      when: '学生混淆必要与充分关系时。', follow: '举一个「有界但不收敛」的例子钉住方向。' },
    { cat: '反例逼问', q: '你说这一步可以约分，那约掉的那个因子会不会为零？',
      when: '分式化简、等价替换撤销条件时。', follow: '为零的那一点，原式还有意义吗？' },
    { cat: '反例逼问', q: '如果结论成立，把题目中一个加号改成减号，还成立吗？',
      when: '检验学生是否真懂结构、还是记住了答案形状。', follow: '失效的地方恰好说明原来用了什么性质？' },
    { cat: '边界条件', q: '瑕点在哪里？你写成极限形式了吗？',
      when: '广义积分、无界函数、分段点。', follow: '用 p 判别法交叉验证一下你的结论。' },
    { cat: '边界条件', q: '取等号的条件是什么？题目问的是严格不等还是可以取等？',
      when: '不等式证明、极值问题。', follow: '把取等情形代回原题看看。' },
    { cat: '迁移应用', q: '如果把这道题的数字全换掉，你的解法还成立吗？哪一步依赖具体数值？',
      when: '区分「通法」与「巧算」时。', follow: '把依赖数值的那一步抽象成一般形式。' },
    { cat: '迁移应用', q: '这道题如果出现在选择题里，哪个选项最像你会踩的坑？',
      when: '模考复盘、命题人视角训练。', follow: '那个陷阱对应的是哪个条件没验？' },
    { cat: '迁移应用', q: '你能把今天的方法写成三步口诀，让明天的自己照着走吗？',
      when: '收尾固化、把方法变成可迁移的程序。', follow: '这三步里哪一步最容易漏？给它加个提醒。' },
  ]

  /** 不给答案的会话示例：每段都以学生自己说出思路收尾 */
  var SESSIONS = [
    { id: 'sq-01', topic: '概念澄清', title: '「直接给个数」被拦下',
      q: '学生：lim(x→0)(tan x − sin x)/x³ 等于多少？直接告诉我。',
      turns: [
        ['学生', '直接给个数吧，我不想推了。'],
        ['教练', '先不报数。你现在卡在哪一步：是没认出结构，还是认出了但不敢用？'],
        ['学生', '我知道要换等价无穷小，但减完是 0。'],
        ['教练', '好，你抓到了「减完是 0」这个信号。那这一步成立吗？前提满足了吗？'],
        ['学生', '……等价无穷小只能在乘除里换，加减不行。'],
        ['教练', '对。那你能把「差」变成「积」吗？把 tan x 提出来试试。'],
        ['学生', 'tan x(1−cos x)，然后 x·(1/2)x² / x³ = 1/2！我自己推出来了。'],
        ['教练', '这就是关键：结论是你说出来的，不是我给的。'],
      ],
      break: '学生自己说出了「加减不能直换」与「化差为积」两步。', lv: '中等' },
    { id: 'sq-02', topic: '反例逼问', title: '用反例钉住条件',
      q: '学生：只要函数连续，中值定理就能用吧？',
      turns: [
        ['学生', '连续就能用拉格朗日吧？'],
        ['教练', '你能构造一个连续、但中值定理给不出结论的例子吗？'],
        ['学生', '想不出来……'],
        ['教练', '换个小问题：闭区间连续、开区间也要可导。如果少一个，会怎样？'],
        ['学生', '哦！|x| 在 [−1,1] 连续，但 0 点不可导，所以不能直接用。'],
        ['教练', '很好。那这个例子告诉你定理的前提是什么？'],
        ['学生', '闭区间连续 + 开区间可导，两个都要，缺一不可。'],
      ],
      break: '学生自己构造了 |x| 反例并说出了两条前提。', lv: '中等' },
    { id: 'sq-03', topic: '边界条件', title: '端点那一块钱',
      q: '学生：Σ xⁿ/(n·2ⁿ) 的收敛域是 (−2,2)，对吧？',
      turns: [
        ['学生', '比值法算出 R=2，所以开区间 (−2,2)。'],
        ['教练', '开区间——那端点呢？你把 x=2 代进去过吗？'],
        ['学生', '没有……代进去是 Σ1/n。'],
        ['教练', '这个级数你熟悉吗？p 等于多少？'],
        ['学生', 'p=1，发散！那 x=−2 是交错的，收敛。所以是 [−2,2)。'],
        ['教练', '对，端点是你自己判出来的。半径只给开区间这件事，记住了。'],
      ],
      break: '学生自己完成两个端点的判别并修正答案。', lv: '中等' },
    { id: 'sq-04', topic: '概念澄清', title: '费曼式复述',
      q: '学生：我懂符号的含义了。',
      turns: [
        ['学生', '这个定理我背下来了，肯定懂了。'],
        ['教练', '那用你自己的话说一遍它的前提，不许用书上的原词。'],
        ['学生', '就是……函数要平滑一点？'],
        ['教练', '「平滑」是日常词。数学上你要检查的是哪两件事？'],
        ['学生', '连续，还有……可导。对，闭区间连续、开区间可导。'],
        ['教练', '很好。那「背下来了」和「讲得出来」的区别，你现在体会到了吗？'],
        ['学生', '体会到了，讲不出来就是没真懂。'],
      ],
      break: '学生自己把模糊的「平滑」还原成两个精确前提。', lv: '轻推' },
    { id: 'sq-05', topic: '迁移应用', title: '自己造一道题',
      q: '学生：华莱士公式我会用了。',
      turns: [
        ['学生', '这个公式我会背了。'],
        ['教练', '那你能造一道需要用它、且我不能一眼看穿的题吗？'],
        ['学生', '∫₀^{π/2} sin⁷x cos²x dx？'],
        ['教练', '好。那这题的关键识别信号是什么？'],
        ['学生', '区间 0 到 π/2、三角函数幂、其中一个余弦是偶次——要先拆一个 cos²=1−sin²。'],
        ['教练', '漂亮。你已经不只是会用公式，而是知道它什么时候能用。'],
      ],
      break: '学生自己造题并说出识别信号，完成迁移。', lv: '中等' },
    { id: 'sq-06', topic: '反例逼问', title: '「一定」是真的吗',
      q: '学生：n 个不同特征值的矩阵一定可以对角化。',
      turns: [
        ['学生', '有 n 个不同特征值就一定可以对角化，这是充要条件。'],
        ['教练', '你说「充要」。那反过来：可对角化的矩阵，特征值一定互异吗？'],
        ['学生', '……单位矩阵，特征值全是 1，但它已经是对角阵。'],
        ['教练', '很好。那你刚才把什么当成了什么？'],
        ['学生', '把充分条件当成充要条件了。真正的充要条件是 n 个无关特征向量。'],
      ],
      break: '学生用单位矩阵反例自己推翻了错误说法。', lv: '死不松口' },
    { id: 'sq-07', topic: '边界条件', title: '分界点单独求导',
      q: '学生：分段函数在分界点直接对两边求导代入就行。',
      turns: [
        ['学生', '两边求导再代入 0，左边 0，右边没定义，所以不可导。'],
        ['教练', '结论对了。但「先求导再代入」这一步，在分界点成立吗？'],
        ['学生', '……右边表达式在 0 处根本没定义，不能代入。'],
        ['教练', '那在分界点能用什么？'],
        ['学生', '导数定义！f′(0)=lim(f(h)−f(0))/h，左右分别算。'],
        ['教练', '对。归纳一下：分界点只回定义，不套公式。'],
      ],
      break: '学生自己指出代入法失效并回到导数定义。', lv: '中等' },
    { id: 'sq-08', topic: '概念澄清', title: '参数还是变量',
      q: '学生：对 x²+a 求导，答案是 2x+a。',
      turns: [
        ['学生', '导数是 2x+a。'],
        ['教练', '这里的 a 是什么？是变量、参数，还是给定常数？'],
        ['学生', '题目说是常数……那导数是 2x。'],
        ['教练', '对。那如果把 a 也当变量，对 a 求偏导是多少？'],
        ['学生', '是 1。所以同一个式子对不同对象求导，结果不一样。'],
        ['教练', '很好。认清算子是谁，比会算更重要。'],
      ],
      break: '学生自己分辨了变量与参数。', lv: '轻推' },
    { id: 'sq-09', topic: '反例逼问', title: '代回原题验一遍',
      q: '学生：我算出来极限是 0，但不确定。',
      turns: [
        ['学生', '我算的是 0。'],
        ['教练', '假设答案是 0，代回原式验一遍会怎样？'],
        ['学生', '代回去……分子是 x²sin(1/x)，sin 有界，x² 趋于 0。'],
        ['教练', '那分母呢？你们是不是同阶？'],
        ['学生', '分母 sin x~x，所以整体是 x·sin(1/x)，无穷小乘有界，还是 0。'],
        ['教练', '这就对了——你自己验出来的，不是我报的。'],
      ],
      break: '学生用代回验证自行确认了答案。', lv: '中等' },
    { id: 'sq-10', topic: '迁移应用', title: '不许用今天的方法',
      q: '学生：这题用洛必达最快。',
      turns: [
        ['学生', '洛必达一遍就出来了。'],
        ['教练', '好。那如果不许用洛必达，你还能怎么解？'],
        ['学生', '……可以等价无穷小替换，或者泰勒展开。'],
        ['教练', '哪种更快？分叉点在哪一步？'],
        ['学生', '泰勒更快，因为分子展开到三阶直接出结果；洛必达要导三次。'],
        ['教练', '这就是「一题多解，择优录取」——你自己比较出来的。'],
      ],
      break: '学生在限制条件下自己找到更优解。', lv: '死不松口' },
    { id: 'sq-11', topic: '边界条件', title: 'n=1 的临界',
      q: '学生：这个通项公式对一切 n 都成立。',
      turns: [
        ['学生', '我归纳出来的公式对所有 n 成立。'],
        ['教练', 'n=1 的时候，你的公式给什么？和题目对得上吗？'],
        ['学生', '代 n=1……差了 1。所以公式从 n=2 才开始。'],
        ['教练', '那你的证明要补哪一句？'],
        ['学生', '要单独验 n=1，然后从 n=2 起用归纳。'],
        ['教练', '对，边界值是你自己抓出来的。'],
      ],
      break: '学生自己发现 n=1 不成立并修正归纳起点。', lv: '中等' },
    { id: 'sq-12', topic: '概念澄清', title: '存在还是唯一',
      q: '学生：我证明了方程有解，所以结论成立。',
      turns: [
        ['学生', '我证出来有解了，够了吧？'],
        ['教练', '题目要的是「存在」还是「唯一」？'],
        ['学生', '……要唯一。我只证了存在。'],
        ['教练', '那还差什么？'],
        ['学生', '还要证任意两个解相等，或者证单调性。'],
        ['教练', '对。存在与唯一是两问，你刚才只答了一问。'],
      ],
      break: '学生自己识别出漏证的唯一性。', lv: '轻推' },
    { id: 'sq-13', topic: '反例逼问', title: '约分约掉了条件',
      q: '学生：这个分式可以直接约掉 (x−1)。',
      turns: [
        ['学生', '分子分母都有 (x−1)，约掉就行。'],
        ['教练', '约掉的那个因子，会不会为零？'],
        ['学生', 'x=1 的时候为零……那约分之后定义域变了。'],
        ['教练', '对。原式在 x=1 无定义，约分后的式子却有了值。这说明什么？'],
        ['学生', '约分只在 x≠1 时合法，要单独标注；极限里可以约，因为考虑的是 x→1 的去心邻域。'],
        ['教练', '很好。你自己把「约分」和「求极限」的差别说清楚了。'],
      ],
      break: '学生自己指出了约分的条件与去心邻域的差别。', lv: '中等' },
    { id: 'sq-14', topic: '迁移应用', title: '把数字换掉还成立吗',
      q: '学生：这道题我用凑微分秒了。',
      turns: [
        ['学生', '我凑出 dv = 2x dx，一步就积分了。'],
        ['教练', '如果把题目里的 2x 换成 3x²，你这个凑法还成立吗？'],
        ['学生', '……不成立，因为 3x² 不是 d(x²)。'],
        ['教练', '那什么结构才能凑？'],
        ['学生', '被积函数里要同时出现某个函数和它的导数，差一个常数倍可以补。'],
        ['教练', '这就是通法了——你不再依赖具体数字，而是认出了结构。'],
      ],
      break: '学生把具体技巧抽象成「函数+其导数」的通用识别信号。', lv: '死不松口' },
  ]

  /** 什么时候切回直接讲解的判据（仲裁条款第③条的落地细则） */
  var SWITCH_CRITERIA = [
    { sig: '连续两轮仍无法推进', act: '给出该步结论并解释为什么这么走', why: '仲裁条款第③条：两轮无进展是硬阈值，继续追问只会消耗信心。' },
    { sig: '学生明显烦躁或说「我不会就这样了」', act: '立即结束追问，改用直接讲解 + 一句安抚', why: '引导是为了建立能力，不是为了制造挫败。情绪优先于流程。' },
    { sig: '纯记忆性事实（公式、术语、常数）', act: '直接给，不留悬念', why: '仲裁条款第④条：公式与术语可以直接给，关键推导才留给学生。' },
    { sig: '限时模考或考前最后一天', act: '切直接讲解，优先速度与确定性', why: '此时目标是拿分，不是训练思维习惯；训练留给平时。' },
    { sig: '学生已说出正确思路，只差规范表述', act: '确认思路后直接给规范写法', why: '思路已经属于学生，剩下的是表达问题，不值得再追问。' },
    { sig: '学生问的是「答案对不对」而非「怎么想」', act: '先反问其验证过程，再确认', why: '用反例逼问模板让学生自己验，比直接判对错更有价值。' },
    { sig: '连续三次追问都得到「不知道」', act: '降级到轻推，给一个方向性提示', why: '难度超出当前层级，降档比死扛有效。' },
    { sig: '涉及概念错误且学生坚信不疑', act: '先构造反例，再给结论', why: '不打破错误概念，直接讲正解会被旧概念同化。' },
    { sig: '时间已到、需要收尾', act: '直接给结论 + 留一个课后自问', why: '保住节奏，把追问延后到下一次。' },
    { sig: '学生主动要求「别问了，直接讲」且语气平稳', act: '尊重请求，切直接讲解', why: '引导是协作，不是强制；除非处于死不松口档且学生仍在拉扯。' },
    { sig: '学生给出的反问已经命中关键一步', act: '立刻确认并停问，让学生自己往下写', why: '目标已经达成，再追问就变成打断思路。' },
    { sig: '概念本身有歧义或题目表述不清', act: '先澄清题意，暂缓追问', why: '题都读错了，追问只会把人引向错误方向。' },
    { sig: '连续追问已让回答变成猜谜', act: '降档并直接给方向性提示', why: '引导的粒度要匹配当前水平；过细的追问等于变相给压力。' },
  ]

  /** 原 v1.1.0 的三档短示例，保留为可读摘要 */
  var DEMO = {
    '轻推': [
      ['学生', '这道题我一点思路都没有。'],
      ['教练', '先别看答案：把题目里已知的条件圈出来，告诉我哪一个你最不确定？'],
    ],
    '中等': [
      ['学生', '直接告诉我最后等于多少吧。'],
      ['教练', '先不报数。你现在的思路卡在哪一步？是没认出结构，还是认出了但不敢用？'],
    ],
    '死不松口': [
      ['学生', '就给个数，求你了。'],
      ['教练', '数与完整步骤都不会给。把你已经写出的第一行发我，我们从那一行往下推。'],
    ],
  }

  /* ── 历史：看过哪段会话 + 反馈 + 是否突破 ── */
  function historyGet(ctx) {
    var arr = storeGet(ctx, K_HISTORY, null)
    if (!Array.isArray(arr)) return []
    return arr.filter(function (x) {
      return x && typeof x === 'object' && typeof x.id === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(String(x.day || ''))
    }).map(function (x) {
      return { id: String(x.id), title: String(x.title || ''), cat: String(x.cat || ''),
        day: x.day, at: num(x.at, Date.now()), win: x.win === true,
        fb: x.fb === 'up' || x.fb === 'down' ? x.fb : '' }
    }).slice(-MAX_HISTORY)
  }
  function historySave(ctx, arr) { storeSet(ctx, K_HISTORY, (arr || []).slice(-MAX_HISTORY)); return arr }
  function sessionById(id) {
    for (var i = 0; i < SESSIONS.length; i++) if (SESSIONS[i].id === id) return SESSIONS[i]
    return null
  }
  function recordUse(ctx, id, win) {
    var ex = sessionById(id)
    if (!ex) return historyGet(ctx)
    var arr = historyGet(ctx)
    arr.push({ id: ex.id, title: ex.title, cat: ex.topic, day: dkey(), at: Date.now(), win: !!win, fb: '' })
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
  function bumpUse(ctx) {
    try {
      if (!ctx || !ctx.keep || typeof ctx.keep.set !== 'function') return
      ctx.keep.set('sqDay', dkey())
      ctx.keep.set('sqUses', (num(ctx.keep.get('sqUses', 0)) + 1))
    } catch (e) { }
  }
  function usesToday(ctx) {
    try {
      if (!ctx || !ctx.keep || typeof ctx.keep.get !== 'function') return 0
      if (ctx.keep.get('sqDay') !== dkey()) return 0
      return num(ctx.keep.get('sqUses', 0))
    } catch (e) { return 0 }
  }

  /* ══════════════ 3. 分析层：突破率 / 覆盖 / 推荐 ══════════════ */

  function feedbackStats(hist) {
    var up = 0, down = 0, win = 0
    ;(hist || []).forEach(function (x) { if (x.fb === 'up') up++; else if (x.fb === 'down') down++; if (x.win) win++ })
    return { up: up, down: down, win: win, used: (hist || []).length }
  }
  function usedCats(hist) {
    var set = {}
    ;(hist || []).forEach(function (x) { if (x.cat) set[x.cat] = 1 })
    return Object.keys(set)
  }
  function recommendOf(hist, cat) {
    var used = {}
    ;(hist || []).forEach(function (x) { used[x.id] = 1 })
    var pool = SESSIONS.filter(function (e) { return cat === '全部' || e.topic === cat })
    if (!pool.length) return null
    var fresh = pool.filter(function (e) { return !used[e.id] })
    return (fresh.length ? fresh : pool)[0]
  }
  function insightsOf(hist, ctx) {
    var out = []
    var st = feedbackStats(hist)
    var cats = usedCats(hist)
    if (!hist.length) {
      out.push({ level: 'info', title: '还没有看过任何追问会话', body: '在「不给答案的会话」里点一条「标记看过」，并勾选是否自己推出了结论，这里就会统计突破率。' })
    } else {
      var rate = Math.round(st.win / st.used * 100)
      out.push({ level: 'info', title: '已回放 ' + st.used + ' 段会话，自己推出 ' + st.win + ' 段', body: '突破率 ' + rate + '%；当前强度「' + level(ctx) + '」。' })
      if (rate < 50 && st.used >= 4) {
        out.push({ level: 'warn', title: '突破率偏低', body: '多半是档位太硬。先切「轻推」练几次，再回「中等」；连续两轮无进展本就该给结论。' })
      }
    }
    if (st.down > st.up && st.down >= 2) {
      out.push({ level: 'warn', title: '点踩多于点赞', body: '如果追问让你更焦虑，直接看「作用域与开关」里的切回判据——该直接讲的时候就该直接讲。' })
    }
    if (cats.length >= 3) {
      out.push({ level: 'good', title: '提问类型覆盖较全', body: '概念澄清 / 反例逼问 / 边界条件 都碰过了。下一步练「迁移应用」——自己造题比答题更难。' })
    }
    var r = recommendOf(hist, '全部')
    if (r) out.push({ level: 'good', title: '下一段建议看：' + r.title, body: '[ ' + r.topic + ' ] ' + r.break })
    return out.slice(0, 5)
  }

  /* ══════════════ 4. 完整样式层（含夜间与窄屏） ══════════════ */

  var CSS = [
    '.' + NS + 'page{display:flex;flex-direction:column;gap:12px;max-width:1180px;margin:0 auto}',
    '.' + NS + 'hero{border-radius:14px;padding:17px 19px;background:linear-gradient(135deg,var(--glass-bg),var(--glass-bg));border:1px solid var(--line);position:relative;overflow:hidden}',
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
    '.' + NS + 'lv{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}',
    '.' + NS + 'lv button{text-align:left;border:1px solid var(--line);border-radius:10px;padding:12px;background:transparent;cursor:pointer;color:inherit;transition:border-color .18s,transform .18s}',
    '.' + NS + 'lv button:hover{transform:translateY(-2px);border-color:var(--accent-text)}',
    '.' + NS + 'lv button[aria-pressed="true"]{border-color:var(--accent-text);background:var(--glass-bg);box-shadow:0 0 0 2px var(--accent-fill)}',
    '.' + NS + 'lv b{display:block;font-size:13px;margin-bottom:4px}',
    '.' + NS + 'lv span{font-size:11.5px;color:var(--text-secondary);line-height:1.6}',
    '.' + NS + 'demo{border-left:2px solid var(--accent-text);padding:6px 0 6px 12px;margin:8px 0;font-size:12.5px;line-height:1.75}',
    '.' + NS + 'demo em{color:var(--text-secondary);font-style:normal}',
    '.' + NS + 'odp{border:1px solid var(--line);border-radius:10px;padding:11px 12px;background:var(--glass-bg)}',
    '.' + NS + 'odp b{display:block;font-size:12.5px;margin-bottom:4px}',
    '.' + NS + 'odp small{display:block;font-size:10.5px;color:var(--accent-text);margin-bottom:6px}',
    '.' + NS + 'odp p{margin:0 0 6px;font-size:11.5px;line-height:1.7;color:var(--text-secondary)}',
    '.' + NS + 'odp em{font-style:normal;font-size:11px;color:var(--text-secondary);display:block;border-left:2px solid var(--line);padding-left:7px;margin-top:5px;line-height:1.6}',
    '.' + NS + 'catbar{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px}',
    '.' + NS + 'tpl{border:1px solid var(--line);border-radius:10px;padding:10px 12px;background:var(--glass-bg);margin-bottom:8px}',
    '.' + NS + 'tpl b{font-size:12.5px}',
    '.' + NS + 'tpl p{font-size:11.5px;color:var(--text-secondary);line-height:1.7;margin:5px 0 0}',
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
    '.' + NS + 'meter{height:6px;border-radius:6px;background:var(--chart-track,var(--line));overflow:hidden}',
    '.' + NS + 'meter i{display:block;height:100%;border-radius:6px;background:linear-gradient(90deg,var(--blue),var(--accent-text));transition:width .25s}',
    '.' + NS + 'ic{display:inline-flex;align-items:center;justify-content:center;width:15px;height:15px;vertical-align:-2px}',
    '.' + NS + 'ic svg{width:15px;height:15px;fill:none;stroke:currentColor;stroke-width:1.8}',
    '.' + NS + 'panel{display:flex;flex-direction:column;gap:8px;font-size:12px}',
    '.' + NS + 'panel-top{display:flex;justify-content:space-between;align-items:center}',
    '.' + NS + 'pill{display:inline-flex;align-items:center;gap:5px;border-radius:999px;padding:3px 9px;background:var(--glass-bg);border:1px solid var(--line);font-size:11.5px}',
    '@media(max-width:820px){.' + NS + 'kpis{grid-template-columns:repeat(2,1fr)}.' + NS + 'grid2,.' + NS + 'lv{grid-template-columns:1fr}}',
    'html[data-theme="night"] .' + NS + 'odp em{border-left-color:#4a5568}',
  ].join('\n')
  function style(ctx) { try { if (ctx && ctx.css && typeof ctx.css.add === 'function') ctx.css.add(CSS, 'skin') } catch (e) { } }

  /* ══════════════ 5. 视图 ══════════════ */

  function viewOverview(ctx, S) {
    var out = []
    var st = feedbackStats(S.hist)
    var d = LEVEL_DESIGN[idxOf(S.lv)]
    out.push('<div class="' + NS + 'hero"><h3>' + I('cpBrain', '问') + ' 苏格拉底追问模式</h3>'
      + '<p>教练不直接替你写答案，而是用一两个具体问题把你推过最关键的那一步。'
      + '<b>当前：' + esc(S.lv) + '</b>（深度 ' + d.depth + '/3）。仲裁条款逐字保留，本页只是可读投影。</p></div>')
    out.push('<div class="' + NS + 'kpis">')
    ;[['已看会话', String(st.used), '段'], ['自己推出', String(st.win), '段'],
      ['突破率', (st.used ? Math.round(st.win / st.used * 100) : 0) + '%', ''], ['今日引导', String(usesToday(ctx)), '次']].forEach(function (x) {
      out.push('<div class="' + NS + 'kpi"><b>' + esc(x[1]) + '</b><span>' + esc(x[0]) + ' ' + esc(x[2]) + '</span></div>')
    })
    out.push('</div>')
    out.push('<section class="' + NS + 'card"><h4>' + I('cpBrain', '档') + ' 三档强度（切换即刻影响教练）</h4>'
      + '<div class="' + NS + 'lv">' + LEVEL_DESIGN.map(function (x) {
        return '<button type="button" data-lv="' + esc(x.k) + '" aria-pressed="' + (x.k === S.lv ? 'true' : 'false') + '">'
          + '<b>' + esc(x.k) + ' · 深度 ' + x.depth + '/3</b><span>' + esc(x.hint) + '</span></button>'
      }).join('') + '</div>'
      + '<div class="' + NS + 'meter" style="margin-top:10px"><i style="width:' + d.meter + '%"></i></div>'
      + '<p style="font-size:12px;line-height:1.8;color:var(--text-secondary);margin:8px 0 0">' + esc(ruleText(S.lv)) + '</p></section>')
    out.push('<div class="' + NS + 'grid2">')
    out.push('<section class="' + NS + 'card"><h4>' + I('cpBrain', '判') + ' 从记录里读出的判断</h4>'
      + S.insights.map(function (x) {
        return '<div class="' + NS + 'note ' + esc(x.level) + '"><div><b>' + esc(x.title) + '</b>' + esc(x.body) + '</div></div>'
      }).join('') + '</section>')
    var r = recommendOf(S.hist, '全部')
    out.push('<section class="' + NS + 'card"><h4>' + I('cpBrain', '荐') + ' 下一段建议看</h4>'
      + (r ? '<div class="' + NS + 'ex" style="margin:0"><div class="' + NS + 'ex-hd"><b>' + esc(r.title) + '</b><span class="' + NS + 'tag">' + esc(r.topic) + '</span></div>'
        + '<div class="' + NS + 'point">' + esc(r.break) + '</div>'
        + '<div class="' + NS + 'acts"><button class="' + NS + 'btn pri" data-act="tab" data-v="examples">去回放</button></div></div>'
        : '<div class="' + NS + 'empty">还没有可推荐的会话。</div>')
      + '</section>')
    out.push('</div>')
    out.push('<section class="' + NS + 'card"><h4>这个档位下会怎么回答</h4>'
      + d.demo.map(function (p) { return '<div class="' + NS + 'demo"><em>' + esc(p[0]) + '</em><br>' + esc(p[1]) + '</div>' }).join('') + '</section>')
    return out.join('')
  }

  function viewMethod(ctx, S) {
    var out = []
    out.push('<section class="' + NS + 'card"><h4>' + I('cpBrain', '层') + ' 引导层级设计（三档追问深度）</h4>'
      + '<p style="font-size:12px;line-height:1.8;color:var(--text-secondary);margin:0 0 10px">'
      + '档位决定「这轮给不给答案、给多少」：轻推给方向、中等给一小步、死不松口只给最小提示。</p>'
      + LEVEL_DESIGN.map(function (x) {
        return '<div class="' + NS + 'odp" style="margin-bottom:8px"><b>' + esc(x.k) + ' · 深度 ' + x.depth + '/3（当前' + (x.k === S.lv ? ' · 生效中' : '') + '）</b>'
          + '<div class="' + NS + 'meter" style="margin:6px 0"><i style="width:' + x.meter + '%"></i></div>'
          + '<p>给多少：' + esc(x.give) + '</p>'
          + '<p>怎么问：' + esc(x.ask) + '</p>'
          + '<p>守住什么：' + esc(x.hold) + '</p>'
          + '<em>适合：' + esc(x.fit) + '</em><em>注意：' + esc(x.risk) + '</em></div>'
      }).join('') + '</section>')
    if (S.cfg.showTemplates) {
      out.push('<section class="' + NS + 'card"><h4>' + I('cpBrain', '问') + ' 经典提问模板库（' + TEMPLATES.length + ' 条）</h4>'
        + '<div class="' + NS + 'catbar">' + CATS.map(function (c) {
          var n = c === '全部' ? TEMPLATES.length : TEMPLATES.filter(function (t) { return t.cat === c }).length
          return '<button class="' + NS + 'btn' + (S.cat === c ? ' pri' : '') + '" data-act="cat" data-v="' + esc(c) + '">' + esc(c) + ' ' + n + '</button>'
        }).join('') + '</div>'
        + TEMPLATES.filter(function (t) { return S.cat === '全部' || t.cat === S.cat }).map(function (t) {
          return '<div class="' + NS + 'tpl"><b>' + esc(t.q) + ' <span class="' + NS + 'tag">' + esc(t.cat) + '</span></b>'
            + '<p>什么时候用：' + esc(t.when) + '</p><p>接着追问：' + esc(t.follow) + '</p></div>'
        }).join('') + '</section>')
    }
    return out.join('')
  }

  function sessionCard(ex, S) {
    var used = false, win = false, fb = ''
    S.hist.forEach(function (h) { if (h.id === ex.id) { used = true; win = win || h.win; if (h.fb) fb = h.fb } })
    var out = ['<div class="' + NS + 'ex"><div class="' + NS + 'ex-hd">']
    out.push('<b>' + esc(ex.title) + '</b><span><span class="' + NS + 'tag">' + esc(ex.topic) + '</span>'
      + '<span class="' + NS + 'tag">' + esc(ex.lv) + '</span><span class="' + NS + 'tag">' + esc(ex.id) + '</span></span></div>')
    out.push('<div class="' + NS + 'q">' + esc(ex.q) + '</div>')
    ex.turns.forEach(function (t) {
      out.push('<div class="' + NS + 'turn' + (t[0] === '学生' ? ' st' : '') + '"><u>' + esc(t[0]) + '：</u>' + esc(t[1]) + '</div>')
    })
    out.push('<div class="' + NS + 'point">突破点：' + esc(ex.break) + '</div>')
    out.push('<div class="' + NS + 'acts">'
      + '<button class="' + NS + 'btn' + (used ? ' pri' : '') + '" data-act="use" data-v="' + esc(ex.id) + '">' + (used ? '已看过 · 再记一次' : '标记看过') + '</button>'
      + '<button class="' + NS + 'btn' + (win ? ' on' : '') + '" data-act="win" data-v="' + esc(ex.id) + '">自己推出了' + (win ? ' 已' : '') + '</button>'
      + '<button class="' + NS + 'btn' + (fb === 'up' ? ' on' : '') + '" data-act="fb" data-v="' + esc(ex.id) + '" data-fb="up">点赞' + (fb === 'up' ? ' 已' : '') + '</button>'
      + '<button class="' + NS + 'btn' + (fb === 'down' ? ' on' : '') + '" data-act="fb" data-v="' + esc(ex.id) + '" data-fb="down">点踩' + (fb === 'down' ? ' 已' : '') + '</button>'
      + '</div></div>')
    return out.join('')
  }

  function viewExamples(ctx, S) {
    var out = []
    out.push('<section class="' + NS + 'card"><div class="' + NS + 'card-hd"><h4>' + I('cpBrain', '例') + ' 不给答案的会话库</h4>'
      + '<span class="muted-sm" style="font-size:11px">共 ' + SESSIONS.length + ' 段 · 都以学生自己说出思路收尾</span></div>')
    out.push('<div class="' + NS + 'catbar">' + CATS.map(function (c) {
      var n = c === '全部' ? SESSIONS.length : SESSIONS.filter(function (e) { return e.topic === c }).length
      return '<button class="' + NS + 'btn' + (S.cat === c ? ' pri' : '') + '" data-act="cat" data-v="' + esc(c) + '">' + esc(c) + ' ' + n + '</button>'
    }).join('') + '</div>')
    var pool = SESSIONS.filter(function (e) { return S.cat === '全部' || e.topic === S.cat })
    if (!pool.length) out.push('<div class="' + NS + 'empty">这一类还没有会话。</div>')
    else pool.forEach(function (e) { out.push(sessionCard(e, S)) })
    out.push('</section>')
    return out.join('')
  }

  function viewScopes(ctx, S) {
    var out = []
    out.push('<section class="' + NS + 'card"><h4>' + I('cpBrain', '域') + ' 作用域与仲裁（与 promptAugment 一一对应）</h4>'
      + '<table class="' + NS + 'table"><thead><tr><th>ctx</th><th>拓展器</th><th>数量</th><th>说明</th></tr></thead><tbody>'
      + '<tr><td>copilot.chat</td><td>苏格拉底模式</td><td>1</td><td>覆盖默认直接给答案的倾向，改为引导式追问。</td></tr>'
      + '</tbody></table>'
      + '<p style="font-size:12px;line-height:1.8;color:var(--text-secondary);margin:10px 0 0">'
      + '只有一条 copilot.chat 拓展器 —— 这是历史契约。语气人格插件（张宇/武忠祥）只决定「用什么口吻说」，'
      + '本模式决定「这轮给不给答案、给多少」；两者冲突时以本教学流程为准。</p></section>')
    out.push('<section class="' + NS + 'card"><h4>' + I('cpBrain', '断') + ' 什么时候该切回直接讲解（' + SWITCH_CRITERIA.length + ' 条判据）</h4>'
      + '<p style="font-size:12px;line-height:1.8;color:var(--text-secondary);margin:0 0 10px">'
      + '仲裁条款第③条说「连续两轮无进展才给结论」，下面是它在真实场景里的落地细则。</p>'
      + SWITCH_CRITERIA.map(function (c, i) {
        return '<div class="' + NS + 'odp" style="margin-bottom:8px"><b>' + (i + 1) + '. 信号：' + esc(c.sig) + '</b>'
          + '<p>动作：' + esc(c.act) + '</p><em>为什么：' + esc(c.why) + '</em></div>'
      }).join('') + '</section>')
    out.push('<section class="' + NS + 'card"><h4>仲裁条款原文（只读）</h4>'
      + '<div class="' + NS + 'point">' + esc(ruleText(S.lv)) + '</div>'
      + '<p style="font-size:11.5px;line-height:1.8;color:var(--text-secondary);margin:8px 0 0">'
      + '完整的四条仲裁要求（含「结尾 1-2 个具体问题」「直接要答案先反问」「连续两轮给结论」「公式术语可直接给」）'
      + '在 api.promptAugment[0].build 里逐字保留，本页只展示当前档对应的那句规则。</p></section>')
    return out.join('')
  }

  function viewHistory(ctx, S) {
    var out = []
    out.push('<section class="' + NS + 'card"><div class="' + NS + 'card-hd"><h4>' + I('cpBrain', '史') + ' 会话与反馈历史</h4>'
      + '<span class="' + NS + 'acts" style="margin:0">'
      + '<button class="' + NS + 'btn" data-act="export-json">导出 JSON</button>'
      + '<button class="' + NS + 'btn" data-act="export-md">导出报告</button>'
      + '<button class="' + NS + 'btn" data-act="clear-history">清空历史</button>'
      + '</span></div>')
    if (!S.hist.length) {
      out.push('<div class="' + NS + 'empty">还没有记录。在「不给答案的会话」里点「标记看过」与「自己推出了」。</div>')
    } else {
      out.push('<table class="' + NS + 'table"><thead><tr><th>日期</th><th>会话</th><th>类型</th><th>自己推出</th><th>反馈</th></tr></thead><tbody>')
      S.hist.slice().reverse().slice(0, 60).forEach(function (h) {
        out.push('<tr><td>' + esc(h.day) + '</td><td>' + esc(h.title) + '</td><td>' + esc(h.cat) + '</td>'
          + '<td>' + (h.win ? '是' : '—') + '</td><td>' + (h.fb === 'up' ? '点赞' : h.fb === 'down' ? '点踩' : '—') + '</td></tr>')
      })
      out.push('</tbody></table>')
      if (S.hist.length > 60) out.push('<p class="muted-sm" style="font-size:11px">仅显示最近 60 条，导出文件里是全部 ' + S.hist.length + ' 条。</p>')
    }
    out.push('</section>')
    return out.join('')
  }

  function viewConfig(ctx, S) {
    var c = S.cfg
    var out = []
    out.push('<section class="' + NS + 'card"><h4>' + I('cpBrain', '设') + ' 引导强度（api.config 契约项）</h4>'
      + '<div class="' + NS + 'field"><label>引导强度（等同插件配置 strength）</label>'
      + '<span>' + LEVELS.map(function (v) {
        return '<button class="' + NS + 'btn' + (v === S.lv ? ' pri' : '') + '" data-lv="' + v + '" style="margin-left:4px">' + v + '</button>'
      }).join('') + '</span></div>'
      + '<p class="muted-sm" style="font-size:11.5px;line-height:1.8">这一项就是注册时 config 里的 strength；切档会同时写入 ctx.config 与 ctx.keep，promptAugment.build 立即按新档取规则。</p></section>')
    out.push('<section class="' + NS + 'card"><h4>附加设置（仅 UI 层，不动 api.config）</h4>'
      + '<div class="' + NS + 'field"><label>自动记录会话回放</label>'
      + '<button class="' + NS + 'btn' + (c.autoRecord ? ' pri' : '') + '" data-act="cfg" data-v="autoRecord">' + (c.autoRecord ? '已开启' : '已关闭') + '</button></div>'
      + '<div class="' + NS + 'field"><label>显示常驻面板</label>'
      + '<button class="' + NS + 'btn' + (c.showPanel ? ' pri' : '') + '" data-act="cfg" data-v="showPanel">' + (c.showPanel ? '显示' : '隐藏') + '</button></div>'
      + '<div class="' + NS + 'field"><label>方法论页显示提问模板</label>'
      + '<button class="' + NS + 'btn' + (c.showTemplates ? ' pri' : '') + '" data-act="cfg" data-v="showTemplates">' + (c.showTemplates ? '显示' : '隐藏') + '</button></div>'
      + '<div class="' + NS + 'field"><label>默认模板/会话分类</label><select data-act="cfg-cat">'
      + CATS.map(function (t) { return '<option value="' + esc(t) + '"' + (c.defaultCat === t ? ' selected' : '') + '>' + esc(t) + '</option>' }).join('')
      + '</select></div></section>')
    out.push('<section class="' + NS + 'card"><h4>边界与隐私</h4>'
      + '<p style="font-size:12px;line-height:1.8;color:var(--text-secondary);margin:0">'
      + '本插件不重算任何学习数据，也不上传；历史只存「看过哪段会话 + 是否自己推出 + 点赞/点踩」，最多 ' + MAX_HISTORY + ' 条。'
      + '仲裁条款只决定「怎么教」，不改变原有输出格式与动作协议。'
      + '清空历史不可撤销，建议先导出。</p></section>')
    return out.join('')
  }

  /** 边界视图：把"什么时候不该追问"写清楚。
   * 追问模式最大的风险是**在不该硬扛的时候硬扛** —— 学生已经很烦了还逼问，
   * 那就从"帮他学会"变成"看他出丑"。这一页是刹车片。 */
  function viewLimits(ctx, S) {
    var out = []
    out.push('<section class="' + NS + 'card"><h4>' + I('cpWarn', '界') + ' 什么时候切回直接讲解</h4>'
      + '<p class="' + NS + 'tip">当前强度：<b>' + esc(S.cur) + '</b>。'
      + '下面的判据**优先级高于强度档位** —— 档位是偏好，这些是刹车。</p>'
      + '<table class="' + NS + 'table"><thead><tr><th>信号</th><th>怎么办</th><th>为什么</th></tr></thead><tbody>'
      + [['同一卡点连续 3 轮无进展', '直接给出关键一步，再继续追问', '再追下去学生只会猜，不会产生理解'],
        ['学生明确说"我完全没想到"', '先给最小提示确认起点，别绕', '完全没有起点时追问等于让他猜谜'],
        ['情绪烦躁 / 时间很紧', '切回直接讲解，事后补追问', '情绪上来时学习关闭，硬扛只剩挫败'],
        ['概念本身有知识性错误', '先纠正事实，再追问推理', '错误的前提上做引导只会加固错误'],
        ['考前最后一天', '直接给结论与步骤', '此时目标是稳住，不是重建理解'],
        ['学生已经自己说对了', '确认并停，别继续问', '再问会让他怀疑自己刚才的答案']]
        .map(function (r) { return '<tr><td>' + esc(r[0]) + '</td><td>' + esc(r[1]) + '</td><td>' + esc(r[2]) + '</td></tr>' }).join('')
      + '</tbody></table></section>')
    out.push('<section class="' + NS + 'card"><h4>这个插件不做什么</h4>'
      + '<div class="' + NS + 'note good"><div><b>不保管会话、不替学生答题、不判定对错</b>'
      + '它只做一件事：给教练的 copilot.chat 加一条引导式提示词约束。'
      + '真正的推理与判断仍由教练和题目本身完成。'
      + '本页的历史只是你"看过哪段示例 + 反馈"，不含学生对话内容。</div></div></section>')
    return out.join('')
  }

  var VIEWS = [
    { k: 'overview', t: '人格概览', f: viewOverview },
    { k: 'method', t: '方法论', f: viewMethod },
    { k: 'examples', t: '示例对话', f: viewExamples },
    { k: 'scopes', t: '作用域与开关', f: viewScopes },
    { k: 'history', t: '历史', f: viewHistory },
    { k: 'config', t: '设置', f: viewConfig },
    { k: 'limits', t: '边界与刹车', f: viewLimits },
  ]

  /* ══════════════ 6. Shell：状态 + 事件委托 ══════════════ */

  function stateOf(ctx) {
    var cfg = cfgGet(ctx)
    var hist = historyGet(ctx)
    var v = 'overview'
    try { if (ctx && ctx.keep && typeof ctx.keep.get === 'function') v = ctx.keep.get(K_LAST_VIEW) || v } catch (e) { }
    return {
      cfg: cfg, hist: hist, lv: level(ctx),
      cat: CATS.indexOf(cfg.defaultCat) >= 0 ? cfg.defaultCat : '全部',
      view: VIEWS.some(function (x) { return x.k === v }) ? v : 'overview',
      insights: insightsOf(hist, ctx),
    }
  }
  function reportMD(ctx, S) {
    var lines = []
    lines.push('# 苏格拉底追问模式 · 使用报告')
    lines.push('')
    lines.push('> 生成时间：' + new Date().toLocaleString())
    lines.push('> 当前强度：' + S.lv + ' · 会话：' + SESSIONS.length + ' · 模板：' + TEMPLATES.length + ' · 历史：' + S.hist.length)
    lines.push('')
    lines.push('## 三档层级设计')
    lines.push('')
    LEVEL_DESIGN.forEach(function (x) { lines.push('- **' + x.k + '（深度 ' + x.depth + '/3）**：' + x.give + ' 怎么问：' + x.ask) })
    lines.push('')
    lines.push('## 切回直接讲解的判据')
    lines.push('')
    SWITCH_CRITERIA.forEach(function (c) { lines.push('- 信号 ' + c.sig + ' → 动作 ' + c.act) })
    lines.push('')
    lines.push('## 提问模板库')
    lines.push('')
    TEMPLATES.forEach(function (t) { lines.push('- （' + t.cat + '）' + t.q + ' 接着问：' + t.follow) })
    lines.push('')
    lines.push('## 会话与反馈历史')
    lines.push('')
    lines.push('| 日期 | 会话 | 类型 | 自己推出 | 反馈 |')
    lines.push('|---|---|---|---|---|')
    S.hist.slice().reverse().forEach(function (h) {
      lines.push('| ' + h.day + ' | ' + h.title + ' | ' + h.cat + ' | ' + (h.win ? '是' : '—') + ' | ' + (h.fb || '—') + ' |')
    })
    return lines.join('\n')
  }
  function doAct(ctx, S, root, act, value, fb) {
    if (act === 'tab' && VIEWS.some(function (x) { return x.k === value })) {
      S.view = value
      try { if (ctx && ctx.keep && typeof ctx.keep.set === 'function') ctx.keep.set(K_LAST_VIEW, value) } catch (e) { }
      render(root, ctx, S); return
    }
    if (act === 'cat' && CATS.indexOf(value) >= 0) {
      S.cat = value
      S.cfg = cfgSet(ctx, { defaultCat: value })
      render(root, ctx, S); return
    }
    if (LEVELS.indexOf(act) >= 0 && value === undefined) {
      setLevel(ctx, act)
      S.lv = act
      S.insights = insightsOf(S.hist, ctx)
      toast(ctx, '引导强度已切到「' + act + '」', 'success')
      render(root, ctx, S); return
    }
    if (act === 'lv' && LEVELS.indexOf(value) >= 0) {
      setLevel(ctx, value)
      bumpUse(ctx)
      S.lv = value
      S.insights = insightsOf(S.hist, ctx)
      toast(ctx, '引导强度已切到「' + value + '」', 'success')
      render(root, ctx, S); return
    }
    if (act === 'use') {
      S.hist = recordUse(ctx, value, false)
      bumpUse(ctx)
      S.insights = insightsOf(S.hist, ctx)
      toast(ctx, '已标记看过这段会话', 'success')
      render(root, ctx, S); return
    }
    if (act === 'win') {
      var arr = historyGet(ctx)
      var hit = false
      for (var i = arr.length - 1; i >= 0; i--) { if (arr[i].id === value) { arr[i].win = !arr[i].win; hit = true; break } }
      if (!hit) { arr = recordUse(ctx, value, true) } else { arr = historySave(ctx, arr) }
      S.hist = arr
      S.insights = insightsOf(S.hist, ctx)
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
        ctx.api.download('苏格拉底模式_历史_' + dkey() + '.json', JSON.stringify(S.hist, null, 2), 'application/json')
        toast(ctx, '已导出 ' + S.hist.length + ' 条历史', 'success')
      } catch (e) { toast(ctx, '导出失败：' + ((e && e.message) || e), 'danger') }
      return
    }
    if (act === 'export-md') {
      try {
        ctx.api.download('苏格拉底模式_报告_' + dkey() + '.md', reportMD(ctx, S), 'text/markdown;charset=utf-8')
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
  function mountPage(el, ctx) {
    style(ctx)
    var S = stateOf(ctx)
    render(el, ctx, S)
    var onClick = function (ev) {
      var t = ev.target
      for (var i = 0; i < 5 && t && t !== el; i++, t = t.parentElement) {
        var act = t.getAttribute && t.getAttribute('data-act')
        if (!act) {
          var lv = t.getAttribute && t.getAttribute('data-lv')
          if (lv) { ev.preventDefault(); doAct(ctx, S, el, 'lv', lv); return }
          continue
        }
        ev.preventDefault()
        doAct(ctx, S, el, act, t.getAttribute('data-v'), t.getAttribute('data-fb'))
        return
      }
    }
    var onChange = function (ev) {
      var t = ev.target
      if (!t || !t.getAttribute) return
      if (t.getAttribute('data-act') === 'cfg-cat') {
        S.cfg = cfgSet(ctx, { defaultCat: CATS.indexOf(t.value) >= 0 ? t.value : '全部' })
        S.cat = S.cfg.defaultCat
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

  /* ══════════════ 7. 常驻面板 ══════════════ */

  function panel(ctx) {
    style(ctx)
    if (!cfgGet(ctx).showPanel) return ''
    var cur = level(ctx)
    var idx = idxOf(cur)
    var uses = usesToday(ctx)
    var d = LEVEL_DESIGN[idx]
    return '<div class="' + NS + 'panel">'
      + '<div class="' + NS + 'panel-top"><span>' + I('cpBrain', '问') + ' 苏格拉底模式</span><span class="' + NS + 'pill">' + esc(cur) + '</span></div>'
      + '<div class="' + NS + 'meter"><i style="width:' + ((idx + 1) * 33) + '%"></i></div>'
      + '<div style="color:var(--text-secondary)">强度 ' + (idx + 1) + '/3 · 今日引导 ' + uses + ' 次</div>'
      + '<div style="color:var(--text-secondary);font-size:11px">' + esc(d.hint) + '</div>'
      + '<button class="btn btn-sm btn-ghost" data-act="open-sq">调整强度与示例</button></div>'
  }

  /* ══════════════ 8. 注册（契约原样保留） ══════════════ */

  var api = {
    id: PID,
    name: '苏格拉底追问模式',
    version: VERSION,
    author: '内置',
    desc: '教练改为引导式追问，不直接给答案。三档强度随时切换，工具页看示例、面板看当前档位。',
    tools: [{ id: 'socratic-page', title: '追问模式', icon: '' + U.icon('cpBrain') + '', mount: function (el, ctx) { return mountPage(el, ctx) } }],
    panels: [{ id: 'sq-today', title: '苏格拉底模式', icon: '' + U.icon('cpBrain') + '', width: 300, height: 190, render: panel }],
    config: [{ key: 'strength', label: '引导强度', type: 'select', default: DEF, options: LEVELS }],
    shortcuts: [{
      key: 'alt+s', label: '打开苏格拉底模式设置',
      run: function (ctx) { try { ctx.api.goTool('socratic-page') } catch (e) { } },
    }],
    queries: [{
      key: 'sq-strength', label: '当前引导强度',
      run: function (ctx) {
        var v = level(ctx)
        var tip = { '轻推': '给方向后可以较快给结论', '中等': '每次只给一小步', '死不松口': '不会报答案，直到你自己推出来' }[v]
        return '苏格拉底追问模式当前为「' + v + '」：' + tip + '。想切换可说「把引导强度改成' + LEVELS.filter(function (x) { return x !== v })[0] + '」。'
      },
    }],
    memory: '用户装有「苏格拉底追问模式」插件：教练默认用引导式追问而非直接给答案，强度分轻推/中等/死不松口三档。用户提到「别直接给答案」「引导我」「卡住了」时，按其当前档位追问。',

    /* ★ 原样保留：以下 promptAugment 是历史契约，禁止改动任何字符 */
    promptAugment: [{
      ctx: 'copilot.chat', name: '苏格拉底模式',
      note: '覆盖默认直接给答案的倾向，改为引导式追问',
      build: function () {
        var st = '中等'; try { st = (window.PluginBus && window.PluginBus.config) ? (window.PluginBus.config('socratic-mode', 'strength') || '中等') : '中等'; } catch (e) { }
        var rule = st === '轻推'
          ? '先给一个方向性提示；学生仍卡住时再逐步追问。'
          : (st === '死不松口'
            ? '无论学生怎么要，都绝不给出最终答案或完整步骤；只允许追问与最小提示，直到学生自己说出正确思路。'
            : '每轮只给一小步提示或一个反问，把关键推理跳跃留给学生自己完成。')
        return ['【教学流程·仲裁条款，高于任何语气/人格指令】本轮采用苏格拉底式引导教学：' + rule,
          '仲裁说明：若同时启用了其他语气人格类插件（如张宇/武忠祥人格包），分工为——它们只决定「用什么口吻说」，本条款决定「这轮给不给答案、给多少」；两者冲突时，以本教学流程为准。',
          '要求：① 每次回复结尾用 1-2 个具体的引导问题收尾（指向下一步该想什么，不许泛泛反问）；',
          '② 学生直接要答案（哪怕说"就一个数！"）时，先反问其当前思路与卡点，再给最小提示，绝不直接报数值结论；',
          '③ 学生连续两轮仍无法推进时，才给出该步结论并解释为什么这么走；',
          '④ 公式与术语可以直接给，但推导的关键一步留给学生；不改变原有输出格式与动作/标记协议。'].join('\n')
      }
    }],
  }

  if (typeof window !== 'undefined' && window.__SQ_DEBUG__) {
    window.__sqInternals = {
      esc: esc, num: num, clamp: clamp, flat: flat, trunc: trunc, dkey: dkey, hashStr: hashStr, I: I,
      level: level, setLevel: setLevel, cfgGet: cfgGet, cfgSet: cfgSet, ruleText: ruleText, idxOf: idxOf,
      LEVEL_DESIGN: LEVEL_DESIGN, TEMPLATES: TEMPLATES, SESSIONS: SESSIONS, SWITCH_CRITERIA: SWITCH_CRITERIA, DEMO: DEMO,
      historyGet: historyGet, historySave: historySave, recordUse: recordUse, setFeedback: setFeedback,
      feedbackStats: feedbackStats, usedCats: usedCats, recommendOf: recommendOf, insightsOf: insightsOf,
      reportMD: reportMD, mount: mountPage, VIEWS: VIEWS, MAX_HISTORY: MAX_HISTORY, LEVELS: LEVELS,
    }
  }

  PluginBus.register(api)
})()
