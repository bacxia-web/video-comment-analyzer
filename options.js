const YTD_OPTIONS = (() => {
  const LANGUAGE_STORAGE_KEY = "ytd_options_language";
  const PREVIEW_STORAGE_PREFIX = "youtubeDigestPreview:";
  const SUPPORTED_LANGUAGES = new Set(["en", "zh-CN"]);

  const COPY = {
    en: {
      pageTitle: "Video & Comment Analyzer Settings",
      languageGroupLabel: "Interface language",
      heading: "API keys and saved data",
      lede:
        "Enter a DeepSeek API Key for AI analysis. Add YouTube and Supadata keys only for the features you need. Keys stay in this Chrome profile and are sent only to the corresponding service.",
      keyPlaceholder: "Paste the API Key from this service",
      youtubeEnableLink: "1. Enable YouTube Data API v3",
      transcriptProvider: "YouTube subtitles",
      supadataApiKeyLabel: "Supadata API Key (optional)",
      supadataHelp: "Optional fallback when YouTube page subtitles cannot be read. Translation and bilingual reading do not require this key. ",
      supadataLink: "Get a Supadata API Key",
      supadataHelpSuffix:
        ". Copy the key from your Supadata account and paste it above.",
      supadataQuota: "Free plan: 100 credits per month, no credit card needed. Fetching existing subtitles costs 1 credit per request, so this allows about 100 requests. Unavailable subtitles may still cost a credit. Unused credits do not carry over. This extension does not transcribe videos without subtitles. ",
      officialPricing: "Official pricing and quota",
      officialQuota: "Official quota",
      requestCost: "Request cost",
      quotaChecked: "Quota information checked on September 21, 2026; your provider account shows the current allowance. These quotas do not cover DeepSeek AI analysis fees.",
      commentsProvider: "YouTube comments",
      youtubeApiKeyLabel: "YouTube Data API Key (optional)",
      youtubeApiHelp:
        "Needed only to fetch YouTube comments and replies. Other features work without it. Select or create a Google Cloud project, then complete these steps: ",
      youtubeApiLink: "2. Create an API Key",
      youtubeApiHelpSuffix: ". Paste the key above.",
      youtubeQuota: "Default free quota: 10,000 units per project per day. One request costs 1 unit and returns up to 100 top-level comments. More pages and replies use additional units. Other calls in the same project may share this quota. ",
      aiProvider: "AI analysis",
      providerSummaryLabel: "AI service",
      providerBadge: "Already configured",
      deepseekApiKeyLabel: "DeepSeek API Key (required for AI)",
      deepseekHelp:
        "Used for summaries, comment analysis, translation, explanations, and note cleanup. Usage is billed to your DeepSeek account. ",
      deepseekLink: "Get a DeepSeek API Key",
      deepseekHelpSuffix: ".",
      privacyNote:
        "AI features send the relevant subtitles, comments, or selected text to DeepSeek. Saving a key stores it locally; it does not check whether the key works.",
      saveSettings: "Save settings",
      localRemix: "Advanced",
      customizationTitle: "Change the AI service (requires code changes)",
      customizationPurpose: "Optional instructions for an AI coding assistant",
      agentBadge: "Code changes required",
      customizationIntro:
        "You can skip this section for normal use. To change the AI service, give the instructions below to an AI coding assistant:",
      customizationStepFolder:
        "Open the extracted Video & Comment Analyzer project folder in your coding agent.",
      customizationStepReplace:
        "Replace [PROVIDER] and [MODEL] with the service and model you want to use.",
      customizationStepKeys:
        "Never include API keys in the prompt or chat. Enter them yourself after the code is ready.",
      customizationPromptLabel: "Editable customization prompt",
      customizationReminderLabel: "Prompt reminder",
      customizationReminder:
        "Before copying, replace [PROVIDER] and [MODEL] with the provider and model you want to use.",
      customizationPrompt:
        "Customize this local Video & Comment Analyzer workspace to use [PROVIDER] with [MODEL]. Work only in the current workspace. Before editing, verify that it contains manifest.json and that the manifest name is Video & Comment Analyzer. If verification fails, stop and ask me to open the extracted Video & Comment Analyzer project folder in my coding agent. Do not search other folders, edit a guessed copy, assume an installation path, or claim Chrome can reveal the absolute OS source path. Update the provider's API endpoint, request format, and minimum Chrome host permissions. Preserve bring-your-own-key and local Chrome storage. Never put API keys in source code, commits, logs, screenshots, this prompt, or chat; after the code is ready, tell me where to enter the key myself. Keep DeepSeek-only request fields and retry behavior isolated to DeepSeek. Handle provider-specific rules separately so one provider does not affect another. Update README.md, README.zh-CN.md, PRIVACY.md, SECURITY.md, and tests. Run npm test, npm run check, and npm run package. Then explain how to reload the unpacked extension and test it on a real YouTube video.",
      copyCustomizationPrompt: "Copy edited prompt",
      localData: "Saved learning data",
      localDataHelp:
        "Subtitle study saves subtitles, summaries, comment results, translations, and notes in this Chrome profile. Clearing saved results may require fetching or analyzing them again, using service quota.",
      clearCache: "Clear saved learning results and translations",
      deleteNotes: "Delete all clip notes",
      resetData: "Delete all extension data",
      footer:
        'Read <a href="PRIVACY.md" target="_blank">PRIVACY.md</a> in the repository for the complete data-flow description.',
      migrationWarning:
        "Custom provider settings were removed safely. Your Supadata key was kept, but the AI key was cleared. Enter a DeepSeek API key to continue.",
      saving: "Saving…",
      saved: "Settings saved locally. Return to the content page to continue. Keys are checked when you use a service.",
      saveFailed: "Could not save settings. Please try again.",
      copying: "Copying…",
      promptCopied: "Edited prompt copied.",
      copyFailed:
        "Could not copy the prompt. Select the prompt text and copy it manually.",
      clearedDigests: ({ count }) =>
        `Cleared ${count} cached result${count === 1 ? "" : "s"}.`,
      notesDeleted: "Deleted all saved notes.",
      resetConfirm:
        "Delete all API keys, saved learning results, translations, and clip notes from this Chrome profile? This cannot be undone.",
      allDataDeleted: "All Video & Comment Analyzer data was deleted.",
      settingsLoadFailed:
        "Could not read your saved settings. Reopen this page before entering replacement keys.",
    },
    "zh-CN": {
      pageTitle: "Video & Comment Analyzer 设置",
      languageGroupLabel: "界面语言",
      heading: "服务密钥与数据管理",
      lede:
        "AI 分析需要 DeepSeek API Key（服务密钥）。YouTube 和 Supadata 按需要填写。密钥保存在当前 Chrome 中，只发送给对应服务商。",
      keyPlaceholder: "粘贴从对应服务复制的 API Key",
      youtubeEnableLink: "1. 启用 YouTube Data API v3",
      transcriptProvider: "YouTube 字幕",
      supadataApiKeyLabel: "Supadata API Key（可选）",
      supadataHelp: "读取 YouTube 网页字幕失败时的备用服务；翻译和中英对照不强制要求此密钥。",
      supadataLink: "申请 Supadata API Key",
      supadataHelpSuffix: "，复制后粘贴到上方输入框。",
      supadataQuota: "免费方案：每月 100 积分，无需信用卡。获取一次已有字幕消耗 1 积分，约可请求 100 次；未找到字幕也可能扣除积分。未用完的积分不累计到下月。插件不会把无字幕视频转写成文字。",
      officialPricing: "官方定价与额度 ↗",
      officialQuota: "官方额度说明 ↗",
      requestCost: "请求用量说明 ↗",
      quotaChecked: "额度信息核实于 2026-09-21，以服务商账户显示为准；以上额度不包含 DeepSeek 的 AI 分析费用。",
      commentsProvider: "YouTube 评论",
      youtubeApiKeyLabel: "YouTube Data API Key（可选）",
      youtubeApiHelp:
        "只在获取 YouTube 评论和回复时需要，不影响其他功能。在 Google Cloud 选择或创建项目后，按顺序完成：",
      youtubeApiLink: "2. 创建 API Key",
      youtubeApiHelpSuffix: "，复制后粘贴到上方输入框。",
      youtubeQuota: "默认免费额度：每个项目每天 10,000 单位。一次请求消耗 1 单位，最多获取 100 条主评论。获取更多评论、补充回复会继续消耗额度；同一项目的其他调用也可能共用额度。",
      aiProvider: "AI 分析",
      providerSummaryLabel: "AI 服务",
      providerBadge: "已预设，无需配置",
      deepseekApiKeyLabel: "DeepSeek API Key（AI 分析必填）",
      deepseekHelp:
        "用于生成摘要、分析评论、翻译、解释内容和润色笔记，按你的 DeepSeek 账户计费。",
      deepseekLink: "申请 DeepSeek API Key",
      deepseekHelpSuffix: "。",
      privacyNote:
        "使用 AI 功能时，相关字幕、评论或选中的文字会发送给 DeepSeek。保存设置不会验证密钥，可用性会在使用时检查。",
      saveSettings: "保存设置",
      localRemix: "高级选项",
      customizationTitle: "更换 AI 服务（需要修改代码）",
      customizationPurpose: "可选：将下面的说明交给 AI 编程助手",
      agentBadge: "需要修改代码",
      customizationIntro: "日常使用可以跳过此项。如需更换 AI 服务，请把下面的说明交给 AI 编程助手：",
      customizationStepFolder:
        "在编程 Agent 中打开 Video & Comment Analyzer 解压后的项目文件夹。",
      customizationStepReplace:
        "把 [PROVIDER] 和 [MODEL] 替换成你想使用的服务和模型。",
      customizationStepKeys:
        "不要在提示词或聊天中加入 API 密钥。代码准备好后，请自行填写。",
      customizationPromptLabel: "可编辑的自定义提示词",
      customizationReminderLabel: "提示词提醒",
      customizationReminder:
        "复制前，请先把 [PROVIDER] 和 [MODEL] 替换成你想使用的服务和模型。",
      customizationPrompt:
        "请把当前本地 Video & Comment Analyzer 工作区改为使用 [PROVIDER] 提供的 [MODEL]。只在当前工作区中操作。编辑前，先确认其中包含 manifest.json，且 manifest 中的 name 是 Video & Comment Analyzer。如果验证失败，请停止，并让我在编程 Agent 中打开 Video & Comment Analyzer 解压后的项目文件夹。不要搜索其他文件夹，不要编辑猜测的副本，不要假设安装路径，也不要声称 Chrome 可以显示操作系统中的绝对源码路径。更新该服务的 API endpoint、请求格式和最少的 Chrome host permissions。保留用户自带密钥模式和 Chrome 本地存储。不要把 API 密钥写入源代码、提交记录、日志、截图、这段提示词或聊天；代码准备好后，请告诉我应该在哪里自行填写密钥。DeepSeek 专用的请求参数和重试逻辑继续只用于 DeepSeek。新服务的专属规则请单独处理，避免相互影响。更新 README.md、README.zh-CN.md、PRIVACY.md、SECURITY.md 和测试。运行 npm test、npm run check 和 npm run package。最后，说明如何重新加载已解压的扩展，并在真实 YouTube 视频上测试。",
      copyCustomizationPrompt: "复制编辑后的提示词",
      localData: "已保存的学习内容",
      localDataHelp:
        "字幕学习会在当前 Chrome 中保存字幕、摘要、评论结果、翻译和笔记。清除后，再次获取或分析内容可能重新消耗服务额度。",
      clearCache: "清除学习结果和翻译缓存",
      deleteNotes: "删除全部片段笔记",
      resetData: "删除插件全部数据",
      footer:
        '完整数据流说明请参阅仓库中的 <a href="PRIVACY.md" target="_blank">PRIVACY.md</a>。',
      migrationWarning:
        "已安全移除自定义服务设置。Supadata 密钥已保留，AI 密钥已清除。请输入 DeepSeek API 密钥以继续使用。",
      saving: "正在保存…",
      saved: "设置已保存到本机。返回内容页面后继续使用，密钥是否可用会在调用时检查。",
      saveFailed: "无法保存设置，请重试。",
      copying: "正在复制…",
      promptCopied: "已复制编辑后的提示词。",
      copyFailed: "无法复制提示词。请选中提示词文本并手动复制。",
      clearedDigests: ({ count }) => `已清除 ${count} 条缓存结果。`,
      notesDeleted: "已删除全部已保存的笔记。",
      resetConfirm:
        "删除当前 Chrome 中的全部服务密钥、学习结果、翻译和片段笔记？此操作无法撤销。",
      allDataDeleted: "已删除全部 Video & Comment Analyzer 数据。",
      settingsLoadFailed: "未能读取已保存的设置。请重新打开此页面，不需要立即重新申请密钥。",
    },
  };

  function normalizeLanguage(language) {
    return SUPPORTED_LANGUAGES.has(language) ? language : "en";
  }

  function translate(language, key, params = {}) {
    const normalizedLanguage = normalizeLanguage(language);
    const value = COPY[normalizedLanguage][key] ?? COPY.en[key] ?? "";
    return typeof value === "function" ? value(params) : value;
  }

  function createStorageAdapter(chromeApi, fallbackStorage) {
    const chromeStorage = chromeApi?.storage?.local;
    const memoryStorage = new Map();

    function fallbackKeys() {
      const keys = [];
      if (!fallbackStorage) return keys;
      try {
        for (let index = 0; index < fallbackStorage.length; index += 1) {
          const key = fallbackStorage.key(index);
          if (key?.startsWith(PREVIEW_STORAGE_PREFIX)) keys.push(key);
        }
      } catch (_error) {
        return [];
      }
      return keys;
    }

    function readFallbackValue(key) {
      try {
        const rawValue = fallbackStorage?.getItem(
          `${PREVIEW_STORAGE_PREFIX}${key}`,
        );
        if (rawValue !== null && rawValue !== undefined) {
          return JSON.parse(rawValue);
        }
      } catch (_error) {
        // Fall through to memory when localStorage is unavailable or malformed.
      }
      return memoryStorage.get(key);
    }

    function writeFallbackValue(key, value) {
      memoryStorage.set(key, value);
      try {
        fallbackStorage?.setItem(
          `${PREVIEW_STORAGE_PREFIX}${key}`,
          JSON.stringify(value),
        );
      } catch (_error) {
        // The in-memory copy keeps a restricted preview functional.
      }
    }

    return {
      async get(keys) {
        if (chromeStorage) return chromeStorage.get(keys);

        const requestedKeys =
          keys === null
            ? [
                ...new Set([
                  ...memoryStorage.keys(),
                  ...fallbackKeys().map((key) =>
                    key.slice(PREVIEW_STORAGE_PREFIX.length),
                  ),
                ]),
              ]
            : Array.isArray(keys)
              ? keys
              : [keys];

        return Object.fromEntries(
          requestedKeys
            .map((key) => [key, readFallbackValue(key)])
            .filter(([, value]) => value !== undefined),
        );
      },

      async set(items) {
        if (chromeStorage) return chromeStorage.set(items);
        for (const [key, value] of Object.entries(items)) {
          writeFallbackValue(key, value);
        }
      },

      async remove(keys) {
        if (chromeStorage) return chromeStorage.remove(keys);
        for (const key of Array.isArray(keys) ? keys : [keys]) {
          memoryStorage.delete(key);
          try {
            fallbackStorage?.removeItem(`${PREVIEW_STORAGE_PREFIX}${key}`);
          } catch (_error) {
            // Memory removal is sufficient for this preview session.
          }
        }
      },

      async clear() {
        if (chromeStorage) return chromeStorage.clear();
        memoryStorage.clear();
        for (const key of fallbackKeys()) {
          try {
            fallbackStorage.removeItem(key);
          } catch (_error) {
            // Continue clearing any remaining preview keys.
          }
        }
      },
    };
  }

  async function readPreferredLanguage(storage) {
    const stored = await storage.get(LANGUAGE_STORAGE_KEY);
    return normalizeLanguage(stored[LANGUAGE_STORAGE_KEY]);
  }

  async function persistPreferredLanguage(storage, language) {
    const normalizedLanguage = normalizeLanguage(language);
    await storage.set({ [LANGUAGE_STORAGE_KEY]: normalizedLanguage });
    return normalizedLanguage;
  }

  function updateLanguageButtonState(buttons, language) {
    const normalizedLanguage = normalizeLanguage(language);
    for (const button of buttons) {
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.language === normalizedLanguage),
      );
    }
  }

  function updateLocalizedPrompt(textarea, prompt) {
    const selectionStart = textarea.selectionStart;
    const selectionEnd = textarea.selectionEnd;
    const selectionDirection = textarea.selectionDirection;
    const scrollTop = textarea.scrollTop;
    const scrollLeft = textarea.scrollLeft;

    textarea.value = prompt;

    if (
      Number.isInteger(selectionStart) &&
      Number.isInteger(selectionEnd) &&
      typeof textarea.setSelectionRange === "function"
    ) {
      textarea.setSelectionRange(
        Math.min(selectionStart, prompt.length),
        Math.min(selectionEnd, prompt.length),
        selectionDirection || "none",
      );
    }
    textarea.scrollTop = scrollTop;
    textarea.scrollLeft = scrollLeft;
  }

  function createPromptDrafts() {
    return {
      en: translate("en", "customizationPrompt"),
      "zh-CN": translate("zh-CN", "customizationPrompt"),
    };
  }

  function switchPromptDraft(
    drafts,
    currentLanguage,
    nextLanguage,
    currentValue,
  ) {
    const normalizedCurrentLanguage = normalizeLanguage(currentLanguage);
    const normalizedNextLanguage = normalizeLanguage(nextLanguage);
    drafts[normalizedCurrentLanguage] = String(currentValue ?? "");
    if (typeof drafts[normalizedNextLanguage] !== "string") {
      drafts[normalizedNextLanguage] = translate(
        normalizedNextLanguage,
        "customizationPrompt",
      );
    }
    return {
      language: normalizedNextLanguage,
      prompt: drafts[normalizedNextLanguage],
    };
  }

  async function copyPromptValue(clipboard, value) {
    await clipboard.writeText(value);
  }

  function getSafeLocalStorage(root) {
    try {
      return root.localStorage;
    } catch (_error) {
      return null;
    }
  }

  function initialize(root = globalThis) {
    const doc = root.document;
    const settingsApi = root.YTD_SETTINGS;
    if (!doc || !settingsApi) return;

    const storage = createStorageAdapter(
      root.chrome,
      getSafeLocalStorage(root),
    );
    const form = doc.getElementById("settingsForm");
    const aiApiKeyInput = doc.getElementById("aiApiKey");
    const supadataApiKeyInput = doc.getElementById("supadataApiKey");
    const youtubeApiKeyInput = doc.getElementById("youtubeApiKey");
    const customizationPrompt = doc.getElementById("customizationPrompt");
    const copyCustomizationPromptBtn = doc.getElementById(
      "copyCustomizationPromptBtn",
    );
    const copyStatus = doc.getElementById("copyStatus");
    const saveStatus = doc.getElementById("saveStatus");
    const dataStatus = doc.getElementById("dataStatus");
    const languageButtons = [...doc.querySelectorAll("[data-language]")];
    const statusStates = new Map();
    const promptDrafts = createPromptDrafts();
    let currentLanguage = "en";

    function renderStatus(element) {
      const state = statusStates.get(element);
      element.textContent = state
        ? translate(currentLanguage, state.key, state.params)
        : "";
    }

    function setStatus(element, key, params = {}) {
      statusStates.set(element, { key, params });
      renderStatus(element);
    }

    function applyLanguage(language) {
      const nextDraft = switchPromptDraft(
        promptDrafts,
        currentLanguage,
        language,
        customizationPrompt.value,
      );
      currentLanguage = nextDraft.language;
      doc.documentElement.lang = currentLanguage;
      doc.title = translate(currentLanguage, "pageTitle");

      for (const element of doc.querySelectorAll("[data-i18n]")) {
        element.textContent = translate(
          currentLanguage,
          element.dataset.i18n,
        );
      }
      for (const element of doc.querySelectorAll("[data-i18n-placeholder]")) {
        element.placeholder = translate(currentLanguage, element.dataset.i18nPlaceholder);
      }
      for (const element of doc.querySelectorAll("[data-i18n-html]")) {
        element.innerHTML = translate(
          currentLanguage,
          element.dataset.i18nHtml,
        );
      }
      for (const element of doc.querySelectorAll("[data-i18n-aria-label]")) {
        element.setAttribute(
          "aria-label",
          translate(currentLanguage, element.dataset.i18nAriaLabel),
        );
      }

      updateLocalizedPrompt(
        customizationPrompt,
        nextDraft.prompt,
      );
      updateLanguageButtonState(languageButtons, currentLanguage);
      for (const element of statusStates.keys()) renderStatus(element);
    }

    async function loadSettings() {
      try {
        const stored = await storage.get(settingsApi.STORAGE_KEY);
        const migration = settingsApi.migrateLegacyCustom(
          stored[settingsApi.STORAGE_KEY],
        );
        const settings = migration.settings;

        aiApiKeyInput.value = settings.aiApiKey;
        supadataApiKeyInput.value = settings.supadataApiKey;
        youtubeApiKeyInput.value = settings.youtubeApiKey;
        if (migration.migrated) {
          await storage.set({ [settingsApi.STORAGE_KEY]: settings });
          setStatus(saveStatus, "migrationWarning");
        }
      } catch (_error) {
        setStatus(saveStatus, "settingsLoadFailed");
      }
    }

    async function loadOptions() {
      try {
        applyLanguage(await readPreferredLanguage(storage));
      } catch (_error) {
        applyLanguage("en");
      }
      await loadSettings();
    }

    async function saveSettings(event) {
      event.preventDefault();
      setStatus(saveStatus, "saving");

      const settings = settingsApi.normalize({
        aiApiKey: aiApiKeyInput.value,
        supadataApiKey: supadataApiKeyInput.value,
        youtubeApiKey: youtubeApiKeyInput.value,
      });

      try {
        await storage.set({ [settingsApi.STORAGE_KEY]: settings });
        setStatus(saveStatus, "saved");
      } catch (_error) {
        setStatus(saveStatus, "saveFailed");
      }
    }

    async function copyCustomizationPrompt() {
      setStatus(copyStatus, "copying");
      try {
        await copyPromptValue(
          root.navigator.clipboard,
          customizationPrompt.value,
        );
        setStatus(copyStatus, "promptCopied");
      } catch (_error) {
        setStatus(copyStatus, "copyFailed");
      }
    }

    async function clearCachedDigests() {
      const all = await storage.get(null);
      const keys = Object.keys(all).filter(
        (key) =>
          key.startsWith("digest_") ||
          key.startsWith("comments_") ||
          key === "ytd_ui_translation_cache",
      );
      if (keys.length) await storage.remove(keys);
      setStatus(dataStatus, "clearedDigests", { count: keys.length });
    }

    async function clearNotes() {
      await storage.remove("ytd_notes");
      setStatus(dataStatus, "notesDeleted");
    }

    async function resetAllData() {
      const confirmed = root.confirm(
        translate(currentLanguage, "resetConfirm"),
      );
      if (!confirmed) return;

      await storage.clear();
      await persistPreferredLanguage(storage, currentLanguage);
      await loadSettings();
      setStatus(dataStatus, "allDataDeleted");
    }

    form.addEventListener("submit", saveSettings);
    copyCustomizationPromptBtn.addEventListener(
      "click",
      copyCustomizationPrompt,
    );
    doc
      .getElementById("clearCacheBtn")
      .addEventListener("click", clearCachedDigests);
    doc.getElementById("clearNotesBtn").addEventListener("click", clearNotes);
    doc.getElementById("resetBtn").addEventListener("click", resetAllData);
    for (const button of languageButtons) {
      button.addEventListener("click", async () => {
        const language = button.dataset.language;
        applyLanguage(language);
        await persistPreferredLanguage(storage, language);
      });
    }

    if (doc.readyState === "loading") {
      doc.addEventListener("DOMContentLoaded", loadOptions, { once: true });
    } else {
      void loadOptions();
    }
  }

  return {
    COPY,
    LANGUAGE_STORAGE_KEY,
    copyPromptValue,
    createPromptDrafts,
    createStorageAdapter,
    normalizeLanguage,
    persistPreferredLanguage,
    readPreferredLanguage,
    translate,
    updateLanguageButtonState,
    updateLocalizedPrompt,
    switchPromptDraft,
    initialize,
  };
})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = YTD_OPTIONS;
}

if (typeof document !== "undefined") {
  YTD_OPTIONS.initialize();
}
