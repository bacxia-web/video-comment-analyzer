/* A local-only entry point on supported content pages. Opening it does not
 * collect content, read API keys, or start an AI request. */
(() => {
  if (globalThis.__vcaLauncherInstalled) return;
  globalThis.__vcaLauncherInstalled = true;

  const host = document.createElement("div");
  host.id = "vca-launcher";
  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = `
    :host { all:initial !important; position:fixed !important; right:20px !important; bottom:24px !important; z-index:2147483646 !important; display:block !important; }
    :host([hidden]) { display:none !important; }
    * { box-sizing:border-box; }
    .wrap { position:relative; width:56px; height:56px; font:14px/1.5 system-ui,-apple-system,sans-serif; }
    button { appearance:none; margin:0; padding:0; cursor:pointer; font:inherit; }
    #vca-open { display:flex; align-items:center; justify-content:center; width:56px; height:56px; border:1px solid #8f3e2a; border-radius:50%; background:#a94e38; color:#fff; font-weight:650; box-shadow:0 3px 12px #322a2038; }
    #vca-open:hover { background:#8f3e2a; }
    #vca-open:active { transform:translateY(1px); }
    #vca-open:disabled { cursor:wait; }
    button:focus-visible { outline:3px solid #2968b4; outline-offset:3px; }
    #vca-dismiss { position:absolute; right:-6px; top:-8px; width:22px; height:22px; border:1px solid #a79c8b; border-radius:50%; background:#fff; color:#433b32; font-size:17px; opacity:0; pointer-events:none; }
    .wrap:hover #vca-dismiss, .wrap:focus-within #vca-dismiss { opacity:1; pointer-events:auto; }
    #vca-tip { position:absolute; right:0; bottom:68px; width:max-content; max-width:min(250px,calc(100vw - 40px)); padding:8px 12px; border:1px solid #ddd4c4; border-radius:8px; background:#fff; color:#2e2a24; box-shadow:0 3px 12px #322a201f; opacity:0; pointer-events:none; overflow-wrap:anywhere; }
    .wrap:hover #vca-tip, .wrap:focus-within #vca-tip, .wrap[data-feedback="true"] #vca-tip { opacity:1; }
    @media (max-width:400px) { :host { right:16px !important; bottom:20px !important; } }
  `;
  const wrap = document.createElement("div");
  wrap.className = "wrap";
  const open = document.createElement("button");
  open.id = "vca-open";
  open.type = "button";
  open.textContent = "分析";
  open.setAttribute("aria-label", "打开 Video & Comment Analyzer 分析面板");
  open.setAttribute("aria-describedby", "vca-tip");
  const dismiss = document.createElement("button");
  dismiss.id = "vca-dismiss";
  dismiss.type = "button";
  dismiss.textContent = "×";
  dismiss.setAttribute("aria-label", "在当前内容页隐藏悬浮球");
  const tip = document.createElement("div");
  tip.id = "vca-tip";
  tip.setAttribute("role", "status");
  tip.setAttribute("aria-live", "polite");
  wrap.append(open, dismiss, tip);
  shadow.append(style, wrap);

  let currentKey = "", dismissedKey = "", lastUrl = "", scheduled = null;
  function label(context) {
    return `${context.label}：${context.video && context.comments ? "分析视频或评论" : context.video ? "分析视频字幕" : "分析评论"}`;
  }
  function refresh() {
    lastUrl = location.href;
    const context = PANORAMA_PLATFORMS.parse(lastUrl);
    host.hidden = !context || context.key === dismissedKey || !!document.fullscreenElement;
    if (context && context.key !== currentKey) {
      currentKey = context.key;
      tip.textContent = label(context);
      wrap.dataset.feedback = "false";
    }
    if (!host.isConnected) document.documentElement.append(host);
  }
  open.addEventListener("click", async event => {
    if (!event.isTrusted || !PANORAMA_PLATFORMS.parse(location.href)) return;
    open.disabled = true;
    open.setAttribute("aria-busy", "true");
    tip.textContent = "正在打开分析面板…";
    wrap.dataset.feedback = "true";
    try {
      const result = await chrome.runtime.sendMessage({ action: "openAnalyzer" });
      if (!result?.success) throw new Error("open failed");
      const context = PANORAMA_PLATFORMS.parse(location.href);
      tip.textContent = context ? label(context) : "打开分析面板";
      wrap.dataset.feedback = "false";
    } catch {
      tip.textContent = "打开失败。请刷新页面重试，或点击浏览器工具栏里的插件图标。";
    } finally {
      open.disabled = false;
      open.removeAttribute("aria-busy");
    }
  });
  dismiss.addEventListener("click", () => {
    dismissedKey = PANORAMA_PLATFORMS.parse(location.href)?.key || "";
    refresh();
  });
  const scheduleRefresh = () => {
    if (scheduled) return;
    scheduled = setTimeout(() => { scheduled = null; refresh(); }, 150);
  };
  new MutationObserver(scheduleRefresh).observe(document.documentElement, { childList: true, subtree: true });
  for (const event of ["popstate", "hashchange", "pageshow", "yt-navigate-finish"]) window.addEventListener(event, refresh);
  document.addEventListener("fullscreenchange", refresh);
  // Covers pushState navigation even when a site's router does not change DOM.
  setInterval(() => { if (location.href !== lastUrl || !host.isConnected) refresh(); }, 800);
  refresh();
})();
