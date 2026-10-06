# Releasing Uplink CSS Studio

Use semantic versioning for every distributable change:

- Increment the patch version for backward-compatible fixes.
- Increment the minor version for backward-compatible features.
- Increment the major version for breaking changes.

## Release checklist

1. Update the plugin header and `Plugin::VERSION` in `uplink-css-studio.php`.
2. Update `Stable tag` and the changelog in `readme.txt`.
3. Add the release notes to `changelog.txt`. Update `update.json` with the same version, its exact release ZIP URL, and release notes.
4. Run the JavaScript syntax check, PHP lint, and `git diff --check`.
5. Install and verify the build on the Bricks test site.
6. Build `uplink-css-studio.zip` without repository files, marketing assets, or a nested ZIP.
7. Confirm the ZIP extracts to one `uplink-css-studio` directory and contains the expected version.
8. Commit with the message `Release Uplink CSS Studio X.Y.Z`.
9. Create an immutable `X.Y.Z` branch at that commit.
10. Create an `X.Y.Z` tag at that commit.
11. Push `main`, the version branch, and the tag to GitHub.
12. Confirm the release workflow publishes the tag as a GitHub Release with an `uplink-css-studio.zip` asset.
13. Confirm the permanent latest-release URL downloads that asset: `https://github.com/stphnwlkr/uplink-css-studio/releases/latest/download/uplink-css-studio.zip`.

Continue development on `main`. Do not add later fixes to an existing version branch.

The bundled update checker reads public `update.json` from `main` without calling the GitHub API. The manifest must point to the versioned `uplink-css-studio.zip` asset from a published stable GitHub Release. It will not install a repository source archive. WordPress decides whether that release is installed manually or through the site's per-plugin automatic-update setting.
