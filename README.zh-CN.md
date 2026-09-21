# Panorama · 内容与评论分析

把三个项目合并为一个 Chrome 扩展，在同一个侧边栏里分析视频字幕和评论。项目暂用 **Panorama**，仓库地址继续保留 `youtube-panorama`，后续可统一更名。

## 支持什么

| 平台 | 视频内容 | 评论内容 | 获取方式 |
| --- | --- | --- | --- |
| YouTube | 支持 | 支持 | 原生字幕 / 页面逐字稿；评论使用 YouTube Data API v3 |
| 哔哩哔哩 | 支持普通视频与当前分 P | 暂未接入 | 使用网站原生字幕 |
| 小红书 | 暂未接入 | 支持 | 复用原项目的页面滚动、展开回复、提取与去重流程 |
| 雪球 | 暂未接入 | 保留支持 | 使用当前登录会话读取评论接口 |

视频分析生成带时间戳的章节摘要、关键引用，点击时间可跳转播放位置。评论分析生成主题、情绪、代表评论、常见问题和创作者建议。可以查看、导出原始内容和 Markdown 分析报告。

**视频内容分析基于字幕，不识别画面，也不对无字幕视频做语音转写。** 评论最多采集 1,000 条，最多选择 400 条进行分析，优先保留高赞评论并兼顾采集顺序。结果会显示实际采集数与分析样本数，不能视作全部观众的意见。

## 安装步骤

1. [下载 v2.0.0 安装包](https://raw.githubusercontent.com/bacxia-web/youtube-panorama/main/releases/youtube-panorama-v2.0.0.zip)，解压到一个长期保留的文件夹。也可以[下载完整源码](https://github.com/bacxia-web/youtube-panorama/archive/refs/heads/main.zip)。
2. 在 Chrome 地址栏输入 `chrome://extensions`。
3. 打开右上角的「开发者模式」。
4. 点击「加载已解压的扩展程序」，选择**直接包含 `manifest.json` 的文件夹**。不能选择 ZIP 文件本身，也不要选多一层的父文件夹。
5. 点击浏览器工具栏的拼图图标，将 **Panorama · 内容与评论分析** 固定到工具栏。
6. 安装时打开的设置页会弹出首次配置对话框，只需填写 **DeepSeek API Key**。输入框旁有可直接点击的[申请 Key 链接](https://platform.deepseek.com/api_keys)。也可以先跳过，第一次分析时再填写。

这是独立的 Chrome 扩展，不需要安装 Tampermonkey，也不依赖 Claude 浏览器扩展。

请保留解压后的文件夹，Chrome 会从该文件夹加载插件。移动或删除文件夹后，需要从新位置重新加载。

## 使用流程

1. 打开要分析的页面：YouTube 视频、哔哩哔哩视频、小红书笔记详情或雪球帖子。
2. 点击工具栏的插件图标，打开侧边栏。面板会显示当前平台和内容标题。
3. 选择「视频内容」或「评论内容」。当前平台不支持的选项会禁用。
4. 点击「开始分析」。插件先采集内容，再调用 DeepSeek；如果只想查看原始内容，点击「仅采集」。
5. 查看章节、引用或评论主题。视频结果的时间按钮可以跳转到对应位置。
6. 点击「导出分析」保存 Markdown，或「导出原始内容」保存 JSON。

切换标签页、视频或 B 站分 P 后，面板会清除上一个页面的结果。已经发出的 API 请求可能仍会完成，但不会混入新页面。采集内容和分析结果只保留在当前面板内，关闭面板后请重新采集，重要结果请先导出。

### YouTube 评论：额外配置一次 Google Key

DeepSeek Key 负责分析，不能代替 Google 的评论接口凭据。首次配置仍只询问 DeepSeek Key；需要 YouTube 评论时，再进入「设置 → 按需配置」。

1. 在 Google Cloud 中创建或选择项目。
2. [启用 YouTube Data API v3](https://console.cloud.google.com/apis/library/youtube.googleapis.com)。
3. 在[凭据页面](https://console.cloud.google.com/apis/credentials)创建 API Key，API 限制选择 YouTube Data API v3。
4. 将 Key 填入插件设置中的「YouTube Data API Key」，保存。

插件会分页读取顶层评论，并补充接口未内嵌的回复。评论关闭、API 未启用、Key 限制不匹配或配额用完时，会显示错误提示。[官方接口说明](https://developers.google.com/youtube/v3/docs/commentThreads/list)

### 视频字幕

- **YouTube**：优先读取播放器字幕；也可读取页面上已打开的「显示转录稿」。原生字幕接口因平台限制无法读取时，可在设置里选填 [Supadata API Key](https://dash.supadata.ai/)，作为备用字幕来源。只请求 `mode=native`，不自动调用付费语音转写。
- **哔哩哔哩**：打开普通视频 `/video/BV…` 或 `/video/av…` 页面，按 URL 中的 `p` 参数读取当前分 P。有些字幕需要先登录 B 站。没有字幕、受限内容或接口暂时不可用时会提示，不生成虚构字幕。番剧、直播和互动视频分支尚未支持。
- 超长字幕超过本次分析限制会明确报错，不会悄悄只分析视频开头。

### 小红书评论

先登录小红书并打开笔记详情，让评论区可见，再点击采集或分析。插件会自动滚动评论区、展开部分回复、去重，并在完成后恢复滚动位置。最多执行 20 轮加载。

只分析页面成功加载的评论，不保证抓到全部评论。页面改版、登录限制、折叠回复或加载失败都可能影响数量。当前不统计小红书评论的楼层关系。

## 修改 API Key

点击侧边栏右上角「设置」，修改 DeepSeek Key 后点击「保存设置」。服务地址和模型已内置，无需填写。默认使用 `deepseek-flash`，参照 [DeepSeek 官方文档](https://api-docs.deepseek.com/zh-cn/)。YouTube 和 Supadata 凭据放在折叠的可选配置中。

Key 只存于本机的 `chrome.storage.local`，普通网页和内容脚本不能读取。Key 不会写入源码、导出文件或上传到 GitHub。分析请求会将选中的字幕或评论及标题发送至 DeepSeek；相关费用由你的服务账户承担。详情见 [隐私说明](PRIVACY.md)。

## 从旧版迁移

- 已加载 `youtube-panorama` 的用户：在原文件夹更新代码，然后在 `chrome://extensions` 点击「重新加载」。保持同一文件夹可以延续原扩展设置。刷新已经打开的视频页面。
- 原版 Panorama 的 DeepSeek、Google、Supadata 配置会继续复用。旧版自定义服务商的 AI Key 不会被发送给 DeepSeek。
- 原来的小红书插件和油猴脚本属于不同扩展，Chrome 不允许自动读取它们的 Key，需要在统一插件重新填写。完成迁移后可停用旧插件，避免重复界面。
- YouTube 原来的双语逐字稿、划词解释与笔记功能保留在「打开 YouTube 学习工具」入口中；该旧版工作流仍需要 Supadata Key。

合并来源：[Xiaohongshu-Comment-analysis](https://github.com/bacxia-web/Xiaohongshu-Comment-analysis)、[YouTube-Comment-analysis](https://github.com/bacxia-web/YouTube-Comment-analysis)、[youtube-panorama](https://github.com/bacxia-web/youtube-panorama)。后续统一在本仓库维护。

## 开发与打包

运行环境：Node.js 18+、Python 3、系统 `zip` 工具。运行插件本身不需要 Node.js。

```bash
npm test
npm run check
npm run package
```

发布包输出到 `dist/youtube-panorama-v2.0.0.zip`。解压后按上述开发者模式步骤安装。发布脚本只打包白名单中的运行文件和说明，不包含本机配置、测试数据或 API Key。

浏览器集成测试可使用已安装的 Playwright：

```bash
PLAYWRIGHT_MODULE=/path/to/playwright node scripts/smoke-extension.cjs
```

测试使用独立浏览器配置和模拟平台/API 响应，不访问个人浏览器资料、不使用真实 Key，也不能替代对平台实时接口及付费分析的验证。

## 项目来源与许可

本项目沿用 [YouTube Digest](https://github.com/zarazhangrui/youtube-digest) 的独立衍生版本，保留上游 MIT 许可和署名。合并后增加多平台采集、统一首次配置、统一分析与导出界面。详见 [LICENSE](LICENSE)。
