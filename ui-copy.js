/* Shared user-facing wording. Provider error details remain in the background. */
var PANORAMA_COPY = (() => {
  const errors = {
    NO_AI_KEY: "请先打开设置，填写 DeepSeek API Key，再回来开始分析。",
    INVALID_AI_KEY: "DeepSeek API Key 未通过验证。请打开设置，检查是否复制完整、是否仍然有效。",
    NO_YOUTUBE_KEY: "获取 YouTube 评论需要 YouTube Data API Key。请在设置中填写该可选项，再回来重试；其他功能不受影响。",
    NO_SUPADATA_KEY: "未配置备用字幕服务。请先在 YouTube 打开「显示转录稿」后重试；也可在设置中填写可选的 Supadata API Key。",
    INVALID_SUPADATA_KEY: "Supadata API Key 未通过验证。请打开设置，检查是否复制完整、是否仍然有效。",
    COMMENTS_DISABLED: "这个视频已关闭评论，可以改为分析视频字幕。",
    YOUTUBE_QUOTA_EXCEEDED: "YouTube 评论获取额度已用完。请到 Google Cloud 查看配额，或等每日额度恢复后再试。",
    YOUTUBE_API_FORBIDDEN: "暂时无法获取 YouTube 评论。请确认 Google Cloud 项目已启用 YouTube Data API v3，并检查 API Key 的使用限制。",
    YOUTUBE_API_BAD_REQUEST: "YouTube 无法读取这次请求。请检查 YouTube Data API Key，并确认当前视频可以正常打开。",
    RATE_LIMITED: "服务暂时限制了请求次数。请稍后重试；如果反复出现，请检查该服务账户的剩余额度。",
    AI_IDLE_TIMEOUT: "DeepSeek 暂时没有响应，请稍后重试。",
    AI_HARD_TIMEOUT: "DeepSeek 分析等待时间过长，请稍后重试，或选择较短的内容。",
    AI_RESPONSE_TOO_LARGE: "分析结果过长，暂时无法显示。请选择较短的内容重试。",
    EMPTY_AI_RESPONSE: "DeepSeek 没有返回分析结果，请重试。",
  };
  function error(result, fallback = "操作未完成，请稍后重试。") {
    const values = typeof result === "string" ? [result] : [result?.code, result?.error, result?.message];
    for (const value of values) if (typeof errors[value] === "string") return errors[value];
    const message = typeof result === "string" ? result : result?.message || result?.error || "";
    if (typeof message === "string" && /[\u3400-\u9fff]/.test(message)) return message;
    const detail = values.filter(value => typeof value === "string").join(" ");
    if (/insufficient.*(?:balance|credit)|payment required|\b402\b/i.test(detail)) return "服务账户余额或可用额度不足。请到对应服务账户查看后再试。";
    if (/api.?key.*(?:not configured|invalid|not valid)|authentication|unauthorized/i.test(detail)) return "API Key 未配置或未通过验证。请打开设置，检查对应服务的密钥。";
    if (/rate.?limit|too many requests|\b429\b/i.test(detail)) return errors.RATE_LIMITED;
    if (/time.?out|timed out|inactive for|\d+-second limit/i.test(detail)) return "服务响应超时，请稍后重试。";
    if (/no.*transcript|empty.*transcript|NO_TRANSCRIPT|EMPTY_TRANSCRIPT/i.test(detail)) return "没有读取到字幕。请确认视频有字幕，或换一个视频重试。";
    if (/no youtube tab/i.test(detail)) return "请先打开一个 YouTube 视频，再使用字幕学习。";
    if (/failed to fetch|network|receiving end|message port|extension context invalidated/i.test(detail)) return "连接中断。请检查网络、刷新内容页面，再重新打开插件。";
    if (/empty response|no valid.*segments|unexpected token|JSON/i.test(detail)) return "服务没有返回可用结果，请重试。";
    return fallback;
  }
  const sentiments = { positive: "偏正面", negative: "偏负面", neutral: "中性", mixed: "褒贬不一" };
  return { error, sentiments };
})();
