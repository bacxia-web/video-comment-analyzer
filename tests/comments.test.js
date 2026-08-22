const test = require("node:test");
const assert = require("node:assert/strict");

const comments = require("../comments.js");

function makeComment(id, likeCount = 0, parentCommentId = null) {
  return {
    id,
    author: `author-${id}`,
    text: `comment ${id}`,
    likeCount,
    publishedAt: "2026-08-22T00:00:00Z",
    parentCommentId,
  };
}

test("YouTube API comments are normalized as untrusted input", () => {
  const normalized = comments.normalizeApiComment(
    {
      id: " c1 ",
      snippet: {
        authorDisplayName: " Viewer ",
        textOriginal: "  Useful   explanation  ",
        likeCount: 12.8,
        publishedAt: "2026-08-22T00:00:00Z",
      },
    },
    "parent-1",
  );

  assert.deepEqual(normalized, {
    id: "c1",
    parentCommentId: "parent-1",
    author: "Viewer",
    text: "Useful explanation",
    likeCount: 12,
    publishedAt: "2026-08-22T00:00:00Z",
  });
  assert.equal(comments.normalizeApiComment({ id: "missing" }), null);
});

test("deterministic stats separate top-level comments and replies", () => {
  const stats = comments.calculateStats([
    makeComment("a", 3),
    makeComment("b", 2, "a"),
    { ...makeComment("c", 0), author: "author-a" },
  ]);

  assert.deepEqual(stats, {
    total: 3,
    topLevel: 2,
    replies: 1,
    authors: 2,
    totalLikes: 5,
  });
});

test("analysis sampling keeps high-like comments and spans fetched order", () => {
  const source = Array.from({ length: 30 }, (_, index) =>
    makeComment(String(index), index === 29 ? 999 : index),
  );
  const sample = comments.selectForAnalysis(source, 9);

  assert.equal(sample.length, 9);
  assert.ok(sample.some((comment) => comment.id === "29"));
  assert.ok(sample.some((comment) => Number(comment.id) < 10));
  assert.ok(sample.some((comment) => Number(comment.id) > 20));
});

test("analysis validation only exposes evidence from real comment IDs", () => {
  const source = [makeComment("real", 7)];
  const validated = comments.validateAnalysis(
    {
      summary: " Audience response ",
      overallSentiment: "unexpected",
      topics: [
        {
          title: "Main topic",
          sentiment: "positive",
          summary: "Viewers liked it",
          evidenceCommentIds: ["invented", "real"],
        },
      ],
      viewerQuestions: ["What comes next?"],
      creatorFeedback: ["Make a follow-up."],
    },
    source,
  );

  assert.equal(validated.overallSentiment, "neutral");
  assert.equal(validated.topics[0].evidence.length, 1);
  assert.equal(validated.topics[0].evidence[0].id, "real");
  assert.equal(validated.topics[0].evidence[0].text, "comment real");
});
