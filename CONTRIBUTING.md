# Contributing

## Branching

- Create feature branches from `main`.
- Open pull requests with clear scope and test notes.

## Commit Messages

Use Conventional Commits:

- `feat: ...`
- `fix: ...`
- `refactor: ...`
- `ci: ...`
- `chore: ...`
- `docs: ...`
- `test: ...`

Examples:

- `feat(moderation): add verdict queue state model`
- `fix(dashboard): prevent duplicate manual actions`

## Pull Requests

- PR titles must follow Conventional Commits.
- Include validation steps (`npm test`, screenshots, logs where relevant).
- Keep PRs focused and reviewable.
- When squash merging, keep the branch commit list in the squash body so every conventional commit appears in the release changelog.

## Ownership

Code ownership is enforced via `.github/CODEOWNERS`.
