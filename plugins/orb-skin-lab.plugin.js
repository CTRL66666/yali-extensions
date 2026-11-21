/**
 * orbSkinLab.js — 内置市场插件「悬浮球换装实验室」v2.0 的**源码原文**
 *
 * 【为什么重写】2026-10-22 用户判定 v1 鸡肋，原话：
 *   「插件代码内部根本没写一个独立于站内素材的其他悬浮球小球，无法实现自定义自己想要的小球外观，
 *     重新改造迭代，至少做一个在插件代码里的小球出来」
 * v1 干的事：切 `window.AiOrb` 的内置皮肤（鸦荔 ⇄ 机器人）+ 注册一个 `<i>` 色块「圆点球」——
 * 换句话说它自己**没画过任何东西**，换装能换的只有站内已有的两件。这确实没有"扩展点"的价值。
 *
 * v2 干的事：本插件用 div + CSS **自己画三颗球**（零站内素材：没有一只鸦荔、没有机器人、没有站内图标），
 * 每颗都是完整皮肤：五态（待机/思考/工作/完成/睡眠）+ 通知点 + 免打扰，走公开契约
 * `AiOrb.registerSkin({key,name,css,mount})` 注册、`AiOrb.setSkin(key)` 穿上、偏好持久化在
 * localStorage(`kaoyan_ai_orb_v1`)。页内还能改主色/辅色 —— 换装、改色、看五态，全在这一个页里闭环。
 *
 * 【为什么用 div 而不是 SVG】站内有一条 `#copilot-fab.orb-host svg{display:none}`（当年为下线 fab
 * 里的旧图标加的），它会把**皮肤里**的 svg 一起藏掉：单测里 DOM 齐全，真机上球是空的。
 * 所以三颗球全部用 div + 伪元素 + 渐变画成 —— 纯 CSS，不受那条规则影响，也顺带省掉合成层开销。
 *
 * 【为什么状态不自己走】v1 里 `mount` 拿不到站点状态信号就自己 setTimeout 编了一套。
 * 这里**只**响应 OrbHandle 的三条指令（setState/notify/setDnd）：站点用 orbSetState 驱动，
 * 插件擅自改状态会跟业务打架（AI 还在思考，球自己跳去"完成"）。页内的状态流按钮只驱预览。
 *
 * 【为什么配置存 localStorage 而不是 ctx.data】皮肤 mount 发生在**页面之外**（桌面右下角那只球，
 * 刷新后由启动重放挂载），那里没有 ctx。所以外观参数只有 localStorage 这一条跨会话通路；
 * 页内改色 → 写 localStorage → `setSkin` 重挂 → 球当场变色。
 */

/* ---------------- 品牌砖（模块图标 + 页眉） ----------------
 * 用户要求「所有插件图标都这么个性化处理」：本插件的形象就是"一颗带轨道的球"，
 * 砖底 = 主色渐变，字形 = 球 + 一条轨道 + 一颗卫星。
 * 字形只写一份 MARK_PATHS：页眉那枚与导航栏那枚**共用**（各抄一份就会慢慢画歪）。
 * 渐变 id 带插件前缀 lb（多插件同屏同名 id 会互相抢填充）。 */
let MARK_PATHS = '<circle cx="12" cy="12" r="5.4"/>'
  + '<ellipse cx="12" cy="12" rx="10.2" ry="4.4" transform="rotate(-24 12 12)"/>'
  + '<circle cx="19.6" cy="7.6" r="1.6" fill="#fff" stroke="none"/>'
let MARK_TILE = '<svg viewBox="0 0 48 48" width="1em" height="1em" aria-hidden="true">'
  + '<defs><linearGradient id="lbMarkG" x1="0" y1="0" x2="0" y2="1">'
  + '<stop offset="0" stop-color="#0284C7"/><stop offset="1" stop-color="#4338CA"/></linearGradient></defs>'
  + '<rect width="48" height="48" rx="13" fill="url(#lbMarkG)"/>'
  + '<g transform="translate(9.6 9.6) scale(1.2)" fill="none" stroke="#fff" stroke-width="2.2"'
  + ' stroke-linecap="round" stroke-linejoin="round">' + MARK_PATHS + '</g></svg>'
/* 页眉那枚：与标题 13px 字号对齐，靠 font-size 驱动砖的 1em */
let MARK_HEAD = '<span class="lb-mark" style="font-size:20px;line-height:1;display:inline-block;vertical-align:-4px;margin-right:6px">'
  + MARK_TILE + '</span>'

/* ---------------- 外观参数（跨会话） ---------------- */
let LS_KEY = 'kaoyan_orb_lab_v2'
let LAB = { ball: 'lab-ink', c1: '#2563EB', c2: '#0B1220' }
function labLoad() {
  try {
    let v = JSON.parse(localStorage.getItem(LS_KEY) || 'null')
    if (v && typeof v === 'object') {
      if (v.ball) LAB.ball = String(v.ball)
      if (v.c1) LAB.c1 = String(v.c1)
      if (v.c2) LAB.c2 = String(v.c2)
    }
  } catch (e) { /* 隐私模式/坏数据：用默认外观，不挡插件 */ }
  return LAB
}
function labSave(patch) {
  if (patch) { if (patch.ball) LAB.ball = patch.ball; if (patch.c1) LAB.c1 = patch.c1; if (patch.c2) LAB.c2 = patch.c2 }
  try { localStorage.setItem(LS_KEY, JSON.stringify(LAB)) } catch (e) { }
  return LAB
}

/* ---------------- 公共壳样式（三颗球共用） ----------------
 * .lb 铺满宿主（宿主负责尺寸：桌面 fab 56px、页内预览 72px），自身不吃指针事件 ——
 * 拖拽/点击仍归 fab，皮肤只负责"长什么样"。 */
let SHELL_CSS = `
.lb{position:absolute;inset:0;pointer-events:none;user-select:none;-webkit-user-select:none;--lb-c1:#2563EB;--lb-c2:#0B1220}
.lb *{position:absolute;box-sizing:border-box}
.lb-bd{right:0;top:0;width:26%;height:26%;border-radius:50%;background:#ff3b30;border:2px solid #fff;
transform:scale(0);transition:transform .18s ease;z-index:9}
.lb.has-badge .lb-bd{transform:scale(1)}
.lb-halo{inset:0;border-radius:50%;border:2px solid var(--lb-c1);opacity:0}
.lb-hl{left:18%;top:12%;width:30%;height:20%;border-radius:50%;background:#fff;opacity:.5;filter:blur(1px)}
.lb-zzz{right:-6%;top:-8%;font-size:10px;font-weight:700;line-height:1;color:var(--lb-c1);opacity:0}
.lb.dnd *,.lb.dnd *::before,.lb.dnd *::after{animation:none!important}
@keyframes lb-breathe{0%,100%{transform:scale(1,1)}50%{transform:scale(1.05,.96)}}
@keyframes lb-spin{to{transform:rotate(360deg)}}
@keyframes lb-wobble{0%,100%{transform:translate(-2%,0) rotate(-2deg)}50%{transform:translate(2%,-2%) rotate(2deg)}}
@keyframes lb-pop{0%{transform:scale(1)}40%{transform:scale(1.14,.88)}100%{transform:scale(1)}}
@keyframes lb-halo{0%{transform:scale(.72);opacity:.9}100%{transform:scale(1.7);opacity:0}}
@keyframes lb-zzz{0%{opacity:0;transform:translate(0,2px) scale(.8)}35%{opacity:.9}100%{opacity:0;transform:translate(4px,-9px) scale(1.1)}}
@keyframes lb-ring-pulse{0%,100%{opacity:.35}50%{opacity:.95}}
@keyframes lb-flash{0%{opacity:0}22%{opacity:.85}100%{opacity:0}}
@media (prefers-reduced-motion: reduce){.lb *,.lb *::before,.lb *::after{animation:none!important}}
`

/* ---------------- 三颗球：各画各的 ---------------- */

/* ① 墨滴球：一颗有眼睛的果冻墨球（点眼 → 弧眼 → 闭眼，五种表情各不相同） */
let BALL_INK = {
  key: 'lab-ink', name: '墨滴球', desc: '果冻质感的墨球，思考时飞出一圈虚线轨道，完成时弧眼笑。',
  css: `
.lb-ink .lb-sp{inset:6%;border-radius:50%;background:radial-gradient(circle at 34% 28%,var(--lb-c1),var(--lb-c2) 78%);
animation:lb-breathe 3.4s ease-in-out infinite;transition:opacity .25s ease}
.lb-ink .lb-sp::after{content:'';position:absolute;inset:0;border-radius:50%;box-shadow:inset 0 -8px 12px rgba(0,0,0,.45)}
.lb-ink .lb-eye{top:42%;width:18%;height:18%;border-radius:50%;background:#fff;transition:top .22s ease,height .22s ease,border-radius .22s ease,background .22s ease}
.lb-ink .lb-eye.l{left:27%}
.lb-ink .lb-eye.r{right:27%}
.lb-ink .lb-mouth{left:50%;bottom:23%;width:22%;height:10%;margin-left:-11%;border-bottom:2px solid #fff;
border-radius:0 0 40% 40%;opacity:0;transition:opacity .2s ease}
.lb-ink .lb-ring{inset:0;border-radius:50%;border:2px dashed var(--lb-c1);opacity:0;transition:opacity .2s ease}
.lb-ink[data-state="thinking"] .lb-ring{opacity:.8;animation:lb-spin 2.6s linear infinite}
.lb-ink[data-state="thinking"] .lb-eye{top:36%}
.lb-ink[data-state="thinking"] .lb-sp{animation-duration:2.1s}
.lb-ink[data-state="working"] .lb-eye{top:47%;height:5%;border-radius:2px}
.lb-ink[data-state="working"] .lb-sp{animation:lb-wobble .44s ease-in-out infinite}
.lb-ink[data-state="done"] .lb-eye{top:45%;height:9%;background:transparent;border-top:3px solid #fff;border-radius:50% 50% 0 0}
.lb-ink[data-state="done"] .lb-mouth{opacity:1}
.lb-ink[data-state="done"] .lb-sp{animation:lb-pop .7s ease-out 2}
.lb-ink[data-state="done"] .lb-halo{animation:lb-halo .8s ease-out 2}
.lb-ink[data-state="sleep"] .lb-eye{top:50%;height:4%;border-radius:2px;opacity:.7}
.lb-ink[data-state="sleep"] .lb-sp{animation-duration:5.4s;opacity:.82}
.lb-ink[data-state="sleep"] .lb-zzz{animation:lb-zzz 2.6s ease-in-out infinite}
`,
  dom: '<div class="lb lb-ink" data-state="idle">'
    + '<span class="lb-ring"></span>'
    + '<span class="lb-sp"><span class="lb-hl"></span>'
    + '<span class="lb-eye l"></span><span class="lb-eye r"></span><span class="lb-mouth"></span></span>'
    + '<span class="lb-halo"></span><span class="lb-zzz">Z</span><span class="lb-bd"></span></div>'
}

/* ② 行星球：球 + 两道斜椭圆环 + 一颗绕行的卫星（转速随状态变） */
let BALL_ORBIT = {
  key: 'lab-orbit', name: '行星球', desc: '两道轨道环 + 一颗绕行卫星：思考加速、工作狂转、睡眠卫星落回地平线。',
  css: `
.lb-orbit .lb-ring{left:-4%;right:-4%;top:34%;height:32%;border-radius:50%;border:2.5px solid var(--lb-c1);
opacity:.55;transform:rotate(-18deg)}
.lb-orbit .lb-ring.b{left:2%;right:2%;top:38%;height:24%;opacity:.28;transform:rotate(26deg)}
.lb-orbit .lb-sp{inset:12%;border-radius:50%;background:radial-gradient(circle at 34% 30%,var(--lb-c1),var(--lb-c2) 76%);
animation:lb-breathe 3.8s ease-in-out infinite;transition:opacity .25s ease}
.lb-orbit .lb-orbs{inset:0;animation:lb-spin 7s linear infinite}
.lb-orbit .lb-moon{left:50%;top:-2%;width:16%;height:16%;margin-left:-8%;border-radius:50%;
background:var(--lb-c1);box-shadow:0 0 6px var(--lb-c1)}
.lb-orbit[data-state="thinking"] .lb-orbs{animation-duration:2.2s}
.lb-orbit[data-state="thinking"] .lb-ring{animation:lb-ring-pulse 1.4s ease-in-out infinite}
.lb-orbit[data-state="working"] .lb-orbs{animation-duration:1s}
.lb-orbit[data-state="working"] .lb-sp{animation:lb-wobble .5s ease-in-out infinite}
.lb-orbit[data-state="done"] .lb-orbs{animation:none}
.lb-orbit[data-state="done"] .lb-moon{top:10%;box-shadow:0 0 10px var(--lb-c1)}
.lb-orbit[data-state="done"] .lb-sp{animation:lb-pop .7s ease-out 2}
.lb-orbit[data-state="done"] .lb-halo{animation:lb-halo .8s ease-out 2}
.lb-orbit[data-state="sleep"] .lb-orbs{animation:none}
.lb-orbit[data-state="sleep"] .lb-moon{top:56%;opacity:.55}
.lb-orbit[data-state="sleep"] .lb-ring{opacity:.22}
.lb-orbit[data-state="sleep"] .lb-sp{animation-duration:6s;opacity:.8}
`,
  dom: '<div class="lb lb-orbit" data-state="idle">'
    + '<span class="lb-ring"></span><span class="lb-ring b"></span>'
    + '<span class="lb-orbs"><span class="lb-moon"></span></span>'
    + '<span class="lb-sp"><span class="lb-hl"></span></span>'
    + '<span class="lb-halo"></span><span class="lb-bd"></span></div>'
}

/* ③ 糖果纹球：锥形渐变条纹球，条纹自转（转速 = 状态；完成时白闪两下） */
let BALL_CANDY = {
  key: 'lab-candy', name: '糖果纹球', desc: '条纹糖果球，条纹随状态自转：待机慢转、工作狂转、完成白闪、睡眠几乎停住。',
  css: `
.lb-candy .lb-sp{inset:6%;border-radius:50%;overflow:hidden;background-color:var(--lb-c2);
background-image:repeating-conic-gradient(from 0deg,var(--lb-c1) 0 15deg,transparent 15deg 30deg);
animation:lb-spin 9s linear infinite;transition:opacity .25s ease}
/* 球面明暗**不能跟条纹一起转**：跟着转就不像"球在自转"，像整颗球在滚。
 * 所以轮廓暗边 + 反光都放在不参与旋转的 .lb-shade 上（早先那版把高光画在 .lb-sp::after 里，
 * 3× 特写下中心是一团白斑，条纹也读不出球感）。 */
.lb-candy .lb-shade{inset:6%;border-radius:50%;
background-image:radial-gradient(circle at 50% 46%,rgba(0,0,0,0) 44%,rgba(0,0,0,.48) 100%),
radial-gradient(circle at 68% 76%,rgba(255,255,255,.16),rgba(255,255,255,0) 40%)}
.lb-candy .lb-hl{left:24%;top:16%;width:26%;height:16%;opacity:.75;filter:blur(1.5px)}
.lb-candy .lb-flash{inset:6%;border-radius:50%;background:#fff;opacity:0}
.lb-candy[data-state="thinking"] .lb-sp{animation-duration:2.4s}
.lb-candy[data-state="working"] .lb-sp{animation-duration:1.1s}
.lb-candy[data-state="working"] .lb-halo{opacity:.6;animation:lb-ring-pulse .9s ease-in-out infinite}
.lb-candy[data-state="done"] .lb-sp{animation:none}
.lb-candy[data-state="done"] .lb-flash{animation:lb-flash .9s ease-out 2}
.lb-candy[data-state="done"] .lb-halo{animation:lb-halo .8s ease-out 2}
.lb-candy[data-state="sleep"] .lb-sp{animation-duration:30s;opacity:.72}
.lb-candy[data-state="sleep"] .lb-zzz{animation:lb-zzz 2.6s ease-in-out infinite}
`,
  dom: '<div class="lb lb-candy" data-state="idle">'
    + '<span class="lb-sp"></span><span class="lb-shade"></span><span class="lb-hl"></span>'
    + '<span class="lb-flash"></span>'
    + '<span class="lb-halo"></span><span class="lb-zzz">Z</span><span class="lb-bd"></span></div>'
}

let BALLS = [BALL_INK, BALL_ORBIT, BALL_CANDY]
function labBall(key) {
  for (let i = 0; i < BALLS.length; i++) { if (BALLS[i].key === key) return BALLS[i] }
  return BALLS[0]
}

/* ---------------- 页内样式（预览台/卡片/控件） ---------------- */
let PAGE_CSS = `
/* 页眉在 390px 下必须能折行：标题与「站内素材 0 件」原来挤在一行，标题被压成两行、
 * 说明文字在右边竖排三行（真机截图才发现）。标题给 nowrap 让它整体不拆，说明文字整行下移。 */
.lab-hd{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:0 0 4px}
.lab-hd-t{font-size:14px;font-weight:600;white-space:nowrap}
.lab-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(184px,1fr));gap:10px;margin-top:10px}
.lab-card{position:relative;display:flex;flex-direction:column;align-items:center;gap:8px;padding:12px 10px 10px;
border:1px solid var(--line);border-radius:12px;background:var(--bg-secondary,#f7f8fa);transition:border-color .2s ease,box-shadow .2s ease}
.lab-card.lab-on{border-color:var(--lb-on,#2563EB);box-shadow:0 0 0 2px rgba(37,99,235,.16)}
.lab-stage{position:relative;width:72px;height:72px;flex:0 0 72px}
.lab-nm{font-size:13px;font-weight:600;line-height:1.2;text-align:center}
.lab-ds{font-size:11.5px;line-height:1.5;opacity:.72;text-align:center;min-height:2.4em}
.lab-tag{font-size:10px;font-weight:600;padding:1px 6px;border-radius:8px;background:var(--lb-on,#2563EB);color:#fff}
.lab-row{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}
.lab-tint{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:12px;font-size:12px;opacity:.85}
.lab-tint input[type=color]{width:30px;height:24px;padding:0;border:1px solid var(--line);border-radius:6px;background:none}
`

let cssReady = false
function ensureLabCss() {
  if (cssReady || typeof document === 'undefined') return
  if (document.querySelector('style[data-orb-lab]')) { cssReady = true; return }
  let st = document.createElement('style')
  st.setAttribute('data-orb-lab', '1')
  st.textContent = SHELL_CSS + BALLS.map(function (b) { return b.css }).join('\n') + PAGE_CSS
  document.head.appendChild(st)
  cssReady = true
}

/* ---------------- 一颗粒子的实例（预览与皮肤**共用这一个工厂**） ----------------
 * 页内预览若另写一套渲染，就会出现"预览好看、穿上变了样"的分裂。所以两边都走 mountBall：
 * 区别只是宿主元素不同（页内 .lab-stage / 桌面 #copilot-fab）。 */
function mountBall(host, key) {
  ensureLabCss()
  let ball = labBall(key)
  if (!host) return { el: null, setState: function () { }, notify: function () { }, setDnd: function () { }, destroy: function () { } }
  host.innerHTML = ball.dom
  let root = host.querySelector('.lb')
  if (!root) return { el: null, setState: function () { }, notify: function () { }, setDnd: function () { }, destroy: function () { host.innerHTML = '' } }
  root.style.setProperty('--lb-c1', LAB.c1)
  root.style.setProperty('--lb-c2', LAB.c2)
  let dead = false
  return {
    el: root,
    setState: function (s) { if (!dead) root.setAttribute('data-state', String(s || 'idle')) },
    notify: function (on) { if (!dead) root.classList.toggle('has-badge', !!on) },
    setDnd: function (on) { if (!dead) root.classList.toggle('dnd', !!on) },
    destroy: function () { dead = true; host.innerHTML = '' }
  }
}

/* ---------------- 注册三件皮肤（幂等） ----------------
 * css 走皮肤契约的 css 字段：core/aiOrb 按 key 各注入一份（v2 顺带修了"只有第一件注入"的老 bug）。
 * 穿上后**刷新还在**：偏好由 aiOrb 自己存（kaoyan_ai_orb_v1）。
 * 自愈：如果偏好里记着我们某颗球、而当前活动皮肤不是它（插件比悬浮球晚加载的时序），重挂一次。 */
function labRegister() {
  let A = window.AiOrb
  if (!A || typeof A.registerSkin !== 'function') return false
  for (let i = 0; i < BALLS.length; i++) {
    let b = BALLS[i]
    A.registerSkin({
      key: b.key,
      name: b.name + '（实验室）',
      css: SHELL_CSS + b.css,
      mount: function (host) { return mountBall(host, b.key) }
    })
  }
  try {
    let pref = String((A.prefs() || {}).skin || '')
    if (pref && labBall(pref).key === pref && A.activeSkin && A.activeSkin() !== pref) A.setSkin(pref)
  } catch (e) { }
  return true
}

let STATES = [
  ['idle', '待机'], ['thinking', '思考'], ['working', '工作'], ['done', '完成'], ['sleep', '睡眠']
]

PluginBus.register({
  id: 'orb-skin-lab',
  name: '悬浮球换装实验室',
  version: '2.0',
  author: '内置',
  desc: '插件自己画三颗悬浮球（墨滴/行星/糖果纹）+ 五态 + 通知点 + 改配色，走 AiOrb.registerSkin 穿上桌面那只球。',
  init: function () { labLoad(); ensureLabCss(); labRegister() },
  tools: [{
    id: 'orb-skin-lab',
    title: '悬浮球换装',
    icon: MARK_TILE,
    render: function () {
      let A = window.AiOrb
      if (!A) return '<div class="muted-sm">window.AiOrb 未就绪（需站点核心 ≥ 2026-10-09）。</div>';
      labLoad()
      let cur = String(A.activeSkin ? A.activeSkin() : '')
      let cards = BALLS.map(function (b) {
        let on = cur === b.key
        return '<div class="lab-card' + (on ? ' lab-on' : '') + '" data-lab-card="' + b.key + '">'
          + '<div class="lab-stage" data-lab-preview="' + b.key + '"></div>'
          + '<div class="lab-nm">' + b.name + (on ? ' <span class="lab-tag">在用</span>' : '') + '</div>'
          + '<div class="lab-ds">' + b.desc + '</div>'
          + '<button class="btn ' + (on ? 'btn-primary' : 'btn-ghost') + ' btn-sm" data-lab-wear="' + b.key + '">'
          + (on ? '已穿上' : '穿上这颗') + '</button></div>'
      }).join('')
      let stBtns = STATES.map(function (s) {
        return '<button class="btn btn-ghost btn-sm" data-lab-state="' + s[0] + '">' + s[1] + '</button>'
      }).join('')
      return '<div class="card">'
        + '<div class="lab-hd">' + MARK_HEAD + '<span class="lab-hd-t">悬浮球换装实验室</span>'
        + '<span class="muted-sm">站内素材 0 件 · 三颗球都是本插件画的</span></div>'
        + '<div class="muted-sm">当前形象：<b data-lab-cur>' + (cur || '（未知）')
        + '</b> · 点「穿上这颗」后右下角那只球立刻换成它，刷新后仍是它。下面每颗球都是实时预览，可先试状态再决定。</div>'
        + '<div class="lab-grid">' + cards + '</div>'
        + '<div class="lab-row">' + stBtns
        + '<button class="btn btn-primary btn-sm" data-lab-flow>播放状态流（思考→工作→完成）</button>'
        + '<button class="btn btn-ghost btn-sm" data-lab-nf>通知点开关</button>'
        + '<button class="btn btn-ghost btn-sm" data-lab-dnd>免打扰开关</button></div>'
        + '<div class="lab-tint">主色 <input type="color" data-lab-c1 value="' + LAB.c1 + '">'
        + '辅色 <input type="color" data-lab-c2 value="' + LAB.c2 + '">'
        + '<button class="btn btn-ghost btn-sm" data-lab-reset>恢复默认配色</button>'
        + '<span class="muted-sm">改色当场生效（预览 + 已穿上的那只球）</span></div>'
        + '<div class="muted-sm" style="margin-top:10px;font-size:11.5px">'
        + '扩展点验证：本插件只调公开契约 —— <code>AiOrb.registerSkin({key,name,css,mount})</code> 注册、'
        + '<code>AiOrb.setSkin(key)</code> 穿上、<code>setState/notify/setDnd/destroy</code> 由站点驱动。'
        + '三颗球都实现完整五态 + 通知点 + 免打扰（免打扰 = 循环动画停、形状差异保留）。</div>'
        + '</div>'
    },
    mount: function (el, ctx) {
      let A = window.AiOrb
      if (!A) return
      labLoad(); ensureLabCss(); labRegister()

      /* 预览实例：与皮肤走同一个 mountBall —— 预览什么样，穿上就是什么样 */
      let views = []
      el.querySelectorAll('[data-lab-preview]').forEach(function (h) {
        views.push(mountBall(h, h.getAttribute('data-lab-preview')))
      })

      let state = 'idle', nf = false, dnd = false
      let timers = []
      function later(fn, ms) { let t = setTimeout(fn, ms); timers.push(t); return t }
      function drive() {
        views.forEach(function (v) { v.setState(state); v.notify(nf); v.setDnd(dnd) })
      }
      drive()

      /* 换装：写偏好 → 让 aiOrb 重挂（同 key 也重挂，否则改过的颜色不会重读）*/
      function wear(key) {
        labSave({ ball: key })
        if (!labRegister()) { ctx.Toast.show('皮肤注册表不可用', 'warn', 2200); return }
        let ok = A.setSkin(key)
        ctx.Toast.show(ok ? '已穿上「' + labBall(key).name + '」' : '换装失败：皮肤未注册', ok ? 'success' : 'warn', 2000)
        paint()
      }
      /* 卡片态就地刷新（不整页重渲染：重渲染会把预览实例连同当前状态一起丢掉）*/
      function paint() {
        let cur = String(A.activeSkin ? A.activeSkin() : '')
        let curEl = el.querySelector('[data-lab-cur]')
        if (curEl) curEl.textContent = cur || '（未知）'
        el.querySelectorAll('[data-lab-card]').forEach(function (card) {
          let key = card.getAttribute('data-lab-card')
          let on = key === cur
          card.classList.toggle('lab-on', on)
          let nm = card.querySelector('.lab-nm')
          if (nm) nm.innerHTML = labBall(key).name + (on ? ' <span class="lab-tag">在用</span>' : '')
          let btn = card.querySelector('[data-lab-wear]')
          if (btn) {
            btn.textContent = on ? '已穿上' : '穿上这颗'
            btn.className = 'btn ' + (on ? 'btn-primary' : 'btn-ghost') + ' btn-sm'
          }
        })
      }

      el.querySelectorAll('[data-lab-wear]').forEach(function (b) {
        b.onclick = function () { wear(b.getAttribute('data-lab-wear')) }
      })
      el.querySelectorAll('[data-lab-state]').forEach(function (b) {
        b.onclick = function () { state = b.getAttribute('data-lab-state'); drive() }
      })
      let flow = el.querySelector('[data-lab-flow]')
      if (flow) flow.onclick = function () {
        /* 连点两次不该出现两套状态流叠在一起跑：先清掉上一轮的定时器 */
        timers.forEach(function (t) { clearTimeout(t) })
        timers = []
        state = 'thinking'; drive()
        later(function () { state = 'working'; drive() }, 1200)
        later(function () { state = 'done'; drive() }, 2500)
        later(function () { state = 'idle'; drive() }, 4300)
      }
      /* 通知点：同时点亮预览与真实悬浮球（这是站点公开信号 AiOrb.notify，不是插件另搞一套）*/
      let nfBtn = el.querySelector('[data-lab-nf]')
      if (nfBtn) nfBtn.onclick = function () {
        nf = !nf; drive()
        try { A.notify(nf) } catch (e) { }
        ctx.Toast.show(nf ? '通知点已点亮（预览 + 悬浮球）' : '通知点已清除', 'info', 1600)
      }
      let dndBtn = el.querySelector('[data-lab-dnd]')
      if (dndBtn) dndBtn.onclick = function () {
        dnd = !dnd; drive()
        ctx.Toast.show(dnd ? '免打扰：循环动画停，五态形状仍在' : '免打扰已关闭', 'info', 1800)
      }
      /* 改色：写盘 + 预览换色变量；**重挂真球只在 onchange**（拖动色盘时 oninput 每秒几十次，
       * 每次 setSkin 都是"销毁 + 重建整颗球"，拖着色盘就会把悬浮球拆装几十遍）。 */
      function tint(k, v, remount) {
        if (!/^#[0-9a-fA-F]{6}$/.test(String(v || ''))) return
        let patch = {}; patch[k] = String(v); labSave(patch)
        views.forEach(function (v2) {
          if (v2.el) { v2.el.style.setProperty('--lb-c1', LAB.c1); v2.el.style.setProperty('--lb-c2', LAB.c2) }
        })
        if (!remount) return
        let cur = String(A.activeSkin ? A.activeSkin() : '')
        if (cur && labBall(cur).key === cur) A.setSkin(cur)
      }
      let c1 = el.querySelector('[data-lab-c1]')
      if (c1) {
        c1.oninput = function () { tint('c1', c1.value, false) }
        c1.onchange = function () { tint('c1', c1.value, true) }
      }
      let c2 = el.querySelector('[data-lab-c2]')
      if (c2) {
        c2.oninput = function () { tint('c2', c2.value, false) }
        c2.onchange = function () { tint('c2', c2.value, true) }
      }
      let rst = el.querySelector('[data-lab-reset]')
      if (rst) rst.onclick = function () {
        labSave({ c1: '#2563EB', c2: '#0B1220' })
        if (c1) c1.value = LAB.c1
        if (c2) c2.value = LAB.c2
        tint('c1', LAB.c1, true)
        ctx.Toast.show('配色已恢复默认', 'success', 1600)
      }

      /* 离开页面：清定时器 + 拆预览实例 + 收掉我们自己点亮的通知点（别给用户留一颗常亮红点）*/
      return function () {
        timers.forEach(function (t) { clearTimeout(t) })
        timers = []
        views.forEach(function (v) { v.destroy() })
        views = []
        if (nf) { try { A.notify(false) } catch (e) { } }
      }
    }
  }],
  onDisable: function () {
    /* 停用插件：如果身上穿的正是我们画的球，退回站内默认（否则刷新后那颗球画不出来）*/
    try {
      let A = window.AiOrb
      if (!A) return
      let cur = String(A.activeSkin ? A.activeSkin() : '')
      if (cur && labBall(cur).key === cur) A.setSkin('yali')
    } catch (e) { }
  }
});
