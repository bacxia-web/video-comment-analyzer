/* URL identity is shared by the panel and service worker. No credentials here. */
var PANORAMA_PLATFORMS = (() => {
  function parse(input) {
    let url;
    try { url = new URL(input); } catch { return null; }
    if (url.protocol !== "https:") return null;
    const host = url.hostname;
    let id;
    if (["www.youtube.com", "youtube.com", "m.youtube.com"].includes(host)) {
      id = url.pathname === "/watch" ? url.searchParams.get("v")
        : url.pathname.match(/^\/(?:shorts|live|embed)\/([\w-]+)\/?$/)?.[1];
      if (!/^[\w-]{11}$/.test(id || "")) return null;
      return { platform: "youtube", label: "YouTube", id, key: `youtube:${id}`,
        url: `https://www.youtube.com/watch?v=${id}`, video: true, comments: true };
    }
    if (["www.bilibili.com", "bilibili.com"].includes(host)) {
      id = url.pathname.match(/^\/video\/(BV[A-Za-z0-9]{10}|av\d+)\/?$/)?.[1];
      if (!id) return null;
      const part = Math.max(1, Math.floor(Number(url.searchParams.get("p")) || 1));
      return { platform: "bilibili", label: "哔哩哔哩", id, part, key: `bilibili:${id}:${part}`,
        url: `https://www.bilibili.com/video/${id}/?p=${part}`, video: true, comments: false };
    }
    if (["www.xiaohongshu.com", "xiaohongshu.com"].includes(host)) {
      id = url.pathname.match(/^\/(?:explore|discovery\/item)\/([a-f0-9]{24})\/?$/i)?.[1];
      if (!id) return null;
      return { platform: "xiaohongshu", label: "小红书", id, key: `xiaohongshu:${id}`,
        url: url.href, video: false, comments: true };
    }
    if (["xueqiu.com", "www.xueqiu.com"].includes(host)) {
      id = url.pathname.match(/^\/\d+\/(\d+)\/?$/)?.[1];
      if (!id) return null;
      return { platform: "xueqiu", label: "雪球", id, key: `xueqiu:${id}`,
        url: url.href, video: false, comments: true };
    }
    return null;
  }
  function timestamp(seconds) {
    const n = Math.max(0, Math.floor(Number(seconds) || 0));
    return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, "0")}`;
  }
  function transcriptResult(rows, source) {
    const transcript = (Array.isArray(rows) ? rows : []).filter(row =>
      typeof row.text === "string" && row.text.trim() && Number.isFinite(Number(row.start)) && Number(row.start) >= 0
    ).map(row => ({ text: row.text.trim(), start: Number(row.start),
      duration: Math.max(0, Number(row.duration) || 0) })).sort((a, b) => a.start - b.start);
    if (!transcript.length) return { success: false, error: "NO_TRANSCRIPT", message: "没有读取到字幕。" };
    const transcriptTextTimestamped = transcript.map(row => `[${timestamp(row.start)}] ${row.text}`).join("\n");
    // Fail visibly instead of silently analyzing only the beginning of a long video.
    if (transcriptTextTimestamped.length > 180000) return { success: false, error: "TRANSCRIPT_TOO_LONG",
      message: "字幕超过本次分析长度上限，请选择较短的视频或分 P 视频。" };
    return { success: true, transcript, transcriptText: transcript.map(row => row.text).join("\n"),
      transcriptTextTimestamped, source };
  }
  return { parse, timestamp, transcriptResult };
})();
if (typeof module !== "undefined" && module.exports) module.exports = PANORAMA_PLATFORMS;
