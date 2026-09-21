/* Shared settings access. Missing AI credentials are entered on the settings page. */
var PANORAMA_SETUP = (() => {
  async function read() {
    const data = await chrome.storage.local.get(YTD_SETTINGS.STORAGE_KEY);
    return YTD_SETTINGS.normalize(data[YTD_SETTINGS.STORAGE_KEY] || {});
  }
  async function ensure() {
    if ((await read()).aiApiKey) return true;
    await chrome.runtime.openOptionsPage();
    return false;
  }
  return { read, ensure };
})();
