# Panorama · 内容与评论分析

## 项目介绍

一个 Chrome 扩展，在侧边栏中用 AI 分析视频和评论：

- **视频分析**：支持 YouTube、哔哩哔哩，生成章节摘要和带时间戳的关键引用。
- **评论分析**：支持 YouTube、小红书、雪球，整理讨论主题、情绪和用户反馈。
- **结果导出**：支持导出分析报告和原始内容。

视频分析基于字幕，暂不支持无字幕视频。

## 安装

1. [下载安装包](https://raw.githubusercontent.com/bacxia-web/youtube-panorama/main/releases/youtube-panorama-v2.0.0.zip)，解压到一个长期保留的文件夹。
2. 在 Chrome 地址栏打开 `chrome://extensions`。
3. 开启右上角的「开发者模式」。
4. 点击「加载已解压的扩展程序」，选择直接包含 `manifest.json` 的文件夹。
5. 将插件固定到工具栏。打开视频或笔记页面，点击插件图标即可开始使用。

请保留解压后的文件夹，插件需要从中加载。

## 配置

首次使用会弹窗要求填写 **DeepSeek API Key**，输入框旁附有申请链接。以后可在侧边栏右上角「设置」中修改，服务地址和模型无需填写。

| 配置项 | 什么时候需要 | 获取方式 |
| --- | --- | --- |
| DeepSeek API Key | 必填，用于 AI 分析 | [申请 Key](https://platform.deepseek.com/api_keys) |
| YouTube Data API Key | 分析 YouTube 评论时填写 | 在 Google Cloud [启用 YouTube Data API v3](https://console.cloud.google.com/apis/library/youtube.googleapis.com)，再[创建 Key](https://console.cloud.google.com/apis/credentials) |
| Supadata API Key | 可选，YouTube 原生字幕无法读取时作为备用 | [获取 Key](https://dash.supadata.ai/) |

YouTube 和 Supadata Key 在「设置 → 按需配置」中填写。小红书、雪球及部分哔哩哔哩字幕需要先登录对应网站。

Key 保存在本机浏览器中；调用 AI 或其他 API 的费用、额度由对应服务账户承担。
