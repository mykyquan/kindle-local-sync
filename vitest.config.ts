import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
	resolve: {
		alias: {
			obsidian: resolve(__dirname, "__mocks__/obsidian.ts"),
		},
	},
});
