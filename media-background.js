/* Unified adapters reuse the existing tested AI and YouTube Data API clients. */
async function panoramaContext(tabId, expectedKey) {
  if (!Number.isInteger(tabId)) throw new Error("请先打开视频、笔记或帖子详情页。");
  const tab = await chrome.tabs.get(tabId);
  const context = PANORAMA_PLATFORMS.parse(tab.url);
  if (!context) throw new Error("请打开 YouTube / 哔哩哔哩视频、小红书笔记或雪球帖子。");
  if (expectedKey && context.key !== expectedKey) throw new Error("页面已切换，请重新开始。");
  return { ...context, tabId, title: tab.title || context.label, channelName: "", description: "", duration: 0 };
}
async function panoramaInject(context, func, args = [], world = "ISOLATED") {
  const [result] = await chrome.scripting.executeScript({ target: { tabId: context.tabId }, world, func, args });
  await panoramaContext(context.tabId, context.key);
  if (!result?.result) throw new Error("没有读取到页面内容，请刷新页面后重试。");
  return result.result;
}
async function panoramaHandle(message) {
  const context = await panoramaContext(message.tabId, message.key);
  if (message.action === "mediaContext") {
    // Metadata lookup must not block the panel on a remote API request.
    const info = await panoramaInject(context, panoramaPageInfo);
    return { success: true, context: { ...context, ...info } };
  }
  if (message.action === "mediaSeek") return panoramaInject(context, panoramaSeek, [Number(message.seconds)]);
  if (message.action === "mediaCollect") {
    let result;
    if (message.mode === "video" && context.video) {
      const native = await panoramaInject(context, panoramaReadVideo, [context, true], "MAIN");
      if (native.success) result = { ...PANORAMA_PLATFORMS.transcriptResult(native.rows, native.source), info: native.info };
      else if (context.platform === "youtube" && native.error !== "PAGE_CHANGED" && (await getSettings()).supadataApiKey) {
        const fallback = await handleFetchTranscript(context.id);
        result = fallback.success ? { ...PANORAMA_PLATFORMS.transcriptResult(fallback.transcript, "Supadata 已有字幕"), info: native.info } : fallback;
      } else result = native;
    } else if (message.mode === "comments" && context.comments) {
      result = context.platform === "youtube"
        ? { ...await handleFetchComments(context.id), source: "YouTube Data API v3" }
        : await panoramaInject(context, panoramaCollectComments, [context]);
      if (result.success) result.stats = YTD_COMMENTS.calculateStats(result.comments);
    } else throw new Error("当前页面不支持这种分析方式，请选择页面上可用的选项。");
    await panoramaContext(context.tabId, context.key);
    const info = result.success ? result.info || await panoramaInject(context, panoramaPageInfo) : {};
    return { ...result, context: { ...context, ...info } };
  }
  if (message.action === "mediaAnalyze") {
    const meta = message.info || context;
    const result = message.mode === "video" && context.video
      ? await handleAnalyzeTranscript(String(message.transcriptText || "").slice(0, 180000), meta.title, meta.channelName, meta.description, meta.duration)
      : message.mode === "comments" && context.comments
        ? await handleAnalyzeComments(message.comments, meta.title, meta.channelName)
        : { success: false, message: "当前页面不支持这种分析方式，请选择页面上可用的选项。" };
    await panoramaContext(context.tabId, context.key);
    return result;
  }
  throw new Error("未能识别这次操作，请重新打开插件后再试。");
}
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!["mediaContext", "mediaCollect", "mediaAnalyze", "mediaSeek"].includes(message?.action)) return;
  // Only extension UI may initiate collection or paid analysis.
  if (sender.id !== chrome.runtime.id || !sender.url?.startsWith(chrome.runtime.getURL(""))) {
    sendResponse({ success: false, error: "UNAUTHORIZED", message: "请从插件面板发起操作。" });
    return false;
  }
  // Chrome service workers can be suspended during an injected long-running fetch.
  const keepAlive = setInterval(() => chrome.runtime.getPlatformInfo().catch(() => {}), 20000);
  panoramaHandle(message).then(sendResponse).catch(() => sendResponse({ success: false,
    error: "PAGE_UNAVAILABLE", message: "页面已切换或暂时无法读取，请回到目标页面后重试。" }))
    .finally(() => clearInterval(keepAlive));
  return true;
});
