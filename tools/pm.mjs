#!/usr/bin/env node
/* pm.mjs — 鸦荔插件仓库管理脚本（Plugin Manager）
 *
 * 由来：2026-11-21 市场 28 支插件全部外置后，发一次版要串 8~10 步：
 *   改插件版本 → 改市场版本 → 打 tag → push → 等 CDN → 改本体 EXT_TAG →
 *   同步快照 → 跑门禁 → 构建 → 部署。
 * 任何一步漏掉都不会当场报错，只会变成"市场显示新版但线上拉旧代码"这种静默事故。
 * 这个脚本把这些步骤收口成一条命令，并在每一步打印发生了什么。
 *
 * 用法（在 _ext_repo 下）：
 *   node tools/pm.mjs list                          列出全部插件 + 版本/体积/市场版本对照
 *   node tools/pm.mjs check                         全量体检（语法/版本/tag/快照），只读
 *   node tools/pm.mjs new <id> [名称]               生成插件骨架
 *   node tools/pm.mjs bump <id> [patch|minor|major|x.y.z]   升源码+市场版本，不提交
 *   node tools/pm.mjs release [--dry-run] [--no-deploy] [id...]
 *                                                   一键发版（默认连站点一起构建部署）
 *   node tools/pm.mjs deploy                        只重新构建部署站点（tag/EXT_TAG 已就位时用）
 *
 * 设计约束（都是踩过坑定下来的）：
 *   · 不用 `git add -A`：工作区常驻别的线的 WIP，只显式 add 自己那几个路径；
 *   · tag 只增不改：jsDelivr 对 tag 是不可变缓存；
 *   · 发版前必须 `check`，且会核对"扩展仓最新 tag == 本体 EXT_TAG"；
 *   · 推送后**轮询 CDN 真拿到 200** 才继续（jsDelivr 索引偶有延迟）；
 *   · 有 `--dry-run`，部署前能先看完整计划。
 */
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const EXT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SITE = path.resolve(EXT, '../kaoyan-v2')
const PLUGINS = path.join(EXT, 'plugins')
const PCD = path.join(SITE, 'src/core/pluginCenterData.ts')
const SYNC = path.join(SITE, 'tools/sync-ext-plugins.mjs')
const DEPLOY_DIR = 'E:/_wb_tmp/pm-deploy'
const HOST = 'https://testingcf.jsdelivr.net/gh/CTRL66666/yali-extensions@'
const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const NPX = process.platform === 'win32' ? 'npx.cmd' : 'npx'

const args = process.argv.slice(2)
const cmd = args[0] || 'help'
const opt = (name) => args.includes('--' + name)
const flagVal = (name, dft) => {
  const i = args.indexOf('--' + name)
  return i >= 0 && args[i + 1] ? args[i + 1] : dft
}

function die(msg) { console.error('\n✗ ' + msg + '\n'); process.exit(1) }
function step(msg) { console.log('\n▸ ' + msg) }
function ok(msg) { console.log('  ✓ ' + msg) }
function warn(msg) { console.log('  ⚠ ' + msg) }

/** 所有外部命令都用参数数组调用，不拼 shell 字符串（路径含空格/中文也安全）。 */
function run(bin, argv, cwd, quiet = false) {
  const r = spawnSync(bin, argv, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  if (r.status !== 0) {
    const tail = ((r.stderr || '') + (r.stdout || '')).trim().split('\n').slice(-6).join('\n    ')
    die(`命令失败：${bin} ${argv.join(' ')}\n    ${tail}`)
  }
  if (!quiet && r.stdout && r.stdout.trim()) console.log(r.stdout.trim())
  return r.stdout || ''
}
function git(cwd, argv, quiet = true) { return run('git', argv, cwd, quiet).trim() }
/* latestTag() 要容许"还没打过 tag"，所以单独走一个不 die 的版本。 */
function tryGit(cwd, argv) {
  const r = spawnSync('git', argv, { cwd, encoding: 'utf8' })
  return r.status === 0 ? (r.stdout || '').trim() : ''
}
/* 部署脚本从 DEPLOY_DIST 读产物；不设它就会去读仓库 dist（等于白复制一份快照）。 */
function runDeploy() {
  const r = spawnSync('python', ['scripts/deploy-v2.py', '--prune'], {
    cwd: SITE, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, DEPLOY_DIST: DEPLOY_DIR },
  })
  if (r.status !== 0) die('部署脚本失败：\n' + ((r.stderr || '') + (r.stdout || '')).slice(-1500))
  return r.stdout || ''
}
function gitStatus(cwd) {
  return git(cwd, ['status', '--porcelain']).split('\n').map((l) => l.trim()).filter(Boolean)
    /* 注意顺序：整行先 trim 会吃掉前导空格，此时再 slice(3) 会把路径首字母削掉
     * （" M plugins/x" → trim → "M plugins/x" → slice(3) = "lugins/x"），
     * 于是"没有待发布改动"这种假象。按两字符状态位之后再 trim 取路径。 */
    .map((l) => ({ st: l.slice(0, 2).trim(), file: l.slice(2).trim().replace(/^"|"$/g, '') }))
}

// ── 数据读取 ──────────────────────────────────────────────────
function marketEntries() {
  const src = readFileSync(PCD, 'utf8')
  const out = []
  const re = /id:\s*'([a-z0-9-]+)',\s*name:\s*'([^']*)',\s*version:\s*'([0-9.]+)'/g
  let m
  while ((m = re.exec(src))) {
    const from = m.index
    const next = src.indexOf("\n  {", from + m[0].length)
    out.push({ id: m[1], name: m[2], version: m[3], retired: /retired:\s*true/.test(src.slice(from, next < 0 ? src.length : next)) })
  }
  return out
}
function versionAnchor(src) {
  const a = /VERSION\s*=\s*'([0-9.]+)'/.exec(src)
  if (a) return { v: a[1], re: /VERSION\s*=\s*'([0-9.]+)'/ }
  const b = /version:\s*'([0-9.]+)'/.exec(src)
  return b ? { v: b[1], re: /version:\s*'([0-9.]+)'/ } : null
}
function pluginFiles() {
  return readdirSync(PLUGINS).filter((f) => f.endsWith('.plugin.js')).sort()
}
function latestTag() { return tryGit(EXT, ['describe', '--tags', '--abbrev=0']) }
function extTag() {
  const m = /const EXT_TAG = '([^']+)'/.exec(readFileSync(PCD, 'utf8'))
  return m ? m[1] : ''
}
function nextTag(cur, mode) {
  /* 插件版本有位数的历史写法：1.0 / 1.2 / 2.0（早期内联件），tag 则是三段。
   * 两边都走这个函数，所以两种都要认 —— 缺 patch 就按 0 补。 */
  const m = /^v?(\d+)\.(\d+)(?:\.(\d+))?$/.exec(String(cur || 'v0.0.0'))
  if (!m) die(`版本号不是 X.Y 或 X.Y.Z 形态：${cur}`)
  let [a, b, c] = [Number(m[1]), Number(m[2]), Number(m[3] || 0)]
  if (mode === 'major') { a++; b = 0; c = 0 }
  else if (mode === 'minor') { b++; c = 0 }
  else c++
  return `v${a}.${b}.${c}`
}

// ── list ──────────────────────────────────────────────────────
function cmdList() {
  const market = new Map(marketEntries().map((m) => [m.id, m]))
  console.log(`扩展仓：${EXT}`)
  console.log(`本体：  ${SITE}   EXT_TAG=${extTag()}   最新 tag=${latestTag()}`)
  console.log('\nid                         版本      KB    市场版本   状态')
  console.log('-'.repeat(66))
  let bad = 0
  for (const f of pluginFiles()) {
    const id = f.replace(/\.plugin\.js$/, '')
    const src = readFileSync(path.join(PLUGINS, f), 'utf8')
    const anchor = versionAnchor(src)
    const mp = market.get(id)
    const v = anchor ? anchor.v : '(无版本锚)'
    let state = 'ok'
    if (!anchor) state = '⚠ 无版本锚'
    else if (!mp) state = '⚠ 市场无此条'
    else if (mp.version !== v) state = `⚠ 漂移(市场 ${mp.version})`
    if (state !== 'ok') bad++
    console.log(`${id.padEnd(27)} ${v.padEnd(8)} ${String(Math.round(src.length / 1024)).padStart(5)}  ${(mp ? mp.version : '-').padEnd(9)}  ${state}${mp && mp.retired ? '  [下架]' : ''}`)
  }
  console.log(`\n共 ${pluginFiles().length} 支，问题 ${bad} 条。`)
  if (bad) process.exitCode = 2
}

// ── check ─────────────────────────────────────────────────────
function cmdCheck() {
  const market = new Map(marketEntries().map((m) => [m.id, m]))
  const problems = []
  for (const f of pluginFiles()) {
    const id = f.replace(/\.plugin\.js$/, '')
    const file = path.join(PLUGINS, f)
    const r = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' })
    if (r.status !== 0) problems.push(`${id}: 语法错 —— ${(r.stderr || '').split('\n')[0]}`)
    const a = versionAnchor(readFileSync(file, 'utf8'))
    if (!a) problems.push(`${id}: 源码里找不到版本锚`)
    else if (!market.has(id)) problems.push(`${id}: 市场里没有这条登记`)
    else if (market.get(id).version !== a.v) problems.push(`${id}: 市场 ${market.get(id).version} ≠ 源码 ${a.v}`)
  }
  const lt = latestTag(), et = extTag()
  if (lt && lt !== et) problems.push(`EXT_TAG 落后：本体 ${et} / 扩展仓最新 ${lt}（线上会拉旧代码）`)

  step('本体快照一致性（sync --check）')
  const r = spawnSync(process.execPath, [SYNC, '--check'], { cwd: SITE, encoding: 'utf8' })
  console.log((r.stdout || '').trim())
  if (r.status !== 0) problems.push(`测试快照不一致（sync --check 退出码 ${r.status}）`)

  if (problems.length) die('体检未通过：\n  ' + problems.join('\n  '))
  ok(`体检通过：${pluginFiles().length} 支插件语法/版本/快照/tag 全部一致（${lt}）`)
}

// ── new ───────────────────────────────────────────────────────
function cmdNew() {
  const id = args[1]
  if (!id || !/^[a-z0-9-]+$/.test(id)) die('用法：node tools/pm.mjs new <小写连字符 id> [名称]')
  const file = path.join(PLUGINS, id + '.plugin.js')
  if (existsSync(file)) die(`插件已存在：${file}`)
  const name = args[2] || id
  const tpl = `/* ${name} — 插件源码（由 pm.mjs new 生成）
 *
 * 约定：
 *   · 源码里 version 必须与市场登记 version 逐字相等（pm.mjs check 会拦）；
 *   · 不要用 fetch(XMLHttpRequest) 请求站点自身路径 —— 源码从扩展仓 CDN 按需拉；
 *   · 改完用 pm.mjs release 发版，别手动打 tag。
 */
PluginBus.register({
  id: '${id}', name: '${name}', version: '1.0.0', author: '内置',
  desc: '待补充：一句话说明它解决什么问题。',
  tags: ['工具页'],
  tools: [{
    id: '${id}', title: '${name}', icon: '',
    render: function () { return '<div class="muted-sm">待补充工具页内容</div>' },
    mount: function (el, ctx) { return function () { el.innerHTML = '' } },
  }],
})
`
  writeFileSync(file, tpl, 'utf8')
  ok(`已创建 ${file}`)
  console.log(`\n下一步：\n  1) 改源码（尤其 desc / 图标 / 工具页内容）\n  2) 在 kaoyan-v2/src/core/pluginCenterData.ts 加一条：\n     { id: '${id}', name: '${name}', version: '1.0.0', icon: 'puzzle', desc: '…', tags: ['…'], codeUrl: EXT_CDN + '${id}.plugin.js' }\n  3) node tools/pm.mjs check && node tools/pm.mjs release`)
}

// ── bump ──────────────────────────────────────────────────────
function cmdBump() {
  const id = args[1]
  const mode = args[2] || 'patch'
  if (!id) die('用法：node tools/pm.mjs bump <id> [patch|minor|major|x.y.z]')
  const file = path.join(PLUGINS, id + '.plugin.js')
  if (!existsSync(file)) die(`找不到插件：${file}`)
  const a = versionAnchor(readFileSync(file, 'utf8'))
  if (!a) die(`${id}: 找不到版本锚，脚本不敢猜着改`)
  const next = /^\d+\.\d+\.\d+$/.test(mode) ? mode : nextTag('v' + a.v, mode).slice(1)

  let src = readFileSync(file, 'utf8')
  src = src.replace(a.re, (all) => all.replace(a.v, next))
  writeFileSync(file, src, 'utf8')

  let pcd = readFileSync(PCD, 'utf8')
  const m = new RegExp(`(id: '${id}',\\s*name: '[^']*',\\s*version: ')([0-9.]+)(')`)
  if (!m.test(pcd)) die(`市场数据里找不到 ${id} 的 version，未改动本体文件（插件源码已升到 ${next}）`)
  pcd = pcd.replace(m, (all, p1, _v, p3) => p1 + next + p3)
  writeFileSync(PCD, pcd, 'utf8')
  ok(`${id}: ${a.v} → ${next}（插件源码与市场各改一处，未提交）`)
}

// ── release ───────────────────────────────────────────────────
function waitCdn(url, tries = 12) {
  for (let i = 0; i < tries; i++) {
    const r = spawnSync('curl', ['-s', '-o', 'NUL', '-w', '%{http_code}', '--max-time', '20', url], { encoding: 'utf8' })
    if ((r.stdout || '').trim() === '200') return true
    process.stdout.write('.')
    spawnSync(process.execPath, ['-e', 'setTimeout(()=>{},4000)'])
  }
  console.log('')
  return false
}

function cmdRelease() {
  const dry = opt('dry-run')
  const noDeploy = opt('no-deploy')
  /* 把 flag 连同它的值一起吃掉，否则 `--tag v1.5.1` 里的 v1.5.1 会被当成插件 id。 */
  const consumed = new Set([0])
  for (let i = 1; i < args.length; i++) {
    if (!args[i].startsWith('--')) continue
    consumed.add(i)
    if (!['--dry-run', '--no-deploy'].includes(args[i]) && args[i + 1]) consumed.add(i + 1)
  }
  const explicit = args.filter((_, i) => !consumed.has(i))
  const bumpMode = flagVal('bump', 'patch')

  step('发版前体检')
  cmdCheck()

  // 找出真正改动的插件：显式指定优先，否则取工作区里变动的插件文件
  const changed = explicit.length ? explicit.map((id) => id + '.plugin.js') :
    gitStatus(EXT).filter((x) => x.file.startsWith('plugins/') && x.file.endsWith('.plugin.js')).map((x) => path.basename(x.file))
  if (!changed.length) die('没有待发布的插件改动（可显式指定 id，或先改插件源码）')

  /* 自动处理版本，但**不能误升**：
   *   · 源码版本相对 HEAD 没变、市场也不变 → 这次是纯代码改动，自动升 patch；
   *   · 源码已手动升过、市场没跟上 → 把市场改成源码版本（别再升一次）；
   *   · 两边已经一致且都相对 HEAD 变了（用户先跑过 bump）→ 不动。 */
  const market = new Map(marketEntries().map((m) => [m.id, m]))
  const bumps = []
  for (const f of changed) {
    const id = f.replace(/\.plugin\.js$/, '')
    const a = versionAnchor(readFileSync(path.join(PLUGINS, f), 'utf8'))
    if (!a) die(`${id}: 无版本锚`)
    const mp = market.get(id)
    if (!mp) die(`${id}: 市场里没有这条登记，先在 pluginCenterData.ts 加一条`)
    const headSrc = tryGit(EXT, ['show', 'HEAD:plugins/' + f])
    const headV = headSrc ? (versionAnchor(headSrc) || {}).v || '' : ''
    if (mp.version !== a.v) bumps.push({ id, target: a.v, why: `市场对齐源码 ${mp.version} → ${a.v}` })
    else if (headV === a.v) bumps.push({ id, target: nextTag('v' + a.v, bumpMode).slice(1), why: `源码版本未变，自动升 patch ${a.v}` })
  }

  const nextTagValue = opt('tag') ? flagVal('tag', '') : nextTag(latestTag(), 'patch')
  if (!/^v\d+\.\d+\.\d+$/.test(nextTagValue)) die(`tag 格式必须是 vX.Y.Z：${nextTagValue}`)
  if (latestTag() === nextTagValue) die(`tag ${nextTagValue} 已存在 —— tag 不可原地改，请升版本号`)

  const plan = [
    ...bumps.map((b) => `版本：${b.id} → ${b.target}（${b.why}）`),
    `扩展仓：提交改动 → 打 tag ${nextTagValue} → push origin main --tags`,
    `等 CDN 索引：${HOST}${nextTagValue}/plugins/${path.basename(changed[0])}`,
    `本体：EXT_TAG → ${nextTagValue}；同步 28 支测试快照；跑门禁；提交`,
    noDeploy ? '（--no-deploy：到此为止）' : `构建 + 部署到 gh-pages（${DEPLOY_DIR}）`,
  ]
  step(`发版计划（${changed.length} 支插件：${changed.join(', ')}）`)
  plan.forEach((p) => console.log('  · ' + p))
  if (dry) { ok('dry-run 结束，未做任何写操作 / 网络写操作'); return }

  // 计划确认后才真正落版本（dry-run 绝不能改文件）
  for (const b of bumps) run(process.execPath, [fileURLToPath(import.meta.url), 'bump', b.id, b.target], EXT, false)

  // 1) 扩展仓：只显式 add 自己改过的插件文件 + README
  step('扩展仓：提交 + 打 tag + 推送')
  const extChanges = gitStatus(EXT)
    .filter((x) => (x.file.startsWith('plugins/') || x.file === 'README.md') && x.st !== '??')
    .map((x) => x.file)
  if (extChanges.length) {
    git(EXT, ['add', '--', ...extChanges], false)
    git(EXT, ['commit', '-m', `chore(plugins): release ${nextTagValue} — ${changed.length} 支插件`], false)
  } else {
    ok('扩展仓没有待提交文件，沿用当前 HEAD 打 tag')
  }
  git(EXT, ['tag', nextTagValue], false)
  git(EXT, ['push', 'origin', 'main', '--tags'], false)

  // 2) 等 CDN 真能取到，而不是假设"推完就有了"
  step('等 jsDelivr 索引新 tag')
  const probe = HOST + nextTagValue + '/plugins/' + path.basename(changed[0])
  if (!waitCdn(probe)) die('CDN 迟迟取不到新 tag，本体 EXT_TAG 未改动（可以稍后重跑 release）')
  ok('CDN 已可取')

  // 3) 本体：改 EXT_TAG → 同步快照 → 门禁 → 提交
  step('本体：改 EXT_TAG + 同步快照')
  const pcd = readFileSync(PCD, 'utf8')
  const tagRe = /const EXT_TAG = '([^']+)'/
  if (!tagRe.test(pcd)) die('本体 pluginCenterData.ts 里找不到 EXT_TAG')
  writeFileSync(PCD, pcd.replace(tagRe, `const EXT_TAG = '${nextTagValue}'`), 'utf8')
  run(process.execPath, [SYNC], SITE, false)
  const chk = spawnSync(process.execPath, [SYNC, '--check'], { cwd: SITE, encoding: 'utf8' })
  console.log((chk.stdout || '').trim())
  if (chk.status !== 0) die('快照一致性检查未通过，本体未提交')

  step('跑插件相关门禁')
  const tests = [
    'tests/core/repo-build-inputs.test.ts',
    'tests/core/market-version-drift.test.ts',
    'tests/core/plugincenter-migration-2026-10-19.test.ts',
    'tests/core/plugin-scope-hygiene.test.ts',
  ]
  run(NPX, ['vitest', 'run', ...tests, '--testTimeout=25000'], SITE, false)

  git(SITE, ['add', '--', PCD, 'tests/vendor/ext-plugins'], false)
  git(SITE, ['commit', '-m', `chore(plugins): EXT_TAG → ${nextTagValue}（同步测试快照）`], false)

  if (noDeploy) { ok('--no-deploy：扩展仓已发布，本体 tag/快照已提交，未构建部署'); return }

  // 4) 构建 + 部署
  step('构建 + 部署')
  const env = { ...process.env, TMP: 'E:/_wb_tmp', TEMP: 'E:/_wb_tmp', ESBUILD_BINARY_PATH: 'E:/_wb_tmp/esbuild.exe' }
  const b = spawnSync(NPM, ['run', 'build:fast'], { cwd: SITE, encoding: 'utf8', env, maxBuffer: 64 * 1024 * 1024 })
  if (b.status !== 0) die('构建失败，未部署：\n' + ((b.stderr || '') + (b.stdout || '')).slice(-1500))
  ok('构建完成')
  if (existsSync(DEPLOY_DIR)) rmSync(DEPLOY_DIR, { recursive: true, force: true })
  mkdirSync(DEPLOY_DIR, { recursive: true })
  cpSync(path.join(SITE, 'dist'), DEPLOY_DIR, { recursive: true })
  const dep = runDeploy()
  dep.includes('部署完成') ? ok('部署完成') : warn('部署脚本输出未包含「部署完成」，请检查上面的输出')

  step('完成')
  console.log(`  · 扩展仓 tag ${nextTagValue}；CDN ${HOST}${nextTagValue}/plugins/<id>.plugin.js`)
  console.log(`  · 本体已同步快照并提交；线上地址 https://ctrl66666.github.io/kaoyan2026/v2/`)
}

// ── deploy（单独命令）─────────────────────────────────────────
function cmdDeploy() {
  step('构建 + 部署（EXT_TAG=' + extTag() + '）')
  const env = { ...process.env, TMP: 'E:/_wb_tmp', TEMP: 'E:/_wb_tmp', ESBUILD_BINARY_PATH: 'E:/_wb_tmp/esbuild.exe' }
  const b = spawnSync(NPM, ['run', 'build:fast'], { cwd: SITE, encoding: 'utf8', env, maxBuffer: 64 * 1024 * 1024 })
  if (b.status !== 0) die('构建失败，未部署')
  if (existsSync(DEPLOY_DIR)) rmSync(DEPLOY_DIR, { recursive: true, force: true })
  mkdirSync(DEPLOY_DIR, { recursive: true })
  cpSync(path.join(SITE, 'dist'), DEPLOY_DIR, { recursive: true })
  runDeploy()
  ok('部署完成')
}

function help() {
  console.log(`插件仓库管理（pm.mjs）
  node tools/pm.mjs list                                    列出插件与版本对照
  node tools/pm.mjs check                                   只读体检
  node tools/pm.mjs new <id> [名称]                         生成插件骨架
  node tools/pm.mjs bump <id> [patch|minor|major|x.y.z]     升版本（不提交）
  node tools/pm.mjs release [--dry-run] [--no-deploy] [id…] 一键发版
  node tools/pm.mjs deploy                                  只构建部署站点
`)
}

try {
  if (cmd === 'list') cmdList()
  else if (cmd === 'check') cmdCheck()
  else if (cmd === 'new') cmdNew()
  else if (cmd === 'bump') cmdBump()
  else if (cmd === 'release') cmdRelease()
  else if (cmd === 'deploy') cmdDeploy()
  else help()
} catch (e) {
  die(String(e && e.stack ? e.stack : e))
}
