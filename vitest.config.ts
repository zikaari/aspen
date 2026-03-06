import { defineConfig } from 'vitest/config'

export default defineConfig({
	resolve: {
		conditions: ['@aspen/source'],
	},
	test: {
		include: ['packages/*/test/**/*.test.{ts,tsx}'],
		passWithNoTests: true,
	},
})
