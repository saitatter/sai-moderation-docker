function repositoryUrl(context) {
  const repository = context.env?.GITHUB_REPOSITORY || process.env.GITHUB_REPOSITORY;
  if (repository) return `https://github.com/${repository}`;

  const configured = context.options?.repositoryUrl || "";
  const match = configured.match(/github\.com[/:](?<owner>[^/]+)\/(?<repo>[^/.]+)(?:\.git)?/);
  return match?.groups ? `https://github.com/${match.groups.owner}/${match.groups.repo}` : null;
}

function comparisonUrl(context) {
  const baseUrl = repositoryUrl(context);
  const previousTag = context.lastRelease?.gitTag;
  const nextTag = context.nextRelease?.gitTag;
  if (!baseUrl || !previousTag || !nextTag) return null;
  return `${baseUrl}/compare/${encodeURIComponent(previousTag)}...${encodeURIComponent(nextTag)}`;
}

function appendFullComparison(context) {
  const url = comparisonUrl(context);
  if (!url || !context.nextRelease) return;

  const notes = String(context.nextRelease.notes || "").trimEnd();
  if (/^Full comparison:/im.test(notes)) return;
  context.nextRelease.notes = `${notes}\n\nFull comparison: ${url}`;
}

module.exports = {
  prepare(_, context) {
    appendFullComparison(context);
  },
  appendFullComparison,
  comparisonUrl,
};
