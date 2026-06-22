# Release Guide

This repository uses an automated GitHub Actions workflow to publish the `@jtrader.ai/mcp` package to npm.

To release a new version, follow these steps locally:

1. **Ensure your working tree is clean**
   Make sure you have committed or stashed all changes.
   ```bash
   git status
   ```

2. **Bump the version**
   Use npm to bump the version. This will automatically update `package.json`, create a commit, and create a git tag (e.g., `v0.2.0`).
   ```bash
   npm version patch  # For bug fixes (0.1.0 -> 0.1.1)
   npm version minor  # For new features (0.1.0 -> 0.2.0)
   npm version major  # For breaking changes (0.1.0 -> 1.0.0)
   ```

3. **Push to GitHub**
   Push the new commit and the newly created tag to the repository.
   ```bash
   git push --follow-tags
   ```

4. **Draft the GitHub Release**
   - Go to the [Releases page](https://github.com/jtraderai/jtrader-mcp/releases) on GitHub.
   - Click **Draft a new release**.
   - In the **Choose a tag** dropdown, select the tag you just pushed (e.g., `v0.2.0`).
   - Click **Generate release notes**. GitHub will automatically compile a changelog based on recent commits and pull requests.
   - Edit the changelog if necessary to make it user-friendly.

5. **Publish!**
   - Click **Publish release**.
   - As soon as the release is published, the `.github/workflows/publish.yml` Action will trigger, build the `dist` folder, and automatically publish the new version to npm.
