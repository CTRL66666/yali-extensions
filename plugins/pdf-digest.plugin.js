/**
 * pdfDigest.js — 内置市场插件「PDF 精读提炼」的**源码原文**
 *
 * 为什么单独一个 .js 文件、再用 `?raw` 内联进 MARKET_PLUGINS：
 *   插件源码最终要交给 `new Function` 重放，所以必须以**字符串**存在。历史做法是
 *   `mkCode([...])` 一行一字符串 —— 那样每个 HTML 属性的引号都要转义一次，
 *   而插件源码越长越容易在转义上翻车（files 头部的 TS1127/引号事故注释就是记账）。
 *   本文件写成真 .js（编辑器/语法高亮/单测都能直接读），pluginCenterData 用
 *   `import PDF_DIGEST_CODE from './pluginSrc/pdfDigest.js?raw'` 取原文 —— 零转义。
 *
 * 能力边界（诚实优先）：
 *   · 解析**完全本地**（window.PdfKit → 本地 pdf.js + 自建 worker），文件不出设备；
 *   · 只读 PDF 的**文字层**：扫描件/图片版只能抽到零星水印字，此时如实告诉用户
 *     "这页没有文字层，读不到"，并给出替代路径（题核/拍照），**绝不编内容**；
 *   · AI 提炼失败/未配置 → 原样报错，不拿空结果冒充成功。
 */
/* ---------------- 品牌字形 / 品牌砖 ----------------
 * 【2026-10-22】模块图标从 emoji '📄' 换成**自己的一枚品牌砖**：页面 + 放大镜（精读提炼）。
 * 字形只写一份 MARK_PATHS：页内标题那枚与导航栏那枚共用 —— 分开抄两份，改一处忘另一处就会画歪。
 * 砖要自己画成一段 SVG：导航栏只吃一段 SVG 串（没有 CSS 可依附），底色与白描边都得写进 svg。
 * 24 格 → 48 格：translate(9.6 9.6) scale(1.2) 缩进内边距；描边 2.2（22px 槽里约 1.2px，
 * 与邻居线性图标同字重）。渐变 id 带插件前缀（pmMarkG）：多插件同名 id 会互相抢填充。 */
let MARK_PATHS = '<path d="M13.5 3.5H5.5a1 1 0 0 0-1 1v15a1 1 0 0 0 1 1h6"/>'
  + '<path d="M7.5 7.5h6M7.5 10.5h4"/>'
  + '<circle cx="15.2" cy="13.2" r="4.3"/>'
  + '<path d="M18.4 16.4L21.5 19.5"/>'
let MARK_TILE = '<svg viewBox="0 0 48 48" width="1em" height="1em" aria-hidden="true">'
  + '<defs><linearGradient id="pmMarkG" x1="0" y1="0" x2="0" y2="1">'
  + '<stop offset="0" stop-color="#0891B2"/><stop offset="1" stop-color="#1D4ED8"/></linearGradient></defs>'
  + '<rect width="48" height="48" rx="13" fill="url(#pmMarkG)"/>'
  + '<g transform="translate(9.6 9.6) scale(1.2)" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">'
  + MARK_PATHS + '</g></svg>'
/* 页内标题的那枚砖：与卡片标题 12.5px 字号对齐，靠 font-size 驱动 svg 的 1em */
let MARK_INLINE = '<span style="font-size:18px;line-height:1;display:inline-block;vertical-align:-4px;margin-right:5px">' + MARK_TILE + '</span>'

PluginBus.register({
  id: 'pdf-digest',
  name: 'PDF 精读提炼',
  version: '1.1',
  author: '内置',
  desc: '本地解析 PDF（不上传）→ 逐页抽文字层 → AI 提炼考点/公式/易错点 + 3 道自测题，可送教练追问、导出 Markdown。',
  config: [
    { key: 'pages', label: '单次最多读几页', type: 'number', default: 12, desc: '大讲义先读前 N 页（默认 12；全书请分次读）' },
    { key: 'kind', label: '提炼侧重', type: 'select', options: ['考点为主', '公式为主', '例题为主'], default: '考点为主' }
  ],
  tools: [{
    id: 'pdf-digest',
    title: 'PDF 精读',
    icon: MARK_TILE,
    mount: function (el, ctx) {
      /* 单次喂给 AI 的字数上限：一整本讲义几十万字塞不进上下文，超了也只会得到
       * "越读越概括"的废话摘要。截断要**说出来**（见 render 的 clipped 提示）。 */
      let MAX_FEED = 20000;
      let st = { name: '', doc: null, pages: [], text: '', empty: [], clipped: false, digest: null, err: '', note: '', busy: false, pct: 0 };

      function esc(s) { return U.esc(String(s == null ? '' : s)); }
      /* 公式走站内渲染器（不是 Markdown）：AI 输出里的 $...$ / 破损 | 伪转义由它兜 */
      function tex(s) { try { return Tex.renderInline(String(s == null ? '' : s)); } catch (e) { return esc(s); } }
      function hasKit() { return !!(window.PdfKit && typeof window.PdfKit.open === 'function'); }

      function block(title, arr, useTex) {
        if (!arr || !arr.length) return '';
        let h = '';
        for (let i = 0; i < arr.length; i++) h += '<li>' + (useTex ? tex(arr[i]) : esc(arr[i])) + '</li>';
        return '<div class="pm-ai-section"><b>' + esc(title) + '：</b><div class="pm-ai-body"><ul>' + h + '</ul></div></div>';
      }

      function pageRows() {
        if (!st.pages.length) return '';
        let rows = '';
        for (let i = 0; i < st.pages.length; i++) {
          let p = st.pages[i];
          let prev = String(p.text || '').replace(/\s+/g, ' ').slice(0, 48);
          rows += '<div style="display:flex;gap:8px;align-items:baseline;padding:4px 0;border-bottom:1px solid var(--line)">'
            + '<span style="flex:0 0 68px;font-size:12px;opacity:.75">第 ' + p.n + ' 页</span>'
            + '<span style="flex:0 0 62px;font-size:12px">' + (p.hasText ? p.chars + ' 字' : '无文字层') + '</span>'
            + '<span style="flex:1;font-size:12px;opacity:.85;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + (prev ? esc(prev) : '—') + '</span>'
            + '</div>';
        }
        return '<div class="card" style="margin-top:8px"><div class="card-title-sm">逐页文字层（' + st.pages.length + ' 页）</div>' + rows + '</div>';
      }

      function digestHtml() {
        let d = st.digest;
        if (!d) return '';
        let quiz = '';
        if (d.quiz && d.quiz.length) {
          let items = '';
          for (let i = 0; i < d.quiz.length; i++) {
            let q = d.quiz[i] || {};
            items += '<div style="padding:6px 0;border-bottom:1px solid var(--line)">'
              + '<div style="font-size:13px">' + (i + 1) + '. ' + tex(q.q) + '</div>'
              + '<details style="margin-top:4px"><summary style="cursor:pointer;font-size:12px;opacity:.75">看参考答案</summary>'
              + '<div style="font-size:12px;margin-top:4px;opacity:.9">' + tex(q.a) + '</div></details></div>';
          }
          quiz = '<div class="card" style="margin-top:8px"><div class="card-title-sm">自测（先自己写，再看答案）</div>' + items + '</div>';
        }
        return '<div class="card" style="margin-top:8px"><div class="card-title-sm">提炼结果 · ' + esc(d.kindName || '') + '</div>'
          + block('核心考点', d.points, false)
          + block('关键公式', d.formulas, true)
          + block('易错点', d.traps, false)
          + '</div>' + quiz;
      }

      function md() {
        let d = st.digest;
        let out = '# ' + (st.name || 'PDF') + ' · 精读提炼\n\n';
        if (st.pages.length) out += '> 本地解析：' + st.pages.length + ' 页 · ' + st.text.length + ' 字' + (st.empty.length ? ' · 无文字层页 ' + st.empty.join('、') : '') + '\n\n';
        if (d) {
          if (d.points && d.points.length) out += '## 核心考点\n' + d.points.map(function (x) { return '- ' + x; }).join('\n') + '\n\n';
          if (d.formulas && d.formulas.length) out += '## 关键公式\n' + d.formulas.map(function (x) { return '- ' + x; }).join('\n') + '\n\n';
          if (d.traps && d.traps.length) out += '## 易错点\n' + d.traps.map(function (x) { return '- ' + x; }).join('\n') + '\n\n';
          if (d.quiz && d.quiz.length) out += '## 自测\n' + d.quiz.map(function (q, i) { return (i + 1) + '. ' + q.q + '\n   - 答案：' + q.a; }).join('\n') + '\n\n';
        }
        out += '## 原文（文字层）\n\n' + st.text;
        return out;
      }

      function render() {
        if (!hasKit()) {
          el.innerHTML = '<div class="card"><div class="card-title-sm">' + MARK_INLINE + 'PDF 精读提炼</div>'
            + '<div class="alert alert-warn">当前版本没有 window.PdfKit（PDF 本地解析能力未注册）。请更新到含 pdfPluginBridge 的版本后重试。</div></div>';
          return;
        }
        let head = '<div class="card"><div class="card-title-sm">' + MARK_INLINE + 'PDF 精读提炼</div>'
          + '<div class="muted-sm" style="margin-bottom:8px">PDF 在本机解析（pdf.js + 独立 worker），文件不会上传、不联网；只读文字层。</div>'
          + '<div class="btn-row">'
          + '<button class="btn btn-primary btn-sm" data-a="pick" ' + (st.busy ? 'disabled' : '') + '>' + (st.name ? '换一份 PDF' : '选择 PDF') + '</button>'
          + '<button class="btn btn-ghost btn-sm" data-a="ai" ' + ((!st.text || st.busy) ? 'disabled' : '') + '>AI 提炼</button>'
          + '<button class="btn btn-ghost btn-sm" data-a="md" ' + (st.digest ? '' : 'disabled') + '>导出 Markdown</button>'
          + '<button class="btn btn-ghost btn-sm" data-a="ask" ' + (st.digest ? '' : 'disabled') + '>送教练追问</button>'
          + (st.name ? '<button class="btn btn-ghost btn-sm" data-a="close">关闭文件</button>' : '')
          + '</div>';

        let status = '';
        if (st.busy) {
          status = '<div class="alert alert-info" style="margin-top:8px">' + esc(st.note || '处理中…') + '</div>';
        } else if (st.err) {
          status = '<div class="alert alert-warn" style="margin-top:8px">' + esc(st.err) + '</div>';
        } else if (st.name) {
          status = '<div class="alert alert-ok" style="margin-top:8px">已读《' + esc(st.name) + '》：' + st.pages.length + ' 页 · ' + st.text.length + ' 字'
            + (st.empty.length ? ' · <b>' + st.empty.length + ' 页没有文字层</b>' : '')
            + (st.clipped ? ' · 已截断到 ' + MAX_FEED + ' 字喂 AI' : '') + '</div>';
        } else {
          status = '<div class="alert alert-info" style="margin-top:8px">选一份讲义/真题 PDF 开始：先看逐页文字层，再让 AI 提炼要点。</div>';
        }

        let emptyTip = '';
        if (!st.busy && st.name && st.empty.length) {
          emptyTip = '<div class="alert alert-warn" style="margin-top:8px">第 ' + st.empty.slice(0, 12).join('、') + (st.empty.length > 12 ? ' 等' : '') + ' 页抽不到文字（扫描件/图片版页）。'
            + '这几页的内容我读不到，也不会猜 —— 想读图版请用「题核析鉴」或拍照识别。</div>';
        }
        el.innerHTML = head + status + emptyTip + '</div>' + pageRows() + digestHtml();
        bind();
      }

      function bind() {
        let q = function (k) { return el.querySelector('[data-a="' + k + '"]'); };
        let pick = q('pick'); if (pick) pick.onclick = pickPdf;
        let ai = q('ai'); if (ai) ai.onclick = digest;
        let mdBtn = q('md'); if (mdBtn) mdBtn.onclick = exportMd;
        let ask = q('ask'); if (ask) ask.onclick = askCoach;
        let cl = q('close'); if (cl) cl.onclick = closeDoc;
      }

      function closeDoc() {
        try { if (st.doc && st.doc.destroy) st.doc.destroy(); } catch (e) { }
        st.doc = null; st.name = ''; st.pages = []; st.text = ''; st.empty = []; st.digest = null; st.err = ''; st.clipped = false;
        render();
      }

      function pickPdf() {
        if (st.busy) return;
        window.PdfKit.pick().then(function (f) {
          return readAll(f);
        }).catch(function (e) {
          let m = String((e && e.message) || e);
          if (m.indexOf('未选择文件') >= 0) return;   // 用户取消 → 静默
          st.err = '打开 PDF 失败：' + m;
          st.busy = false;
          render();
        });
      }

      function readAll(f) {
        st.busy = true; st.err = ''; st.digest = null; st.pages = []; st.text = ''; st.empty = []; st.clipped = false;
        st.name = f.name; st.note = '正在本地解析《' + f.name + '》…'; st.pct = 0;
        render();
        let p = window.PdfKit.open(f.data);
        return p.then(function (doc) {
          try { if (st.doc && st.doc.destroy) st.doc.destroy(); } catch (e) { }
          st.doc = doc;
          let maxPages = Math.max(1, Math.min(200, Number(ctx.config('pages')) || 12));
          st.note = '共 ' + doc.numPages + ' 页，读取前 ' + Math.min(maxPages, doc.numPages) + ' 页…';
          render();
          return window.PdfKit.docText(doc, {
            to: maxPages,
            onPage: function (pg, done, total) {
              st.note = '抽取文字层 ' + done + '/' + total + ' 页…';
              render();
            }
          });
        }).then(function (r) {
          st.pages = r.pages;
          st.empty = r.emptyPages || [];
          let full = r.text || '';
          st.clipped = full.length > MAX_FEED;
          st.text = st.clipped ? full.slice(0, MAX_FEED) : full;
          st.busy = false; st.note = '';
          if (!st.text.replace(/\s/g, '').length) {
            st.err = '这份 PDF 的文字层是空的（扫描件/图片版）。可以换一份带文字层的 PDF，或用「题核析鉴 / 拍照」读图版页面。';
          }
          render();
        }).catch(function (e) {
          st.busy = false;
          st.err = '解析失败：' + String((e && e.message) || e);
          render();
        });
      }

      function digest() {
        if (st.busy || !st.text) return;
        if (!ctx.ai.has()) { st.err = '还没配置 AI：去「设置 → AI 接口」填好后再点提炼（PDF 解析本身不需要 AI）。'; render(); return; }
        st.busy = true; st.err = ''; st.digest = null; st.note = 'AI 正在读这 ' + st.pages.length + ' 页…'; render();
        let kind = String(ctx.config('kind') || '考点为主');
        let sys = '你是考研讲义精读助手。只输出 JSON 本身，不要前言、不要后记。数学公式一律用 $...$ 包裹。'
          + '文字来自 PDF 文字层，公式可能是带 ^{} _{} 的近似转写 —— 遇到残缺的记号按语义补齐，但不要编造原文没有的内容。';
        let usr = '下面是讲义《' + st.name + '》第 1-' + st.pages.length + ' 页的文字层内容：\n\n' + st.text
          + '\n\n请按「' + kind + '」的侧重提炼，只输出 JSON：'
          + '{"points":["核心考点，≤6 条，每条≤40字"],"formulas":["关键公式，≤6 条，用 $...$"],"traps":["易错点，≤5 条"],'
          + '"quiz":[{"q":"一道自测题","a":"参考答案与关键步骤"}]}'
          + '。要求：quiz 给 3 道、由易到难；points/formulas/traps 里只写这份讲义**真实出现**的内容，原文没有就少写几条，不许凑数。';
        ctx.ai.json(sys, usr, { ctx: 'plugin.ai' }).then(function (r) {
          let d = (r && typeof r === 'object') ? r : {};
          d.points = Array.isArray(d.points) ? d.points : [];
          d.formulas = Array.isArray(d.formulas) ? d.formulas : [];
          d.traps = Array.isArray(d.traps) ? d.traps : [];
          d.quiz = Array.isArray(d.quiz) ? d.quiz.slice(0, 5) : [];
          d.kindName = kind;
          if (!d.points.length && !d.formulas.length && !d.traps.length) {
            st.busy = false;
            st.err = 'AI 这次没给出可用的提炼结果（返回结构不完整）。可以再点一次「AI 提炼」，或先「送教练追问」看它怎么读。';
            render();
            return;
          }
          st.digest = d; st.busy = false; st.note = '';
          ctx.log('PDF 精读：' + st.name + ' → 考点 ' + d.points.length + ' / 公式 ' + d.formulas.length + ' / 易错 ' + d.traps.length);
          render();
        }).catch(function (e) {
          st.busy = false;
          st.err = 'AI 提炼失败：' + String((e && e.message) || e) + '（PDF 已解析好，问题出在 AI 接口）';
          render();
        });
      }

      function exportMd() {
        if (!st.digest) return;
        ctx.api.download('PDF精读-' + (st.name || 'notes').replace(/\.pdf$/i, '') + '.md', md(), 'text/markdown;charset=utf-8');
      }

      function askCoach() {
        if (!st.digest) return;
        let d = st.digest;
        let first = (d.points && d.points[0]) || '';
        let q = '我刚用「PDF 精读」读了讲义《' + st.name + '》前 ' + st.pages.length + ' 页，提炼出的第一个考点是：' + first
          + '。别急着讲答案，先问我一个能检验我是否真懂的问题；我答完你再指出我漏了什么。';
        if (window.Copilot && typeof window.Copilot.open === 'function') {
          window.Copilot.open({ send: q });
        } else {
          ctx.Toast.show('教练面板还没就绪，稍后再试', 'warn', 2500);
        }
      }

      render();
    }
  }]
});
