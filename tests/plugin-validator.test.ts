import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, it } from "node:test";
import { validatePlugin } from "../scripts/validate-plugin.mjs";

describe("Plugin Architectural and UI/UX Validator", () => {
	it("accepts canonical study-mode-template with 0 errors and 0 warnings", () => {
		const result = validatePlugin("examples/plugins/study-mode-template");
		assert.equal(result.ok, true);
		assert.equal(result.errors, 0);
		assert.equal(result.warnings, 0);
	});

	it("accepts canonical multi-mode example", () => {
		const result = validatePlugin("examples/plugins/multi-mode");
		assert.equal(result.ok, true);
		assert.equal(result.errors, 0);
	});

	it("rejects non-existent directory", () => {
		const result = validatePlugin("non-existent-plugin-dir-xyz");
		assert.equal(result.ok, false);
		assert.ok(result.errors > 0);
	});

	it("rejects missing manifest.json", () => {
		const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lh-validator-test-"));
		try {
			const result = validatePlugin(tmp);
			assert.equal(result.ok, false);
			assert.ok(result.errors > 0);
		} finally {
			fs.rmSync(tmp, { recursive: true, force: true });
		}
	});

	it("flags forbidden host imports and AI slop tells", () => {
		const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lh-validator-test-"));
		try {
			const dist = path.join(tmp, "dist");
			fs.mkdirSync(dist, { recursive: true });
			fs.writeFileSync(
				path.join(dist, "manifest.json"),
				JSON.stringify({
					apiVersion: 1,
					id: "slop-plugin",
					name: "Slop Plugin",
					version: "1.0.0",
					main: "main.js",
				}),
			);
			fs.writeFileSync(
				path.join(dist, "main.js"),
				`
				import { Button } from "@/components/ui/button"; // forbidden!
				export function activate(ctx) {
					const btn = document.createElement("button");
					btn.className = "bg-gradient-to-r from-purple-500 to-pink-500 shadow-[0_0_20px_#a855f7]";
					btn.textContent = "🚀 Click Me 🚀";
					btn.style.color = "#ffffff";
				}
				`,
			);

			const result = validatePlugin(tmp);
			assert.equal(result.ok, false, "Should fail due to forbidden host import");
			assert.ok(result.errors >= 1, "Expected forbidden import error");
			assert.ok(result.warnings >= 2, "Expected warnings for slop tells (gradient, glow, hex color, emoji)");
		} finally {
			fs.rmSync(tmp, { recursive: true, force: true });
		}
	});
});
