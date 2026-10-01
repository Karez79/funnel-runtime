---
description: Launch the reviewer subagent on a PR (normal or re-review) with the standard prompt
argument-hint: <pr-number> [re-review <previous-comment-id>] [focus...]
---

Launch one background reviewer subagent for PR `$ARGUMENTS` of `Karez79/funnel-runtime`.
Parse the arguments: the first is the PR number; if the second is `re-review`, the third is the
id of the previous reviewer comment; anything else is extra focus for the reviewer.

Use the Agent tool with `subagent_type: reviewer` if that type is available, otherwise
`general-purpose`, `run_in_background: true`, and exactly this prompt (fill the placeholders):

> You are acting as the `reviewer` subagent of this project. Read your definition with
> `git -C <repo> fetch -q && git -C <repo> show origin/<head-branch>:.claude/agents/reviewer.md`
> and follow it exactly: read-only, no edits, no commits, no global cleanup commands.
>
> Review PR #<n> (head `<head-branch>`, base `<base-branch>`) in Karez79/funnel-runtime.
> Another agent works in `<repo>`: never checkout, stash or write there. Inspect with
> `git diff origin/<base>...origin/<head>` and `git show`; to run commands, create your own
> worktree under `<scratchpad>/rev<n>` from `origin/<head>` (`pnpm install --frozen-lockfile`,
> `pnpm check`, `pnpm e2e` if relevant) and remove it at the end. Check CI with
> `gh pr checks <n> -R Karez79/funnel-runtime`.
>
> Spec: CLAUDE.md sections <sections from the PR body>. Extra focus: <focus or "none">.
>
> [re-review only] This is a re-review. Previous review: `gh api
repos/Karez79/funnel-runtime/issues/comments/<id> -q .body`. For every previous finding give
> fixed / partially fixed / not fixed with evidence, then review the new commits with the full
> checklist.
>
> Post exactly one comment with `mcp__github__add_issue_comment` (owner Karez79, repo
> funnel-runtime, issue_number <n>) in the reviewer.md format, ending with the line
> `Blockers: N, majors: N, minors: N.`, and return the tables as your final answer.

Get `<head-branch>`/`<base-branch>` from `gh pr view <n> --json headRefName,baseRefName`.
`<repo>` is the project root, `<scratchpad>` is this session's scratchpad directory.

After the reviewer returns: if there is any blocker or major, fix, push, and run
`/review-pr <n> re-review <new-comment-id>`. Merge only when the latest verdict is APPROVE and
CI is green.
