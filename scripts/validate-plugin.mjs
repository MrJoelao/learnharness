#!/usr/bin/env node
/**
 * Plugin Architectural and UI/UX Validator
 * Validates a LearnHarness plugin against manifest specifications, host boundaries,
 * and UI/UX craft guidelines (anti-slop).
 *
 * Usage:
 *   node scripts/validate-plugin.mjs <path-to-plugin-dir>
 */
import * as fs from "node:fs";
import * as path from "node:path";

const ALLOWED_ICONS = new Set([
	"BookOpen", "Brain", "Calculator", "Code", "FlaskConical",
	"GraduationCap", "Lightbulb", "Network", "Puzzle", "Target"
]);

const FORBIDDEN_IMPORT_PATTERNS = [
	{ pattern: /from\s+["']@\/components(?:\/.*)?["']/, message: "Cannot import private host components from '@/components'" },
	{ pattern: /from\s+["']@\/src(?:\/.*)?["']/, message: "Cannot import private host modules from '@/src'" },
	{ pattern: /from\s+["']next(?:\/.*)?["']/, message: "Cannot import Next.js runtime modules inside plugin bundle" },
];

const SLOP_PATTERNS = [
	{ pattern: /(?:background|color|border):\s*#(?:[0-9a-fA-F]{3,8})\b/, message: "Avoid hardcoded hex colors; use host CSS variables like var(--background), var(--card), var(--border)" },
	{ pattern: /shadow-\[0_0_[0-9]+px/, message: "Avoid glowing neon box shadows (AI slop indicator)" },
	{ pattern: /(?:bg-gradient-to|from-purple|to-pink|from-indigo)/, message: "Avoid purple/violet AI gradient tropes; prefer quiet neutral surfaces" },
	{ pattern: /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u, message: "Avoid emojis in buttons or headers; use host Lucide icon names" },
];

function log(status, msg) {
	const icon = status === "pass" ? "✔" : status === "warn" ? "⚠" : "✖";
	console.log(`  ${icon} [${status.toUpperCase()}] ${msg}`);
}

export function validatePlugin(targetPath) {
	console.log(`\nAnalyzing LearnHarness plugin at: ${targetPath}`);
	const resolved = path.resolve(targetPath);
	if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
		log("fail", `Target directory not found: ${resolved}`);
		return { ok: false, errors: 1, warnings: 0 };
	}

	let errors = 0;
	let warnings = 0;

	// 1. Locate manifest.json
	let manifestPath = path.join(resolved, "dist", "manifest.json");
	if (!fs.existsSync(manifestPath)) {
		manifestPath = path.join(resolved, "manifest.json");
	}

	if (!fs.existsSync(manifestPath)) {
		log("fail", "Missing manifest.json (expected in plugin root or dist/)");
		return { ok: false, errors: 1, warnings: 0 };
	}

	let manifest;
	try {
		manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
		log("pass", "manifest.json is valid JSON");
	} catch (err) {
		log("fail", `manifest.json syntax error: ${err.message}`);
		return { ok: false, errors: 1, warnings: 0 };
	}

	// 2. Validate manifest fields
	if (manifest.apiVersion !== 1) {
		log("fail", `Expected apiVersion: 1, got ${manifest.apiVersion}`);
		errors++;
	} else {
		log("pass", "apiVersion: 1");
	}

	if (!manifest.id || typeof manifest.id !== "string" || !/^[a-z0-9][a-z0-9._-]*$/.test(manifest.id)) {
		log("fail", `Invalid plugin id: '${manifest.id}'. Must start with letter/digit and contain only lowercase ASCII/numbers/dashes.`);
		errors++;
	} else {
		log("pass", `Valid plugin id: ${manifest.id}`);
	}

	if (!manifest.name || typeof manifest.name !== "string") {
		log("fail", "Missing or non-string plugin 'name'");
		errors++;
	} else {
		log("pass", `Plugin name: ${manifest.name}`);
	}

	const baseDir = path.dirname(manifestPath);

	// Check entry points
	if (manifest.main) {
		const mainFile = path.resolve(baseDir, manifest.main);
		if (!fs.existsSync(mainFile)) {
			log("fail", `Declared main entry '${manifest.main}' not found at: ${mainFile}`);
			errors++;
		} else {
			log("pass", `Main entry found: ${manifest.main}`);
		}
	}

	if (manifest.backend) {
		const backendFile = path.resolve(baseDir, manifest.backend);
		if (!fs.existsSync(backendFile)) {
			log("fail", `Declared backend entry '${manifest.backend}' not found at: ${backendFile}`);
			errors++;
		} else {
			log("pass", `Backend entry found: ${manifest.backend}`);
		}
	}

	// 3. Scan JS/TS/CSS source files for architecture and anti-slop rules
	const filesToScan = [];
	function walk(dir) {
		for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
			if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "data") continue;
			const full = path.join(dir, entry.name);
			if (entry.isDirectory()) {
				walk(full);
			} else if (/\.(js|mjs|cjs|ts|tsx|css)$/.test(entry.name)) {
				filesToScan.push(full);
			}
		}
	}
	walk(resolved);

	let hasSignalCleanup = false;
	for (const file of filesToScan) {
		const rel = path.relative(resolved, file);
		const content = fs.readFileSync(file, "utf8");

		// Check forbidden imports
		for (const { pattern, message } of FORBIDDEN_IMPORT_PATTERNS) {
			if (pattern.test(content)) {
				log("fail", `${rel}: ${message}`);
				errors++;
			}
		}

		// Check for signal cleanup in frontend renderer
		if (content.includes("registerModeRenderer") || content.includes("registerView")) {
			if (content.includes("signal.aborted") || content.includes("signal.addEventListener") || content.includes("return () =>") || content.includes("return cleanup")) {
				hasSignalCleanup = true;
			}
		}

		// Check anti-slop rules
		for (const { pattern, message } of SLOP_PATTERNS) {
			if (pattern.test(content)) {
				log("warn", `${rel}: ${message}`);
				warnings++;
			}
		}

		// Check backend mode registrations for valid Lucide icon
		const iconMatch = content.match(/icon:\s*["']([^"']+)["']/);
		if (iconMatch && iconMatch[1]) {
			const icon = iconMatch[1];
			if (!ALLOWED_ICONS.has(icon)) {
				log("warn", `${rel}: Icon '${icon}' is not in the host's supported Lucide mode icons: ${[...ALLOWED_ICONS].join(", ")}`);
				warnings++;
			} else {
				log("pass", `Registered supported mode icon: ${icon}`);
			}
		}
	}

	if (manifest.main && !hasSignalCleanup) {
		log("warn", "Renderer does not appear to check 'signal.aborted' or register cleanup on abort signal.");
		warnings++;
	} else if (manifest.main) {
		log("pass", "Renderer handles lifecycle and abort signal cleanup.");
	}

	console.log(`\nSummary: ${errors === 0 ? "PASSED" : "FAILED"} (${errors} errors, ${warnings} warnings)\n`);
	return { ok: errors === 0, errors, warnings };
}

if (process.argv[1] && process.argv[1].endsWith("validate-plugin.mjs")) {
	const target = process.argv[2] || ".";
	const result = validatePlugin(target);
	process.exit(result.ok ? 0 : 1);
}
