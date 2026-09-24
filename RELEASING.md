# Releasing Uplink CSS Studio

Use semantic versioning for every distributable change:

- Increment the patch version for backward-compatible fixes.
- Increment the minor version for backward-compatible features.
- Increment the major version for breaking changes.

## Release checklist

1. Update the plugin header and `Plugin::VERSION` in `uplink-css-studio.php`.
2. Update `Stable tag` and the changelog in `readme.txt`.
3. Add the release notes to `changelog.txt`.
4. Run the JavaScript syntax check, PHP lint, and `git diff --check`.
5. Install and verify the build on the Bricks test site.
6. Build the versioned ZIP without repository files, marketing assets, or a nested ZIP.
7. Confirm the ZIP extracts to one `uplink-css-studio` directory and contains the expected version.
8. Commit with the message `Release Uplink CSS Studio X.Y.Z`.
9. Create an immutable `X.Y.Z` branch at that commit.
10. Push `main` and the version branch to GitHub.

Continue development on `main`. Do not add later fixes to an existing version branch.
