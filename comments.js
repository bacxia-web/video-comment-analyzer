/**
 * Pure helpers for YouTube comment collection and analysis.
 *
 * Network access stays in background.js. Keeping normalization and validation
 * here makes model and API responses testable as untrusted input.
 */
var YTD_COMMENTS = (() => {
  const MAX_FETCHED_COMMENTS = 1000;
  const MAX_ANALYSIS_COMMENTS = 400;

  const cleanText = (value, maxLength) =>
    typeof value === "string"
      ? value.replace(/\s+/g, " ").trim().slice(0, maxLength)
      : "";

  function normalizeApiComment(comment, parentCommentId = null) {
    const snippet = comment?.snippet;
    const id = cleanText(comment?.id, 200);
    const text = cleanText(snippet?.textOriginal || snippet?.textDisplay, 5000);
    if (!id || !snippet || !text) return null;

    return {
      id,
      parentCommentId: parentCommentId
        ? cleanText(parentCommentId, 200)
        : null,
      author: cleanText(snippet.authorDisplayName, 200),
      text,
      likeCount: Math.max(0, Math.floor(Number(snippet.likeCount) || 0)),
      publishedAt: cleanText(snippet.publishedAt, 80),
    };
  }

  function calculateStats(comments) {
    const safe = Array.isArray(comments) ? comments : [];
    const authors = new Set(safe.map((comment) => comment.author).filter(Boolean));
    const topLevelCount = safe.filter((comment) => !comment.parentCommentId).length;
    const totalLikes = safe.reduce(
      (sum, comment) => sum + Math.max(0, Number(comment.likeCount) || 0),
      0,
    );
    return {
      total: safe.length,
      topLevel: topLevelCount,
      replies: Math.max(0, safe.length - topLevelCount),
      authors: authors.size,
      totalLikes,
    };
  }

  /**
   * Preserve highly endorsed comments, then spread the remaining sample across
   * the fetched order so a long discussion is not represented only by page 1.
   */
  function selectForAnalysis(comments, limit = MAX_ANALYSIS_COMMENTS) {
    const safe = Array.isArray(comments) ? comments.filter(Boolean) : [];
    const safeLimit = Math.max(1, Math.floor(Number(limit) || 1));
    if (safe.length <= safeLimit) return [...safe];

    const priorityCount = Math.min(Math.floor(safeLimit / 3), safe.length);
    const prioritized = [...safe]
      .sort((a, b) => (b.likeCount || 0) - (a.likeCount || 0))
      .slice(0, priorityCount);
    const selectedIds = new Set(prioritized.map((comment) => comment.id));
    const remaining = safe.filter((comment) => !selectedIds.has(comment.id));
    const needed = safeLimit - prioritized.length;
    const spread = [];
    for (let index = 0; index < needed; index += 1) {
      const sourceIndex = Math.min(
        remaining.length - 1,
        Math.floor((index * remaining.length) / needed),
      );
      spread.push(remaining[sourceIndex]);
    }
    return [...prioritized, ...spread].slice(0, safeLimit);
  }

  function validateAnalysis(input, comments) {
    const commentById = new Map(
      (Array.isArray(comments) ? comments : []).map((comment) => [
        comment.id,
        comment,
      ]),
    );
    const safeString = (value, maxLength) => cleanText(value, maxLength);
    const allowedSentiments = new Set([
      "positive",
      "negative",
      "neutral",
      "mixed",
    ]);
    const sentiment = (value) =>
      allowedSentiments.has(value) ? value : "neutral";

    const topics = (Array.isArray(input?.topics) ? input.topics : [])
      .slice(0, 10)
      .map((topic) => {
        const evidence = (
          Array.isArray(topic?.evidenceCommentIds)
            ? topic.evidenceCommentIds
            : []
        )
          .map((id) => commentById.get(String(id)))
          .filter(Boolean)
          .slice(0, 3)
          .map((comment) => ({
            id: comment.id,
            author: comment.author,
            text: comment.text,
            likeCount: comment.likeCount,
          }));
        const title = safeString(topic?.title, 120);
        if (!title) return null;
        return {
          title,
          sentiment: sentiment(topic?.sentiment),
          summary: safeString(topic?.summary, 800),
          evidence,
        };
      })
      .filter(Boolean);

    const safeList = (value) =>
      (Array.isArray(value) ? value : [])
        .map((item) => safeString(item, 500))
        .filter(Boolean)
        .slice(0, 8);

    return {
      summary: safeString(input?.summary, 1500),
      overallSentiment: sentiment(input?.overallSentiment),
      topics,
      viewerQuestions: safeList(input?.viewerQuestions),
      creatorFeedback: safeList(input?.creatorFeedback),
    };
  }

  return {
    MAX_FETCHED_COMMENTS,
    MAX_ANALYSIS_COMMENTS,
    normalizeApiComment,
    calculateStats,
    selectForAnalysis,
    validateAnalysis,
  };
})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = YTD_COMMENTS;
}
