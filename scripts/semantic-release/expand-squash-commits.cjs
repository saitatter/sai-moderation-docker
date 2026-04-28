const CONVENTIONAL_COMMIT_RE =
  /^(?:[-*]\s*)?(?<header>(?<type>[a-z]+)(?:\((?<scope>[^)]+)\))?(?<breaking>!)?:\s+(?<subject>.+))$/;

function getBodyLines(commit) {
  const body = typeof commit.body === "string" ? commit.body : "";
  if (body.trim()) return body.split(/\r?\n/);

  const message = typeof commit.message === "string" ? commit.message : "";
  return message.split(/\r?\n/).slice(1);
}

function extractSquashCommits(commit) {
  const seen = new Set();

  return getBodyLines(commit)
    .map((line) => line.trim())
    .map((line, index) => {
      const match = line.match(CONVENTIONAL_COMMIT_RE);
      if (!match?.groups) return null;

      const { header, type, scope, breaking, subject } = match.groups;
      if (seen.has(header)) return null;
      seen.add(header);

      return {
        ...commit,
        hash: `${commit.hash || "squash"}-body-${index}`,
        message: header,
        header,
        subject,
        type,
        scope: scope || null,
        body: "",
        footer: "",
        notes: breaking ? [{ title: "BREAKING CHANGE", text: subject }] : [],
        references: [],
      };
    })
    .filter(Boolean);
}

function expandSquashCommits(commits = []) {
  return commits.flatMap((commit) => {
    const expanded = extractSquashCommits(commit);
    return expanded.length > 0 ? expanded : [commit];
  });
}

function applyExpansion(context) {
  if (!Array.isArray(context.commits)) return;
  context.commits = expandSquashCommits(context.commits);
}

module.exports = {
  analyzeCommits(_, context) {
    applyExpansion(context);
    return null;
  },
  expandSquashCommits,
};
