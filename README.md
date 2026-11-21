# 鸦荔扩展资源仓

鸦荔考研的**扩展资源独立仓库**：插件源码、素材、技能包。
站点本体只保留「拉取 + 运行」的能力，**不放具体插件代码**。

## 为什么独立成仓

插件会越来越多、越来越大（图集动辄几 MB），放在本体仓里：

- 源码仓体积会被素材撑起来，clone 变慢；
- 每次改一个插件都要重新构建、重新部署整个站点；
- 插件出问题会污染本体的提交历史。

独立之后：插件改完推这里，站点**不用重新部署**就能拉到新版。

## 目录约定

```
plugins/            插件源码（.plugin.js）
assets/             插件配套素材（图集 / 音频 / 字体）
  <plugin-id>/      按插件 id 分目录，内含素材与许可证文本
    source/         原始高分辨率素材（**不进服务链路**，只作留档与再压缩）
skills/             技能包（zip + SKILL.md，后续启用）
```

## 拉取方式

站点通过 **jsDelivr CDN** 拉取（国内可访问、有缓存）：

```
https://cdn.jsdelivr.net/gh/CTRL66666/yali-extensions@main/plugins/<file>.plugin.js
```

也可以用 GitHub raw（国内不稳定，仅作兜底）：

```
https://raw.githubusercontent.com/CTRL66666/yali-extensions/main/plugins/<file>.plugin.js
```

> 版本建议：生产环境尽量用**固定 tag**（`@v1.4.1`）而不是 `@main`，
> 避免上游改动直接影响到线上用户。

## ⚠ 大文件必须多源兜底（踩过的坑）

**`cdn.jsdelivr.net` 对大文件会 301 到 `raw.githubusercontent.com`**，
而国内网络访问 raw **会超时**（实测 30s 只下到 622KB 就断），
浏览器端表现是「图片永远不出现」，**不报错、控制台干净**。

实测结论（2026-11-21，1.7MB webp）：

| host | 行为 |
|---|---|
| `testingcf.jsdelivr.net` | 200 直出，0 跳转 |
| `gcore.jsdelivr.net` | 200 直出，0 跳转 |
| `cdn.jsdelivr.net` | 301 → raw，国内超时 |
| `cdn.statically.io` | 连接失败 |

**约定**：插件加载素材时按 `testingcf → gcore → cdn` 顺序逐个探测，
谁先出图用谁，结果写进 `localStorage`；不要写死单一域名。

## 插件清单（市场的全部插件都在这里）

**2026-11-21 起，插件市场里的每一支插件都从本仓拉取** —— 站点本体不再内联任何插件源码，
也不再在 `public/plugins/` 存放副本。市场登记只剩元数据（id / 名称 / 版本 / 拉取地址）。

共 28 支（含 4 支历史下架件，仍保留源码以便追溯与重装）：

| id | 名称 | 版本 | 状态 |
|---|---|---|---|
| `anki-exporter` | Anki 导出器 | 1.0 | 在架 |
| `async-form-action` | 异步表单动作 | 1.0 | 在架 |
| `daily-boost` | 今日动力面板 | 1.0 | 在架 |
| `daily-mistake-drill` | 每日错题唤醒 | 1.0 | 在架 |
| `deepseek-whale-muse` | DeepSeek 鲸鱼娘 · 原版 | 1.4.1 | 在架 |
| `duel-arena` | 博弈刷题场 | 1.4.7 | 在架 |
| `ear-radio` | 磨耳朵电台 | 1.1.4 | 在架 |
| `feynman-crystal` | 费曼晶体 | 1.4.7 | 在架 |
| `formula-vault` | 公式军火库 | 1.3.10 | 在架 |
| `insight-plugin` | 学习洞察 | 1.0 | 在架 |
| `interview-sim` | 复试模拟舱 | 1.7.4 | 在架 |
| `memo-deck` | 记忆宫殿 · 闪卡 | 1.6.7 | 在架 |
| `orb-skin-lab` | 悬浮球换装实验室 | 2.0 | 在架 |
| `pacing-dojo` | 时钟道场 | 1.3.0 | 在架 |
| `paper-extract` | 试卷提取 | 1.7.9 | 在架 |
| `pdf-digest` | PDF 精读提炼 | 1.1 | 在架 |
| `prof-workshop` | 出题家 | 1.2.0 | 在架 |
| `proof-pathfinder` | 证明寻路者 | 3.0.0 | 在架 |
| `scoring-forge` | 采分点熔炉 | 1.5.5 | 在架 |
| `socratic-mode` | 苏格拉底追问模式 | 1.0 | 在架 |
| `storage-doctor` | 存储体检 | 2.0 | 在架 |
| `variant-forge` | 变式题工厂 | 1.4.2 | 在架 |
| `wuzhongxiang-strict` | 武忠祥·严谨避坑人格 | 1.2 | 在架 |
| `zhangyu-3x` | 张宇·三向解题人格 | 2.3 | 在架 |
| `countdown-desk` | 倒计时桌面 | 1.2 | 已下架 |
| `english-sentence` | 高分句型管家 | 1.0 | 已下架 |
| `pomodoro-pro` | 番茄钟计时器 Pro | 1.1 | 已下架 |
| `sprint-kicker` | 组卷冲刺鼓手 | 1.0 | 已下架 |

> 内联时代留下的 `src/core/pluginSrc/*.js`（`?raw` 引入）与 `public/plugins/*.plugin.js`
> 已一并迁入本仓，本体侧删除。

### deepseek-whale-muse 素材交付策略

原始图集 2304×3584（6×7 帧，384×512/格）在站点上最大只显示 168px 高（DPR3 需 ~378×504），
**原图属于严重过采样**。服务链路用三档交付：

| 文件 | 尺寸 | 体积 | 用途 |
|---|---|---|---|
| `pet-dafeiyu-tiny.webp` | 324×504（54×72/格） | 72 KB | 探针 + 首屏占位，先出角色 |
| `pet-dafeiyu-inbetweens-tiny.webp` | 216×72（54×72/格） | 8 KB | 过渡帧占位（同几何，桥接动画不缺图） |
| `pet-dafeiyu.webp` | 1728×2688（288×384/格） | 934 KB | 高清图集，加载完替换占位 |
| `pet-dafeiyu-inbetweens.webp` | 1152×384（288×384/格） | 91 KB | 过渡帧（原 PNG 709KB，换 WebP 后 -87%） |

原始素材留档在 `assets/whale-muse-assets/source/`，不参与拉取。

> 压缩必须**预乘 alpha**（半透明像素占多数，直接缩放会在边缘渗出黑边）。
> 思路：RGB×A 后 LANCZOS 缩放，再除回 A；WebP q=84 / method=6。

## 素材许可

`assets/whale-muse-assets/` 内的图集遵循 **CC BY-NC-SA 4.0**（见同目录 `CC-BY-NC-SA-4.0.txt`），
原始出处与作者署名见 `UPSTREAM-NOTICE.txt`。**商用前必须先读这两份文件。**

## 发版与 tag 约定

- 站点通过**固定 tag** 拉取（不用 `@main`），所以改任何一支插件都要打新 tag：
  `git tag v1.5.1 && git push origin main --tags`，再改本体 `pluginCenterData.ts` 里的 `EXT_CDN` tag 一处。
- **tag 不可原地改**：jsDelivr 对 tag 是不可变缓存，改了就升版本号。
- 插件自己的 `version`（源码里 `let VERSION` 或 `register({ version })`）必须与市场登记一致，
  本体的 `market-version-drift` 门禁会拿 `tests/vendor/ext-plugins/` 快照比对。
- 素材（图集等）可以钉在"它最后一次变更的 tag"上，不必跟着每次代码 tag 变 ——
  鲸鱼娘就是 `assets` 钉在 `@v1.4.1`，代码走 `@v1.5.0`。
