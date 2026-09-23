var PANORAMA_XHS_UI = (() => {
  const $ = id => document.getElementById(id);
  const names = { ...PANORAMA_COPY.sentiments, unknown: "未判断" };
  const make = (tag, text = "", className = "") => {
    const el = document.createElement(tag); el.textContent = text; el.className = className; return el;
  };
  let current = {};
  function reset() { current = {}; $("xhsProgress").hidden = true; delete document.body.dataset.xhsPhase; }
  function progress(phase, details = {}) {
    current = { ...current, ...details, phase };
    document.body.dataset.xhsPhase = phase;
    $("xhsProgress").hidden = false;
    $("xhsProgress").dataset.phase = phase;
    const titles = { collect: "正在获取评论", collected: "获取已结束", analyze: "正在逐批分析评论", merge: "正在汇总议题与精选评论", complete: "分析完成", error: "分析暂时中断" };
    $("xhsProgressTitle").textContent = titles[phase];
    const count = current.count || 0, total = current.total || count;
    const bar = $("xhsProgressBar"); bar.removeAttribute("value"); bar.max = Math.max(total, 1);
    if (["collect", "collected"].includes(phase)) {
      $("xhsProgressText").textContent = `已获取 ${count.toLocaleString()} 条评论（去重后）`;
      $("xhsProgressDetail").textContent = phase === "collect"
        ? `第 ${current.round || 0} / ${current.maxRounds || "—"} 轮 · 正在读取评论、展开回复，请保持笔记打开。`
        : current.stopMessage || "可以开始分析已获取的评论。";
      if (phase === "collected") bar.value = count;
    } else {
      $("xhsProgressText").textContent = `已分析 ${(current.analyzed || 0).toLocaleString()} / ${total.toLocaleString()} 条评论`;
      $("xhsProgressDetail").textContent = phase === "merge" ? `全部评论已逐批分析，正在合并相近议题、整理精选评论。已完成 ${current.mergeCount || 0} 组合并。`
        : phase === "complete" ? "已分析本次获取的全部评论。下方统计只代表本次获取的内容。"
        : phase === "error" ? "已获取的评论仍在。点击「重试分析」继续，成功批次会尽量复用。"
        : `已完成 ${current.completedBatches || 0} / ${current.batchCount || "—"} 批。进度在每批分析成功后更新。`;
      if (phase !== "merge") bar.value = current.analyzed || 0;
    }
    const active = phase === "collect" ? 0 : phase === "complete" ? 3 : 1;
    $("xhsSteps").querySelectorAll("li").forEach((el, index) => {
      el.dataset.state = index < active ? "done" : index === active ? "active" : "pending";
      if (index === active) el.setAttribute("aria-current", "step"); else el.removeAttribute("aria-current");
    });
  }
  function comment(parent, row) {
    const quote = make("blockquote", "", "xhs-comment");
    quote.append(make("p", row.text.length > 240 ? `${row.text.slice(0, 240)}…` : row.text));
    quote.append(make("span", `${row.author || "匿名用户"} · ${row.likeCount.toLocaleString()} 赞`, "muted fine"));
    if (row.text.length > 240) {
      const full = make("details"); full.append(make("summary", "查看完整原文"), make("p", row.text)); quote.append(full);
    }
    parent.append(quote);
  }
  function render(parent, data, analysis) {
    const overview = make("section", "", "xhs-overview"); overview.id = "xhsOverview";
    overview.append(make("h2", "一句话结论"), make("p", analysis.summary, "xhs-lead"));
    const metrics = make("dl", "", "xhs-metrics");
    for (const [label, count] of [["已获取评论", data.comments.length], ["实际分析评论", analysis.totalAnalyzed], ["归纳议题", analysis.topics.length], ["精选评论", analysis.featured.length]]) {
      const cell = make("div"); cell.append(make("dt", label), make("dd", count.toLocaleString())); metrics.append(cell);
    }
    overview.append(metrics, make("p", "议题态度分布（按议题数统计）", "xhs-label"));
    const distribution = make("div", "", "xhs-distribution"), legend = make("div", "", "xhs-legend");
    distribution.setAttribute("role", "img");
    distribution.setAttribute("aria-label", Object.entries(analysis.sentimentCounts).map(([key, count]) => `${names[key]} ${count} 个议题`).join("，"));
    for (const [key, count] of Object.entries(analysis.sentimentCounts)) {
      if (key === "unknown" && !count) continue;
      if (count) { const segment = make("span", "", `sentiment-${key}`); segment.style.flex = String(count); distribution.append(segment); }
      legend.append(make("span", `${names[key]} ${count}`, `xhs-sentiment sentiment-${key}`));
    }
    overview.append(distribution, legend);
    const scope = make("details", "", "xhs-scope");
    scope.append(make("summary", "本次获取范围与停止原因"), make("p", `${data.stopMessage || ""} ${data.notice || ""}`));
    overview.append(make("p", "议题与态度由 AI 归纳，只代表本次获取的评论。", "muted fine"), scope); parent.append(overview);

    const section = make("section", "", "result-section"); section.id = "xhsTopics";
    section.append(make("h2", "大家主要在讨论什么"), make("p", "按涉及评论数量排序。每条评论只计入一个主要议题。", "muted fine"));
    const byId = new Map(data.comments.map(row => [row.id, row]));
    const more = make("details", "", "xhs-more-topics"); more.append(make("summary", `其余 ${Math.max(analysis.topics.length - 3, 0)} 个议题`));
    analysis.topics.forEach((topic, index) => {
      const card = make("article", "", `xhs-topic ${index < 3 ? "xhs-topic-main" : ""}`);
      card.append(make("p", `议题 ${index + 1} · ${topic.count} 条评论`, "xhs-label"), make("h3", topic.title),
        make("span", names[topic.sentiment], `xhs-sentiment sentiment-${topic.sentiment}`), make("p", topic.summary, "xhs-topic-summary"));
      topic.evidence.forEach(row => comment(card, row));
      const all = make("details"); all.append(make("summary", `查看本议题的 ${topic.count} 条评论`));
      const list = make("div", "", "xhs-topic-comments"); all.append(list);
      all.addEventListener("toggle", () => {
        if (all.open && !list.childElementCount) topic.commentIds.forEach(id => comment(list, byId.get(id)));
      });
      card.append(all); (index < 3 ? section : more).append(card);
    });
    if (analysis.topics.length > 3) section.append(more);
    if (!analysis.topics.length) section.append(make("p", "本次评论尚不足以归纳出明确议题。", "muted"));
    if (analysis.unclassifiedCount) section.append(make("p", `${analysis.unclassifiedCount} 条评论未归入议题，例如简短互动、无关内容或信息不足的评论；它们已参与分析。`, "muted fine"));
    parent.append(section);

    const featured = make("section", "", "result-section"); featured.id = "xhsFeatured";
    featured.append(make("h2", "值得细看的评论"), make("p", "AI 根据具体经历、信息补充、建议和问题筛选，点赞数仅供参考。", "muted fine"));
    for (const row of analysis.featured) {
      const item = make("article", "", "xhs-featured");
      item.append(make("span", row.tag, "xhs-label")); comment(item, row);
      item.append(make("p", `入选理由：${row.reason}`, "xhs-reason"), make("p", `所属议题：${row.topicTitle}`, "muted fine")); featured.append(item);
    }
    if (!analysis.featured.length) featured.append(make("p", "本次没有筛选到信息足够具体的评论。", "muted"));
    parent.append(featured);
  }
  function report(data, analysis) {
    const counts = Object.entries(analysis.sentimentCounts).filter(([key, n]) => n || key !== "unknown").map(([key, n]) => `${names[key]} ${n}`).join(" · ");
    const lines = [analysis.summary, "", `已获取 ${data.comments.length} 条；实际分析 ${analysis.totalAnalyzed} 条；归纳 ${analysis.topics.length} 个议题；精选 ${analysis.featured.length} 条。`,
      `议题态度（按议题数）：${counts}`, `未归入议题的评论：${analysis.unclassifiedCount} 条。每条评论只计入一个主要议题。`, data.stopMessage || "", data.notice || "", ""];
    for (const topic of analysis.topics) {
      lines.push(`## ${topic.title}`, `${topic.count} 条评论 · ${names[topic.sentiment]}`, "", topic.summary, "");
      topic.evidence.forEach(row => lines.push(`> ${row.text}`, `> ${row.author || "匿名用户"} · ${row.likeCount} 赞`, ""));
    }
    lines.push("## 值得细看的评论", "");
    analysis.featured.forEach(row => lines.push(`### ${row.tag}`, row.text, `${row.author || "匿名用户"} · ${row.likeCount} 赞`, `入选理由：${row.reason}`, `所属议题：${row.topicTitle}`, ""));
    return lines;
  }
  return { reset, progress, render, report };
})();
