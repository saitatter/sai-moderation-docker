import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { expandSquashCommits } = require("../scripts/semantic-release/expand-squash-commits.cjs");

describe("expandSquashCommits", () => {
  it("replaces squash commits with conventional commits from the body", () => {
    const commits = [
      {
        hash: "abc123",
        header: "feat(events): add overlay delivery (#12)",
        subject: "add overlay delivery (#12)",
        type: "feat",
        body: [
          "* feat(events): publish normalized overlay chat events",
          "* fix(api): keep blocked messages out of overlay",
          "* docs(readme): document moderation release policy",
          "Co-authored-by: Example <example@example.com>",
        ].join("\n"),
      },
    ];

    expect(expandSquashCommits(commits)).toEqual([
      expect.objectContaining({
        hash: "abc123-body-0",
        header: "feat(events): publish normalized overlay chat events",
        type: "feat",
        scope: "events",
        subject: "publish normalized overlay chat events",
      }),
      expect.objectContaining({
        hash: "abc123-body-1",
        header: "fix(api): keep blocked messages out of overlay",
        type: "fix",
        scope: "api",
        subject: "keep blocked messages out of overlay",
      }),
      expect.objectContaining({
        hash: "abc123-body-2",
        header: "docs(readme): document moderation release policy",
        type: "docs",
        scope: "readme",
        subject: "document moderation release policy",
      }),
    ]);
  });

  it("keeps normal commits unchanged", () => {
    const commits = [{ hash: "def456", header: "fix(queue): persist flagged state", body: "" }];
    expect(expandSquashCommits(commits)).toEqual(commits);
  });
});
