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
    if (!values[0]) throw new Error("DeepSeek API Key 为必填项。请先申请密钥，再粘贴到上方输入框。");
    if (values.some(value => /\s/.test(value))) throw new Error("密钥中不能有空格或换行。请重新复制完整的 API Key 后保存。");
    await chrome.storage.local.set({ [YTD_SETTINGS.STORAGE_KEY]: YTD_SETTINGS.normalize({
      aiApiKey: values[0], youtubeApiKey: values[1], supadataApiKey: values[2] }) });
    saveStatus.className = "success";
    saveStatus.textContent = "设置已保存。回到要分析的网页，点击「开始分析」。";
  } catch (error) { saveStatus.className = "error"; saveStatus.textContent = /[\u3400-\u9fff]/.test(error.message) ? error.message : "设置未保存，请重新打开设置页面后再试。"; }
  finally { button.disabled = false; }
});
document.getElementById("reveal").onclick = event => {
  const visible = deepseekInput.type === "password";
  deepseekInput.type = visible ? "text" : "password";
  event.target.textContent = visible ? "隐藏" : "显示";
  event.target.setAttribute("aria-pressed", String(visible));
};
document.getElementById("clearKeys").onclick = async () => {
  if (!confirm("清除 DeepSeek、YouTube 和 Supadata 的全部密钥？以后使用相关功能时需要重新填写；已有笔记和学习缓存会保留。")) return;
  try {
    await chrome.storage.local.set({ [YTD_SETTINGS.STORAGE_KEY]: YTD_SETTINGS.normalize() });
    await loadPreferences(); saveStatus.className = "success"; saveStatus.textContent = "服务密钥已清除。再次使用 AI 分析前，请填写 DeepSeek API Key。";
  } catch { saveStatus.className = "error"; saveStatus.textContent = "清除失败，请重试。"; }
};
(async () => {
  try { await loadPreferences(); }
  catch { saveStatus.className = "error"; saveStatus.textContent = "未能读取已保存的设置。请重新打开此页面，不需要立即重新申请密钥。"; }
})();
