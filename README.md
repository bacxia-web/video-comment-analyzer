# Video & Comment Analyzer

## 项目介绍

一个 Chrome 扩展，在侧边栏中用 AI 分析视频和评论：

- **视频摘要**：支持 YouTube、哔哩哔哩，生成章节摘要和带时间戳的关键引用。
- **评论分析**：支持 YouTube、小红书、雪球，整理讨论主题、评论态度和用户反馈。
- **结果导出**：支持导出分析报告和已获取的内容。

视频摘要基于字幕，不识别画面，暂不支持无字幕视频。

## 安装

1. [下载安装包](https://raw.githubusercontent.com/bacxia-web/video-comment-analyzer/main/releases/video-comment-analyzer-v0.2.4.zip)，解压到一个长期保留的文件夹。
2. 在 Chrome 地址栏打开 `chrome://extensions`。
3. 开启右上角的「开发者模式」。
4. 点击「加载已解压的扩展程序」，选择直接包含 `manifest.json` 的文件夹。
5. 打开支持的视频或笔记详情页，点击右下角「分析」悬浮球打开面板。选择「视频摘要」或「评论分析」，再点击「开始分析」。也可从浏览器工具栏打开插件。

请保留解压后的文件夹，插件需要从中加载。更新时覆盖原文件夹，在扩展管理页点击「重新加载」，再刷新已打开的网页。

## 配置

首次安装后会直接打开设置页面，请填写 **DeepSeek API Key（必填）**，输入框旁附有申请链接。以后可在侧边栏右上角「设置」中修改，服务地址和模型无需填写。

| 配置项 | 什么时候需要 | 获取方式 |
| --- | --- | --- |
| DeepSeek API Key | 必填，用于 AI 分析 | [申请 Key](https://platform.deepseek.com/api_keys) |
| YouTube Data API Key | 可选，仅获取 YouTube 评论时需要 | 在 Google Cloud [启用 YouTube Data API v3](https://console.cloud.google.com/apis/library/youtube.googleapis.com)，再[创建 Key](https://console.cloud.google.com/apis/credentials) |
| Supadata API Key | 可选，用于备用 YouTube 字幕和「字幕学习」功能 | [获取 Key](https://dash.supadata.ai/) |

YouTube Data API Key 可在设置页面按需填写，Supadata Key 位于「Supadata 字幕服务（可选）」中。小红书、雪球及部分哔哩哔哩字幕需要先登录对应网站。

密钥保存在本机 Chrome 中。设置页提供申请链接和免费额度说明；AI 分析、字幕学习等用量由对应服务账户承担。
