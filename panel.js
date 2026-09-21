const $ = id => document.getElementById(id);
const state = { context: null, mode: "video", data: null, analysis: null, busy: false, revision: 0, refresh: 0, windowId: null };
const sentiment = { positive: "偏正面", negative: "偏负面", neutral: "中性", mixed: "观点混合" };
const send = message => chrome.runtime.sendMessage(message);
const node = (tag, text, className) => {
  const element = document.createElement(tag); element.textContent = text || "";
  if (className) element.className = className;
  return element;
};
function status(text, kind = "") { $("status").textContent = text; $("status").dataset.state = kind; }
function updateControls() {
  const allowed = !!state.context?.[state.mode];
  $("analyze").disabled = $("collect").disabled = state.busy || !allowed;
  $("analyze").textContent = state.analysis ? "重新分析" : "开始分析";
  for (const button of document.querySelectorAll("[data-mode]")) {
    button.setAttribute("aria-pressed", String(button.dataset.mode === state.mode));
    button.disabled = state.busy || !!state.context && !state.context[button.dataset.mode];
  }
  $("hint").textContent = !state.context ? "打开 YouTube / 哔哩哔哩视频、小红书笔记或雪球帖子，再点击插件图标。"
    : state.mode === "video" ? "读取当前视频字幕，生成章节摘要和关键引用。"
    : state.context.platform === "youtube" ? "通过 YouTube 官方 API 采集评论，分析讨论主题与观众反馈。"
    : state.context.platform === "xiaohongshu" ? "自动滚动并展开当前笔记评论，分析讨论主题与用户反馈。"
    : "读取当前雪球帖子的评论，分析讨论主题与用户反馈。";
}
function resetResults() {
  state.data = state.analysis = null;
  $("results").replaceChildren(); $("rawContent").replaceChildren();
  for (const id of ["results", "raw", "exportData", "exportReport", "fixSettings"]) $(id).hidden = true;
  status("");
}
async function refreshContext() {
  const request = ++state.refresh;
  try {
    const [tab] = await chrome.tabs.query({ active: true, windowId: state.windowId });
    const parsed = PANORAMA_PLATFORMS.parse(tab?.url);
    if (request !== state.refresh) return;
    if (state.context?.key === parsed?.key && state.context?.tabId === tab?.id) return;
    state.revision++; state.busy = false; resetResults();
    state.context = parsed ? { ...parsed, tabId: tab.id, title: tab.title || parsed.label } : null;
    $("platform").textContent = parsed?.label || "当前页面";
    $("title").textContent = state.context?.title || "先打开要分析的内容";
    $("author").textContent = "";
    $("legacy").hidden = parsed?.platform !== "youtube";
    if (parsed && !parsed[state.mode]) state.mode = parsed.video ? "video" : "comments";
    updateControls();
    if (!parsed) return;
    const result = await send({ action: "mediaContext", tabId: tab.id, key: parsed.key });
    if (request !== state.refresh || !result?.success) return;
    state.context = result.context;
    $("title").textContent = result.context.title;
    $("author").textContent = result.context.channelName;
  } catch { if (request === state.refresh) { status("无法读取当前页面，请刷新页面后重试。", "error"); updateControls(); } }
}
function showError(result) {
  const messages = {
    NO_YOUTUBE_KEY: "获取 YouTube 评论需要单独的 Google API Key。请在设置中填写「YouTube Data API Key」（可选项，仅此功能需要）。",
    NO_AI_KEY: "请先在设置中填写 DeepSeek API Key。",
    INVALID_AI_KEY: "DeepSeek Key 无效，请在设置中检查。",
    RATE_LIMITED: "服务暂时限流，请稍后重试。",
    COMMENTS_DISABLED: "此视频已关闭评论。",
    YOUTUBE_QUOTA_EXCEEDED: "YouTube API 配额已用完，请稍后重试或检查 Google Cloud 配额。",
    YOUTUBE_API_FORBIDDEN: "YouTube API 拒绝了请求，请检查 Key、API 启用状态与配额。"
  };
  status(messages[result?.error] || result?.message || "操作失败，请稍后重试。", "error");
  $("fixSettings").hidden = !["NO_YOUTUBE_KEY", "NO_AI_KEY", "INVALID_AI_KEY", "YOUTUBE_API_FORBIDDEN"].includes(result?.error);
}
function renderData() {
  const data = state.data;
  $("raw").hidden = $("exportData").hidden = false;
  const rows = state.mode === "video" ? data.transcript : data.comments;
  $("rawCount").textContent = `（${rows.length} ${state.mode === "video" ? "段字幕" : "条评论"}）`;
  $("rawContent").replaceChildren();
  for (const row of rows) {
    const item = node("div", "", "raw-row");
    item.append(node("p", state.mode === "video" ? `[${PANORAMA_PLATFORMS.timestamp(row.start)}] ${row.text}` : row.text));
    if (state.mode === "comments") item.append(node("span", `${row.author || "匿名用户"} · ${row.likeCount} 赞`, "muted fine"));
    $("rawContent").append(item);
  }
}
function timeButton(seconds) {
  const button = node("button", PANORAMA_PLATFORMS.timestamp(seconds), "time");
  button.title = "跳转到视频此处";
  button.onclick = async () => {
    try {
      const result = await send({ action: "mediaSeek", tabId: state.context.tabId, key: state.context.key, seconds });
      if (!result?.success) showError(result);
    } catch { status("无法跳转，请确认仍在原视频页面。", "error"); }
  };
  return button;
}
function section(title) { const section = node("section", "", "result-section"); section.append(node("h2", title)); $("results").append(section); return section; }
function renderAnalysis() {
  $("results").replaceChildren(); $("results").hidden = $("exportReport").hidden = false;
  const analysis = state.analysis;
  if (state.mode === "video") {
    const chapters = section("视频章节");
    for (const chapter of analysis.chapters || []) {
      const item = node("article", "", "result-item");
      item.append(timeButton(chapter.timestampSeconds), node("h3", chapter.title), node("p", chapter.summary)); chapters.append(item);
    }
    if (!analysis.chapters?.length) chapters.append(node("p", "本次未生成可用章节，可重试分析。", "muted"));
    if (analysis.keyQuotes?.length) {
      const quotes = section("关键引用");
      for (const quote of analysis.keyQuotes) { const item = node("blockquote", ""); item.append(timeButton(quote.timestampSeconds), node("p", quote.quote)); quotes.append(item); }
    }
  } else {
    const overview = section("评论概览");
    overview.append(node("p", sentiment[analysis.overallSentiment] || "中性", "badge"), node("p", analysis.summary));
    for (const topic of analysis.topics || []) {
      const item = node("article", "", "result-item");
      item.append(node("h3", topic.title), node("p", sentiment[topic.sentiment] || "中性", "badge"), node("p", topic.summary));
      for (const evidence of topic.evidence || []) {
        const quote = node("blockquote", ""); quote.append(node("p", evidence.text), node("span", `${evidence.author || "匿名用户"} · ${evidence.likeCount} 赞`, "muted fine")); item.append(quote);
      }
      overview.append(item);
    }
    for (const [key, title] of [["viewerQuestions", "大家在问什么"], ["creatorFeedback", "给创作者的建议"]]) {
      if (!analysis[key]?.length) continue;
      const list = node("ul", ""); for (const text of analysis[key]) list.append(node("li", text)); section(title).append(list);
    }
  }
}
async function run(withAnalysis) {
  if (state.busy || !state.context?.[state.mode]) return;
  const revision = state.revision;
  if (withAnalysis && !await PANORAMA_SETUP.ensure()) return;
  if (revision !== state.revision || state.busy) return;
  const context = { ...state.context }, mode = state.mode;
  state.busy = true; resetResults(); updateControls();
  const valid = () => revision === state.revision;
  try {
    status(mode === "video" ? "正在读取字幕…" : "正在采集评论…", "loading");
    const data = await send({ action: "mediaCollect", tabId: context.tabId, key: context.key, mode });
    if (!valid()) return;
    if (!data?.success) { showError(data); return; }
    state.data = data; state.context = data.context;
    $("title").textContent = data.context.title; $("author").textContent = data.context.channelName || "";
    renderData();
    const count = mode === "video" ? data.transcript.length : data.comments.length;
    if (!count) { status("此页面没有可分析的内容。", "error"); return; }
    const note = [data.source, `${count} ${mode === "video" ? "段字幕" : "条评论"}`, data.truncated ? "已达到采集上限或仅获取部分内容" : "", data.notice].filter(Boolean).join(" · ");
    if (!withAnalysis) { status(`采集完成。${note}`, "success"); return; }
    status("内容已采集，DeepSeek 正在分析…", "loading");
    const result = await send({ action: "mediaAnalyze", tabId: context.tabId, key: context.key, mode,
      info: data.context, transcriptText: data.transcriptTextTimestamped, comments: data.comments });
    if (!valid()) return;
    if (!result?.success) { showError(result); return; }
    state.analysis = result.analysis; renderAnalysis();
    status(`分析完成。${note}${result.sampleSize ? ` · 实际分析 ${result.sampleSize} 条评论` : ""}`, "success");
  } catch { if (valid()) status("连接中断，请重新打开插件或稍后重试。", "error"); }
  finally { if (valid()) { state.busy = false; updateControls(); } }
}
function download(content, extension, type) {
  const blob = new Blob([content], { type }); const url = URL.createObjectURL(blob);
  const link = document.createElement("a"); link.href = url;
  link.download = `video-comment-analyzer-${state.context.platform}-${state.context.id}-${state.mode}.${extension}`;
  link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
$("exportData").onclick = () => {
  if (!state.data) return;
  download(JSON.stringify({ source: state.context.url, title: state.context.title, collectedAt: new Date().toISOString(),
    collectionSource: state.data.source, notice: state.data.notice, truncated: !!state.data.truncated,
    transcript: state.data.transcript, comments: state.data.comments }, null, 2), "json", "application/json");
};
$("exportReport").onclick = () => {
  if (!state.analysis) return;
  const lines = [`# ${state.context.title}`, "", state.context.url, "", $("status").textContent, ""];
  if (state.mode === "video") {
    for (const chapter of state.analysis.chapters || []) lines.push(`## ${chapter.timestamp} ${chapter.title}`, "", chapter.summary, "");
    lines.push("## 关键引用", ""); for (const quote of state.analysis.keyQuotes || []) lines.push(`> [${quote.timestamp}] ${quote.quote}`, "");
  } else {
    lines.push(state.analysis.summary, "");
    for (const topic of state.analysis.topics || []) {
      lines.push(`## ${topic.title}`, "", topic.summary, "");
      for (const item of topic.evidence || []) lines.push(`> ${item.text}`, `> ${item.author} · ${item.likeCount} 赞`, "");
    }
    for (const [key, title] of [["viewerQuestions", "大家在问什么"], ["creatorFeedback", "给创作者的建议"]]) {
      lines.push(`## ${title}`, "", ...(state.analysis[key] || []).map(item => `- ${item}`), "");
    }
  }
  download(lines.join("\n"), "md", "text/markdown;charset=utf-8");
};
$("settings").onclick = $("fixSettings").onclick = () => chrome.runtime.openOptionsPage();
$("analyze").onclick = () => run(true); $("collect").onclick = () => run(false);
for (const button of document.querySelectorAll("[data-mode]")) button.onclick = () => {
  if (state.busy || button.dataset.mode === state.mode) return;
  state.revision++; state.mode = button.dataset.mode; resetResults(); updateControls();
};
chrome.tabs.onActivated.addListener(info => { if (info.windowId === state.windowId) refreshContext(); });
chrome.tabs.onUpdated.addListener((tabId, change) => { if (change.url || change.status === "complete") refreshContext(); });
chrome.runtime.onMessage.addListener(message => {
  if (!state.busy || !state.context) return;
  if (message.action === "mediaProgress" && message.key === state.context.key ||
    message.action === "commentsProgress" && state.context.platform === "youtube" && message.videoId === state.context.id) {
    status(`正在采集评论… 已读取 ${message.count} 条`, "loading");
  }
});
(async () => {
  try { state.windowId = (await chrome.windows.getCurrent()).id; await refreshContext(); }
  catch { status("插件初始化失败，请重新打开。", "error"); }
})();
