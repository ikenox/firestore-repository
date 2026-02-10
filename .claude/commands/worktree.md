Create a git worktree for the branch `$ARGUMENTS` under the `.worktree/` directory and change the working directory to it.

1. Run `git worktree add .worktree/$ARGUMENTS $ARGUMENTS`
2. Change working directory to `.worktree/$ARGUMENTS` using `cd`
3. Confirm the current directory and branch
