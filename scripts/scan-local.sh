#!/bin/sh
# Runs n8n's community package scanner gate against this checkout in a node:22 container
# (the scanner pulls a native module that does not build on newer Node releases). The repo
# is mounted read-only and copied inside, so nothing on the host changes. See
# scripts/scan-local.mjs for what is checked and what only a published version can show.
#
# The copies live two levels below / on purpose: the scanner's findPackageJson() stops
# before it looks at a directory directly under /, so a package at /work would never find
# its own package.json and every node would fail no-credential-reuse. The real scanner
# unpacks into a deep temp directory, which this mirrors.
set -eu

SCANNER_VERSION="${SCANNER_VERSION:-0.42.0}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

docker run --rm -v "$ROOT:/src:ro" -e SCANNER_VERSION="$SCANNER_VERSION" node:22-slim sh -ec '
	SOURCE=/tmp/scan/source
	PACKAGE=/tmp/scan/package
	SCANNER=/tmp/scan/scanner
	mkdir -p "$SOURCE" "$PACKAGE" "$SCANNER"
	cd /src && tar --exclude=./node_modules --exclude=./dist --exclude=./.git -cf - . | tar -xf - -C "$SOURCE"
	cd "$SOURCE"
	npm ci --ignore-scripts --no-audit --no-fund >/dev/null
	npm run build >/dev/null
	tarball="$(npm pack --silent)"
	tar -xzf "$tarball" -C "$PACKAGE" --strip-components=1
	echo "packed $tarball:"
	(cd "$PACKAGE" && find . -type f | sort)
	cd "$SCANNER"
	npm init -y >/dev/null
	npm install --ignore-scripts --no-audit --no-fund "@n8n/scan-community-package@$SCANNER_VERSION" >/dev/null 2>&1
	cp "$SOURCE/scripts/scan-local.mjs" "$SCANNER/scan-local.mjs"
	echo "scanner @n8n/scan-community-package@$SCANNER_VERSION on node $(node --version):"
	node "$SCANNER/scan-local.mjs" "$SOURCE" "$PACKAGE"
'
