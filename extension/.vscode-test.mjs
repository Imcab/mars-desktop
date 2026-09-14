import { defineConfig } from '@vscode/test-cli';

// Two runs, because they need different things. The unit tests are pure
// functions over Java text and want no workspace at all; the integration tests
// only mean anything with a MARS project open, since finding one is half of
// what they check.
export default defineConfig([
	{
		label: 'unit',
		files: 'out/test/unit/**/*.test.js',
	},
	{
		label: 'integration',
		files: 'out/test/integration/**/*.test.js',
		workspaceFolder: './src/test/fixture',
	},
]);
