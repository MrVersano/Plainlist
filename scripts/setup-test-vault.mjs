// Installs the Hot Reload plugin (https://github.com/pjeby/hot-reload) into the test vault,
// so `npm run dev` rebuilds are picked up without restarting Obsidian.
import { mkdirSync, writeFileSync } from 'fs';

const dir = 'test-vault/.obsidian/plugins/hot-reload';
const base = 'https://raw.githubusercontent.com/pjeby/hot-reload/master';

mkdirSync(dir, { recursive: true });
for (const file of ['main.js', 'manifest.json']) {
	const res = await fetch(`${base}/${file}`);
	if (!res.ok) throw new Error(`Could not download ${file}: ${res.status}`);
	writeFileSync(`${dir}/${file}`, await res.text());
}
console.log(`Installed Hot Reload into ${dir}`);
