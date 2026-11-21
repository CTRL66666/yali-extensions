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

> 版本建议：生产环境尽量用**固定 tag**（`@v1.4.0`）而不是 `@main`，
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

## 插件清单

| id | 名称 | 版本 | 说明 |
|---|---|---|---|
| `deepseek-whale-muse` | DeepSeek 鲸鱼娘 · 原版 | 1.4.0 | 社区 Q 版女仆鲸鱼娘悬浮球皮肤：56–168px 尺寸调节、本地记忆、五态与六种互动、手排原画真帧过渡 |

### deepseek-whale-muse 素材交付策略

原始图集 2304×3584（6×7 帧，384×512/格）在站点上最大只显示 168px 高（DPR3 需 ~378×504），
**原图属于严重过采样**。服务链路用三档交付：

| 文件 | 尺寸 | 体积 | 用途 |
|---|---|---|---|
| `pet-dafeiyu-tiny.webp` | 324×504（54×72/格） | 72 KB | 探针 + 首屏占位，先出角色 |
| `pet-dafeiyu.webp` | 1728×2688（288×384/格） | 934 KB | 高清图集，加载完替换占位 |
| `pet-dafeiyu-inbetweens.webp` | 1152×384（288×384/格） | 91 KB | 过渡帧（原 PNG 709KB，换 WebP 后 -87%） |

原始素材留档在 `assets/whale-muse-assets/source/`，不参与拉取。

> 压缩必须**预乘 alpha**（半透明像素占多数，直接缩放会在边缘渗出黑边）。
> 思路：RGB×A 后 LANCZOS 缩放，再除回 A；WebP q=84 / method=6。

## 素材许可

`assets/whale-muse-assets/` 内的图集遵循 **CC BY-NC-SA 4.0**（见同目录 `CC-BY-NC-SA-4.0.txt`），
原始出处与作者署名见 `UPSTREAM-NOTICE.txt`。**商用前必须先读这两份文件。**
