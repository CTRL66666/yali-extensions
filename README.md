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

> 版本建议：生产环境尽量用**固定 tag**（`@v1.2.0`）而不是 `@main`，
> 避免上游改动直接影响到线上用户。

## 插件清单

| id | 名称 | 版本 | 说明 |
|---|---|---|---|
| `deepseek-whale-muse` | DeepSeek 鲸鱼娘 · 原版 | 1.2.0 | 社区 Q 版女仆鲸鱼娘悬浮球皮肤：56–168px 尺寸调节、本地记忆、五态与六种互动、手排原画真帧过渡 |

## 素材许可

`assets/whale-muse-assets/` 内的图集遵循 **CC BY-NC-SA 4.0**（见同目录 `CC-BY-NC-SA-4.0.txt`），
原始出处与作者署名见 `UPSTREAM-NOTICE.txt`。**商用前必须先读这两份文件。**
