# Repository hardening: branch protection & security settings

The CI workflow (`.github/workflows/ci.yml`) and Dependabot config
(`.github/dependabot.yml`) live in the repo, but the settings below are
GitHub-side toggles that must be enabled once by a repo admin. They are
documented here so the intent is tracked in version control.

## 1. Protect `main`

Settings → Branches → Add branch ruleset (or classic branch protection) for `main`:

- **Require a pull request before merging** (no direct pushes to `main`).
  - Require at least 1 approving review.
  - Dismiss stale approvals when new commits are pushed.
- **Require status checks to pass before merging**, and select:
  - `Typecheck, test, build` (the `verify` job from the CI workflow).
  - Require branches to be up to date before merging.
- **Require conversation resolution before merging.**
- **Do not allow bypassing the above** (uncheck "allow administrators to bypass"
  unless you have a specific reason).
- Optionally: **Require linear history** and **block force pushes / deletions**.

> The status check only appears in the picker after the workflow has run at
> least once. Open a throwaway PR (or push this branch) so the `verify` check
> registers, then add it as required.

CLI equivalent (requires admin + GitHub CLI):

```bash
gh api -X PUT repos/OWNER/REPO/branches/main/protection \
  -H "Accept: application/vnd.github+json" \
  -f 'required_status_checks[strict]=true' \
  -f 'required_status_checks[contexts][]=Typecheck, test, build' \
  -f 'enforce_admins=true' \
  -f 'required_pull_request_reviews[required_approving_review_count]=1' \
  -f 'restrictions=' 
```

## 2. Enable Dependabot & security scanning

Settings → Code security and analysis:

- **Dependabot alerts** — ON (surfaces known CVEs in dependencies).
- **Dependabot security updates** — ON (auto-PRs for vulnerable deps).
- **Dependabot version updates** — driven by `.github/dependabot.yml` (already
  committed); confirm it shows as active after this file lands on `main`.
- **Secret scanning** + **Push protection** — ON.
- **Code scanning (CodeQL)** — optional but recommended; add the default
  CodeQL workflow for JavaScript/TypeScript.

## 3. Verify

After enabling, open a test PR and confirm:

- The `verify` CI job runs and is marked **Required**.
- Merge is blocked until the check passes and the PR is approved.
- Dependabot shows up under the **Insights → Dependency graph → Dependabot** tab.
