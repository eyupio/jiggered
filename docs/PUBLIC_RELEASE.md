# Public release checklist

Repository files cannot enable GitHub account settings. Complete these steps
before making the repository public, and verify them again after the switch.

1. Review and merge the release preparation PR, including the MIT licence.
2. Require successful `test` and `browser` checks on the default branch.
   The existing **Protect main** ruleset is disabled and has no target refs;
   activation alone is insufficient. Target the default branch, require a pull
   request, block deletion and force pushes, and require these two checks.
   Keep an explicit owner emergency bypass if needed for a solo maintainer.
3. Enable **Private vulnerability reporting** under repository security settings.
   Verify the private report link in SECURITY.md works before inviting reports.
4. Check every remaining branch and tag, commit attachments, release assets,
   Actions logs and artifacts for credentials and personal records. Enable
   available secret scanning and push protection when publishing. Removing a
   file from a new commit does not remove its earlier versions from Git history.
5. `n1.png` and `n2.png` were removed from the current tree, but earlier versions
   still contain the username and energy values shown in those screenshots.
   Decide whether that historic content is acceptable before publishing.
   Any history rewrite requires a separate coordinated operation.
6. Make the GHCR package public separately if anonymous image pulls are intended.
   From a clean Docker configuration (without cached registry credentials), run
   `docker pull ghcr.io/jnnngs/jiggered:latest`. Confirm both amd64 and arm64
   manifests exist. If no stable image exists yet, tag a release and wait for
   successful image publication. Source builds are documented as the fallback.
7. Confirm tagged release notes, the public README and the landing/pricing copy
   match the release. Deploy the launch copy alongside the public visibility
   switch so visitors can actually open the source link.

The preparation review inspected main at `2c0cc53` and 159 reachable commits
for common credential patterns. No matching live credentials were identified;
this is not a full secret-scanner certificate or clearance of binary history,
other refs, release assets, issue attachments or Actions artifacts.
