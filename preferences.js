const deepseekInput = document.getElementById("deepseekKey");
const youtubeInput = document.getElementById("youtubeKey");
const supadataInput = document.getElementById("supadataKey");
const saveStatus = document.getElementById("saveStatus");
async function loadPreferences() {
  const settings = await PANORAMA_SETUP.read();
  deepseekInput.value = settings.aiApiKey;
  youtubeInput.value = settings.youtubeApiKey;
  supadataInput.value = settings.supadataApiKey;
}
document.getElementById("preferencesForm").addEventListener("submit", async event => {
  event.preventDefault();
  const button = event.submitter;
  button.disabled = true;
  try {
    const values = [deepseekInput.value.trim(), youtubeInput.value.trim(), supadataInput.value.trim()];
    if (!values[0]) throw new Error("请填写必填的 DeepSeek API Key。");
    if (values.some(value => /\s/.test(value))) throw new Error("Key 不能包含空格或换行，请检查后再保存。");
    await chrome.storage.local.set({ [YTD_SETTINGS.STORAGE_KEY]: YTD_SETTINGS.normalize({
      aiApiKey: values[0], youtubeApiKey: values[1], supadataApiKey: values[2] }) });
    saveStatus.className = "success";
    saveStatus.textContent = "设置已保存，回到内容页面即可使用。";
  } catch (error) { saveStatus.className = "error"; saveStatus.textContent = error.message; }
  finally { button.disabled = false; }
});
document.getElementById("reveal").onclick = event => {
  const visible = deepseekInput.type === "password";
  deepseekInput.type = visible ? "text" : "password";
  event.target.textContent = visible ? "隐藏" : "显示";
  event.target.setAttribute("aria-pressed", String(visible));
};
document.getElementById("clearKeys").onclick = async () => {
  if (!confirm("清除本插件已保存的所有 API Key？再次分析时需要重新填写。")) return;
  try {
    await chrome.storage.local.set({ [YTD_SETTINGS.STORAGE_KEY]: YTD_SETTINGS.normalize() });
    await loadPreferences(); saveStatus.className = "success"; saveStatus.textContent = "已清除所有 Key。";
  } catch { saveStatus.className = "error"; saveStatus.textContent = "清除失败，请重试。"; }
};
(async () => {
  try { await loadPreferences(); }
  catch { saveStatus.className = "error"; saveStatus.textContent = "设置读取失败，请重新打开插件。"; }
})();
