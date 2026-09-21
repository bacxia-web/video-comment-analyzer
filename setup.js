/* One first-use dialog shared by the side panel and settings page. */
var PANORAMA_SETUP = (() => {
  const applicationUrl = "https://platform.deepseek.com/api_keys";
  async function read() {
    const data = await chrome.storage.local.get(YTD_SETTINGS.STORAGE_KEY);
    return YTD_SETTINGS.normalize(data[YTD_SETTINGS.STORAGE_KEY] || {});
  }
  async function saveKey(key) {
    const value = key.trim();
    if (!value || /\s/.test(value)) throw new Error("请输入完整的 DeepSeek API Key，不能包含空格。");
    const current = await read();
    await chrome.storage.local.set({ [YTD_SETTINGS.STORAGE_KEY]: YTD_SETTINGS.normalize({ ...current, aiApiKey: value }) });
  }
  let pending;
  function ensure() {
    if (pending) return pending;
    pending = (async () => {
      if ((await read()).aiApiKey) return true;
      return new Promise(resolve => {
        const dialog = document.createElement("dialog");
        dialog.id = "keyDialog";
        dialog.setAttribute("aria-labelledby", "setupTitle");
        // Constant extension markup only. All page/model content uses textContent.
        dialog.innerHTML = `<form id="setupForm"><h2 id="setupTitle">先连接 DeepSeek</h2>
          <p class="muted">填一次 Key，就能分析字幕和评论。以后可以在设置中修改。</p>
          <label for="setupKey">DeepSeek API Key</label><input id="setupKey" type="password" autocomplete="off" spellcheck="false" required>
          <p class="help"><a href="${applicationUrl}" target="_blank" rel="noopener noreferrer">申请 DeepSeek API Key ↗</a></p>
          <p class="muted fine">Key 仅保存在此浏览器本地。分析时会调用你的 DeepSeek 账户。</p>
          <p id="setupError" class="error" role="alert"></p><div class="actions"><button type="submit" class="primary">保存并开始</button><button type="button" id="setupLater">稍后填写</button></div></form>`;
        document.body.append(dialog);
        const finish = value => { dialog.close(); dialog.remove(); resolve(value); };
        dialog.querySelector("#setupLater").onclick = () => finish(false);
        dialog.addEventListener("cancel", event => { event.preventDefault(); finish(false); });
        dialog.querySelector("form").onsubmit = async event => {
          event.preventDefault();
          const button = dialog.querySelector('[type="submit"]');
          button.disabled = true;
          try { await saveKey(dialog.querySelector("input").value); finish(true); }
          catch (error) { dialog.querySelector("#setupError").textContent = error.message; button.disabled = false; }
        };
        dialog.showModal();
      });
    })().finally(() => { pending = null; });
    return pending;
  }
  return { read, saveKey, ensure };
})();
