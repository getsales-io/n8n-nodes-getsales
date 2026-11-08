// The example workflows in examples/ are what the README points a reader to, so they must
// keep matching the nodes: every GetSales node names a parameter the node shows for its
// resource and operation, every connection joins two nodes of the file, and no file carries a
// credential or a key.
const test = require('node:test');
const assert = require('node:assert/strict');
const { readdirSync, readFileSync } = require('node:fs');
const path = require('node:path');

const pkg = require('../package.json');
const { GetSales } = require('../dist/nodes/GetSales/GetSales.node');
const { GetSalesTrigger } = require('../dist/nodes/GetSalesTrigger/GetSalesTrigger.node');

const dir = path.join(__dirname, '..', 'examples');
const files = readdirSync(dir).filter((name) => name.endsWith('.json'));
const descriptions = {
	[`${pkg.name}.getSales`]: new GetSales().description,
	[`${pkg.name}.getSalesTrigger`]: new GetSalesTrigger().description,
};

/** The value a parameter has on a node: the one it names, else the property's default. */
function valueOf(properties, parameters, name) {
	if (name in parameters) return parameters[name];
	return properties.find((property) => property.name === name)?.default;
}

/** True when a property's displayOptions.show lets it show with these parameters. */
function shown(property, properties, parameters) {
	const show = property.displayOptions?.show ?? {};
	return Object.entries(show).every(([name, allowed]) => allowed.includes(valueOf(properties, parameters, name)));
}

test('there are example workflows, and the README names each of them', () => {
	assert.ok(files.length >= 3, 'at least three examples');
	const readme = readFileSync(path.join(__dirname, '..', 'README.md'), 'utf8');
	for (const file of files) assert.ok(readme.includes(`examples/${file}`), `README links examples/${file}`);
});

for (const file of files) {
	test(`examples/${file} matches the nodes it uses`, () => {
		const text = readFileSync(path.join(dir, file), 'utf8');
		const workflow = JSON.parse(text);
		assert.equal(typeof workflow.name, 'string');
		assert.ok(/[–—]/.test(text) === false, 'no en or em dash');
		assert.ok(!/gs_live_[A-Za-z0-9]/.test(text), 'no API key');

		const names = new Set(workflow.nodes.map((node) => node.name));
		assert.equal(names.size, workflow.nodes.length, 'node names are unique');
		let ours = 0;
		for (const node of workflow.nodes) {
			assert.equal(node.credentials, undefined, `${node.name} carries no credential`);
			const description = descriptions[node.type];
			if (!description) {
				assert.ok(!node.type.startsWith(`${pkg.name}.`), `${node.type} is a node of this package`);
				continue;
			}
			ours++;
			assert.equal(node.typeVersion, description.version);
			const { properties } = description;
			for (const name of Object.keys(node.parameters)) {
				const matches = properties.filter((property) => property.name === name);
				assert.ok(matches.length > 0, `${node.name}: ${name} is a parameter of ${node.type}`);
				assert.ok(
					matches.some((property) => shown(property, properties, node.parameters)),
					`${node.name}: ${name} shows for its resource and operation`,
				);
			}
			for (const property of properties) {
				if (property.required && property.type !== 'options' && shown(property, properties, node.parameters)) {
					assert.ok(property.name in node.parameters, `${node.name}: the required ${property.name} is set`);
				}
			}
		}
		assert.ok(ours > 0, 'the example uses a GetSales node');

		for (const [from, outputs] of Object.entries(workflow.connections)) {
			assert.ok(names.has(from), `the connection from ${from} starts at a node of the file`);
			for (const output of outputs.main ?? []) {
				for (const link of output) assert.ok(names.has(link.node), `${from} connects to a node of the file`);
			}
		}
	});
}
