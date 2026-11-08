// tsc emits JavaScript only. n8n also loads two kinds of static files from beside the
// compiled code: the SVGs that `file:` icon references name, and each node's codex
// (<Node>.node.json: categories, search aliases, documentation links). This script walks
// the source folders and mirrors every such file into dist/ under the same relative path,
// so a new node or icon needs no edit here.
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const sourceFolders = ['credentials', 'nodes'];

function isStaticFile(name) {
	return name.endsWith('.svg') || name.endsWith('.node.json');
}

function mirrorStaticFiles(relativeDir) {
	for (const entry of fs.readdirSync(path.join(root, relativeDir), { withFileTypes: true })) {
		const relativePath = path.join(relativeDir, entry.name);
		if (entry.isDirectory()) {
			mirrorStaticFiles(relativePath);
			continue;
		}
		if (!isStaticFile(entry.name)) continue;
		const target = path.join(root, 'dist', relativePath);
		fs.mkdirSync(path.dirname(target), { recursive: true });
		fs.copyFileSync(path.join(root, relativePath), target);
	}
}

sourceFolders.forEach(mirrorStaticFiles);
