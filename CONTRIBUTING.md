# Contributing to Daisy Platform

Thanks for working on Daisy. This guide covers branch naming, the PR workflow, commit message style, local development, and how the parallel agent process slots into reviews.

## House style

All prose, comments, commit messages, and PR descriptions use UK English spelling and grammar. No emojis. No em dashes, use commas or spaces instead.

## Branch naming

Branches should describe the work, not the author. Use one of these prefixes:

- `wave-{N}{X}-{short-name}` for parallel agent waves, where `{N}` is the wave number and `{X}` is the agent letter (matches the M1 build plan). Examples: `wave-1a-scaffold`, `wave-1c-hygiene`, `wave-3b-bookings`.
- `feat/{short-name}` for new features outside a wave.
- `fix/{short-name}` for bug fixes.
- `chore/{short-name}` for tooling, config, or housekeeping work.
- `docs/{short-name}` for documentation-only changes.

Keep `{short-name}` lowercase and hyphenated, three or four words at most.

## Pull request workflow

1. Open a PR against `main` from your branch. Never push directly to `main`, branch protection blocks it.
2. The CI workflow runs typecheck, lint, and build on every push. CI must be green before review.
3. At least one approving review is required. Stale reviews are dismissed when the branch is updated.
4. Squash-merge into `main`. Keep the squash commit message in conventional commits style.
5. Delete the branch after merge.

For wave PRs, the wave's verifier reviews and merges sibling PRs in dependency order. The verifier also checks that file scopes did not collide and that acceptance criteria in the M1 build plan are met.

## Commit message style

We use conventional commits. The first line is `type: short summary in present tense`, max 72 characters. Common types:

- `feat:` a new user-facing feature
- `fix:` a bug fix
- `chore:` tooling, config, dependencies, build pipeline
- `docs:` documentation only
- `test:` test scaffolding or coverage changes
- `refactor:` internal restructure with no behaviour change

Example:

```
feat: add territory map to franchisee dashboard
```

Multi-line bodies are welcome when the why needs explaining. Wrap at 72 characters.

## Local development

See `README.md` for project setup, environment variables, and how to run the dev server.

The repo has a pre-commit hook that runs `prettier --write` and `eslint --fix` on staged files via `lint-staged`. You should not need to run formatters manually. If the hook does not run, ensure you have run `npm install` so the `prepare` script wires up Husky.

To run the same checks CI runs:

```bash
npm run typecheck
npm run lint
npm run test
npm run build
```

## Verifier role

Each parallel build wave has a designated verifier (separate from the building agents). The verifier:

1. Reviews each agent PR against the wave's acceptance criteria from the M1 build plan.
2. Confirms file scopes did not overlap.
3. Merges sibling PRs in dependency order.
4. Runs the post-wave gate checks before kicking off the next wave.

If a verifier finds an issue, they comment on the PR with what needs fixing. The building agent re-pushes to the same branch.
