# Parallel work during SprintHack

Use this checklist with [AGENTS.md](../AGENTS.md) and [CONTEXT.md](../CONTEXT.md). The event problem, framework, and team ownership may still change; agree on them before assigning implementation tasks.

## Assign small tasks

1. Confirm which teammate the agent represents and record each teammate's area in the Ownership table in `AGENTS.md` once the team agrees. Do not edit that table without team agreement.
2. Give each task one owner, a short goal, the files or area it may edit, and a concrete check for completion. Write shared API routes and data shapes in `docs/` before separate tasks depend on them.
3. Keep agents within their owner's area. If a task needs shared configuration, a shared type, or another owner's file, coordinate with that teammate and call it out in the PR.

## Isolate and review each change

1. Refresh `main` and create a separate branch from it for each task, named `<handle>/<short-topic>` (for example, `joao/demo-flow`). A Git worktree can give each task its own directory while sharing the same repository. Never put two agents on the same branch or commit to `main`.
2. Before editing, inspect `git status` in that worktree. Keep the diff limited to the assigned task, and commit a working state with a focused message. Never commit secrets or real personal or payment data.
3. Run the checks relevant to the change and record the command and result. For a visual change, inspect the preview deployment when available. Note privacy, bias, or misuse concerns for the pitch and PR.
4. Push only the task branch and open a draft PR into `main`. Include what changed, how it was checked, any new dependencies or environment variable names, changed interfaces, and any cross-owner edits. Update `README.md` and `.env.example` in the same PR when applicable.
5. Ask another teammate to review. João decides what to merge for his branches; agents do not merge, push to `main`, or delete branches without their human's explicit instruction. Follow the Sunday soft freeze and code freeze in `AGENTS.md`.

Keep task branches short-lived. After `main` changes, bring it into an active task branch early and stop for a teammate's conflict rather than guessing at their code.
