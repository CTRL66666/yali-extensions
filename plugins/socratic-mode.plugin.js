/* socratic-mode.plugin.js — 苏格拉底追问模式 · v1.1.0
 *
 * 早期版本只有一个 promptAugment（22 行），用户看不到"现在是什么档位、它在怎么拦答案"。
 * 这次按现代插件的能力面补齐：工具页 / 常驻面板 / 教练查询 / 快捷键 / 作用域样式。
 *
 * 【绝不改动的契约】下方 promptAugment 里的每一句都是教学仲裁条款：
 * market-plugins.test.ts 断言「苏格拉底」「引导」与仲裁段；prompt-augment.test.ts
 * 真重放后断言只有一条 copilot.chat 拓展器。升级只加能力，不动一个字。
 */
;(function () {
  'use strict'

  let VERSION = '1.1.0'
  let PID = 'socratic-mode'
  let NS = 'sq-'
  let DEF = '中等'
  let LEVELS = ['轻推', '中等', '死不松口']

  let CSS = `
.sq-page{display:flex;flex-direction:column;gap:12px}
.sq-hero{border-radius:14px;padding:16px 18px;background:linear-gradient(135deg,var(--glass-bg),var(--glass-bg));border:1px solid var(--line)}
.sq-hero h3{margin:0 0 6px;font-size:16px}
.sq-hero p{margin:0;color:var(--text-secondary);font-size:12.5px;line-height:1.7}
.sq-card{border:1px solid var(--line);border-radius:12px;padding:14px 16px;background:var(--glass-bg)}
.sq-card h4{margin:0 0 10px;font-size:13.5px}
.sq-lv{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}
.sq-lv button{text-align:left;border:1px solid var(--line);border-radius:10px;padding:12px;background:transparent;cursor:pointer;color:inherit;transition:border-color .18s,transform .18s}
.sq-lv button:hover{transform:translateY(-2px);border-color:var(--accent-text)}
.sq-lv button[aria-pressed="true"]{border-color:var(--accent-text);background:var(--glass-bg);box-shadow:0 0 0 2px var(--accent-fill)}
.sq-lv b{display:block;font-size:13px;margin-bottom:4px}
.sq-lv span{font-size:11.5px;color:var(--text-secondary);line-height:1.6}
.sq-demo{border-left:2px solid var(--accent-text);padding:6px 0 6px 12px;margin:8px 0;font-size:12.5px;line-height:1.75}
.sq-demo em{color:var(--text-secondary);font-style:normal}
.sq-panel{display:flex;flex-direction:column;gap:8px;font-size:12px}
.sq-panel-top{display:flex;justify-content:space-between;align-items:center}
.sq-pill{display:inline-flex;align-items:center;gap:5px;border-radius:999px;padding:3px 9px;background:var(--glass-bg);border:1px solid var(--line);font-size:11.5px}
.sq-meter{height:6px;border-radius:6px;background:var(--chart-track);overflow:hidden}
.sq-meter i{display:block;height:100%;border-radius:6px;background:linear-gradient(90deg,var(--blue),var(--accent-text));transition:width .25s}
`

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] }) }
  function style(ctx) { try { if (ctx && ctx.css && typeof ctx.css.add === 'function') ctx.css.add(CSS, 'skin') } catch (e) { } }
  function level(ctx) {
    try {
      let v = String((ctx && ctx.config ? ctx.config('strength') : '') || '')
      return LEVELS.indexOf(v) >= 0 ? v : DEF
    } catch (e) { return DEF }
  }
  function setLevel(ctx, v) {
    if (LEVELS.indexOf(v) < 0) return false
    try { if (ctx && typeof ctx.config === 'function') ctx.config('strength', v) } catch (e) { }
    try { if (ctx && ctx.keep) ctx.keep.set('sqLevel', v) } catch (e) { }
    return true
  }
  function bumpUse(ctx) {
    try {
      if (!ctx || !ctx.keep) return
      ctx.keep.set('sqDay', new Date().toISOString().slice(0, 10))
      ctx.keep.set('sqUses', (Number(ctx.keep.get('sqUses', 0)) || 0) + 1)
    } catch (e) { }
  }
  let DEMO = {
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

  /* ── 工具页：档位一眼可见，切换一次即刻影响教练 ─────────────── */
  function mountPage(el, ctx) {
    style(ctx)
    function render() {
      let cur = level(ctx)
      let demo = DEMO[cur] || DEMO[DEF]
      el.innerHTML = '<div class="sq-page">'
        + '<div class="sq-hero"><h3>' + U.icon('cpBrain') + ' 苏格拉底追问模式</h3>'
        + '<p>教练不直接替你写答案，而是用一两个具体问题把你推过最关键的那一步。<b>当前：' + esc(cur) + '</b></p></div>'
        + '<div class="sq-card"><h4>选择引导强度</h4><div class="sq-lv">'
        + LEVELS.map(function (v, i) {
          let sub = ['先给方向，卡住再逐步追问', '每次只给一小步，关键跳跃留给你', '绝不报答案，直到你自己说出来'][i]
          return '<button type="button" data-lv="' + v + '" aria-pressed="' + (v === cur) + '"><b>' + esc(v) + '</b><span>' + sub + '</span></button>'
        }).join('') + '</div></div>'
        + '<div class="sq-card"><h4>这个档位下会怎么回答</h4>'
        + demo.map(function (p) { return '<div class="sq-demo"><em>' + esc(p[0]) + '</em><br>' + esc(p[1]) + '</div>' }).join('')
        + '<details><summary style="cursor:pointer;font-size:12px;color:var(--text-secondary)">仲裁规则与边界 ⓘ</summary>'
        + '<p style="font-size:12px;line-height:1.8;color:var(--text-secondary)">语气人格插件（张宇/武忠祥）只决定用什么口吻说；本模式决定这轮给不给答案、给多少。两者冲突时以本模式为准。连续两轮仍无进展才给出该步结论；公式与术语可直接给，推导关键一步留给学生。</p></details>'
        + '</div></div>'
      let btns = el.querySelectorAll('[data-lv]')
      Array.prototype.forEach.call(btns, function (b) {
        b.onclick = function () {
          let v = b.getAttribute('data-lv')
          setLevel(ctx, v); bumpUse(ctx); render()
          if (ctx.Toast) ctx.Toast.show('引导强度已切到「' + v + '」', 'success')
        }
      })
    }
    render()
    return function () { el.innerHTML = '' }
  }

  /* ── 常驻面板：档位 + 今日追问次数 ───────────────────────── */
  function panel(ctx) {
    style(ctx)
    let cur = level(ctx)
    let uses = 0
    try { uses = Number(ctx.keep && ctx.keep.get('sqUses', 0)) || 0 } catch (e) { }
    let idx = Math.max(0, LEVELS.indexOf(cur))
    return '<div class="sq-panel">'
      + '<div class="sq-panel-top"><span>' + U.icon('cpBrain') + ' 苏格拉底模式</span><span class="sq-pill">' + esc(cur) + '</span></div>'
      + '<div class="sq-meter"><i style="width:' + ((idx + 1) * 33) + '%"></i></div>'
      + '<div style="color:var(--text-secondary)">强度 ' + (idx + 1) + '/3 · 今日引导 ' + uses + ' 次</div>'
      + '<button class="btn btn-sm btn-ghost" data-sq-open>调整强度与示例</button></div>'
  }

  let api = {
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
        let v = level(ctx)
        let tip = { '轻推': '给方向后可以较快给结论', '中等': '每次只给一小步', '死不松口': '不会报答案，直到你自己推出来' }[v]
        return '苏格拉底追问模式当前为「' + v + '」：' + tip + '。想切换可说「把引导强度改成' + LEVELS.filter(function (x) { return x !== v })[0] + '」。'
      },
    }],
    memory: '用户装有「苏格拉底追问模式」插件：教练默认用引导式追问而非直接给答案，强度分轻推/中等/死不松口三档。用户提到「别直接给答案」「引导我」「卡住了」时，按其当前档位追问。',

    /* ★ 原样保留：以下 promptAugment 是历史契约，禁止改动任何字符 */
    promptAugment: [{
      ctx: 'copilot.chat', name: '苏格拉底模式',
      note: '覆盖默认直接给答案的倾向，改为引导式追问',
      build: function () {
        let st = '中等'; try { st = (window.PluginBus && window.PluginBus.config) ? (window.PluginBus.config('socratic-mode', 'strength') || '中等') : '中等'; } catch (e) { }
        let rule = st === '轻推'
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

  PluginBus.register(api)
})()
