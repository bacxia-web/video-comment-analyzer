/**
 * SIDE PANEL LOGIC
 *
 * Handles the UI for Video & Comment Analyzer: video detection, transcript analysis,
 * rendering results, and export features.
 */

const DEBUG = false;
const debugLog = (...args) => {
  if (DEBUG) console.log(...args);
};

// ============================================================
// STATE
// ============================================================

let currentVideoId = null;
let currentVideoUrl = null;
let currentAnalysis = null;
let currentTranscript = null;
let currentTranscriptText = null; // Plain text (for display/export)
let currentTranscriptTimestamped = null; // With timestamps for AI analysis
let currentTranscriptLanguage = null;
let currentVideoTitle = "";
let currentChannelName = "";
let currentVideoDescription = "";
let currentVideoDuration = 0;
let isAnalysisLoading = false; // Track if analysis is in progress
let youtubeTabId = null; // Store the YouTube tab ID for reliable messaging
let videoRevision = 0;
let transcriptLoadPromise = null;
let currentTranscriptSource = "";
let transcriptReadingPosition = null;
let notesLoadRevision = 0;
let panelRedirecting = false;
let currentComments = [];
let currentCommentStats = null;
let currentCommentAnalysis = null;
let currentCommentsTruncated = false;
let currentTopComments = [];
let isCommentsLoading = false;
let isCommentAnalysisLoading = false;
let commentCacheCheckedVideoId = null;

// --- Global content language state ---
// One control drives Transcript, Overview, Comments, and Notes.
let currentLanguageMode = "original";
let translationGeneration = 0; // Invalidates responses from older UI modes/videos.
let translationWorkCount = 0;
let transcriptScrollObserver = null;
// Stable keys include the video, source mode, language, and semantic segment ID.
let transcriptParagraphCache = new Map();
const UI_TRANSLATION_STORAGE_KEY = "ytd_ui_translation_cache";
const LANGUAGE_MODE_STORAGE_KEY = "ytd_global_language_mode";
let uiTranslationCache = new Map();
let uiTranslationErrors = new Map();
let localizedContentNodes = new Map();
let uiTranslationGeneration = 0;
let uiTranslationScheduled = false;
let isUiTranslationRunning = false;
const TRANSLATION_MESSAGE_TIMEOUT_MS = 130_000;

/**
 * Prevent a stopped service worker or dead message channel from leaving the
 * transcript queue stuck forever. The underlying Chrome message cannot be
 * cancelled, so settled guards deliberately ignore any late response.
 */
function sendTranslationMessage(message) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timeoutId;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      callback(value);
    };

    timeoutId = setTimeout(() => {
      finish(
        reject,
        new Error(
          "Translation request timed out after 130 seconds. Please Retry.",
        ),
      );
    }, TRANSLATION_MESSAGE_TIMEOUT_MS);

    let messagePromise;
    try {
      messagePromise = chrome.runtime.sendMessage(message);
    } catch (error) {
      finish(reject, error);
      return;
    }

    Promise.resolve(messagePromise).then(
      (result) => finish(resolve, result),
      (error) => finish(reject, error),
    );
  });
}

// --- Auto-scroll state (follow video playback in transcript) ---
let autoScrollEnabled = true; // True = scroll transcript to follow video playback
let autoScrollInterval = null; // setInterval ID for polling video time
let lastAutoScrollTime = 0; // Timestamp of last programmatic scroll (ignores scroll events within 1s)

// ============================================================
// TRANSCRIPT GROUPING
// ============================================================

const TRANSCRIPT_SEGMENT_LIMITS = Object.freeze({
  minChars: 60,
  idealChars: 180,
  maxChars: 320,
  maxSeconds: 20,
});

function normalizeCaptionText(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .replace(/([\u3400-\u9fff])\s+([\u3400-\u9fff])/g, "$1$2")
    .replace(/([，。；：！？])\s+(?=[\u3400-\u9fff])/g, "$1")
    .replace(/\s+([,.;:!?，。；：！？])/g, "$1")
    .trim();
}

/**
 * Splits a single oversized thought at the strongest nearby punctuation.
 * Word boundaries are the final safety valve for captions with no punctuation.
 */
function splitOversizedThought(text, maxChars) {
  const parts = [];
  let rest = normalizeCaptionText(text);

  while (rest.length > maxChars) {
    const windowText = rest.slice(0, maxChars + 1);
    const lowerBound = Math.floor(maxChars * 0.55);
    let cut = -1;

    for (const pattern of [/[;:；：]\s*/g, /[,，]\s*/g, /\s/g]) {
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(windowText))) {
        if (match.index >= lowerBound) cut = match.index + match[0].length;
      }
      if (cut > 0) break;
    }

    if (cut <= 0) cut = maxChars;
    parts.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }

  if (rest) parts.push(rest);
  return parts;
}

/**
 * Reconstructs complete sentences across raw caption boundaries. Each segment
 * keeps the timestamp of the first caption that contributed text. Character
 * and time limits prevent a malformed Supadata entry from becoming one giant
 * row while punctuation remains the preferred boundary.
 */
function groupTranscriptEntries(entries, limits = TRANSCRIPT_SEGMENT_LIMITS) {
  if (!Array.isArray(entries) || entries.length === 0) return [];

  const pieces = [];
  entries.forEach((entry, entryIndex) => {
    const text = normalizeCaptionText(entry?.text);
    if (!text) return;
    const start = Number.isFinite(Number(entry.start)) ? Number(entry.start) : 0;
    const duration = Math.max(0, Number(entry.duration) || 0);
    const sentenceParts =
      text.match(/[^.!?;:,。！？；：，]+(?:[.!?;:,。！？；：，]+["')\]”’）】」』]*|$)/g) ||
      [text];
    let consumedChars = 0;

    sentenceParts.forEach((sentencePart) => {
      const cleanPart = normalizeCaptionText(sentencePart);
      if (!cleanPart) return;
      const oversizedParts = splitOversizedThought(cleanPart, limits.maxChars);
      oversizedParts.forEach((part, partIndex) => {
        const ratio = text.length ? Math.min(1, consumedChars / text.length) : 0;
        pieces.push({
          text: part,
          start: start + duration * ratio,
          semanticEnd:
            /[.!?。！？]["')\]”’）】」』]*$/.test(part) ||
            oversizedParts.length > 1,
          clauseEnd: /[;:,；：，]["')\]”’）】」』]*$/.test(part),
          sourceOrder: `${entryIndex}:${partIndex}`,
        });
        consumedChars += part.length + 1;
      });
    });
  });

  const grouped = [];
  let current = null;

  const flush = () => {
    if (!current || !current.text.trim()) return;
    const index = grouped.length;
    const text = normalizeCaptionText(current.text);
    grouped.push({
      id: `segment-${index}-${Math.round(current.start * 1000)}`,
      start: current.start,
      text,
      texts: [text],
    });
    current = null;
  };

  pieces.forEach((piece) => {
    if (!current) current = { start: piece.start, text: "" };
    current.text = normalizeCaptionText(`${current.text} ${piece.text}`);
    const elapsed = Math.max(0, piece.start - current.start);
    const comfortablySized = current.text.length >= limits.minChars;
    const reachedIdeal = current.text.length >= limits.idealChars;
    const atNaturalBoundary =
      piece.semanticEnd ||
      (piece.clauseEnd &&
        (reachedIdeal ||
          current.text.length >= limits.maxChars ||
          elapsed >= limits.maxSeconds));
    const reachedGuardrail =
      atNaturalBoundary &&
      (current.text.length >= limits.maxChars || elapsed >= limits.maxSeconds);
    const reachedHardGuardrail =
      current.text.length >= Math.round(limits.maxChars * 1.2) ||
      elapsed >= limits.maxSeconds + 5;

    if (
      (atNaturalBoundary && (comfortablySized || elapsed >= 8)) ||
      (atNaturalBoundary && reachedIdeal) ||
      reachedGuardrail ||
      reachedHardGuardrail
    ) {
      flush();
    }
  });
  flush();

  return grouped;
}

// ============================================================
// INITIALIZATION
// ============================================================

document.addEventListener("DOMContentLoaded", async () => {
  await loadGlobalLanguageState();
  setupEventListeners();
  setupTranscriptSearch();
  setupExplainFeature();
  await evictOldCacheEntries(20);

  await checkCurrentTab();
});

// Listen for messages from the Digest button on YouTube page
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "startDigestFromButton") {
    // Load the digest for the current video. Served from cache when we've
    // seen this video before (no API calls); fetched fresh otherwise.
    // (This used to force-clear the cache on every click, which silently
    // burned a transcript credit + analysis tokens per click.)
    checkCurrentTab();
    sendResponse({ success: true });
  }
  if (message.action === "transcriptProgress") {
    // Background is telling us the transcript fetch status changed
    updateLoading(message.title, message.subtitle);
    sendResponse({ success: true });
  }
  if (message.action === "noteSaved") {
    // Refresh notes list when a new note is saved
    const filterAll = document
      .getElementById("notesFilterAll")
      ?.classList.contains("active");
    loadNotes(filterAll ? null : currentVideoId);
    sendResponse({ success: true });
  }
  if (
    message.action === "commentsProgress" &&
    message.videoId === currentVideoId &&
    isCommentsLoading
  ) {
    setCommentsStatus(
      `正在获取评论… 已获取 ${Number(message.count) || 0} 条（含回复）。`,
    );
    sendResponse({ success: true });
  }
  return false;
});

// ============================================================
// FOLLOW THE ACTIVE TAB
// ============================================================
// YouTube keeps the full reading interface. Other supported platforms use
// their own analysis view; internal settings pages retain the current video.
// Track YouTube SPA navigation without falling back to another video tab.
//
// Everything is scoped to the window this panel lives in: tab switches in
// OTHER browser windows must not close this panel or hijack its content.

let navigationRefreshTimer = null;
let panelWindowId = null;
chrome.windows.getCurrent().then((w) => {
  panelWindowId = w.id;
});

function scheduleDigestRefresh() {
  // Small delay lets YouTube finish rendering the new video's title and
  // description before we read them. Also collapses rapid-fire URL events
  // into a single refresh.
  clearTimeout(navigationRefreshTimer);
  navigationRefreshTimer = setTimeout(() => {
    checkCurrentTab();
  }, 600);
}

function panelIsShowingResults() {
  const results = document.getElementById("resultsState");
  return results && results.style.display !== "none";
}

/**
 * Reacts to the URL now in front of the panel: close on non-YouTube,
 * refresh the digest when the video changed.
 */
function handleFrontTabUrl(url) {
  if (panelRedirecting) return;
  if (isSettingsUrl(url)) return;
  const parsed = PANORAMA_PLATFORMS.parse(url);
  if (parsed && parsed.platform !== "youtube") {
    panelRedirecting = true;
    videoRevision++;
    location.replace(chrome.runtime.getURL("panel.html"));
    return;
  }
  if (!parsed) {
    videoRevision++;
    translationGeneration++;
    uiTranslationGeneration++;
    currentVideoId = null;
    showState("welcome");
    return;
  }
  const newVideoId = parsed.id;
  // Refresh when the video changed, or when we're not currently showing
  // results (e.g. user went home, then clicked back into the same video).
  if (newVideoId !== currentVideoId || !panelIsShowingResults()) {
    videoRevision++;
    translationGeneration++;
    uiTranslationGeneration++;
    scheduleDigestRefresh();
  }
}

function isSettingsUrl(url) {
  // Includes panel tabs used to inspect the extension. They are not a new
  // content page and must not overwrite the currently attached video.
  return ["preferences.html", "options.html", "panel.html", "sidepanel.html"].some(path =>
    url === chrome.runtime.getURL(path) || url?.startsWith(chrome.runtime.getURL(path) + "#"));
}

// Fires when a tab's URL changes — including YouTube's no-reload navigation.
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!changeInfo.url || !tab.active) return;
  if (panelWindowId !== null && tab.windowId !== panelWindowId) return;
  handleFrontTabUrl(changeInfo.url);
});

// Fires when a different tab comes to the front — switching tabs, or a new
// tab being opened (including ones opened by clicking links in other apps).
chrome.tabs.onActivated.addListener(async ({ tabId, windowId }) => {
  if (panelWindowId !== null && windowId !== panelWindowId) return;
  try {
    const tab = await chrome.tabs.get(tabId);
    // Brand-new tabs may not have committed their URL yet — fall back to
    // the pending one so we judge where the tab is actually going.
    handleFrontTabUrl(tab.url || tab.pendingUrl || "");
  } catch (e) {
    // Tab closed before we could read it — nothing to do.
  }
});

function setupEventListeners() {
  // Tab switching
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => switchTab(tab.dataset.tab));
  });

  // Error retry
  document.getElementById("errorBtn").addEventListener("click", () => {
    if (currentVideoId) {
      startDigest(currentVideoId, currentVideoUrl);
    }
  });

  document.getElementById("settingsBtn")?.addEventListener("click", () => {
    chrome.runtime.sendMessage({ action: "openOptions" });
  });
  document.getElementById("transcriptFetchBtn")?.addEventListener("click", () => loadCurrentTranscript(false));
  document.getElementById("exportOverviewBtn")?.addEventListener("click", () => exportAnalysisReport("video"));
  document.getElementById("exportCommentReportBtn")?.addEventListener("click", () => exportAnalysisReport("comments"));
  document.getElementById("exportCommentsBtn")?.addEventListener("click", () => {
    downloadTextFile(JSON.stringify({ videoTitle: currentVideoTitle, url: currentVideoUrl,
      comments: currentComments, stats: currentCommentStats, truncated: currentCommentsTruncated }, null, 2),
      `${sanitizeFilename(currentVideoTitle)}-comments.json`);
  });

  // Transcript actions
  document
    .getElementById("copyTranscriptBtn")
    ?.addEventListener("click", copyTranscript);
  document
    .getElementById("exportTranscriptBtn")
    ?.addEventListener("click", exportTranscript);
  document.querySelectorAll(".language-mode-btn").forEach((button) => {
    button.addEventListener("click", () => {
      handleGlobalLanguageModeChange(button.dataset.languageMode);
    });
  });

  document
    .getElementById("commentFetchBtn")
    ?.addEventListener("click", fetchCurrentComments);
  document
    .getElementById("commentAnalyzeBtn")
    ?.addEventListener("click", analyzeCurrentComments);

  // Follow playback button — re-enables auto-scroll after user scrolled away
  document
    .getElementById("followPlaybackBtn")
    ?.addEventListener("click", () => {
      autoScrollEnabled = true;
      document.getElementById("followPlaybackBtn").style.display = "none";
      // Jump straight back to the line currently being spoken. We scroll
      // directly (not via playbackTrackingTick) because the tick skips
      // entries that are already highlighted — and the current line almost
      // always IS highlighted, which made this button appear to do nothing.
      if (!scrollToActiveEntry()) {
        playbackTrackingTick(); // No highlight yet — let a tick establish one
      }
    });

  // Notes filter buttons
  document.getElementById("notesFilterThis")?.addEventListener("click", () => {
    setNotesFilter(false);
    loadNotes(currentVideoId);
  });
  document.getElementById("notesFilterAll")?.addEventListener("click", () => {
    setNotesFilter(true);
    loadNotes(null); // Load all notes
  });
}

function setNotesFilter(showAll) {
  const thisVideoButton = document.getElementById("notesFilterThis");
  const allNotesButton = document.getElementById("notesFilterAll");
  thisVideoButton?.classList.toggle("active", !showAll);
  thisVideoButton?.setAttribute("aria-pressed", String(!showAll));
  allNotesButton?.classList.toggle("active", showAll);
  allNotesButton?.setAttribute("aria-pressed", String(showAll));
}

// ============================================================
// VIDEO DETECTION
// ============================================================

async function checkCurrentTab() {
  try {
    const [tab] = await chrome.tabs.query(panelWindowId === null
      ? { active: true, currentWindow: true } : { active: true, windowId: panelWindowId });
    if (isSettingsUrl(tab?.url)) return;
    const context = PANORAMA_PLATFORMS.parse(tab?.url);
    if (!context || context.platform !== "youtube") {
      handleFrontTabUrl(tab?.url || "");
      return;
    }
    await startDigest(context.id, context.url, tab.id, tab.title);
  } catch (error) {
    console.error("Tab check error:", error);
    showError("无法读取当前视频", "请刷新 YouTube 视频页面，再重新打开插件。");
  }
}

function extractVideoId(url) {
  const context = PANORAMA_PLATFORMS.parse(url);
  return context?.platform === "youtube" ? context.id : null;
}

// ============================================================
// DIGEST PIPELINE
// ============================================================

async function startDigest(videoId, videoUrl, tabId = youtubeTabId, title = "") {
  if (videoId === currentVideoId && tabId === youtubeTabId && panelIsShowingResults()) return;
  const revision = ++videoRevision;
  translationGeneration++;
  uiTranslationGeneration++;
  localizedContentNodes.clear();
  document.getElementById("explainTooltip").style.display = "none";
  document.getElementById("explainModal")?.remove();
  if (transcriptScrollObserver) transcriptScrollObserver.disconnect();
  transcriptScrollObserver = null;
  transcriptLoadPromise = null;
  transcriptReadingPosition = null;
  stopPlaybackTracking();
  currentVideoId = videoId;
  currentVideoUrl = videoUrl;
  youtubeTabId = tabId;
  currentAnalysis = currentTranscript = currentTranscriptText = currentTranscriptTimestamped = null;
  currentTranscriptLanguage = null;
  currentTranscriptSource = "";
  currentVideoTitle = title || "YouTube 视频";
  currentChannelName = currentVideoDescription = "";
  currentVideoDuration = 0;
  isAnalysisLoading = false;
  // A new video starts in its original language. Merely opening the panel
  // must never start a paid translation remembered from a previous video.
  currentLanguageMode = "original";
  setGlobalLanguageModeButtons("original");
  translationWorkCount = 0;
  setTranslatingSpinner(false);
  resetCommentState();
  setNotesFilter(false);
  document.getElementById("transcriptSearch").value = "";
  document.getElementById("transcriptList").replaceChildren();
  document.getElementById("transcriptSourceBadge")?.remove();
  document.getElementById("chapterList").textContent = "打开「AI 摘要」后，会根据字幕生成章节摘要（使用 DeepSeek 额度）。";
  document.getElementById("exportOverviewBtn").hidden = true;
  document.getElementById("quotesList").textContent = "获取字幕后，可生成带时间戳的关键引用。";
  showVideoInfo();
  showState("results");
  switchTab("transcript");
  setTranscriptAvailability(false, "正在读取页面字幕…", true);
  loadNotes(videoId);

  const cached = await loadFromCache(videoId);
  if (revision !== videoRevision) return;
  if (cached?.transcript?.length) {
    currentAnalysis = cached.analysis || null;
    currentTranscript = cached.transcript;
    currentTranscriptText = cached.transcriptText;
    currentTranscriptTimestamped = cached.transcriptTimestamped;
    currentTranscriptLanguage = cached.transcriptLanguage || null;
    currentTranscriptSource = cached.transcriptSource || "视频已有字幕";
    currentVideoTitle = cached.videoTitle || currentVideoTitle;
    currentChannelName = cached.channelName || "";
    currentVideoDescription = cached.videoDescription || "";
    currentVideoDuration = cached.videoDuration || 0;
    for (const [key, value] of Object.entries(cached.paragraphCache || {})) {
      transcriptParagraphCache.set(key, value);
    }
    showVideoInfo();
    setTranscriptAvailability(true);
    renderTranscript();
    if (currentAnalysis) {
      renderAnalysisResults(currentAnalysis);
      highlightMomentsOnPage(currentAnalysis.keyMoments);
    }
    return;
  }
  // Only the free, on-page transcript is read automatically. A retry or an
  // explicit AI action may use the optional Supadata fallback.
  await loadCurrentTranscript(true);
}

function showVideoInfo() {
  document.getElementById("videoInfo").style.display = "block";
  document.getElementById("videoTitle").textContent = currentVideoTitle;
  document.getElementById("videoChannel").textContent = currentChannelName;
}

function setTranscriptAvailability(available, message = "", loading = false) {
  document.getElementById("transcriptNotice").hidden = available;
  document.getElementById("transcriptNoticeText").textContent = message;
  const button = document.getElementById("transcriptFetchBtn");
  button.disabled = loading;
  button.textContent = loading ? "正在读取…" : "重新获取字幕";
  for (const id of ["transcriptSearchBar", "transcriptHelp"]) document.getElementById(id).hidden = !available;
  for (const id of ["copyTranscriptBtn", "exportTranscriptBtn"]) document.getElementById(id).disabled = !available;
}

function loadCurrentTranscript(nativeOnly = false) {
  if (transcriptLoadPromise) return transcriptLoadPromise;
  if (!currentVideoId || !youtubeTabId) return Promise.resolve(false);
  const revision = videoRevision;
  const videoId = currentVideoId;
  setTranscriptAvailability(false, nativeOnly ? "正在从当前视频读取字幕…" : "正在读取字幕；网页读取失败时会尝试已配置的 Supadata 备用服务。", true);
  const pending = (async () => {
    try {
      const result = await chrome.runtime.sendMessage({ action: "mediaCollect", mode: "video",
        tabId: youtubeTabId, key: `youtube:${videoId}`, nativeOnly });
      if (revision !== videoRevision) return false;
      if (!result?.success) {
        setTranscriptAvailability(false, PANORAMA_COPY.error(result, "没有读到字幕。可在视频页面打开「显示转录稿」后重试，或在设置中添加可选的 Supadata 备用 Key。"));
        return false;
      }
      currentTranscript = result.transcript;
      currentTranscriptText = result.transcriptText;
      currentTranscriptTimestamped = result.transcriptTextTimestamped;
      currentTranscriptLanguage = result.language || null;
      currentTranscriptSource = result.source || "视频已有字幕";
      currentVideoTitle = result.context?.title || currentVideoTitle;
      currentChannelName = result.context?.channelName || "";
      currentVideoDescription = result.context?.description || "";
      currentVideoDuration = result.context?.duration || 0;
      showVideoInfo();
      setTranscriptAvailability(true);
      renderTranscript();
      await saveToCache(videoId);
      return revision === videoRevision;
    } catch (error) {
      if (revision === videoRevision) setTranscriptAvailability(false, PANORAMA_COPY.error(error));
      return false;
    } finally {
      if (revision === videoRevision) transcriptLoadPromise = null;
    }
  })();
  transcriptLoadPromise = pending;
  return pending;
}

async function ensureCurrentTranscript() {
  const revision = videoRevision;
  if (transcriptLoadPromise) await transcriptLoadPromise;
  if (revision !== videoRevision) return false;
  return !!currentTranscript || await loadCurrentTranscript(false);
}

// ============================================================
// RENDERING
// ============================================================

/**
 * Renders the analysis results into the Overview tab.
 * Shows chapters and key quotes only.
 */
function renderAnalysisResults(analysis) {
  document.getElementById("exportOverviewBtn").hidden = false;
  // Chapters
  const chapterList = document.getElementById("chapterList");
  chapterList.innerHTML = "";
  (analysis.chapters || []).forEach((chapter, index) => {
    const li = document.createElement("li");
    li.className = "chapter-item";
    li.dataset.seconds = chapter.timestampSeconds;
    li.innerHTML = `
      <span class="chapter-timestamp">${escapeHtml(chapter.timestamp)}</span>
      <div class="chapter-content">
        <span class="chapter-title">${escapeHtml(chapter.title)}</span>
        <span class="chapter-summary">${escapeHtml(chapter.summary || "")}</span>
      </div>
    `;
    li.addEventListener("click", () => {
      debugLog(
        "[Video & Comment Analyzer Panel] Chapter clicked:",
        chapter.timestamp,
        chapter.timestampSeconds,
      );
      seekTo(chapter.timestampSeconds);
    });
    chapterList.appendChild(li);
    registerLocalizedContent(
      li.querySelector(".chapter-title"),
      `overview:${currentVideoId}:chapter:${index}:title`,
      chapter.title,
    );
    registerLocalizedContent(
      li.querySelector(".chapter-summary"),
      `overview:${currentVideoId}:chapter:${index}:summary`,
      chapter.summary,
    );
  });

  // Quotes - sort by timestamp (chronological order)
  const quotesList = document.getElementById("quotesList");
  quotesList.innerHTML = "";
  const sortedQuotes = [...(analysis.keyQuotes || [])].sort(
    (a, b) => (a.timestampSeconds || 0) - (b.timestampSeconds || 0),
  );
  sortedQuotes.forEach((quote, index) => {
    const div = document.createElement("div");
    div.className = "quote-item";
    div.dataset.seconds = quote.timestampSeconds;
    div.innerHTML = `
      <div class="quote-text">${escapeHtml(quote.quote)}</div>
      <div class="quote-meta">
        <span class="quote-timestamp">${escapeHtml(quote.timestamp)}</span>
        <div class="quote-actions">
          <button class="quote-save-note-btn" title="保存此时间附近的字幕为片段笔记">保存片段</button>
          <button class="quote-copy-btn" title="复制这段引用的原文">复制原文</button>
        </div>
      </div>
    `;
    div.addEventListener("click", () => {
      debugLog(
        "[Video & Comment Analyzer Panel] Quote clicked:",
        quote.timestamp,
        quote.timestampSeconds,
      );
      seekTo(quote.timestampSeconds);
    });

    const quoteCopyBtn = div.querySelector(".quote-copy-btn");
    quoteCopyBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      try {
        await navigator.clipboard.writeText(quote.quote);
        quoteCopyBtn.textContent = "已复制";
        setTimeout(() => {
          quoteCopyBtn.textContent = "复制原文";
        }, 1500);
      } catch (err) {
        console.error("Copy failed:", err);
      }
    });

    const quoteSaveNoteBtn = div.querySelector(".quote-save-note-btn");
    quoteSaveNoteBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      await saveQuoteAsNote(quote, quoteSaveNoteBtn);
    });

    quotesList.appendChild(div);
    registerLocalizedContent(
      div.querySelector(".quote-text"),
      `overview:${currentVideoId}:quote:${index}`,
      quote.quote,
    );
  });
}

/**
 * Saves a key quote as a timestamped note.
 */
async function saveQuoteAsNote(quote, btn) {
  if (!currentVideoId) return;

  const originalText = btn.textContent;
  btn.textContent = "正在保存…";
  btn.disabled = true;

  try {
    const result = await chrome.runtime.sendMessage({
      action: "saveNote",
      videoId: currentVideoId,
      timestamp: quote.timestampSeconds,
      videoTitle: currentVideoTitle,
      channelName: currentChannelName,
    });

    if (result.success) {
      btn.textContent = "已保存";
      setTimeout(() => {
        btn.textContent = originalText;
        btn.disabled = false;
      }, 1500);
      // Refresh notes list if on Notes tab
      loadNotes(currentVideoId);
    } else {
      console.error("[Video & Comment Analyzer] Save quote as note failed:", result.error);
      btn.textContent = "保存失败，请重试";
      setTimeout(() => {
        btn.textContent = originalText;
        btn.disabled = false;
      }, 1500);
    }
  } catch (error) {
    console.error("[Video & Comment Analyzer] Save quote as note error:", error);
    btn.textContent = "保存失败，请重试";
    setTimeout(() => {
      btn.textContent = originalText;
      btn.disabled = false;
    }, 1500);
  }
}

/**
 * Legacy function for backwards compatibility with cached data.
 * Renders both transcript and analysis.
 */
function renderResults(analysis) {
  renderAnalysisResults(analysis);

  renderTranscript();

  document.getElementById("tabsNav").style.display = "flex";

  // Setup explain feature for text selection
  setupExplainFeature();
}

/**
 * Returns true while the user has a range of text selected.
 * Transcript row clicks must not seek in that state: the click emitted after
 * selection mouseup belongs to the selection/explain interaction, not playback.
 */
function hasNonCollapsedTextSelection() {
  const selection = window.getSelection();
  return Boolean(
    selection && selection.rangeCount > 0 && !selection.isCollapsed,
  );
}

/**
 * Preserves normal row-click seeking while keeping text selection inert.
 */
function seekFromTranscriptEntryClick(event, seconds) {
  if (hasNonCollapsedTextSelection()) {
    event.preventDefault();
    event.stopPropagation();
    return;
  }

  seekTo(seconds);
}

function renderTranscript() {
  if (!currentTranscript) return;

  const transcriptList = document.getElementById("transcriptList");
  transcriptList.innerHTML = "";

  // Show a small badge indicating the transcript came from the video's
  // existing subtitles. (We no longer AI-transcribe audio, so subtitles
  // are the only source.)
  const existingBadge = document.getElementById("transcriptSourceBadge");
  if (existingBadge) existingBadge.remove();

  const badge = document.createElement("div");
  badge.id = "transcriptSourceBadge";
  badge.className = "transcript-source-badge";
  badge.innerHTML = `<span class="source-dot source-dot--subs"></span> ${escapeHtml(currentTranscriptSource || "视频已有字幕")} · ${escapeHtml(getOriginalTranscriptLabel())}`;
  transcriptList.parentElement.insertBefore(badge, transcriptList);

  // Group entries using smart sentence-boundary + time-guardrail logic
  const grouped = groupTranscriptEntries(currentTranscript);

  grouped.forEach((group) => {
    const div = document.createElement("div");
    div.className = "transcript-entry";
    div.dataset.seconds = group.start;

    const minutes = Math.floor(group.start / 60);
    const seconds = Math.floor(group.start % 60);
    const timestamp = `${minutes}:${String(seconds).padStart(2, "0")}`;

    div.innerHTML = `
      <span class="transcript-time">${timestamp}</span>
      <span class="transcript-text">${renderSubtitleInlineMarkup(group.text)}</span>
    `;

    div.addEventListener("click", (event) =>
      seekFromTranscriptEntryClick(event, group.start),
    );
    transcriptList.appendChild(div);
  });

  // Start tracking video playback for auto-scroll
  startPlaybackTracking();
}

function copyTranscript() {
  copyToClipboardWithFeedback(currentTranscriptText || "", "copyTranscriptBtn");
}

function exportTranscript() {
  const transcriptContent = currentTranscriptText || "";
  const videoUrl = `https://youtube.com/watch?v=${currentVideoId}`;

  let exportText = "";
  exportText += `视频字幕\n`;
  exportText += `${"=".repeat(60)}\n\n`;
  exportText += `标题：${currentVideoTitle || "未知标题"}\n`;
  exportText += `作者：${currentChannelName || "未知作者"}\n`;
  exportText += `视频链接：${videoUrl}\n`;
  exportText += `\n${"—".repeat(60)}\n\n`;

  if (currentVideoDescription) {
    exportText += `视频介绍：\n${currentVideoDescription}\n`;
    exportText += `\n${"—".repeat(60)}\n\n`;
  }

  exportText += `视频字幕：\n\n${transcriptContent}\n`;
  exportText += `\n${"—".repeat(60)}\n`;
  exportText += `由 Video & Comment Analyzer 导出\n`;

  const filename = `${sanitizeFilename(currentVideoTitle)}-transcript.txt`;
  downloadTextFile(exportText, filename);
}

function exportAnalysisReport(mode) {
  const analysis = mode === "video" ? currentAnalysis : currentCommentAnalysis;
  if (!analysis) return;
  const lines = [`# ${currentVideoTitle}`, "", currentVideoUrl, ""];
  if (mode === "video") {
    lines.push("## 章节摘要", "");
    for (const chapter of analysis.chapters || []) lines.push(`### ${PANORAMA_PLATFORMS.timestamp(chapter.timestampSeconds)} ${chapter.title}`, "", chapter.summary || "", "");
    lines.push("## 关键引用", "");
    for (const quote of analysis.keyQuotes || []) lines.push(`- [${PANORAMA_PLATFORMS.timestamp(quote.timestampSeconds)}] ${quote.quote}`);
  } else {
    lines.push("## 评论概览", "", analysis.summary || "", "", `整体态度：${PANORAMA_COPY.sentiments[analysis.overallSentiment] || "中性"}`, "");
    for (const topic of analysis.topics || []) {
      lines.push(`## ${topic.title}`, "", topic.summary || "", "");
      for (const row of topic.evidence || []) lines.push(`> ${row.text}`, `> — ${row.author || "匿名用户"} · ${row.likeCount || 0} 赞`, "");
    }
    for (const [key, title] of [["viewerQuestions", "大家在问什么"], ["creatorFeedback", "给创作者的建议"]]) {
      if (analysis[key]?.length) lines.push(`## ${title}`, "", ...analysis[key].map(text => `- ${text}`), "");
    }
    lines.push("结论仅代表本次获取的评论。");
  }
  downloadTextFile(lines.join("\n"), `${sanitizeFilename(currentVideoTitle)}-${mode}-analysis.md`);
}

// ============================================================
// UI STATE MANAGEMENT
// ============================================================

function showState(state) {
  document.getElementById("welcomeState").style.display =
    state === "welcome" ? "flex" : "none";
  document.getElementById("loadingState").style.display =
    state === "loading" ? "block" : "none";
  document.getElementById("errorState").style.display =
    state === "error" ? "block" : "none";
  const uploadEl = document.getElementById("uploadState");
  if (uploadEl) uploadEl.style.display = "none"; // Upload state removed — always hidden
  document.getElementById("resultsState").style.display =
    state === "results" ? "block" : "none";

  // The tab bar only belongs on the results view. We toggle it HERE, in one
  // place, so it tracks the view automatically. Previously each caller had to
  // remember to re-show it after showState("results"), and one path forgot —
  // which is why the tabs could vanish when re-opening an already-analyzed video.
  document.getElementById("tabsNav").style.display =
    state === "results" ? "flex" : "none";

  if (state !== "results") {
    stopPlaybackTracking();
  }
}

function updateLoading(title, subtitle) {
  document.getElementById("loadingText").textContent = title;
  document.getElementById("loadingSubtext").textContent = subtitle;
}

function showError(title, message) {
  showState("error");
  document.getElementById("errorTitle").textContent = title;
  document.getElementById("errorMessage").textContent = message;
  document.getElementById("errorBtn").textContent = "重试";
}

// ============================================================
// TAB SWITCHING
// ============================================================

function switchTab(tabName) {
  const previousTab = document.querySelector(".tab.active")?.dataset.tab;
  if (previousTab === "transcript" && tabName !== "transcript") transcriptReadingPosition = captureTranscriptPosition();
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.tab === tabName);
  });

  document.querySelectorAll(".tab-panel").forEach((panel) => {
    panel.classList.toggle("active", panel.dataset.panel === tabName);
  });

  // Start/stop playback tracking based on which tab is active
  if (tabName === "transcript") {
    startPlaybackTracking();
    if (previousTab !== "transcript") restoreTranscriptPosition(transcriptReadingPosition);
  } else {
    stopPlaybackTracking();
  }

  // Lazy-load LLM analysis when user switches to Overview tab
  if (tabName === "overview" && !currentAnalysis && !isAnalysisLoading) {
    triggerAnalysis();
  }

  if (tabName === "comments") {
    initializeCommentsTab();
  }
}

/**
 * Triggers the LLM analysis (lazy-loaded when user clicks Overview or Quotes tab).
 * This saves tokens by not running analysis until needed.
 */
async function triggerAnalysis() {
  if (!currentVideoId || isAnalysisLoading || currentAnalysis) return;
  const revision = videoRevision;
  isAnalysisLoading = true;

  // Show loading indicators in the Overview tab
  const chapterList = document.getElementById("chapterList");
  const quotesList = document.getElementById("quotesList");

  if (chapterList)
    chapterList.innerHTML =
      '<li class="chapter-item" style="color: var(--text-muted); border: none;">DeepSeek 正在生成章节摘要…</li>';
  if (quotesList)
    quotesList.innerHTML =
      '<div class="quote-item" style="color: var(--text-muted); border-left-color: var(--border);">正在整理关键引用…</div>';

  try {
    if (!await PANORAMA_SETUP.ensure()) {
      chapterList.textContent = PANORAMA_COPY.error({ error: "NO_AI_KEY" });
      quotesList.textContent = "填写后回到「AI 摘要」即可继续。";
      return;
    }
    if (revision !== videoRevision) return;
    if (!await ensureCurrentTranscript()) {
      if (revision === videoRevision) {
        chapterList.textContent = "还没有可分析的字幕。请到「视频字幕」查看获取提示，完成后再回来。";
        quotesList.textContent = "评论分析和已有笔记仍可使用。";
      }
      return;
    }
    const analysisResult = await chrome.runtime.sendMessage({
      action: "analyzeTranscript",
      transcriptText: currentTranscriptTimestamped,
      videoTitle: currentVideoTitle,
      channelName: currentChannelName,
      videoDescription: currentVideoDescription,
      videoDuration: currentVideoDuration,
    });
    if (revision !== videoRevision) return;

    if (!analysisResult.success) {
      if (chapterList)
        chapterList.innerHTML = `<li class="chapter-item" style="color: var(--accent); border: none;">${escapeHtml(PANORAMA_COPY.error(analysisResult, "摘要生成失败，请稍后重试。"))}</li>`;
      if (quotesList) quotesList.textContent = "尚未生成关键引用。解决上方提示后，切换到其他栏目，再回到「AI 摘要」重试。";
      isAnalysisLoading = false;
      return;
    }

    currentAnalysis = analysisResult.analysis;
    renderAnalysisResults(currentAnalysis);
    highlightMomentsOnPage(currentAnalysis.keyMoments);

    // Save to cache now that we have analysis
    await saveToCache(currentVideoId);
  } catch (error) {
    if (revision !== videoRevision) return;
    console.error("[Video & Comment Analyzer Panel] Analysis error:", error);
    if (chapterList)
      chapterList.innerHTML = `<li class="chapter-item" style="color: var(--accent); border: none;">${escapeHtml(PANORAMA_COPY.error(error))}</li>`;
    if (quotesList) quotesList.textContent = "尚未生成关键引用。切换到其他栏目，再回到「AI 摘要」重试。";
  } finally {
    if (revision === videoRevision) isAnalysisLoading = false;
  }
}

// ============================================================
// COMMENTS
// ============================================================

function setCommentsStatus(message, isError = false) {
  const status = document.getElementById("commentsStatus");
  if (!status) return;
  status.textContent = message;
  status.classList.toggle("error", isError);
}

function resetCommentState() {
  currentComments = [];
  currentCommentStats = null;
  currentCommentAnalysis = null;
  currentCommentsTruncated = false;
  currentTopComments = [];
  isCommentsLoading = false;
  isCommentAnalysisLoading = false;
  commentCacheCheckedVideoId = null;
  document.getElementById("exportCommentsBtn").hidden = true;
  document.getElementById("exportCommentReportBtn").hidden = true;

  document.getElementById("commentStats")?.setAttribute("hidden", "");
  document.getElementById("commentActions")?.setAttribute("hidden", "");
  document.getElementById("commentAnalysis")?.setAttribute("hidden", "");
  document.getElementById("topCommentsSection")?.setAttribute("hidden", "");
  const fetchButton = document.getElementById("commentFetchBtn");
  if (fetchButton) {
    fetchButton.disabled = false;
    fetchButton.textContent = "获取评论";
  }
  setCommentsStatus("点击「获取评论」读取公开评论和回复，需要 YouTube Data API Key，并消耗其额度。");
}

async function initializeCommentsTab() {
  if (!currentVideoId || commentCacheCheckedVideoId === currentVideoId) return;
  commentCacheCheckedVideoId = currentVideoId;
  const revision = videoRevision;
  try {
    const stored = await chrome.storage.local.get(`comments_${currentVideoId}`);
    if (revision !== videoRevision) return;
    const cached = stored[`comments_${currentVideoId}`];
    const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
    if (!cached || Date.now() - Number(cached.timestamp || 0) > THIRTY_DAYS) {
      if (cached) await chrome.storage.local.remove(`comments_${currentVideoId}`);
      return;
    }
    currentCommentStats = cached.stats || null;
    currentCommentAnalysis = cached.analysis || null;
    currentCommentsTruncated = !!cached.truncated;
    currentTopComments = Array.isArray(cached.topComments)
      ? cached.topComments
      : [];
    renderCommentStats();
    renderTopComments(currentTopComments);
    if (currentCommentAnalysis) {
      renderCommentAnalysis(currentCommentAnalysis);
      document.getElementById("commentSampleNote").textContent = cached.sampleSize
        ? `本次分析了 ${cached.sampleSize} 条评论`
        : "";
    }
    const fetchButton = document.getElementById("commentFetchBtn");
    if (fetchButton) fetchButton.textContent = "重新获取评论";
    setCommentsStatus("已显示本机保存的评论结果。需要最新内容时，点击「重新获取评论」。");
  } catch (error) {
    console.error("Comment cache load error:", error);
  }
}

async function fetchCurrentComments() {
  if (!currentVideoId || isCommentsLoading) return;
  isCommentsLoading = true;
  const revision = videoRevision;
  const fetchButton = document.getElementById("commentFetchBtn");
  const analyzeButton = document.getElementById("commentAnalyzeBtn");
  if (fetchButton) {
    fetchButton.disabled = true;
    fetchButton.textContent = "正在获取…";
  }
  if (analyzeButton) analyzeButton.disabled = true;
  setCommentsStatus("正在获取 YouTube 评论和回复…");

  try {
    const result = await chrome.runtime.sendMessage({
      action: "fetchComments",
      videoId: currentVideoId,
    });
    if (revision !== videoRevision) return;
    if (!result?.success) {
      const message =
        result?.error === "NO_YOUTUBE_KEY"
          ? PANORAMA_COPY.error({ error: "NO_YOUTUBE_KEY" })
          : PANORAMA_COPY.error(result, "评论获取失败，请稍后重试。");
      setCommentsStatus(message, true);
      return;
    }
    currentComments = result.comments || [];
    document.getElementById("exportCommentsBtn").hidden = currentComments.length === 0;
    document.getElementById("exportCommentReportBtn").hidden = true;
    currentCommentStats = result.stats || null;
    currentCommentsTruncated = !!result.truncated;
    currentCommentAnalysis = null;
    currentTopComments = [...currentComments]
      .sort((a, b) => (b.likeCount || 0) - (a.likeCount || 0))
      .slice(0, 20);
    renderCommentStats();
    renderTopComments(currentTopComments);
    document.getElementById("commentAnalysis")?.setAttribute("hidden", "");
    const actions = document.getElementById("commentActions");
    if (actions) actions.hidden = currentComments.length === 0;
    document.getElementById("commentSampleNote").textContent =
      currentComments.length > 400
        ? "最多选取 400 条评论进行 AI 分析"
        : "";
    setCommentsStatus(
      currentComments.length
        ? `已获取 ${currentComments.length} 条评论（含回复）${currentCommentsTruncated ? "，已达到 1,000 条上限" : ""}。点击「开始分析」后，会将评论发送给 DeepSeek，按账户计费。`
        : "没有获取到公开评论。请确认此视频的评论区有内容。",
    );
    await saveCommentCache();
  } catch (error) {
    if (revision !== videoRevision) return;
    setCommentsStatus(PANORAMA_COPY.error(error, "评论获取失败，请稍后重试。"), true);
  } finally {
    if (revision !== videoRevision) return;
    isCommentsLoading = false;
    if (fetchButton) {
      fetchButton.disabled = false;
      fetchButton.textContent = currentCommentStats
        ? "重新获取评论"
        : "获取评论";
    }
    if (analyzeButton) analyzeButton.disabled = currentComments.length === 0;
  }
}

async function analyzeCurrentComments() {
  if (!currentComments.length || isCommentAnalysisLoading) return;
  const revision = videoRevision;
  if (!await PANORAMA_SETUP.ensure()) {
    setCommentsStatus(PANORAMA_COPY.error({ error: "NO_AI_KEY" }), true);
    return;
  }
  if (revision !== videoRevision) return;
  isCommentAnalysisLoading = true;
  const button = document.getElementById("commentAnalyzeBtn");
  if (button) {
    button.disabled = true;
    button.textContent = "正在分析…";
  }
  setCommentsStatus("DeepSeek 正在整理讨论主题与评论态度…");
  try {
    const result = await chrome.runtime.sendMessage({
      action: "analyzeComments",
      comments: currentComments,
      videoTitle: currentVideoTitle,
      channelName: currentChannelName,
    });
    if (revision !== videoRevision) return;
    if (!result?.success) {
      const message =
        result?.error === "NO_AI_KEY"
          ? PANORAMA_COPY.error({ error: "NO_AI_KEY" })
          : PANORAMA_COPY.error(result, "评论分析失败，请稍后重试。");
      setCommentsStatus(message, true);
      return;
    }
    currentCommentAnalysis = result.analysis;
    renderCommentAnalysis(currentCommentAnalysis);
    document.getElementById("commentSampleNote").textContent =
      `本次分析了 ${result.sampleSize || currentComments.length} 条评论`;
    setCommentsStatus("评论分析完成。结论仅代表本次获取的评论。");
    await saveCommentCache(result.sampleSize);
  } catch (error) {
    if (revision !== videoRevision) return;
    setCommentsStatus(PANORAMA_COPY.error(error, "评论分析失败，请稍后重试。"), true);
  } finally {
    if (revision !== videoRevision) return;
    isCommentAnalysisLoading = false;
    if (button) {
      button.disabled = false;
      button.textContent = currentCommentAnalysis
        ? "重新分析"
        : "开始分析";
    }
  }
}

function renderCommentStats() {
  const container = document.getElementById("commentStats");
  if (!container || !currentCommentStats) return;
  container.replaceChildren();
  const entries = [
    ["评论总数", currentCommentStats.total],
    ["主评论", currentCommentStats.topLevel],
    ["回复", currentCommentStats.replies],
    ["发言人数", currentCommentStats.authors],
  ];
  for (const [label, value] of entries) {
    const card = document.createElement("div");
    card.className = "comment-stat";
    const number = document.createElement("span");
    number.className = "comment-stat-value";
    number.textContent = Number(value || 0).toLocaleString();
    const caption = document.createElement("span");
    caption.className = "comment-stat-label";
    caption.textContent = label;
    card.append(number, caption);
    container.appendChild(card);
  }
  container.hidden = false;
}

function renderTopComments(comments) {
  const section = document.getElementById("topCommentsSection");
  const container = document.getElementById("topComments");
  if (!section || !container) return;
  container.replaceChildren();
  const safeComments = Array.isArray(comments) ? comments : [];
  safeComments.forEach((comment, index) => {
    const card = document.createElement("div");
    card.className = "top-comment";
    const meta = document.createElement("div");
    meta.className = "top-comment-meta";
    const author = document.createElement("span");
    author.textContent = comment.author || "匿名用户";
    const likes = document.createElement("span");
    likes.textContent = `${Number(comment.likeCount) || 0} 赞${comment.parentCommentId ? " · 回复" : ""}`;
    meta.append(author, likes);
    const text = document.createElement("div");
    text.className = "top-comment-text";
    text.textContent = comment.text || "";
    card.append(meta, text);
    container.appendChild(card);
    registerLocalizedContent(
      text,
      `comments:${currentVideoId}:top:${comment.id || index}`,
      comment.text,
    );
  });
  section.hidden = safeComments.length === 0;
}

function renderCommentAnalysis(analysis) {
  if (!analysis) return;
  document.getElementById("exportCommentReportBtn").hidden = false;
  const wrapper = document.getElementById("commentAnalysis");
  const sentiment = document.getElementById("commentSentiment");
  sentiment.className = `sentiment-badge ${analysis.overallSentiment || "neutral"}`;
  sentiment.textContent = PANORAMA_COPY.sentiments[analysis.overallSentiment] || "中性";
  const commentSummary = document.getElementById("commentSummary");
  commentSummary.textContent = analysis.summary || "本次没有生成评论概览，可以重新分析。";
  registerLocalizedContent(
    commentSummary,
    `comments:${currentVideoId}:analysis:summary`,
    analysis.summary || "本次没有生成评论概览，可以重新分析。",
  );

  const topics = document.getElementById("commentTopics");
  topics.replaceChildren();
  (analysis.topics || []).forEach((topic, topicIndex) => {
    const card = document.createElement("div");
    card.className = "comment-topic";
    const header = document.createElement("div");
    header.className = "comment-topic-header";
    const title = document.createElement("div");
    title.className = "comment-topic-title";
    title.textContent = topic.title;
    const badge = document.createElement("span");
    badge.className = `sentiment-badge ${topic.sentiment || "neutral"}`;
    badge.textContent = PANORAMA_COPY.sentiments[topic.sentiment] || "中性";
    header.append(title, badge);
    const summary = document.createElement("p");
    summary.className = "comment-topic-summary";
    summary.textContent = topic.summary || "";
    card.append(header, summary);
    registerLocalizedContent(
      title,
      `comments:${currentVideoId}:topic:${topicIndex}:title`,
      topic.title,
    );
    registerLocalizedContent(
      summary,
      `comments:${currentVideoId}:topic:${topicIndex}:summary`,
      topic.summary,
    );
    (topic.evidence || []).forEach((evidence, evidenceIndex) => {
      const quote = document.createElement("div");
      quote.className = "comment-evidence";
      const quoteText = document.createElement("span");
      quoteText.className = "comment-evidence-text";
      quoteText.textContent = evidence.text;
      const meta = document.createElement("div");
      meta.className = "comment-evidence-meta";
      meta.textContent = `${evidence.author || "匿名用户"} · ${Number(evidence.likeCount) || 0} 赞`;
      quote.append(quoteText, meta);
      card.appendChild(quote);
      registerLocalizedContent(
        quoteText,
        `comments:${currentVideoId}:topic:${topicIndex}:evidence:${evidence.id || evidenceIndex}`,
        evidence.text,
      );
    });
    topics.appendChild(card);
  });
  renderCommentInsightList(
    "viewerQuestionsSection",
    "viewerQuestions",
    analysis.viewerQuestions,
    `comments:${currentVideoId}:questions`,
  );
  renderCommentInsightList(
    "creatorFeedbackSection",
    "creatorFeedback",
    analysis.creatorFeedback,
    `comments:${currentVideoId}:feedback`,
  );
  wrapper.hidden = false;
}

function renderCommentInsightList(sectionId, listId, values, translationId) {
  const section = document.getElementById(sectionId);
  const list = document.getElementById(listId);
  if (!section || !list) return;
  list.replaceChildren();
  const safeValues = Array.isArray(values) ? values : [];
  safeValues.forEach((value, index) => {
    const item = document.createElement("li");
    item.textContent = value;
    list.appendChild(item);
    registerLocalizedContent(item, `${translationId}:${index}`, value);
  });
  section.hidden = safeValues.length === 0;
}

async function saveCommentCache(sampleSize = null) {
  if (!currentVideoId || !currentCommentStats) return;
  const cacheData = {
    stats: currentCommentStats,
    analysis: currentCommentAnalysis,
    topComments: currentTopComments,
    truncated: currentCommentsTruncated,
    sampleSize,
    timestamp: Date.now(),
  };
  try {
    await chrome.storage.local.set({
      [`comments_${currentVideoId}`]: cacheData,
    });
    const all = await chrome.storage.local.get(null);
    const keys = Object.keys(all).filter((key) => key.startsWith("comments_"));
    if (keys.length > 20) {
      const oldest = keys
        .map((key) => ({ key, timestamp: Number(all[key]?.timestamp) || 0 }))
        .sort((a, b) => a.timestamp - b.timestamp)
        .slice(0, keys.length - 20)
        .map((entry) => entry.key);
      await chrome.storage.local.remove(oldest);
    }
  } catch (error) {
    console.error("Comment cache save error:", error);
  }
}

// ============================================================
// TIMESTAMP / SEEK
// ============================================================

async function seekTo(seconds) {
  debugLog("[Video & Comment Analyzer Panel] seekTo called with:", seconds);
  if (seconds === undefined || seconds === null) {
    debugLog("[Video & Comment Analyzer Panel] seekTo aborted - no seconds value");
    return;
  }

  const payload = {
    action: "seekTo",
    seconds: Number(seconds),
  };

  try {
    // Try direct messaging to the stored YouTube tab first (fastest/reliable)
    if (youtubeTabId) {
      try {
        await chrome.tabs.sendMessage(youtubeTabId, payload);
        debugLog("[Video & Comment Analyzer Panel] seekTo direct success");
        return;
      } catch (directErr) {
        debugLog(
          "[Video & Comment Analyzer Panel] Direct seekTo failed, falling back to relay:",
          directErr.message,
        );
      }
    }

    // Fallback: route through background script
    const result = await chrome.runtime.sendMessage({
      action: "relayToContent",
      tabId: youtubeTabId,
      videoId: currentVideoId,
      payload,
    });
    debugLog("[Video & Comment Analyzer Panel] seekTo relay result:", result);
  } catch (error) {
    console.error("[Video & Comment Analyzer Panel] seekTo error:", error);
  }
}

/**
 * Plays a saved note at its timestamp.
 * - If the note belongs to the video currently open, we seek the player in place.
 * - If it belongs to a DIFFERENT video (e.g. viewing "All Notes"), seeking the
 *   current player would jump to the wrong content, so we open that video in a
 *   new tab at the right timestamp instead.
 */
function playNote(note) {
  if (note.videoId && note.videoId === currentVideoId) {
    seekTo(note.timestampSeconds);
  } else {
    // note.timestampedUrl already includes the &t=<seconds>s anchor
    chrome.tabs.create({ url: note.timestampedUrl });
  }
}

async function highlightMomentsOnPage(moments) {
  if (!moments || !moments.length) return;

  try {
    // Route through background script for reliable message passing
    await chrome.runtime.sendMessage({
      action: "relayToContent",
      tabId: youtubeTabId,
      videoId: currentVideoId,
      payload: {
        action: "highlightMoments",
        moments: moments,
        videoDuration: currentVideoDuration,
      },
    });
  } catch (error) {
    console.error("Highlight error:", error);
  }
}

// ============================================================
// UTILITY
// ============================================================

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text || "";
  return div.innerHTML;
}

/**
 * Renders the small subset of inline formatting commonly present in subtitle
 * tracks and model translations. Everything is escaped first; only exact,
 * attribute-free allowlisted tags are restored as markup afterwards.
 */
function renderSubtitleInlineMarkup(text) {
  return escapeHtml(text).replace(
    /&lt;(\/?)(i|em|b|strong|u)&gt;|&lt;br(?:\s*\/)?&gt;/gi,
    (_match, closing, tagName) =>
      tagName ? `<${closing}${tagName.toLowerCase()}>` : "<br>",
  );
}

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (error) {
    console.error("Copy failed:", error);
    return false;
  }
}

async function copyToClipboardWithFeedback(text, buttonId) {
  const btn = document.getElementById(buttonId);
  const original = btn.textContent;

  const success = await copyToClipboard(text);
  if (success) {
    btn.textContent = "已复制";
    setTimeout(() => {
      btn.textContent = original;
    }, 2000);
  }
}

function downloadTextFile(text, filename) {
  const blob = new Blob([text], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function sanitizeFilename(str) {
  return (str || "untitled")
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .substring(0, 50)
    .toLowerCase();
}

// ============================================================
// TRANSCRIPT SEARCH AND READING POSITION
// ============================================================

function captureTranscriptPosition() {
  if (document.querySelector(".tab.active")?.dataset.tab !== "transcript") return transcriptReadingPosition;
  const area = document.getElementById("contentArea");
  const top = area.getBoundingClientRect().top;
  const row = [...document.querySelectorAll("#transcriptList .transcript-entry")]
    .find(entry => entry.getBoundingClientRect().bottom > top);
  return { seconds: Number(row?.dataset.seconds) || 0,
    offset: row ? row.getBoundingClientRect().top - top : 0,
    scrollTop: area.scrollTop, following: autoScrollEnabled };
}

function restoreTranscriptPosition(position) {
  if (!position || document.querySelector(".tab.active")?.dataset.tab !== "transcript") return;
  const area = document.getElementById("contentArea");
  const rows = [...document.querySelectorAll("#transcriptList .transcript-entry")];
  const row = rows.filter(entry => Number(entry.dataset.seconds) <= position.seconds).at(-1);
  lastAutoScrollTime = Date.now();
  if (position.scrollTop === 0 || !row) area.scrollTop = position.scrollTop;
  else area.scrollTop += row.getBoundingClientRect().top - area.getBoundingClientRect().top - position.offset;
  autoScrollEnabled = position.following;
  document.getElementById("followPlaybackBtn").style.display = position.following ? "none" : "block";
}

function setupTranscriptSearch() {
  const input = document.getElementById("transcriptSearch");
  const list = document.getElementById("transcriptList");
  const count = document.getElementById("transcriptSearchCount");
  const previous = document.getElementById("transcriptSearchPrev");
  const next = document.getElementById("transcriptSearchNext");
  let matches = [], index = -1, timer;

  function selectMatch(target, scroll = true) {
    matches[index]?.classList.remove("current-match");
    index = matches.length ? (target + matches.length) % matches.length : -1;
    matches[index]?.classList.add("current-match");
    count.textContent = !input.value.trim() ? "" : matches.length ? `${index + 1} / ${matches.length}` : "未找到";
    previous.disabled = next.disabled = matches.length === 0;
    if (scroll && matches[index]) {
      autoScrollEnabled = false;
      lastAutoScrollTime = Date.now();
      document.getElementById("followPlaybackBtn").style.display = "block";
      matches[index].scrollIntoView({ block: "center" });
    }
  }

  function refreshSearch(scroll = false) {
    observer.disconnect();
    for (const mark of list.querySelectorAll("mark.transcript-match")) mark.replaceWith(document.createTextNode(mark.textContent));
    list.normalize();
    const oldIndex = index;
    matches = [];
    const query = input.value.trim();
    if (query) {
      const pattern = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "giu");
      for (const field of list.querySelectorAll(".transcript-text, .transcript-original, .transcript-translation")) {
        if (field.classList.contains("translation-pending") || field.classList.contains("translation-error")) continue;
        const walker = document.createTreeWalker(field, NodeFilter.SHOW_TEXT);
        const textNodes = [];
        while (walker.nextNode()) if (!walker.currentNode.parentElement.closest("button")) textNodes.push(walker.currentNode);
        for (const textNode of textNodes) {
          const text = textNode.textContent;
          const found = [...text.matchAll(pattern)];
          if (!found.length) continue;
          const fragment = document.createDocumentFragment();
          let offset = 0;
          for (const match of found) {
            fragment.append(document.createTextNode(text.slice(offset, match.index)));
            const mark = document.createElement("mark");
            mark.className = "transcript-match";
            mark.textContent = match[0];
            fragment.append(mark); matches.push(mark);
            offset = match.index + match[0].length;
          }
          fragment.append(document.createTextNode(text.slice(offset)));
          textNode.replaceWith(fragment);
        }
      }
    }
    selectMatch(scroll ? 0 : Math.max(0, Math.min(oldIndex, matches.length - 1)), scroll);
    observer.observe(list, { childList: true, subtree: true, characterData: true });
  }

  const observer = new MutationObserver(() => {
    clearTimeout(timer);
    timer = setTimeout(() => refreshSearch(false), 60);
  });
  observer.observe(list, { childList: true, subtree: true, characterData: true });
  input.addEventListener("input", () => refreshSearch(true));
  input.addEventListener("keydown", event => {
    if (event.key === "Enter") { event.preventDefault(); selectMatch(index + (event.shiftKey ? -1 : 1)); }
    if (event.key === "Escape") { input.value = ""; refreshSearch(false); }
  });
  previous.addEventListener("click", () => selectMatch(index - 1));
  next.addEventListener("click", () => selectMatch(index + 1));
}

// ============================================================
// TEXT SELECTION — EXPLAIN AND SAVE NOTE
// ============================================================

/**
 * Sets up text selection handling in the transcript.
 * When user selects text, shows an "Explain" button.
 */
function setupExplainFeature() {
  const transcriptList = document.getElementById("transcriptList");
  if (!transcriptList) return;

  // Remove existing tooltip if any
  const existingTooltip = document.getElementById("explainTooltip");
  if (existingTooltip) return;

  // Create the explain tooltip/button
  const tooltip = document.createElement("div");
  tooltip.id = "explainTooltip";
  tooltip.className = "explain-tooltip";
  tooltip.innerHTML = `<button class="explain-btn" type="button">解释选中文字</button><button class="selection-note-btn" type="button">存为笔记</button>`;
  tooltip.style.display = "none";
  document.body.appendChild(tooltip);

  let selectedText = "";
  let selectedTimestamp = 0;

  // Interacting with Explain must preserve the transcript selection and stay
  // isolated from document/row click behavior.
  tooltip.addEventListener("mousedown", (event) => {
    event.preventDefault();
    event.stopPropagation();
  });
  tooltip.addEventListener("mouseup", (event) => {
    event.stopPropagation();
  });
  tooltip.addEventListener("click", (event) => {
    event.stopPropagation();
  });

  // Listen for text selection
  document.addEventListener("mouseup", (e) => {
    const selection = window.getSelection();
    const text = selection.toString().trim();

    // Only show if selecting within transcript
    const isInTranscript = transcriptList.contains(selection.anchorNode) && transcriptList.contains(selection.focusNode);

    // Allow any selection length (removed 10+ char requirement)
    if (text.length > 0 && isInTranscript) {
      selectedText = text;

      // Position the tooltip near the selection
      const range = selection.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      const startNode = range.startContainer.nodeType === Node.ELEMENT_NODE ? range.startContainer : range.startContainer.parentElement;
      selectedTimestamp = Number(startNode?.closest(".transcript-entry")?.dataset.seconds) || 0;

      tooltip.style.display = "block";
      tooltip.style.top = `${rect.bottom + window.scrollY + 8}px`;
      tooltip.style.left = `${Math.max(tooltip.offsetWidth / 2 + 8, Math.min(innerWidth - tooltip.offsetWidth / 2 - 8, rect.left + rect.width / 2))}px`;
    } else {
      tooltip.style.display = "none";
    }
  });

  // Hide tooltip when clicking elsewhere
  document.addEventListener("mousedown", (e) => {
    if (!tooltip.contains(e.target)) {
      tooltip.style.display = "none";
    }
  });

  // Handle explain button click
  tooltip
    .querySelector(".explain-btn")
    .addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (!selectedText) return;
      if (!await PANORAMA_SETUP.ensure()) return;

      tooltip.style.display = "none";
      await showExplanation(selectedText);
    });
  tooltip.querySelector(".selection-note-btn").addEventListener("click", async (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (!selectedText || !currentVideoId) return;
    const button = event.currentTarget;
    const videoId = currentVideoId;
    button.disabled = true;
    button.textContent = "正在保存…";
    try {
      const result = await chrome.runtime.sendMessage({ action: "saveSelectionNote", videoId,
        timestamp: selectedTimestamp, text: selectedText, videoTitle: currentVideoTitle, channelName: currentChannelName });
      button.textContent = result?.success ? "已保存" : "保存失败，重试";
      if (result?.success && videoId === currentVideoId) loadNotes(videoId);
    } catch {
      button.textContent = "保存失败，重试";
    } finally {
      button.disabled = false;
      setTimeout(() => { button.textContent = "存为笔记"; }, 1500);
    }
  });
}

/**
 * Shows the explanation modal and fetches it from the configured AI provider.
 */
async function showExplanation(selectedText) {
  const revision = videoRevision;
  // Create modal
  const modal = document.createElement("div");
  modal.id = "explainModal";
  modal.className = "explain-modal-overlay";
  modal.innerHTML = `
    <div class="explain-modal">
      <div class="explain-modal-header">
        <div class="explain-modal-title">AI 解释</div>
        <button class="explain-modal-close" id="closeExplain" aria-label="关闭解释">✕</button>
      </div>
      <div class="explain-selected-text">"${escapeHtml(selectedText.substring(0, 200))}${selectedText.length > 200 ? "..." : ""}"</div>
      <div class="explain-modal-content" id="explanationContent">
        <div class="explain-loading">
          <div class="loading-bar"></div>
          <span>DeepSeek 正在解释选中的内容…</span>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  // Close handlers
  document
    .getElementById("closeExplain")
    .addEventListener("click", () => modal.remove());
  modal.addEventListener("click", (e) => {
    if (e.target === modal) modal.remove();
  });

  // Get some context around the selection from the transcript
  const transcriptContext = getTranscriptContext(selectedText);

  // Fetch explanation
  try {
    const result = await chrome.runtime.sendMessage({
      action: "explainSelection",
      selectedText: selectedText,
      transcriptContext: transcriptContext,
      videoTitle: currentVideoTitle,
    });

    const contentDiv = modal.querySelector("#explanationContent");
    if (!modal.isConnected || revision !== videoRevision) return;
    if (result.success) {
      contentDiv.innerHTML = `<div class="explain-text">${escapeHtml(result.explanation).replace(/\n\n/g, "</p><p>").replace(/\n/g, "<br>")}</div>`;
    } else {
      contentDiv.innerHTML = `<div class="explain-error">${escapeHtml(PANORAMA_COPY.error(result, "解释未完成，请重新选择文字后重试。"))}</div>`;
    }
  } catch (error) {
    const contentDiv = modal.querySelector("#explanationContent");
    if (!modal.isConnected || revision !== videoRevision) return;
    contentDiv.innerHTML = `<div class="explain-error">${escapeHtml(PANORAMA_COPY.error(error))}</div>`;
  }
}

/**
 * Gets surrounding context from the transcript for the selected text.
 */
function getTranscriptContext(selectedText) {
  const fullText = currentTranscriptText || "";
  const index = fullText.indexOf(selectedText);

  if (index === -1) return "";

  // Get 200 chars before and after
  const start = Math.max(0, index - 200);
  const end = Math.min(fullText.length, index + selectedText.length + 200);

  return fullText.substring(start, end);
}

// ============================================================
// CACHING
// ============================================================

/**
 * Saves the current digest results to persistent local storage.
 * Results survive browser restarts — reopening the same video loads from cache
 * without consuming API tokens or Supadata calls.
 * Cache expires after 30 days. Oldest entries evicted when > 20 videos cached.
 */
async function saveToCache(videoId) {
  if (!videoId || !currentTranscript) return;

  try {
    // Persist semantic-segment translations for this video.
    const paragraphCacheForVideo = {};
    for (const [key, value] of transcriptParagraphCache.entries()) {
      if (key.startsWith(`${videoId}:`)) {
        paragraphCacheForVideo[key] = value;
      }
    }

    const cacheData = {
      analysis: currentAnalysis, // May be null if not yet analyzed
      transcript: currentTranscript,
      transcriptText: currentTranscriptText,
      transcriptTimestamped: currentTranscriptTimestamped,
      transcriptLanguage: currentTranscriptLanguage,
      transcriptSource: currentTranscriptSource,
      videoTitle: currentVideoTitle,
      channelName: currentChannelName,
      videoDescription: currentVideoDescription,
      videoDuration: currentVideoDuration,
      paragraphCache: paragraphCacheForVideo,
      timestamp: Date.now(),
    };

    await chrome.storage.local.set({ [`digest_${videoId}`]: cacheData });
    debugLog(
      "Saved to cache:",
      videoId,
      currentAnalysis ? "(with analysis)" : "(transcript only)",
    );

    // Evict old entries if we have more than 20 videos cached
    await evictOldCacheEntries(20);
  } catch (error) {
    console.error("Cache save error:", error);
  }
}

/**
 * Keeps the cache from growing unbounded.
 * Removes the oldest entries when we exceed maxEntries videos.
 *
 * @param {number} maxEntries - Maximum number of cached videos to keep
 */
async function evictOldCacheEntries(maxEntries) {
  try {
    const allData = await chrome.storage.local.get(null);
    let digestKeys = Object.keys(allData).filter((k) =>
      k.startsWith("digest_"),
    );
    const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
    const expired = digestKeys.filter((key) => {
      const timestamp = Number(allData[key]?.timestamp) || 0;
      return Date.now() - timestamp > THIRTY_DAYS;
    });
    if (expired.length) {
      await chrome.storage.local.remove(expired);
      const expiredSet = new Set(expired);
      digestKeys = digestKeys.filter((key) => !expiredSet.has(key));
    }

    if (digestKeys.length <= maxEntries) return;

    // Sort by timestamp (oldest first) and remove excess
    const sorted = digestKeys
      .map((k) => ({ key: k, ts: allData[k]?.timestamp || 0 }))
      .sort((a, b) => a.ts - b.ts);

    const toRemove = sorted
      .slice(0, sorted.length - maxEntries)
      .map((e) => e.key);
    if (toRemove.length > 0) {
      await chrome.storage.local.remove(toRemove);
      debugLog(`[Video & Comment Analyzer] Evicted ${toRemove.length} old cache entries`);
    }
  } catch (error) {
    console.error("Cache eviction error:", error);
  }
}

/**
 * Loads digest results from persistent local storage.
 * Returns null if not cached or expired (30-day expiry).
 */
async function loadFromCache(videoId) {
  if (!videoId) return null;

  try {
    const result = await chrome.storage.local.get(`digest_${videoId}`);
    const cached = result[`digest_${videoId}`];

    if (!cached) return null;

    // Cache expires after 30 days
    const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
    if (Date.now() - cached.timestamp > THIRTY_DAYS) {
      await chrome.storage.local.remove(`digest_${videoId}`);
      return null;
    }

    return cached;
  } catch (error) {
    console.error("Cache load error:", error);
    return null;
  }
}

/**
 * Updates the cache after enhance or translation operations.
 */
async function updateCache() {
  if (currentVideoId) {
    await saveToCache(currentVideoId);
  }
}

// ============================================================
// NOTES
// ============================================================

/**
 * Loads and renders notes from storage.
 * @param {string|null} videoId - Filter by video ID, or null for all notes
 */
async function loadNotes(videoId) {
  const revision = videoRevision;
  const request = ++notesLoadRevision;
  try {
    const result = await chrome.runtime.sendMessage({
      action: "getNotes",
      videoId: videoId,
    });

    if (result.success && revision === videoRevision && request === notesLoadRevision) {
      renderNotes(result.notes, videoId);
    }
  } catch (error) {
    console.error("[Video & Comment Analyzer Panel] Load notes error:", error);
  }
}

/**
 * Renders the notes list in the Notes tab.
 */
function renderNotes(notes, filteredVideoId) {
  const notesList = document.getElementById("notesList");
  const notesIntro = document.getElementById("notesIntro");

  if (!notesList) return;

  notesList.innerHTML = "";

  if (!notes || notes.length === 0) {
    notesIntro.style.display = "block";
    notesIntro.textContent = filteredVideoId
      ? "这个视频还没有笔记。选中字幕后点击「存为笔记」即可保存；也可在视频画面上点击「保存片段」或按 N 键，保存并润色附近字幕（使用 DeepSeek 额度）。"
      : "还没有笔记。可选中字幕存为笔记，也可在 YouTube 视频画面上点击「保存片段」。";
    return;
  }

  notesIntro.style.display = "none";

  notes.forEach((note, index) => {
    const noteEl = document.createElement("div");
    noteEl.className = "note-item";
    noteEl.innerHTML = `
      <div class="note-header">
        <span class="note-timestamp" data-url="${escapeHtml(note.timestampedUrl)}" data-seconds="${Number(note.timestampSeconds) || 0}">${escapeHtml(note.timestamp)}</span>
        ${!filteredVideoId ? `<span class="note-video-title">${escapeHtml(note.videoTitle)}</span>` : ""}
        <button class="note-delete" data-id="${escapeHtml(note.id)}" title="删除这条片段笔记" aria-label="删除这条片段笔记">✕</button>
      </div>
      <div class="note-text">"${escapeHtml(note.text)}"</div>
      <div class="note-actions">
        <button class="note-action-btn note-copy-text" title="复制这条片段笔记的原文">复制原文</button>
        <button class="note-action-btn note-copy-link" data-url="${escapeHtml(note.timestampedUrl)}">复制片段链接</button>
        <button class="note-action-btn note-play" data-seconds="${Number(note.timestampSeconds) || 0}">跳到此处</button>
      </div>
    `;

    const noteTranslationId = `notes:${note.videoId || currentVideoId || "all"}:${note.id || index}`;
    registerLocalizedContent(
      noteEl.querySelector(".note-text"),
      `${noteTranslationId}:text`,
      `"${note.text}"`,
    );
    if (!filteredVideoId) {
      registerLocalizedContent(
        noteEl.querySelector(".note-video-title"),
        `${noteTranslationId}:title`,
        note.videoTitle,
      );
    }

    // Timestamp click - play from this point (in this tab or a new one)
    noteEl.querySelector(".note-timestamp").addEventListener("click", () => {
      playNote(note);
    });

    // Delete button
    noteEl
      .querySelector(".note-delete")
      .addEventListener("click", async (e) => {
        e.stopPropagation();
        await deleteNote(note.id);
        loadNotes(filteredVideoId);
      });

    // Copy text button — copies just the note's text
    noteEl
      .querySelector(".note-copy-text")
      .addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(note.text);
          const btn = noteEl.querySelector(".note-copy-text");
          btn.textContent = "已复制";
          setTimeout(() => {
            btn.textContent = "复制原文";
          }, 2000);
        } catch (err) {
          console.error("Copy failed:", err);
        }
      });

    // Copy timestamp button — copies the timestamped YouTube link
    noteEl
      .querySelector(".note-copy-link")
      .addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(note.timestampedUrl);
          const btn = noteEl.querySelector(".note-copy-link");
          btn.textContent = "已复制";
          setTimeout(() => {
            btn.textContent = "复制片段链接";
          }, 2000);
        } catch (err) {
          console.error("Copy failed:", err);
        }
      });

    // Play button (in this tab if it's the current video, else a new tab)
    noteEl.querySelector(".note-play").addEventListener("click", () => {
      playNote(note);
    });

    notesList.appendChild(noteEl);
  });
}

/**
 * Deletes a note by ID.
 */
async function deleteNote(noteId) {
  try {
    await chrome.runtime.sendMessage({
      action: "deleteNote",
      noteId: noteId,
    });
  } catch (error) {
    console.error("[Video & Comment Analyzer Panel] Delete note error:", error);
  }
}

// ============================================================
// AUTO-SCROLL — Follow video playback in transcript
// ============================================================
// While a video plays, the transcript automatically scrolls to show which
// 30-second chunk is currently being spoken. If the user manually scrolls
// (e.g., to read ahead), auto-scroll pauses and a "Follow playback" button
// appears so they can resume it. Highlight always stays active regardless.

/**
 * Starts polling the video's current time and highlighting/scrolling
 * to the matching transcript entry.
 */
function startPlaybackTracking() {
  if (!currentTranscript || !currentTranscript.length) return;
  if (document.querySelector(".tab.active")?.dataset.tab !== "transcript") return;

  // Don't restart if already tracking (preserves user's auto-scroll state)
  if (autoScrollInterval) return;

  autoScrollEnabled = true;
  document.getElementById("followPlaybackBtn").style.display = "none";

  // Poll video time every 500ms
  autoScrollInterval = setInterval(() => playbackTrackingTick(), 500);

  // Listen for manual scrolls on the content area
  const contentArea = document.getElementById("contentArea");
  contentArea.removeEventListener("scroll", onContentAreaScroll);
  contentArea.addEventListener("scroll", onContentAreaScroll);
}

/**
 * Stops playback tracking entirely. Called when leaving transcript tab,
 * starting a new digest, or leaving results state.
 */
function stopPlaybackTracking() {
  if (autoScrollInterval) {
    clearInterval(autoScrollInterval);
    autoScrollInterval = null;
  }
  autoScrollEnabled = true; // Reset for next time
  lastAutoScrollTime = 0;
  document.getElementById("followPlaybackBtn").style.display = "none";

  // Remove active highlights
  document
    .querySelectorAll(".transcript-entry.active-playback")
    .forEach((el) => {
      el.classList.remove("active-playback");
    });
}

/**
 * One tick of the playback tracker. Gets current video time from the
 * YouTube tab and highlights + scrolls to the matching transcript entry.
 */
async function playbackTrackingTick() {
  const revision = videoRevision;
  try {
    const result = await chrome.runtime.sendMessage({
      action: "relayToContent",
      tabId: youtubeTabId,
      videoId: currentVideoId,
      payload: { action: "getCurrentTime" },
    });

    if (revision !== videoRevision || !result.success || !result.response) return;

    const currentTime = result.response.currentTime || 0;
    highlightActiveEntry(currentTime);
  } catch (error) {
    // Silently ignore — YouTube tab might be closed or navigated away
  }
}

/**
 * Scrolls the transcript to the entry currently being spoken (the one
 * carrying the active-playback highlight). Returns false if nothing is
 * highlighted yet. Stamps lastAutoScrollTime BEFORE scrolling so the scroll
 * events from our own smooth animation aren't mistaken for the user
 * scrolling away (which would re-disable auto-scroll immediately).
 */
function scrollToActiveEntry() {
  const activeEntry = document.querySelector(
    "#transcriptList .transcript-entry.active-playback",
  );
  if (!activeEntry) return false;

  lastAutoScrollTime = Date.now();
  activeEntry.scrollIntoView({ behavior: "smooth", block: "center" });
  return true;
}

/**
 * Finds the transcript entry matching the current playback time,
 * highlights it, and scrolls to it (if auto-scroll is enabled).
 *
 * @param {number} currentSeconds - Current video playback time in seconds
 */
function highlightActiveEntry(currentSeconds) {
  const transcriptList = document.getElementById("transcriptList");
  if (!transcriptList) return;

  const entries = transcriptList.querySelectorAll(".transcript-entry");
  if (entries.length === 0) return;

  // Find the entry whose time range contains the current playback time
  let activeEntry = null;
  entries.forEach((entry, index) => {
    const entrySeconds = parseInt(entry.dataset.seconds);
    const nextEntry = entries[index + 1];
    const nextSeconds = nextEntry
      ? parseInt(nextEntry.dataset.seconds)
      : Infinity;

    if (currentSeconds >= entrySeconds && currentSeconds < nextSeconds) {
      activeEntry = entry;
    }
  });

  if (!activeEntry) return;

  // Skip if this entry is already highlighted (no DOM thrashing)
  if (activeEntry.classList.contains("active-playback")) return;

  // Remove old highlight, add new one
  entries.forEach((e) => e.classList.remove("active-playback"));
  activeEntry.classList.add("active-playback");

  // Only scroll if auto-scroll is enabled
  if (autoScrollEnabled) {
    lastAutoScrollTime = Date.now();
    activeEntry.scrollIntoView({ behavior: "smooth", block: "center" });
  }
}

/**
 * Scroll event handler for the content area.
 * Detects manual scrolling and disables auto-scroll so the user
 * can read at their own pace without being yanked back.
 */
function onContentAreaScroll() {
  // Ignore scroll events within 1 second of a programmatic scroll
  // (smooth scroll animations can last longer than a simple boolean flag)
  if (Date.now() - lastAutoScrollTime < 1000) return;

  // User scrolled manually — disable auto-scroll and show the button
  if (autoScrollEnabled && autoScrollInterval) {
    autoScrollEnabled = false;
    document.getElementById("followPlaybackBtn").style.display = "block";
  }
}

// ============================================================
// GLOBAL CONTENT LANGUAGE — Original / Chinese / bilingual
// ============================================================

async function loadGlobalLanguageState() {
  try {
    const stored = await chrome.storage.local.get(UI_TRANSLATION_STORAGE_KEY);
    const savedTranslations = stored[UI_TRANSLATION_STORAGE_KEY];
    if (savedTranslations && typeof savedTranslations === "object") {
      uiTranslationCache = new Map(
        Object.entries(savedTranslations).filter(
          ([key, value]) => key && typeof value === "string" && value.trim(),
        ),
      );
    }
  } catch (error) {
    console.warn("[Video & Comment Analyzer] Could not load language preferences:", error);
  }
  setGlobalLanguageModeButtons(currentLanguageMode);
}

function setGlobalLanguageModeButtons(mode) {
  document.querySelectorAll(".language-mode-btn").forEach((button) => {
    const active = button.dataset.languageMode === mode;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
}

async function handleGlobalLanguageModeChange(mode) {
  if (!["original", "zh", "bilingual"].includes(mode)) return;
  const isRetry = mode === currentLanguageMode && mode !== "original";
  if (mode === currentLanguageMode && !isRetry) return;
  const revision = videoRevision;
  if (mode !== "original") {
    if (!await PANORAMA_SETUP.ensure() || revision !== videoRevision) return;
    if (document.querySelector('.tab.active')?.dataset.tab === "transcript" && !await ensureCurrentTranscript()) return;
    if (revision !== videoRevision) return;
  }
  const position = captureTranscriptPosition();

  currentLanguageMode = mode;
  translationGeneration += 1;
  uiTranslationGeneration += 1;
  uiTranslationErrors.clear();
  translationWorkCount = 0;
  setTranslatingSpinner(false);
  if (transcriptScrollObserver) transcriptScrollObserver.disconnect();
  transcriptScrollObserver = null;
  setGlobalLanguageModeButtons(mode);
  chrome.storage.local
    .set({ [LANGUAGE_MODE_STORAGE_KEY]: mode })
    .catch((error) =>
      console.warn("[Video & Comment Analyzer] Could not save language preference:", error),
    );

  renderAllLocalizedContent();
  if (mode === "original") {
    if (currentTranscript) renderTranscript();
    restoreTranscriptPosition(position);
    return;
  }

  scheduleUiTranslation();
  if (currentTranscript) await translateTranscript();
  restoreTranscriptPosition(position);
}

function stableTextHash(text) {
  let hash = 2166136261;
  for (const character of String(text || "")) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function uiTranslationCacheKey(id, original) {
  return `${id}:zh:${stableTextHash(original)}`;
}

function registerLocalizedContent(element, id, original) {
  const text = String(original || "").trim();
  if (!element || !id || !text) return;
  const record = {
    id,
    element,
    original: text,
    cacheKey: uiTranslationCacheKey(id, text),
  };
  localizedContentNodes.set(id, record);
  renderLocalizedContentNode(record);
  if (currentLanguageMode !== "original") scheduleUiTranslation();
}

function renderLocalizedContentNode(record) {
  if (!record.element) return;
  const translated = uiTranslationCache.get(record.cacheKey) || "";
  const error = uiTranslationErrors.get(record.cacheKey) || "";
  const element = record.element;
  element.classList.add("global-localized-content");
  element.dataset.languageMode = currentLanguageMode;

  if (currentLanguageMode === "original") {
    element.textContent = record.original;
    element.classList.remove("global-translation-status");
    return;
  }

  const translationText = translated || error || "翻译中…";
  if (currentLanguageMode === "zh") {
    element.textContent = translationText;
    element.classList.toggle("global-translation-status", !translated);
    return;
  }

  element.classList.remove("global-translation-status");
  element.replaceChildren();
  const original = document.createElement("span");
  original.className = "global-translation-original";
  original.textContent = record.original;
  const translation = document.createElement("span");
  translation.className = `global-translation-zh${translated ? "" : " global-translation-status"}`;
  translation.textContent = translationText;
  element.append(original, translation);
}

function renderAllLocalizedContent() {
  for (const [id, record] of localizedContentNodes) {
    if (!record.element?.isConnected) {
      localizedContentNodes.delete(id);
      continue;
    }
    renderLocalizedContentNode(record);
  }
}

function getPendingUiTranslations() {
  const pendingByCacheKey = new Map();
  for (const record of localizedContentNodes.values()) {
    if (
      record.element?.isConnected &&
      !uiTranslationCache.has(record.cacheKey) &&
      !uiTranslationErrors.has(record.cacheKey)
    ) {
      pendingByCacheKey.set(record.cacheKey, record);
    }
  }
  return [...pendingByCacheKey.values()];
}

function createUiTranslationBatches(records) {
  const batches = [];
  let batch = [];
  let characterCount = 0;
  for (const record of records) {
    const length = record.original.length;
    if (batch.length && (batch.length >= 16 || characterCount + length > 22000)) {
      batches.push(batch);
      batch = [];
      characterCount = 0;
    }
    batch.push(record);
    characterCount += length;
  }
  if (batch.length) batches.push(batch);
  return batches;
}

async function persistUiTranslationCache() {
  const allEntries = [...uiTranslationCache.entries()];
  const recentEntries = [];
  let storedCharacters = 0;
  for (let index = allEntries.length - 1; index >= 0; index -= 1) {
    const entry = allEntries[index];
    const entryCharacters = entry[0].length + entry[1].length;
    if (
      recentEntries.length >= 400 ||
      storedCharacters + entryCharacters > 1_500_000
    ) {
      break;
    }
    recentEntries.unshift(entry);
    storedCharacters += entryCharacters;
  }
  uiTranslationCache = new Map(recentEntries);
  try {
    await chrome.storage.local.set({
      [UI_TRANSLATION_STORAGE_KEY]: Object.fromEntries(recentEntries),
    });
  } catch (error) {
    console.warn("[Video & Comment Analyzer] Could not save UI translations:", error);
  }
}

function scheduleUiTranslation() {
  if (
    currentLanguageMode === "original" ||
    uiTranslationScheduled ||
    isUiTranslationRunning
  ) {
    return;
  }
  uiTranslationScheduled = true;
  setTimeout(() => {
    uiTranslationScheduled = false;
    translatePendingUiContent();
  }, 20);
}

async function translatePendingUiContent() {
  if (currentLanguageMode === "original" || isUiTranslationRunning) return;
  const pending = getPendingUiTranslations();
  if (!pending.length) return;

  isUiTranslationRunning = true;
  const generation = uiTranslationGeneration;
  const videoId = currentVideoId;
  setTranslatingSpinner(true);
  try {
    for (const batch of createUiTranslationBatches(pending)) {
      if (
        generation !== uiTranslationGeneration ||
        videoId !== currentVideoId ||
        currentLanguageMode === "original"
      ) {
        return;
      }
      const requestSegments = batch.map((record, index) => ({
        id: `ui-${index}`,
        text: record.original,
      }));
      let result;
      try {
        result = await sendTranslationMessage({
          action: "translateContent",
          content: { segments: requestSegments },
          contentType: "uiBatch",
          targetLanguage: "zh",
          videoTitle: currentVideoTitle,
        });
      } catch (error) {
        result = { success: false, error: error.message || "翻译失败" };
      }
      if (generation !== uiTranslationGeneration || videoId !== currentVideoId) {
        return;
      }
      const aligned = alignTranslatedSegmentBatch(
        requestSegments,
        result?.success ? result.translatedContent?.segments : [],
      );
      aligned.forEach((item, index) => {
        const cacheKey = batch[index].cacheKey;
        if (item.text) {
          uiTranslationCache.set(cacheKey, item.text);
          uiTranslationErrors.delete(cacheKey);
        } else {
          uiTranslationErrors.set(
            cacheKey,
            `${PANORAMA_COPY.error(result, "这段内容翻译未完成。")} 再次点击「中文」或「双语」可重试。`,
          );
        }
      });
      renderAllLocalizedContent();
    }
    await persistUiTranslationCache();
  } finally {
    isUiTranslationRunning = false;
    setTranslatingSpinner(false);
    if (currentLanguageMode !== "original" && getPendingUiTranslations().length) {
      scheduleUiTranslation();
    }
  }
}

function getOriginalTranscriptLabel() {
  const language = String(currentTranscriptLanguage || "").trim();
  return /^[A-Za-z0-9-]{1,20}$/.test(language)
    ? `原文（${language}）`
    : "原文";
}

function getActiveTranscriptSegments() {
  return groupTranscriptEntries(currentTranscript || []);
}

function transcriptTranslationCacheKey(segment) {
  return `${currentVideoId}:zh:semantic:${segment.id}`;
}

function renderTranscriptSegmentContent(segment, mode, translated, error) {
  const original = renderSubtitleInlineMarkup(segment.text);
  let translationHtml = "";
  if (translated) {
    translationHtml = renderSubtitleInlineMarkup(translated);
  } else if (error) {
    translationHtml = `${escapeHtml(PANORAMA_COPY.error(error, "这段字幕翻译未完成。"))}<button class="translation-retry-btn" type="button">重试翻译</button>`;
  } else {
    translationHtml = "等待翻译…";
  }

  if (mode === "bilingual") {
    return `<span class="transcript-copy"><span class="transcript-original">${original}</span><span class="transcript-translation ${translated ? "" : error ? "translation-error" : "translation-pending"}">${translationHtml}</span></span>`;
  }

  return `<span class="transcript-copy"><span class="transcript-translation ${translated ? "" : error ? "translation-error" : "translation-pending"}">${translationHtml}</span></span>`;
}

function renderTranscriptModeRows(segments, mode) {
  const transcriptList = document.getElementById("transcriptList");
  if (!transcriptList) return [];
  transcriptList.innerHTML = "";

  const existingBadge = document.getElementById("transcriptSourceBadge");
  if (existingBadge) existingBadge.remove();
  const badge = document.createElement("div");
  badge.id = "transcriptSourceBadge";
  badge.className = "transcript-source-badge";
  const originalLabel = getOriginalTranscriptLabel();
  const modeLabel =
    mode === "bilingual"
      ? `${originalLabel} + 简体中文`
      : `中文翻译 · ${originalLabel}`;
  badge.innerHTML = `<span class="source-dot source-dot--subs"></span> ${escapeHtml(currentTranscriptSource || "视频已有字幕")} · ${modeLabel}`;
  transcriptList.parentElement.insertBefore(badge, transcriptList);

  const rows = [];
  segments.forEach((segment, index) => {
    const div = document.createElement("div");
    const cached = transcriptParagraphCache.get(
      transcriptTranslationCacheKey(segment),
    );
    div.className = `transcript-entry ${cached ? "translated" : "translating"}`;
    div.dataset.seconds = segment.start;
    div.dataset.segmentId = segment.id;
    div.dataset.segmentIndex = index;

    const minutes = Math.floor(segment.start / 60);
    const seconds = Math.floor(segment.start % 60);
    const timestamp = `${minutes}:${String(seconds).padStart(2, "0")}`;
    div.innerHTML = `
      <span class="transcript-time">${timestamp}</span>
      ${renderTranscriptSegmentContent(segment, mode, cached, "")}
    `;
    div.addEventListener("click", (event) =>
      seekFromTranscriptEntryClick(event, segment.start),
    );
    transcriptList.appendChild(div);
    rows.push(div);
  });

  startPlaybackTracking();
  return rows;
}

/**
 * Rebuilds a provider response in source order. Unknown IDs are ignored and
 * missing IDs remain explicit errors, never positional guesses.
 */
function alignTranslatedSegmentBatch(sourceSegments, responseSegments) {
  const translatedById = new Map();
  if (Array.isArray(responseSegments)) {
    responseSegments.forEach((item) => {
      if (!item || typeof item.id !== "string" || typeof item.text !== "string")
        return;
      const text = item.text.trim();
      if (text && !translatedById.has(item.id)) {
        translatedById.set(item.id, text);
      }
    });
  }

  return sourceSegments.map((segment) => ({
    id: segment.id,
    text: translatedById.get(segment.id) || "",
    error: translatedById.has(segment.id) ? "" : "Translation unavailable.",
  }));
}

function updateTranslatedRow(segment, index, alignedItem, generation) {
  if (generation !== translationGeneration) return;
  const row = document.querySelector(
    `.transcript-entry[data-segment-id="${CSS.escape(segment.id)}"]`,
  );
  if (!row) return;

  if (alignedItem.text) {
    transcriptParagraphCache.set(
      transcriptTranslationCacheKey(segment),
      alignedItem.text,
    );
  }

  const copy = row.querySelector(".transcript-copy");
  if (copy) {
    copy.outerHTML = renderTranscriptSegmentContent(
      segment,
      currentLanguageMode,
      alignedItem.text,
      alignedItem.error,
    );
  }
  row.classList.toggle("translated", !!alignedItem.text);
  row.classList.toggle("translating", false);
  row.classList.toggle("translation-failed", !alignedItem.text);

  const retry = row.querySelector(".translation-retry-btn");
  if (retry) {
    ["mousedown", "mouseup"].forEach((eventName) => {
      retry.addEventListener(eventName, (event) => {
        event.preventDefault();
        event.stopPropagation();
      });
    });
    retry.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      retryTranslationSegment(index, generation);
    });
  }
}

let activeTranslationQueue = null;

async function requestTranscriptTranslationBatch(
  indices,
  segments,
  generation,
  videoId,
  mode,
) {
  const sourceBatch = indices.map((index) => segments[index]);
  setTranslatingSpinner(true);
  try {
    const result = await sendTranslationMessage({
      action: "translateContent",
      content: {
        segments: sourceBatch.map(({ id, text }) => ({ id, text })),
      },
      contentType: "transcriptBatch",
      targetLanguage: "zh",
      videoTitle: currentVideoTitle,
    });

    const isStale =
      generation !== translationGeneration ||
      videoId !== currentVideoId ||
      mode !== currentLanguageMode;
    if (isStale) return;

    const responseSegments = result?.success
      ? result.translatedContent?.segments
      : [];
    const aligned = alignTranslatedSegmentBatch(sourceBatch, responseSegments);
    const position = captureTranscriptPosition();
    aligned.forEach((item, batchIndex) => {
      if (!result?.success) {
        item.error = result?.error || "Translation failed.";
      }
      updateTranslatedRow(
        sourceBatch[batchIndex],
        indices[batchIndex],
        item,
        generation,
      );
    });
    restoreTranscriptPosition(position);
    await updateCache();
  } catch (error) {
    if (generation !== translationGeneration) return;
    sourceBatch.forEach((segment, batchIndex) => {
      updateTranslatedRow(
        segment,
        indices[batchIndex],
        { id: segment.id, text: "", error: error.message || "Translation failed." },
        generation,
      );
    });
  } finally {
    setTranslatingSpinner(false);
  }
}

function retryTranslationSegment(index, generation) {
  if (generation !== translationGeneration || !activeTranslationQueue) return;
  const row = document.querySelector(
    `.transcript-entry[data-segment-index="${index}"]`,
  );
  if (row) {
    row.classList.add("translating");
    row.classList.remove("translation-failed");
    const translation = row.querySelector(".transcript-translation");
    if (translation) {
      translation.className = "transcript-translation translation-pending";
      translation.textContent = "正在重试翻译…";
    }
  }
  activeTranslationQueue.enqueue(index, true);
}

/**
 * Renders immediately, translates the first small batch, then observes the
 * remaining rows. Batches are sequential so the provider is never flooded.
 */
async function translateTranscript() {
  const segments = getActiveTranscriptSegments();
  if (!segments.length || currentLanguageMode === "original") return;

  translationGeneration += 1;
  const generation = translationGeneration;
  const videoId = currentVideoId;
  const mode = currentLanguageMode;
  if (transcriptScrollObserver) transcriptScrollObserver.disconnect();

  const rows = renderTranscriptModeRows(segments, mode);
  const queue = [];
  const queued = new Set();
  let processing = false;

  const processNext = async () => {
    if (processing || queue.length === 0 || generation !== translationGeneration)
      return;
    processing = true;
    const indices = queue.splice(0, 3);
    indices.forEach((index) => queued.delete(index));
    try {
      await requestTranscriptTranslationBatch(
        indices,
        segments,
        generation,
        videoId,
        mode,
      );
    } finally {
      processing = false;
      if (queue.length && generation === translationGeneration) processNext();
    }
  };

  const enqueue = (index, force = false) => {
    if (!Number.isInteger(index) || !segments[index]) return;
    const cached = transcriptParagraphCache.has(
      transcriptTranslationCacheKey(segments[index]),
    );
    if ((!force && cached) || queued.has(index)) return;
    queue.push(index);
    queued.add(index);
    // Let all entries reported in the same viewport turn collect before the
    // worker starts, producing one small contextual multi-segment request.
    Promise.resolve().then(processNext);
  };
  activeTranslationQueue = { enqueue };

  transcriptScrollObserver = new IntersectionObserver(
    (observerEntries) => {
      observerEntries
        .filter((entry) => entry.isIntersecting)
        .sort(
          (a, b) =>
            Number(a.target.dataset.segmentIndex) -
            Number(b.target.dataset.segmentIndex),
        )
        .forEach((entry) => enqueue(Number(entry.target.dataset.segmentIndex)));
    },
    {
      root: document.getElementById("contentArea"),
      rootMargin: "320px 0px",
      threshold: 0,
    },
  );

  rows.forEach((row, index) => {
    if (!row.classList.contains("translated")) transcriptScrollObserver.observe(row);
    if (index < 3) enqueue(index);
  });
}

function setTranslatingSpinner(show) {
  if (show) translationWorkCount += 1;
  else translationWorkCount = Math.max(0, translationWorkCount - 1);
  const isTranslating = translationWorkCount > 0;
  const spinner = document.getElementById("langSpinner");
  if (spinner) spinner.classList.toggle("visible", isTranslating);
}

// Pure helpers are exposed for the repository's Node tests. The extension does
// not read this object at runtime.
globalThis.__YTD_TRANSCRIPT_TESTING__ = {
  sendTranslationMessage,
  groupTranscriptEntries,
  splitOversizedThought,
  alignTranslatedSegmentBatch,
  stableTextHash,
  uiTranslationCacheKey,
  createUiTranslationBatches,
  renderSubtitleInlineMarkup,
  renderTranscriptSegmentContent,
};
