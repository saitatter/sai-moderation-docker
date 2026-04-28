module.exports = {
  branches: ["main"],
  plugins: [
    [
      "@semantic-release/commit-analyzer",
      {
        releaseRules: [
          { type: "feat", release: "minor" },
          { type: "fix", release: "patch" },
          { type: "perf", release: "patch" },
          { type: "refactor", release: "patch" },
          { type: "ci", release: "patch" },
          { type: "chore", release: "patch" },
          { type: "docs", release: false },
          { type: "test", release: false },
          { type: "style", release: false },
          { type: "build", release: false },
        ],
        preset: "conventionalcommits",
      },
    ],
    [
      "@semantic-release/release-notes-generator",
      {
        preset: "conventionalcommits",
        presetConfig: {
          types: [
            { type: "feat", section: "✨ Features", hidden: false },
            { type: "fix", section: "🐛 Fixes", hidden: false },
            { type: "perf", section: "🐛 Fixes", hidden: false },
            { type: "refactor", section: "♻️ Refactors", hidden: false },
            { type: "build", section: "🧰 CI & Build", hidden: false },
            { type: "ci", section: "🧰 CI & Build", hidden: false },
            { type: "chore", section: "🧰 CI & Build", hidden: false },
            { type: "docs", section: "📚 Docs", hidden: false },
            { type: "test", section: "🧪 Tests", hidden: false },
          ],
        },
        writerOpts: {
          commitsSort: ["scope", "subject"],
        },
      },
    ],
    "@semantic-release/github",
  ],
};
