// The lint gate of n8n's community package scanner, rebuilt for local runs. It mirrors
// buildScanConfig() in @n8n/scan-community-package 0.42.0 (dist/scanner.js): the
// recommended rules of @n8n/eslint-plugin-community-nodes, no-console, and the three
// rulesets of eslint-plugin-n8n-nodes-base with the same rules switched off. Keep the
// versions in package.json equal to the ones that scanner release pins.
import { n8nCommunityNodesPlugin } from '@n8n/eslint-plugin-community-nodes';
import tsParser from '@typescript-eslint/parser';
import n8nNodesPlugin from 'eslint-plugin-n8n-nodes-base';
import { defineConfig } from 'eslint/config';

export default defineConfig(
	{ ignores: ['dist/**', 'node_modules/**', 'test/**', 'scripts/**', 'package-lock.json'] },
	n8nCommunityNodesPlugin.configs.recommended,
	{
		rules: { 'no-console': 'error' },
	},
	{ plugins: { 'n8n-nodes-base': n8nNodesPlugin } },
	{
		files: ['package.json'],
		rules: { ...n8nNodesPlugin.configs.community.rules },
	},
	{
		files: ['**/credentials/**/*.ts'],
		rules: {
			...n8nNodesPlugin.configs.credentials.rules,
			'n8n-nodes-base/cred-class-field-documentation-url-miscased': 'off',
			'n8n-nodes-base/cred-class-field-type-options-password-missing': 'off',
		},
	},
	{
		files: ['**/nodes/**/*.ts'],
		rules: {
			...n8nNodesPlugin.configs.nodes.rules,
			'n8n-nodes-base/node-class-description-inputs-wrong-regular-node': 'off',
			'n8n-nodes-base/node-class-description-outputs-wrong': 'off',
			'n8n-nodes-base/node-param-type-options-max-value-present': 'off',
		},
	},
	{
		files: ['**/*.json'],
		languageOptions: { parser: tsParser },
	},
	{
		files: ['**/*.ts'],
		languageOptions: { parser: tsParser },
	},
);
