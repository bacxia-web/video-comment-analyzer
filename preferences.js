const deepseekInput = document.getElementById("deepseekKey");
const youtubeInput = document.getElementById("youtubeKey");
const supadataInput = document.getElementById("supadataKey");
const saveStatus = document.getElementById("saveStatus");
const xhsInputs = { maxComments: document.getElementById("xhsMaxComments"), maxRounds: document.getElementById("xhsMaxRounds"), idleRounds: document.getElementById("xhsIdleRounds") };
const xhsSaveStatus = document.getElementById("xhsSaveStatus");
async function loadXhsPreferences() {
  const stored = await chrome.storage.local.get(YTD_SETTINGS.XHS_STORAGE_KEY);
  const settings = YTD_SETTINGS.normalizeXhs(stored[YTD_SETTINGS.XHS_STORAGE_KEY]);
  for (const [key, input] of Object.entries(xhsInputs)) input.value = settings[key];
  if (location.hash === "#xiaohongshuSettings") document.getElementById("xiaohongshuSettings").open = true;
}
document.getElementById("xhsSettingsForm").addEventListener("submit", async event => {
  event.preventDefault();
  const values = Object.fromEntries(Object.entries(xhsInputs).map(([key, input]) => [key, Number(input.value)]));
  if (Object.entries(values).some(([key, value]) => !Number.isInteger(value) || value < YTD_SETTINGS.XHS_LIMITS[key].min || value > YTD_SETTINGS.XHS_LIMITS[key].max)) return;
  xhsSaveStatus.textContent = "正在保存…";
  try {
    await chrome.storage.local.set({ [YTD_SETTINGS.XHS_STORAGE_KEY]: values });
    xhsSaveStatus.className = "success";
    xhsSaveStatus.textContent = "获取设置已保存，下次开始或继续获取时生效。";
  } catch { xhsSaveStatus.className = "error"; xhsSaveStatus.textContent = "未能保存，请重试。"; }
});
document.getElementById("resetXhsSettings").onclick = () => {
  for (const [key, input] of Object.entries(xhsInputs)) input.value = YTD_SETTINGS.XHS_LIMITS[key].default;
  xhsSaveStatus.textContent = "已填入默认值，点击「保存获取设置」后生效。";
};
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
  try { await loadPreferences(); await loadXhsPreferences(); }
  catch { saveStatus.className = "error"; saveStatus.textContent = "未能读取已保存的设置。请重新打开此页面，不需要立即重新申请密钥。"; }
})();
