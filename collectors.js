/* These self-contained functions are injected only after a user action.
 * They receive page identity, never an API key. MAIN world is used only for
 * the site's player and its native subtitle requests. */
async function panoramaReadVideo(expected, withTranscript) {
  const text = (selector) => document.querySelector(selector)?.textContent?.trim() || "";
  const fail = (message, error = "NO_TRANSCRIPT") => ({ success: false, error, message });
  const timeoutFetch = (url, options = {}) => fetch(url, { ...options, signal: AbortSignal.timeout(20000) });
  function current() {
    const url = new URL(location.href);
    if (expected.platform === "youtube") {
      const id = url.pathname === "/watch" ? url.searchParams.get("v") : url.pathname.split("/")[2];
      return id === expected.id;
    }
    if (expected.platform === "bilibili") {
      return url.pathname.split("/")[2] === expected.id &&
        Math.max(1, Number(url.searchParams.get("p")) || 1) === expected.part;
    }
    return false;
  }
  if (!current()) return fail("页面已切换，请回到要分析的内容页面后重试。", "PAGE_CHANGED");
  try {
    if (expected.platform === "youtube") {
      const response = document.getElementById("movie_player")?.getPlayerResponse?.() || window.ytInitialPlayerResponse;
      const details = response?.videoDetails;
      if (details?.videoId && details.videoId !== expected.id) return fail("播放器正在切换视频，请稍后重试。", "PAGE_CHANGED");
      const info = { title: details?.title || text("h1.ytd-watch-metadata") || document.title,
        channelName: details?.author || text("#channel-name"),
        description: details?.shortDescription || "", duration: Number(details?.lengthSeconds) || 0 };
      if (!withTranscript) return { success: true, info };
      const tracks = [...(response?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [])];
      tracks.sort((a, b) => (b.languageCode?.startsWith("zh") ? 2 : b.kind !== "asr" ? 1 : 0) -
        (a.languageCode?.startsWith("zh") ? 2 : a.kind !== "asr" ? 1 : 0));
      for (const track of tracks.slice(0, 3)) {
        try {
          const url = new URL(track.baseUrl);
          if (url.protocol !== "https:" || !["www.youtube.com", "youtube.com"].includes(url.hostname) || url.pathname !== "/api/timedtext") continue;
          url.searchParams.set("fmt", "json3");
          const res = await timeoutFetch(url.href, { credentials: "include" });
          if (!res.ok) continue;
          const body = await res.text();
          let rows = [];
          try {
            const data = JSON.parse(body);
            rows = (data.events || []).filter(event => event.segs).map(event => ({
              start: Number(event.tStartMs) / 1000, duration: Number(event.dDurationMs || 0) / 1000,
              text: event.segs.map(segment => segment.utf8 || "").join("").replace(/\n/g, " ") }));
          } catch {
            const xml = new DOMParser().parseFromString(body, "text/xml");
            rows = [...xml.querySelectorAll("text, p")].map(node => ({
              start: node.hasAttribute("start") ? Number(node.getAttribute("start")) : Number(node.getAttribute("t")) / 1000,
              duration: node.hasAttribute("dur") ? Number(node.getAttribute("dur")) : Number(node.getAttribute("d")) / 1000,
              text: node.textContent }));
          }
          rows = rows.filter(row => row.text.trim());
          if (!current()) return fail("页面已切换，请回到要分析的内容页面后重试。", "PAGE_CHANGED");
          if (rows.length) return { success: true, info, rows, source: "YouTube 网站字幕" };
        } catch { /* The native caption endpoint may reject this session. Try the visible transcript. */ }
      }
      const rows = [...document.querySelectorAll("ytd-transcript-segment-renderer")].map(node => {
        const parts = (node.querySelector(".segment-timestamp")?.textContent || "").trim().split(":");
        return { start: parts.reduce((n, value) => n * 60 + Number(value), 0), duration: 0,
          text: node.querySelector(".segment-text")?.textContent?.trim() || "" };
      }).filter(row => row.text);
      if (rows.length && current()) return { success: true, info, rows, source: "YouTube 页面逐字稿" };
      return fail("未能读取 YouTube 字幕。可先在视频页面打开「显示转录稿」再试，或在设置中配置可选的 Supadata 字幕服务。无字幕视频暂不支持。");
    }
    const params = new URLSearchParams(expected.id.startsWith("BV") ? { bvid: expected.id } : { aid: expected.id.slice(2) });
    const viewResponse = await timeoutFetch(`https://api.bilibili.com/x/web-interface/view?${params}`, { credentials: "include" });
    if (!viewResponse.ok) return fail("哔哩哔哩视频信息暂时无法读取，请刷新页面后重试。", "BILIBILI_API_ERROR");
    const view = await viewResponse.json();
    if (view.code !== 0 || !view.data) return fail("哔哩哔哩未返回视频信息，请确认视频可正常播放。", "BILIBILI_API_ERROR");
    const data = view.data;
    const part = data.pages?.find(page => page.page === expected.part);
    if (!part) return fail("未找到当前视频的分集，请刷新视频页面后重试。", "BILIBILI_PART_NOT_FOUND");
    const info = { title: data.title + (data.pages.length > 1 ? ` · P${expected.part} ${part.part}` : ""),
      channelName: data.owner?.name || "", description: data.desc || "", duration: Number(part.duration) || 0 };
    if (!withTranscript) return { success: true, info };
    const query = new URLSearchParams({ bvid: data.bvid, cid: String(part.cid) });
    const playerResponse = await timeoutFetch(`https://api.bilibili.com/x/player/wbi/v2?${query}`, { credentials: "include" });
    if (!playerResponse.ok) return fail("暂时无法获取字幕，请稍后重试。", "BILIBILI_API_ERROR");
    const player = await playerResponse.json();
    if (player.code !== 0) return fail("暂时无法读取字幕。请先登录哔哩哔哩，再重试；仍失败时可稍后再试。", "BILIBILI_API_ERROR");
    const subtitles = [...(player.data?.subtitle?.subtitles || [])];
    subtitles.sort((a, b) => Number((b.lan || "").includes("zh")) - Number((a.lan || "").includes("zh")));
    if (!subtitles.length) return fail(player.data?.need_login_subtitle
      ? "此视频字幕需要登录。请先在哔哩哔哩页面登录，再重新分析。" : "此视频没有可读取的字幕，暂不支持无字幕视频。");
    const url = new URL(subtitles[0].subtitle_url, location.href);
    if (url.protocol !== "https:" || !(url.hostname === "hdslb.com" || url.hostname.endsWith(".hdslb.com"))) return fail("无法读取这个视频的字幕地址，请尝试其他视频。");
    const res = await timeoutFetch(url.href, { credentials: "omit" });
    if (!res.ok) return fail("字幕下载失败，请稍后重试。");
    const subtitle = await res.json();
    if (!current()) return fail("页面已切换，请回到要分析的内容页面后重试。", "PAGE_CHANGED");
    return { success: true, info, source: "哔哩哔哩网站字幕", rows: (subtitle.body || []).map(row => ({
      start: Number(row.from), duration: Math.max(0, Number(row.to) - Number(row.from)), text: row.content })) };
  } catch {
    return fail("读取字幕失败或超时，请确认页面可正常播放后重试。", "TRANSCRIPT_FETCH_FAILED");
  }
}

async function panoramaCollectComments(expected) {
  const current = () => location.pathname.split("/").filter(Boolean).at(-1) === expected.id;
  const fail = (message, error = "COMMENT_FETCH_FAILED") => ({ success: false, error, message });
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const comments = new Map();
  const progress = () => chrome.runtime.sendMessage({ action: "mediaProgress", key: expected.key, count: comments.size }).catch(() => {});
  if (!current()) return fail("页面已切换，请回到要分析的内容页面后重试。", "PAGE_CHANGED");
  // Prevent two open panels from scrolling the same page concurrently.
  if (globalThis.__panoramaCollecting) return fail("正在获取这个页面的评论，请等待当前操作完成。");
  globalThis.__panoramaCollecting = true;
  try {
    if (expected.platform === "xueqiu") {
      let maxId = "0";
      let incomplete = false;
      const stripHtml = value => new DOMParser().parseFromString(String(value || ""), "text/html").body.textContent.trim();
      const push = (comment, parentId = null) => {
        if (!comment?.id || comments.size >= 1000) return;
        const id = String(comment.id), text = stripHtml(comment.text).slice(0, 5000);
        if (text) comments.set(id, { id, parentCommentId: parentId && String(parentId), text,
          author: String(comment.user?.screen_name || "").slice(0, 200), likeCount: Number(comment.like_count) || 0, publishedAt: "" });
      };
      for (let page = 0; page < 50; page++) {
        if (!current()) return fail("页面已切换，请回到要分析的内容页面后重试。", "PAGE_CHANGED");
        const params = new URLSearchParams({ id: expected.id, type: "status", size: "20", max_id: maxId });
        const response = await fetch(`/statuses/v3/comments.json?${params}`, { credentials: "include", signal: AbortSignal.timeout(15000) });
        if (!response.ok) { incomplete = true; break; }
        const data = await response.json();
        if (data.error_code) { incomplete = true; break; }
        const before = comments.size;
        for (const comment of data.comments || []) {
          push(comment);
          for (const reply of comment.child_comments || []) push(reply, comment.id);
        }
        progress();
        if (!data.next_max_id || String(data.next_max_id) === maxId || comments.size === before) break;
        if (comments.size >= 1000 || page === 49) { incomplete = true; break; }
        maxId = String(data.next_max_id);
        await sleep(700);
      }
      if (!comments.size) return fail("未获取到雪球评论。请先登录雪球，确认帖子有评论后重试。");
      return { success: true, comments: [...comments.values()], truncated: incomplete,
        source: "雪球帖子评论", notice: incomplete ? "只获取了部分评论，可能受网站限制或已达到数量上限。" : "" };
    }
    // Selectors and scroll/expand workflow adapted from Xiaohongshu-Comment-analysis.
    // Scope to the open note so feed text or another note cannot become evidence.
    const root = document.querySelector(".note-detail-mask, #noteContainer, .note-container") || document;
    const selector = '.comment-item, .comment-item-sub, div[class*="commentItem"], .parent-comment';
    const first = (node, selectors) => selectors.map(s => node.querySelector(s)).find(el => el?.textContent.trim());
    const likes = value => {
      const match = String(value || "").replace(/,/g, "").match(/([\d.]+)\s*(万|w|k)?/i);
      return match ? Math.round(Number(match[1]) * (/万|w/i.test(match[2] || "") ? 10000 : /k/i.test(match[2] || "") ? 1000 : 1)) : 0;
    };
    const read = () => {
      for (const item of root.querySelectorAll(selector)) {
        const textEl = first(item, [".content .note-text", ".content", ".note-text", "span.content"]);
        if (!textEl) continue;
        // A wrapper containing a child comment is not a second comment.
        if (textEl.closest(selector) !== item) continue;
        const text = textEl.textContent.trim().slice(0, 5000);
        const author = first(item, [".author .name", ".name", 'a[class*="name"]'])?.textContent.trim().slice(0, 200) || "";
        if (!text) continue;
        const dedup = item.getAttribute("data-id") || item.id || `${author}|${text}`;
        const old = comments.get(dedup);
        if (!old && comments.size >= 1000) break;
        comments.set(dedup, { id: old?.id || `xhs-${comments.size + 1}`, parentCommentId: null, author: author || old?.author || "", text,
          likeCount: likes(first(item, [".like .count", ".like-wrapper .count", 'span[class*="count"]'])?.textContent), publishedAt: "" });
      }
    };
    const targets = [".note-scroller", ".comments-container", ".comments-el"].map(s => root.querySelector(s) || document.querySelector(s)).filter(Boolean);
    const scroll = targets.find(el => el.scrollHeight > el.clientHeight + 20) || targets[0] || document.scrollingElement;
    const previousScroll = scroll.scrollTop;
    let stable = 0, incomplete = true;
    const clicked = new WeakSet();
    try {
      for (let round = 0; round < 20; round++) {
        if (!current()) return fail("页面已切换，请回到要分析的内容页面后重试。", "PAGE_CHANGED");
        const before = comments.size;
        read();
        let expanded = 0;
        const repliesRoot = root.querySelector(".comments-container, .comments-el, .comments-list") || root;
        for (const el of repliesRoot.querySelectorAll('span, button, a, div[class*="expand"], div[class*="more"], div[class*="reply"]')) {
          const label = el.textContent.trim();
          if (clicked.has(el) || el.offsetParent === null || label.length > 24 || /收起/.test(label)) continue;
          if (!/^(?:展开|查看全部|查看更多|加载更多|更多回复|共\s*\d+\s*条回复)/.test(label)) continue;
          if (el.closest(".content, .note-text, .author")) continue;
          const link = el.closest("a[href]");
          if (link && !["", "#"].includes(link.getAttribute("href"))) continue;
          if ([...el.children].some(child => child.textContent.trim() === label)) continue;
          clicked.add(el); el.click(); expanded++;
          if (expanded >= 15) break;
        }
        scroll.scrollTop = scroll.scrollHeight;
        await sleep(850);
        if (!current()) return fail("页面已切换，请回到要分析的内容页面后重试。", "PAGE_CHANGED");
        read(); progress();
        if (comments.size >= 1000) break;
        stable = comments.size === before && expanded === 0 ? stable + 1 : 0;
        if (stable >= 3) { incomplete = false; break; }
      }
    } finally { if (current()) scroll.scrollTop = previousScroll; }
    if (!comments.size) return fail("没有读取到评论。请登录小红书，打开笔记详情并确认评论区已显示后重试。", "NO_COMMENTS");
    return { success: true, comments: [...comments.values()], source: "小红书页面评论", truncated: incomplete,
      notice: "仅包含页面已加载的评论，可能不是全部评论；没有区分评论与回复的对应关系。" };
  } catch {
    return fail("评论获取失败，请刷新内容页面后重试。");
  } finally { globalThis.__panoramaCollecting = false; }
}

function panoramaPageInfo() {
  const text = selector => document.querySelector(selector)?.textContent?.trim() || "";
  return { title: text("h1.ytd-watch-metadata, h1.video-title, #detail-title, .note-content .title, .article__bd__title") || document.title,
    channelName: text("#channel-name, .up-name, .author-container .username, .author-wrapper .name, .article__author .name"), description: "", duration: 0 };
}
function panoramaSeek(seconds) {
  const video = document.querySelector("video");
  if (!video || !Number.isFinite(seconds) || seconds < 0) return { success: false, message: "未找到视频播放器，请回到原视频页面后重试。" };
  video.currentTime = Number.isFinite(video.duration) ? Math.min(seconds, video.duration) : seconds;
  return { success: true };
}
if (typeof module !== "undefined" && module.exports) module.exports = { panoramaReadVideo, panoramaCollectComments, panoramaPageInfo, panoramaSeek };
