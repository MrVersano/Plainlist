# Plainlist

## Development

```bash
npm install
npm run setup-vault   # installs the Hot Reload plugin into test-vault/
npm run dev           # builds into test-vault/.obsidian/plugins/plainlist and rebuilds on change
npm test              # vitest
npm run lint
npm run build         # type-check and production build (main.js, styles.css)
```

Open `test-vault/` as a vault in Obsidian, turn off Restricted mode, and enable Plainlist and Hot Reload under **Settings → Community plugins**.
