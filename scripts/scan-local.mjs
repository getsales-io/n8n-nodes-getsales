// Runs the lint gate of n8n's community package scanner on a local checkout and on the
// tarball `npm pack` makes from it, without publishing anything.
//
// `npx @n8n/scan-community-package <name>` only scans a version already on npm: it checks the
// npm provenance attestation, downloads the GitHub source the attestation points at, and then
// lints two things with analyzePackage(): that source (SOURCE_FILE_PATTERNS) and the unpacked
// npm tarball (compiled .js and package.json). This script runs the same analyzePackage() on
// the same two inputs taken from disk. What it cannot check is the provenance itself, which
// exists only once GitHub Actions publishes the package.
//
// Usage: node scan-local.mjs <source-dir> <unpacked-tarball-dir>
// The scanner package must be resolvable from this script's working directory. Its module moved
// from scanner/scanner.mjs (0.41 and before) to dist/scanner.js (0.42), so both are tried.
const layouts = ['dist/scanner.js', 'scanner/scanner.mjs'];
let scanner;
for (const layout of layouts) {
	try {
		scanner = await import(`@n8n/scan-community-package/${layout}`);
		break;
	} catch (error) {
		// Only the scanner's own file missing means "try the other layout": a module it imports
		// that is missing is a broken install and fails here.
		const missing = String(error?.url ?? error?.message ?? '');
		if (error?.code !== 'ERR_MODULE_NOT_FOUND' || !missing.includes(layout)) throw error;
	}
}
if (!scanner) {
	console.error(`No scanner module found at ${layouts.join(' or ')}`);
	process.exit(2);
}
const { analyzePackage, SOURCE_FILE_PATTERNS } = scanner;

const [sourceDir, packageDir] = process.argv.slice(2);
if (!sourceDir || !packageDir) {
	console.error('Usage: node scan-local.mjs <source-dir> <unpacked-tarball-dir>');
	process.exit(2);
}

const legs = [
	['source', await analyzePackage(sourceDir, SOURCE_FILE_PATTERNS)],
	['tarball', await analyzePackage(packageDir, ['**/*.js', 'package.json'])],
];

let failed = false;
for (const [name, result] of legs) {
	if (result.passed) {
		console.log(`PASS ${name}${result.message ? ` (${result.message})` : ''}`);
	} else {
		failed = true;
		console.log(`FAIL ${name}: ${result.message}`);
		if (result.details) console.log(result.details);
	}
}
process.exit(failed ? 1 : 0);
