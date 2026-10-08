# Development

```bash
npm install
npm run setup-vault   # installs the Hot Reload plugin into test-vault/
npm run dev           # builds into test-vault/.obsidian/plugins/plainlist and rebuilds on change
npm test              # vitest
npm run lint
npm run build         # type-check and production build (main.js, styles.css)
```

Open `test-vault/` as a vault in Obsidian, turn off Restricted mode, and enable Plainlist and Hot Reload under **Settings → Community plugins**. To build into another vault, set `PLAINLIST_VAULT=/path/to/vault` before `npm run dev`.

The file model (`src/model/`) and date parsing (`src/dates/`) have no Obsidian imports and are covered by the tests in `tests/`.

## Releasing

1. Add an entry for the new version at the top of [CHANGELOG.md](../CHANGELOG.md), with the date and **New**, **Improvements** and **No longer broken** sections as needed.
2. `npm version patch` (or `minor` / `major`) updates `manifest.json`, `package.json` and `versions.json`.
3. Push the commit and tag (`git push --follow-tags`). The release workflow builds the plugin and publishes a GitHub release with `main.js`, `manifest.json` and `styles.css`.
