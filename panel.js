const $ = id => document.getElementById(id);
const state = { context: null, mode: "video", data: null, analysis: null, busy: false, revision: 0, refresh: 0, windowId: null,
  requestId: null, phase: "", analysisFailed: false, xhsWithAnalysis: false, redirecting: false };
const sentiment = PANORAMA_COPY.sentiments;
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
  const xhs = state.context?.platform === "xiaohongshu";
  document.body.dataset.platform = state.context?.platform || "";
  $("usageNotice").textContent = xhs ? "AI 分析使用你的 DeepSeek 额度；只获取评论不调用 AI。"
    : "「开始分析」会获取内容并发送给 DeepSeek，按你的账户计费。「只获取内容」不调用 AI，但可能消耗 YouTube 或 Supadata 的额度。";
  $("resultScope").textContent = xhs ? "评论结论仅代表本次获取的内容。" : "视频摘要只分析字幕，不识别画面。评论结论仅代表本次获取的内容。";
  $("xhsSettingsLink").hidden = !xhs;
  $("continueCollect").hidden = !xhs || !state.data || state.busy;
  $("collect").textContent = xhs && state.data ? "重新获取" : "只获取内容";
  if (xhs && state.data?.comments.length) $("analyze").textContent = state.analysisFailed ? "重试分析" : state.analysis ? "重新分析已有评论" : `分析已获取的 ${state.data.comments.length} 条`;
  for (const button of document.querySelectorAll("[data-mode]")) {
    button.setAttribute("aria-pressed", String(button.dataset.mode === state.mode));
    button.disabled = state.busy || !!state.context && !state.context[button.dataset.mode];
    button.title = state.context && !state.context[button.dataset.mode]
      ? `${state.context.label}暂不支持${button.dataset.mode === "video" ? "视频摘要" : "评论分析"}。` : "";
  }
  $("hint").textContent = !state.context ? "支持 YouTube、哔哩哔哩视频，小红书笔记和雪球帖子。请打开内容详情页，再点击右下角「分析」。"
    : state.mode === "video" ? "根据当前视频的字幕生成摘要。结果中的时间可以点击，直接跳到对应片段。"
    : state.context.platform === "youtube" ? "获取当前视频的评论和回复，整理讨论主题与观众意见。需要填写 YouTube Data API Key。"
    : state.context.platform === "xiaohongshu" ? "获取过程中会自动滚动、展开回复，请保持当前笔记打开。"
    : "获取当前帖子的评论，整理讨论主题与用户意见。请先登录雪球。";
}
function resetResults() {
  state.data = state.analysis = null;
  state.analysisFailed = false; state.requestId = null; state.phase = "";
  PANORAMA_XHS_UI.reset(); $("stopCollect").hidden = true;
  $("results").replaceChildren(); $("rawContent").replaceChildren();
  for (const id of ["results", "raw", "exportData", "exportReport", "fixSettings"]) $(id).hidden = true;
  status("");
}
async function refreshContext() {
  if (state.redirecting) return;
  const request = ++state.refresh;
  try {
    const [tab] = await chrome.tabs.query({ active: true, windowId: state.windowId });
    if (state.context?.platform === "xiaohongshu" && ["preferences.html", "options.html"].some(path => {
      const url = chrome.runtime.getURL(path); return tab?.url === url || tab?.url?.startsWith(`${url}#`);
    })) return;
    const parsed = PANORAMA_PLATFORMS.parse(tab?.url);
    if (request !== state.refresh) return;
    if (state.context?.key === parsed?.key && state.context?.tabId === tab?.id) return;
    if (state.busy && state.context?.platform === "xiaohongshu" && state.phase === "collect") {
      send({ action: "mediaStopCollect", tabId: state.context.tabId, key: state.context.key, requestId: state.requestId }).catch(() => {});
    } else if (state.busy && state.context?.platform === "xiaohongshu") {
      send({ action: "mediaCancelAnalysis", tabId: state.context.tabId, key: state.context.key, requestId: state.requestId }).catch(() => {});
    }
    if (parsed?.platform === "youtube") {
      state.redirecting = true;
      location.replace(chrome.runtime.getURL("sidepanel.html"));
      return;
    }
    state.revision++; state.busy = false; resetResults();
    state.context = parsed ? { ...parsed, tabId: tab.id, title: tab.title || parsed.label } : null;
    $("platform").textContent = parsed?.label || "当前页面";
    $("title").textContent = state.context?.title || "先打开要分析的内容";
    $("author").textContent = "";
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
  status(PANORAMA_COPY.error(result), "error");
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
  if (analysis.schema === "xhs-v1") { PANORAMA_XHS_UI.render($("results"), state.data, analysis); return; }
  if (state.mode === "video") {
    const chapters = section("视频章节");
    for (const chapter of analysis.chapters || []) {
      const item = node("article", "", "result-item");
      item.append(timeButton(chapter.timestampSeconds), node("h3", chapter.title), node("p", chapter.summary)); chapters.append(item);
    }
    if (!analysis.chapters?.length) chapters.append(node("p", "本次没有生成摘要，可以点击「重新分析」重试。", "muted"));
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
  if (state.context.platform === "xiaohongshu" && state.mode === "comments") return runXhs(withAnalysis);
  const revision = state.revision;
  if (withAnalysis && !await PANORAMA_SETUP.ensure()) return;
  if (revision !== state.revision || state.busy) return;
  const context = { ...state.context }, mode = state.mode;
  state.busy = true; resetResults(); updateControls();
  const valid = () => revision === state.revision;
  try {
    status(mode === "video" ? "正在获取字幕…" : "正在获取评论，请保持当前页面打开…", "loading");
    const data = await send({ action: "mediaCollect", tabId: context.tabId, key: context.key, mode });
    if (!valid()) return;
    if (!data?.success) { showError(data); return; }
    state.data = data; state.context = data.context;
    $("title").textContent = data.context.title; $("author").textContent = data.context.channelName || "";
    renderData();
    const count = mode === "video" ? data.transcript.length : data.comments.length;
    if (!count) { status(mode === "video" ? "没有获取到字幕，请确认视频有字幕后重试。" : "没有获取到评论，请确认评论区有内容并已加载。", "error"); return; }
    const note = [data.source, `${count} ${mode === "video" ? "段字幕" : "条评论"}`, data.truncated ? "仅获取了部分内容" : "", data.notice].filter(Boolean).join(" · ");
    if (!withAnalysis) { status(`内容已获取，尚未进行 AI 分析。${note}`, "success"); return; }
    status("内容已获取，DeepSeek 正在分析…", "loading");
    const result = await send({ action: "mediaAnalyze", tabId: context.tabId, key: context.key, mode,
      info: data.context, transcriptText: data.transcriptTextTimestamped, comments: data.comments });
    if (!valid()) return;
    if (!result?.success) { showError(result); return; }
    state.analysis = result.analysis; renderAnalysis();
    status(`分析完成。${note}${result.sampleSize ? ` · 实际分析 ${result.sampleSize} 条评论` : ""}`, "success");
  } catch { if (valid()) status("连接中断，请重新打开插件或稍后重试。", "error"); }
  finally { if (valid()) { state.busy = false; updateControls(); } }
}
async function runXhs(withAnalysis, resume = false) {
  if (state.busy || state.context?.platform !== "xiaohongshu") return;
  const revision = state.revision;
  if (withAnalysis && !await PANORAMA_SETUP.ensure()) return;
  if (revision !== state.revision || state.busy) return;
  if (resume) {
    try {
      const stored = await chrome.storage.local.get(YTD_SETTINGS.XHS_STORAGE_KEY);
      const limits = YTD_SETTINGS.normalizeXhs(stored[YTD_SETTINGS.XHS_STORAGE_KEY]);
      if (state.data.comments.length >= limits.maxComments) {
        status(`已达到 ${limits.maxComments} 条上限。请先点击「调整小红书获取范围」调高上限，再继续获取。`); return;
      }
    } catch { status("未能读取获取设置，请重新打开插件后重试。", "error"); return; }
    if (revision !== state.revision || state.busy) return;
  }
  const needsCollection = resume || !withAnalysis || !state.data?.comments.length;
  if (needsCollection && !resume) resetResults();
  const context = { ...state.context }, requestId = crypto.randomUUID();
  const valid = () => revision === state.revision && state.requestId === requestId;
  state.requestId = requestId; state.busy = true; state.xhsWithAnalysis = withAnalysis;
  state.analysisFailed = false; updateControls(); $("fixSettings").hidden = true;
  try {
    if (needsCollection) {
      state.phase = "collect"; status("");
      PANORAMA_XHS_UI.progress("collect", { count: resume ? state.data.comments.length : 0, analyzed: 0, total: 0,
        round: 0, maxRounds: null, batchCount: 0, completedBatches: 0 });
      $("stopCollect").hidden = false; $("stopCollect").disabled = false;
      $("stopCollect").textContent = withAnalysis ? "停止获取，分析已有评论" : "停止获取";
      const data = await send({ action: "mediaCollect", tabId: context.tabId, key: context.key, mode: "comments", requestId, resume });
      if (!valid()) return;
      $("stopCollect").hidden = true;
      if (!data?.success) { showError(data); PANORAMA_XHS_UI.progress("collected", { stopMessage: PANORAMA_COPY.error(data) }); return; }
      state.data = data; state.analysis = null; state.context = data.context;
      $("results").hidden = $("exportReport").hidden = true; $("results").replaceChildren();
      $("title").textContent = data.context.title; $("author").textContent = data.context.channelName || "";
      renderData(); state.phase = "collected";
      PANORAMA_XHS_UI.progress("collected", { count: data.comments.length, stopMessage: data.stopMessage });
      status(`${data.stopMessage} ${data.notice}`);
      if (!data.comments.length) return;
      // A limit or site interruption needs an explicit choice, not an implicit
      // assumption that all comments have been collected.
      if (!withAnalysis || !["idle", "user"].includes(data.stopReason)) return;
    }
    state.phase = "analyze"; state.analysis = null;
    $("results").hidden = $("exportReport").hidden = true; $("results").replaceChildren();
    const count = state.data.comments.length;
    PANORAMA_XHS_UI.progress("analyze", { count, total: count, analyzed: 0, completedBatches: 0, batchCount: 0 });
    status(`正在分析已获取的 ${count} 条评论，无需重新获取。`, "loading");
    const result = await send({ action: "mediaAnalyze", tabId: context.tabId, key: context.key, mode: "comments",
      requestId, info: state.data.context, comments: state.data.comments });
    if (!valid()) return;
    if (!result?.success) {
      state.analysisFailed = true; showError(result); PANORAMA_XHS_UI.progress("error"); return;
    }
    state.analysis = result.analysis; state.phase = "complete"; renderAnalysis();
    PANORAMA_XHS_UI.progress("complete", { analyzed: result.analysis.totalAnalyzed, total: count });
    status(`分析完成，已分析 ${count} 条评论。${state.data.stopMessage} ${state.data.notice}`, "success");
  } catch {
    if (valid()) {
      state.analysisFailed = state.phase === "analyze" || state.phase === "merge";
      status("连接中断。已获取的评论仍在，可重试分析或继续获取。", "error");
      PANORAMA_XHS_UI.progress(state.analysisFailed ? "error" : "collected", { stopMessage: "获取连接中断，请重新获取或分析已有评论。" });
    }
  } finally { if (valid()) { state.busy = false; $("stopCollect").hidden = true; updateControls(); } }
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
  } else if (state.analysis.schema === "xhs-v1") {
    lines.push(...PANORAMA_XHS_UI.report(state.data, state.analysis));
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
$("continueCollect").onclick = () => runXhs(state.xhsWithAnalysis, true);
$("stopCollect").onclick = async () => {
  if (!state.busy || state.phase !== "collect") return;
  const requestId = state.requestId;
  $("stopCollect").disabled = true; $("stopCollect").textContent = "正在停止获取…";
  try {
    const result = await send({ action: "mediaStopCollect", tabId: state.context.tabId, key: state.context.key, requestId });
    if (state.requestId === requestId && !result?.success) throw new Error("stop failed");
  } catch {
    if (state.requestId === requestId && state.phase === "collect") {
      $("stopCollect").disabled = false; $("stopCollect").textContent = "停止未完成，点击重试";
    }
  }
};
for (const button of document.querySelectorAll("[data-mode]")) button.onclick = () => {
  if (state.busy || button.dataset.mode === state.mode) return;
  state.revision++; state.mode = button.dataset.mode; resetResults(); updateControls();
};
chrome.tabs.onActivated.addListener(info => { if (info.windowId === state.windowId) refreshContext(); });
chrome.tabs.onUpdated.addListener((tabId, change) => { if (change.url || change.status === "complete") refreshContext(); });
chrome.runtime.onMessage.addListener((message, sender) => {
  if (!state.busy || !state.context) return;
  if (state.context.platform === "xiaohongshu") {
    if (sender.id !== chrome.runtime.id || message.action !== "mediaProgress" || message.key !== state.context.key || message.requestId !== state.requestId) return;
    if (message.phase === "collect" && state.phase !== "collect") return;
    state.phase = message.phase; PANORAMA_XHS_UI.progress(message.phase, message); return;
  }
  if (message.action === "mediaProgress" && message.key === state.context.key ||
    message.action === "commentsProgress" && state.context.platform === "youtube" && message.videoId === state.context.id) {
    status(`正在获取评论… 已获取 ${message.count} 条，请保持当前页面打开。`, "loading");
  }
});
window.addEventListener("pagehide", () => {
  if (!state.busy || state.context?.platform !== "xiaohongshu") return;
  send({ action: state.phase === "collect" ? "mediaStopCollect" : "mediaCancelAnalysis",
    tabId: state.context.tabId, key: state.context.key, requestId: state.requestId }).catch(() => {});
});
(async () => {
  try { state.windowId = (await chrome.windows.getCurrent()).id; await refreshContext(); }
  catch { status("插件初始化失败，请重新打开。", "error"); }
})();
