const test = require('node:test');
const assert = require('node:assert/strict');
const { existsSync, readFileSync, readdirSync, statSync } = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const pkg = require('../package.json');
const { GETSALES_API_HOST } = require('../dist/shared/host');

/** Loads one entry of the package.json n8n block the way n8n does: the export named like the file. */
function load(entry) {
	const file = path.join(root, entry);
	const className = path.basename(file).split('.')[0];
	const Exported = require(file)[className];
	assert.equal(typeof Exported, 'function', `${entry} exports ${className}`);
	return { file, instance: new Exported() };
}

function iconFiles(icon) {
	return Object.values(icon).map((value) => value.replace(/^file:/, ''));
}

test('every node and credential in the n8n block loads, with its icons and codex beside it', () => {
	for (const entry of pkg.n8n.credentials) {
		const { file, instance } = load(entry);
		for (const icon of iconFiles(instance.icon)) assert.ok(existsSync(path.join(path.dirname(file), icon)), icon);
	}
	for (const entry of pkg.n8n.nodes) {
		const { file, instance } = load(entry);
		const { description } = instance;
		for (const icon of iconFiles(description.icon)) assert.ok(existsSync(path.join(path.dirname(file), icon)), icon);
		const codexFile = file.replace(/\.js$/, '.json');
		const codex = JSON.parse(readFileSync(codexFile, 'utf8'));
		assert.equal(codex.node, `${pkg.name}.${description.name}`);
		assert.deepEqual(codex.categories, ['Sales', 'Marketing & Content', 'Communication']);
		assert.ok(codex.alias.every((alias) => !/linkedin/i.test(alias)), 'no LinkedIn alias');
		assert.deepEqual(description.credentials, [{ name: 'getSalesApi', required: true }]);
	}
});

test('the package version is 1.0.0 or later', () => {
	assert.match(pkg.version, /^[1-9]\d*\.\d+\.\d+$/);
});

test('the README, which npm shows too, keeps both trademark notices as paragraphs of their own', () => {
	const readme = readFileSync(path.join(root, 'README.md'), 'utf8');
	const notices = [
		'n8n is a trademark of n8n GmbH. GetSales is not endorsed by or a partner of n8n.',
		'GetSales is an independent product and is not affiliated with, endorsed by, or sponsored by LinkedIn Corporation. LinkedIn and the LinkedIn logo are trademarks of LinkedIn Corporation. Use of GetSales is at your own risk and subject to the applicable third-party platform terms.',
	];
	for (const notice of notices) assert.ok(readme.includes(`\n\n${notice}\n\n`), notice);
});

test('the package ships no runtime dependency', () => {
	assert.equal(pkg.dependencies, undefined);
	assert.deepEqual(pkg.peerDependencies, { 'n8n-workflow': '*' });
});

test('the API host is written in shared/host.ts and nowhere else, and no file names a pre-release host', () => {
	const skip = new Set(['node_modules', 'dist', '.git']);
	const files = [];
	const walk = (dir) => {
		for (const name of readdirSync(dir)) {
			if (skip.has(name)) continue;
			const full = path.join(dir, name);
			if (statSync(full).isDirectory()) walk(full);
			else if (!/\.(svg|tgz)$/.test(name)) files.push(full);
		}
	};
	walk(root);
	const holders = files.filter((file) => readFileSync(file, 'utf8').includes(GETSALES_API_HOST));
	assert.deepEqual(holders.map((file) => path.relative(root, file)), [path.join('shared', 'host.ts')]);
	// GetSales ships one production app, so no file names a pre-release host or label, the API
	// host included (the word is assembled so this file passes its own scan).
	const preReleaseWord = new RegExp('be' + 'ta', 'i');
	const preReleaseHolders = files.filter((file) => preReleaseWord.test(readFileSync(file, 'utf8')));
	assert.deepEqual(preReleaseHolders.map((file) => path.relative(root, file)), []);
});
