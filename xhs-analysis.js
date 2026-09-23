/* Small batches cover every collected XHS comment. Counts come from validated
 * source IDs, never from model-generated numbers or illustrative quotes. */
var PANORAMA_XHS = (() => {
  const sentiments = new Set(["positive", "negative", "neutral", "mixed"]);
  const tags = new Set(["具体经历", "信息补充", "建设性建议", "关键问题"]);
  const text = (value, max) => typeof value === "string" ? value.trim().slice(0, max) : "";
  const sentiment = value => sentiments.has(value) ? value : "unknown";
  function invalid(message) {
    const error = new Error(message || "本批分析未能完整对应评论，请重试分析；已获取的评论和成功批次会保留。");
    error.code = "XHS_ANALYSIS_INCOMPLETE";
    throw error;
  }
  function prepare(comments) {
    if (!Array.isArray(comments) || !comments.length || comments.length > 5000) invalid("请获取 1～5,000 条评论后再分析。");
    const seen = new Set();
    const source = comments.map(row => {
      if (!row || typeof row.id !== "string" || !row.id || seen.has(row.id) || typeof row.text !== "string" || !row.text.trim() || row.text.length > 5000) invalid("评论数据不完整，请重新获取后再分析。");
      seen.add(row.id);
      return { id: row.id, text: row.text, author: text(row.author, 200), likeCount: Number.isFinite(row.likeCount) ? Math.max(0, row.likeCount) : 0,
        isReply: !!(row.isReply || row.parentCommentId || row.threadRootId || row.replyToAuthor),
        parentCommentId: text(row.parentCommentId, 200) || null, threadRootId: text(row.threadRootId, 200) || null,
        replyToAuthor: text(row.replyToAuthor, 200) };
    });
    for (const row of source) {
      for (const key of ["parentCommentId", "threadRootId"]) if (!seen.has(row[key]) || row[key] === row.id) row[key] = null;
    }
    return source;
  }
  function prepareNote(note, title = "") {
    return { title: text(note?.title || title, 500), author: text(note?.author, 200), text: text(note?.text, 20000),
      truncated: !!note?.truncated || typeof note?.text === "string" && note.text.trim().length > 20000 };
  }
  function batchPayload(batch, byId) {
    const ids = new Set(batch.map(row => row.id));
    const referenceIds = new Set(batch.flatMap(row => [row.parentCommentId, row.threadRootId]));
    const serialize = row => ({ id: row.id, text: row.text, author: row.author, likes: row.likeCount,
      isReply: row.isReply, parentCommentId: row.parentCommentId, threadRootId: row.threadRootId, replyToAuthor: row.replyToAuthor });
    return { comments: batch.map(serialize),
      contextComments: [...referenceIds].filter(id => byId.has(id) && !ids.has(id)).map(id => serialize(byId.get(id))) };
  }
  function batches(comments) {
    const result = [], byId = new Map(comments.map(row => [row.id, row])); let batch = [];
    for (const row of comments) {
      // Budget the actual comments AND their reference context, deduplicating
      // shared ancestors. The note body has its own bounded allowance.
      if (batch.length && (batch.length >= 60 || JSON.stringify(batchPayload([...batch, row], byId)).length > 24000)) {
        result.push(batch); batch = [];
      }
      batch.push(row);
    }
    if (batch.length) result.push(batch);
    return result;
  }
  function validateBatch(input, comments, index) {
    const source = new Map(comments.map(row => [row.id, row]));
    const localTopics = new Map();
    if (!Array.isArray(input?.topics) || input.topics.length > 8 || !Array.isArray(input.assignments)) invalid();
    for (const row of input.topics) {
      if (typeof row?.id !== "string" || !row.id || localTopics.has(row.id) || !text(row.title, 100) || !text(row.summary, 500)) invalid();
      localTopics.set(row.id, { id: `b${index + 1}:${row.id}`, title: text(row.title, 100), summary: text(row.summary, 500),
        sentiment: sentiment(row.sentiment), commentIds: [], evidenceIds: Array.isArray(row.evidenceCommentIds) ? row.evidenceCommentIds : [] });
    }
    const assigned = new Set(), unclassifiedIds = [];
    for (const row of input.assignments) {
      if (!source.has(row?.commentId) || assigned.has(row.commentId) || (row.topicId !== null && !localTopics.has(row.topicId))) invalid();
      assigned.add(row.commentId);
      if (row.topicId === null) unclassifiedIds.push(row.commentId);
      else localTopics.get(row.topicId).commentIds.push(row.commentId);
    }
    if (assigned.size !== source.size) invalid();
    const topics = [...localTopics.values()].filter(row => row.commentIds.length).map(row => ({ ...row,
      evidenceIds: [...new Set(row.evidenceIds.filter(id => row.commentIds.includes(id)))].slice(0, 2) }));
    const classified = new Set(topics.flatMap(row => row.commentIds));
    const featured = (Array.isArray(input.featured) ? input.featured : []).filter(row => classified.has(row?.commentId) && tags.has(row.tag) && text(row.reason, 160))
      .slice(0, 4).map(row => ({ id: row.commentId, tag: row.tag, reason: text(row.reason, 160) }));
    if (!text(input.summary, 500)) invalid();
    return { summary: text(input.summary, 500), topics, featured, unclassifiedIds };
  }
  function validateMerge(input, sources, prefix) {
    if (!Array.isArray(input?.topics) || !input.topics.length || input.topics.length > Math.min(10, sources.length) || !text(input.summary, 700)) invalid();
    const byId = new Map(sources.map(row => [row.id, row])), used = new Set();
    const topics = input.topics.map((row, index) => {
      if (!text(row?.title, 100) || !text(row.summary, 500) || !Array.isArray(row.sourceTopicIds) || !row.sourceTopicIds.length) invalid();
      const members = row.sourceTopicIds.map(id => {
        if (!byId.has(id) || used.has(id)) invalid();
        used.add(id); return byId.get(id);
      });
      return { id: `${prefix}:${index + 1}`, title: text(row.title, 100), summary: text(row.summary, 500),
        sentiment: sentiment(row.sentiment), commentIds: [...new Set(members.flatMap(topic => topic.commentIds))],
        evidenceIds: [...new Set(members.flatMap(topic => topic.evidenceIds))].slice(0, 2) };
    });
    if (used.size !== byId.size) invalid();
    return { summary: text(input.summary, 700), topics };
  }
  function result(comments, reports, merged) {
    const byId = new Map(comments.map(row => [row.id, row]));
    const topics = merged.topics.map(topic => ({ ...topic, count: topic.commentIds.length,
      evidence: (topic.evidenceIds.length ? topic.evidenceIds : topic.commentIds.slice(0, 2)).map(id => byId.get(id))
    })).sort((a, b) => b.count - a.count);
    const sentimentCounts = { positive: 0, negative: 0, neutral: 0, mixed: 0, unknown: 0 };
    topics.forEach(topic => sentimentCounts[topic.sentiment]++);
    const candidates = reports.flatMap(report => report.featured), featured = [], selected = new Set(), texts = new Set();
    // Keep different kinds of useful comments, rather than letting likes alone win.
    for (let pass = 0; pass < 8 && featured.length < 8; pass++) {
      for (const tag of tags) {
        const candidate = candidates.find(row => row.tag === tag && !selected.has(row.id) && !texts.has(byId.get(row.id).text.replace(/\s/g, "")));
        if (!candidate || featured.length >= 8) continue;
        selected.add(candidate.id); texts.add(byId.get(candidate.id).text.replace(/\s/g, ""));
        featured.push({ ...byId.get(candidate.id), tag: candidate.tag, reason: candidate.reason,
          topicTitle: topics.find(topic => topic.commentIds.includes(candidate.id))?.title || "未归入议题" });
      }
    }
    return { schema: "xhs-v1", summary: merged.summary, totalAnalyzed: comments.length, topics, featured, sentimentCounts,
      unclassifiedCount: reports.reduce((sum, report) => sum + report.unclassifiedIds.length, 0) };
  }
  return { prepare, prepareNote, batchPayload, batches, validateBatch, validateMerge, result };
})();

// Memory-only checkpoints let a failed request retry without scrolling again or
// paying for successful batches again. Nothing is stored in the visited website.
const xhsAnalysisCheckpoints = new Map();
const xhsCancelledRequests = new Set();
function cancelXhsAnalysis(requestId) {
  if (typeof requestId !== "string" || !requestId) return;
  if (xhsCancelledRequests.size >= 50) xhsCancelledRequests.delete(xhsCancelledRequests.values().next().value);
  xhsCancelledRequests.add(requestId);
}
async function handleAnalyzeXhs(comments, context, requestId) {
  let checkpoint, claimed = false;
  try {
    const source = PANORAMA_XHS.prepare(comments);
    const note = PANORAMA_XHS.prepareNote(context.note, context.title);
    const sourceById = new Map(source.map(row => [row.id, row]));
    const bytes = new TextEncoder().encode(JSON.stringify({ note, comments: source }));
    const digest = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(value => value.toString(16).padStart(2, "0")).join("");
    const cacheKey = `${context.key}:${digest}`;
    checkpoint = xhsAnalysisCheckpoints.get(cacheKey);
    if (checkpoint?.active) return { success: false, message: "这些评论正在分析中，请等待当前任务完成。" };
    if (!checkpoint) {
      for (const [key, value] of xhsAnalysisCheckpoints) if (!value.active && xhsAnalysisCheckpoints.size >= 2) xhsAnalysisCheckpoints.delete(key);
      checkpoint = { reports: [], merges: new Map(), active: false };
      xhsAnalysisCheckpoints.set(cacheKey, checkpoint);
    }
    checkpoint.active = true; claimed = true;
    const batches = PANORAMA_XHS.batches(source);
    let completed = batches.slice(0, checkpoint.reports.length).reduce((sum, batch) => sum + batch.length, 0);
    const progress = (phase, details = {}) => chrome.runtime.sendMessage({ action: "mediaProgress", key: context.key, requestId,
      phase, count: source.length, analyzed: completed, total: source.length, batchCount: batches.length,
      completedBatches: checkpoint.reports.length, ...details }).catch(() => {});
    const request = async (heading, data) => {
      if (xhsCancelledRequests.has(requestId)) throw new Error("已切换页面，后续批次已停止。");
      await panoramaContext(context.tabId, context.key);
      const system = await loadPromptSection("xhs-comments.md", heading);
      const { text } = await requestAiCompletion({ maxTokens: 6500, temperature: 0.2, responseFormat: { type: "json_object" },
        messages: [{ role: "system", content: system }, { role: "user", content: JSON.stringify(data) }] });
      await panoramaContext(context.tabId, context.key);
      if (xhsCancelledRequests.has(requestId)) throw new Error("已切换页面，后续批次已停止。");
      return parseLooseJson(text);
    };
    progress("analyze");
    for (let index = checkpoint.reports.length; index < batches.length; index++) {
      const input = await request("Batch prompt", { task: "xhs_batch", title: note.title, note,
        ...PANORAMA_XHS.batchPayload(batches[index], sourceById) });
      checkpoint.reports.push(PANORAMA_XHS.validateBatch(input, batches[index], index));
      completed += batches[index].length;
      progress("analyze");
    }
    const reports = checkpoint.reports;
    let topics = reports.flatMap(report => report.topics), merged = { topics, summary: reports[0].summary };
    let mergeCount = 0, level = 0;
    progress("merge", { mergeCount });
    const merge = async (group, prefix) => {
      const key = JSON.stringify(group.map(topic => topic.id));
      let output = checkpoint.merges.get(key);
      if (!output) {
        const input = await request("Merge prompt", { task: "xhs_merge", title: note.title, note,
          topics: group.map(topic => ({ id: topic.id, title: topic.title, summary: topic.summary, sentiment: topic.sentiment, count: topic.commentIds.length })) });
        output = PANORAMA_XHS.validateMerge(input, group, prefix);
        checkpoint.merges.set(key, output);
      }
      mergeCount++; progress("merge", { mergeCount });
      return output;
    };
    if (reports.length > 1 && topics.length) {
      while (topics.length > 20) {
        const next = []; level++;
        for (let index = 0; index < topics.length; index += 20) {
          const group = topics.slice(index, index + 20);
          if (group.length === 1) next.push(group[0]);
          else next.push(...(await merge(group, `m${level}-${index}`)).topics);
        }
        topics = next;
      }
      merged = await merge(topics, "final");
    } else if (!topics.length) merged = { topics: [], summary: "本次评论以简短互动或信息不足的内容为主，未归纳出有充分依据的议题。" };
    const analysis = PANORAMA_XHS.result(source, reports, merged);
    xhsAnalysisCheckpoints.delete(cacheKey);
    return { success: true, analysis, sampleSize: source.length };
  } catch (error) {
    return { success: false, error: error.code || "XHS_ANALYSIS_FAILED", message: error.message,
      completedBatches: checkpoint?.reports.length || 0 };
  } finally { if (claimed) checkpoint.active = false; xhsCancelledRequests.delete(requestId); }
}

if (typeof module !== "undefined" && module.exports) module.exports = PANORAMA_XHS;
