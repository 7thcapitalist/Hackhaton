# Working rules for AI agents (and humans)

This repo is shared by 4 teammates. Each of us works with our own AI coding agent
(Claude Code, Cursor, Codex, Copilot, etc.). Every agent working in this repo must
follow these rules. Read [CONTEXT.md](CONTEXT.md) first for the event, schedule
and judging criteria.

## 1. Know who you are working for

- At the start of a session, find out which teammate you are working for. If you
  don't know, ask. Use their handle in branch names (see below).
- Your human decides what gets merged. Don't merge pull requests, push to `main`,
  or delete branches unless your human explicitly tells you to.

## 2. Branches: one person, one branch

- **Never commit directly to `main`.** `main` must always build and run, so it can
  be demoed at any moment.
- Every piece of work goes on its own branch, named `<handle>/<short-topic>`,
  for example `joao/api-setup` or `maria/landing-page`.
- Only work on your own branches. Never commit to, rebase or force-push a
  teammate's branch. If you need their change, wait for it to merge into `main`.
- Start every branch from a fresh `main`:
  ```bash
  git switch main && git pull && git switch -c <handle>/<topic>
  ```
- Keep branches short-lived (a few hours at most). Merge small and often, not
  one giant PR at the end.
- Pull `main` into your branch often (`git pull origin main`) to catch conflicts early.

## 3. Pull requests

- Open a PR into `main` for every change. Title: what it does, in plain words.
- PR description: what changed, how to run or test it, and anything teammates
  need to know (new env vars, new dependencies, changed interfaces).
- Another teammate (or their agent) should glance at it before merging. During
  crunch time a quick "looks good" in chat is enough.
- Prefer **squash merge**. Delete the branch after it merges.

## 4. Stay in your lane

- After the team splits the work, record who owns which area in the
  **Ownership** table below. Keep your edits inside your area.
- If you must touch someone else's area (shared config, a shared type, an API
  contract), say so in the PR description and tell that teammate.
- Don't reformat, rename or "clean up" files you weren't asked to touch. Unrelated
  diffs cause merge conflicts.
- Agree on interfaces (API routes, data shapes) early and write them down in
  `docs/` so people can build in parallel against them.

## 5. Commits

- Small, focused commits with clear messages, e.g. `feat: add payment form`,
  `fix: handle empty cart`, `docs: update setup steps`.
- Commit working states. Don't commit code that breaks the build.
- If your agent adds co-author lines, that's fine.

## 6. Git safety

- No `git push --force` on `main` or on anyone else's branch. On your own branch,
  use `--force-with-lease` only if you must.
- No `git reset --hard`, `git clean -fd` or branch deletions without asking your human.
- If you hit a merge conflict in someone else's code, stop and ask rather than guessing.

## 7. Secrets and data

- **Never commit secrets**: API keys, tokens, passwords, `.env` files. Put
  placeholder names in `.env.example` instead.
- Never use real card numbers or real personal data. Use test or fake data only
  (Visa is the main sponsor; payment test data is fine).
- "Ethical considerations" is a judging criterion. Note privacy, bias or misuse
  concerns in the PR or in `docs/` as you find them, so they can go into the pitch.

## 8. Timeline rules (see CONTEXT.md)

- **Saturday 12:30**: team forms. Fill in the Ownership table and pick the stack.
- **Sunday 15:00**: soft freeze. Only bug fixes and demo polish get merged.
- **Sunday 16:00**: code freeze. Nothing new merges into `main`. Whatever is on
  `main` is what we demo.
- Working demo beats perfect code. Cut scope before cutting stability.

## 9. Keep docs current

- When you add a dependency, a run command or an env var, update `README.md` in
  the same PR.
- Don't change this file (`AGENTS.md`) without the team agreeing.

## Ownership

Fill this in after the team forms on Saturday.

| Teammate | Handle | Area / owns | Branch prefix |
|----------|--------|-------------|---------------|
| Joao Vitor | joao | TBD | `joao/` |
| TBD | | | |
| TBD | | | |
| TBD | | | |

## Stack

TBD once the problem is announced (Saturday 11:30).
