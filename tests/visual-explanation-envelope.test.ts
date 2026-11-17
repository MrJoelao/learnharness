/**
 * Tests for Visual Explanation Engine — Envelope & Validation (Phase 6)
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	validateVisualArtifact,
	type ValidationResult,
} from "../src/core/visual-explanation-validator.ts";
import {
	renderMemoryBlocksSvg,
	renderCpuRegistersSvg,
	renderProcessTimelineSvg,
} from "../src/core/visual-primitives.ts";
import type { VisualArtifact } from "../src/core/contracts/visual-explanation.ts";

const VALID_SVG =
	'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 200"><rect width="400" height="200" fill="#f0fdf4"/><text x="20" y="40">Stack Frame</text></svg>';

describe("Visual Explanation Envelope Validation", () => {
	it("accepts a completely valid SVG visual artifact", () => {
		const artifact: VisualArtifact = {
			version: 1,
			id: "memory-stack-1",
			title: "Call Stack Execution",
			summary: "Visualizes the function call stack and local variable allocation",
			renderer: "svg",
			source: VALID_SVG,
			presentation: "inline",
			initialState: { step: 0, maxSteps: 3 },
			controls: [
				{ type: "button", id: "btn-step", label: "Next Step", action: "step-forward" },
				{ type: "button", id: "btn-prev", label: "Prev Step", action: "step-backward" },
				{ type: "button", id: "btn-play", label: "Play", action: "play" },
				{ type: "button", id: "btn-pause", label: "Pause", action: "pause" },
				{ type: "button", id: "btn-reset", label: "Reset", action: "reset" },
			],
			accessibility: {
				description: "A diagram showing stack frames growing downwards from high memory addresses.",
				reducedMotionFallback: true,
			},
		};

		const res = validateVisualArtifact(artifact);
		assert.equal(res.valid, true);
		assert.equal(res.problems.length, 0);
		assert.ok(res.sanitized);
		assert.equal(res.sanitized?.id, "memory-stack-1");
		assert.equal(res.sanitized?.renderer, "svg");
		assert.equal(res.sanitized?.controls?.length, 5);
	});

	it("rejects an HTML visual artifact", () => {
		const artifact = {
			version: 1,
			id: "page-table-walk",
			title: "Page Table Address Translation",
			renderer: "html",
			source: "<div class='table'><div>Page Directory</div><div>Page Table</div></div>",
			presentation: "panel",
		};

		const res = validateVisualArtifact(artifact);
		assert.equal(res.valid, false);
		assert.ok(res.problems.some((p) => p.includes("Renderer 'html' is not permitted")));
	});

	it("rejects non-object or null payloads", () => {
		assert.equal(validateVisualArtifact(null).valid, false);
		assert.equal(validateVisualArtifact("string").valid, false);
		assert.equal(validateVisualArtifact(123).valid, false);
	});

	it("rejects unsupported versions", () => {
		const res = validateVisualArtifact({
			version: 2,
			id: "valid-id",
			title: "Valid Title",
			renderer: "svg",
			source: VALID_SVG,
		});
		assert.equal(res.valid, false);
		assert.ok(res.problems.some((p) => p.includes("Unsupported artifact version")));
	});

	it("rejects invalid, empty, or oversized IDs", () => {
		// Empty
		let res = validateVisualArtifact({
			version: 1,
			id: "",
			title: "Title",
			renderer: "svg",
			source: VALID_SVG,
		});
		assert.equal(res.valid, false);
		assert.ok(res.problems.some((p) => p.includes("Invalid artifact id")));

		// Disallowed characters
		res = validateVisualArtifact({
			version: 1,
			id: "bad id with spaces & symbols!",
			title: "Title",
			renderer: "svg",
			source: VALID_SVG,
		});
		assert.equal(res.valid, false);

		// Oversized (>64 chars)
		res = validateVisualArtifact({
			version: 1,
			id: "a".repeat(65),
			title: "Title",
			renderer: "svg",
			source: VALID_SVG,
		});
		assert.equal(res.valid, false);
	});

	it("rejects empty or oversized titles", () => {
		// Empty
		let res = validateVisualArtifact({
			version: 1,
			id: "test-id",
			title: "   ",
			renderer: "svg",
			source: VALID_SVG,
		});
		assert.equal(res.valid, false);
		assert.ok(res.problems.some((p) => p.includes("Invalid artifact title")));

		// Oversized (>128 chars)
		res = validateVisualArtifact({
			version: 1,
			id: "test-id",
			title: "T".repeat(129),
			renderer: "svg",
			source: VALID_SVG,
		});
		assert.equal(res.valid, false);
	});

	it("rejects unsupported renderers", () => {
		const res = validateVisualArtifact({
			version: 1,
			id: "test-id",
			title: "Title",
			renderer: "canvas",
			source: "console.log('canvas')",
		});
		assert.equal(res.valid, false);
		assert.ok(res.problems.some((p) => p.includes("Unsupported renderer 'canvas'")));
	});

	it("rejects oversized sources (>64KB)", () => {
		const oversized = "<svg>" + "x".repeat(65537) + "</svg>";
		const res = validateVisualArtifact({
			version: 1,
			id: "test-id",
			title: "Title",
			renderer: "svg",
			source: oversized,
		});
		assert.equal(res.valid, false);
		assert.ok(res.problems.some((p) => p.includes("exceeds limit")));
	});

	it("rejects dangerous SVG elements and script execution", () => {
		const dangerousTags = [
			'<svg><script>alert("xss")</script></svg>',
			'<svg><foreignObject><div>xss</div></foreignObject></svg>',
			'<svg><iframe src="evil.com"></iframe></svg>',
			'<svg><link rel="stylesheet" href="http://evil.com/style.css"/></svg>',
			'<svg><object data="evil.swf"></object></svg>',
			'<svg><embed src="evil.swf"/></svg>',
		];

		for (const source of dangerousTags) {
			const res = validateVisualArtifact({
				version: 1,
				id: "sec-test",
				title: "Security Test",
				renderer: "svg",
				source,
			});
			assert.equal(res.valid, false, `Expected source to be rejected: ${source}`);
			assert.ok(res.problems.some((p) => p.includes("forbidden tags")));
		}
	});

	it("rejects inline event handlers in SVG", () => {
		const withHandlers = [
			'<svg onload="alert(1)"><rect width="10" height="10"/></svg>',
			'<svg><rect width="10" height="10" onclick="alert(2)"/></svg>',
			'<svg><circle r="5" onerror="fetch(\'leak\')"/></svg>',
		];

		for (const source of withHandlers) {
			const res = validateVisualArtifact({
				version: 1,
				id: "event-test",
				title: "Event Test",
				renderer: "svg",
				source,
			});
			assert.equal(res.valid, false);
			assert.ok(res.problems.some((p) => p.includes("inline event handlers")));
		}
	});

	it("rejects external URLs and unsafe protocols in SVG", () => {
		const unsafeUrls = [
			'<svg><a href="javascript:alert(1)"><text>Click</text></a></svg>',
			'<svg><image href="http://evil.com/tracker.png"/></svg>',
			'<svg><use href="https://attacker.org/defs.svg#icon"/></svg>',
			'<svg><use xlink:href="//attacker.org/defs.svg#icon"/></svg>',
		];

		for (const source of unsafeUrls) {
			const res = validateVisualArtifact({
				version: 1,
				id: "proto-test",
				title: "Protocol Test",
				renderer: "svg",
				source,
			});
			assert.equal(res.valid, false);
		}
	});

	it("rejects external DTD and entity declarations in SVG", () => {
		const dtd = '<!DOCTYPE svg SYSTEM "http://evil.com/evil.dtd"><svg><rect width="10" height="10"/></svg>';
		const res = validateVisualArtifact({
			version: 1,
			id: "dtd-test",
			title: "DTD Test",
			renderer: "svg",
			source: dtd,
		});
		assert.equal(res.valid, false);
		assert.ok(res.problems.some((p) => p.includes("DTD")));
	});

	it("rejects privileged properties in the envelope", () => {
		const privileged = [
			{ filesystem: "/var/run" },
			{ network: true },
			{ plugin: "com.example.plugin" },
			{ eval: "runCode()" },
		];

		for (const priv of privileged) {
			const res = validateVisualArtifact({
				version: 1,
				id: "priv-test",
				title: "Privileged Test",
				renderer: "svg",
				source: VALID_SVG,
				...priv,
			});
			assert.equal(res.valid, false);
			assert.ok(res.problems.some((p) => p.includes("Unrecognized or privileged capability")));
		}
	});

	it("validates control descriptors thoroughly", () => {
		// Duplicate control IDs rejected
		let res = validateVisualArtifact({
			version: 1,
			id: "ctrl-test",
			title: "Control Test",
			renderer: "svg",
			source: VALID_SVG,
			controls: [
				{ type: "button", id: "btn-1", label: "One", action: "play" },
				{ type: "button", id: "btn-1", label: "Duplicate", action: "reset" },
			],
		});
		assert.equal(res.valid, false);
		assert.ok(res.problems.some((p) => p.includes("Duplicate control id")));

		// Invalid button action
		res = validateVisualArtifact({
			version: 1,
			id: "ctrl-action-test",
			title: "Invalid Action Test",
			renderer: "svg",
			source: VALID_SVG,
			controls: [
				{ type: "button", id: "btn-inv", label: "Fly", action: "fly" },
			],
		});
		assert.equal(res.valid, false);
		assert.ok(res.problems.some((p) => p.includes("invalid action 'fly'")));

		// Non-boolean disabled
		res = validateVisualArtifact({
			version: 1,
			id: "ctrl-disabled-test",
			title: "Invalid Disabled Test",
			renderer: "svg",
			source: VALID_SVG,
			controls: [
				{ type: "button", id: "btn-d", label: "Disabled", action: "play", disabled: "yes" },
			],
		});
		assert.equal(res.valid, false);
		assert.ok(res.problems.some((p) => p.includes("disabled must be a boolean")));

		// Non-button controls rejected: slider
		res = validateVisualArtifact({
			version: 1,
			id: "slider-test",
			title: "Slider Test",
			renderer: "svg",
			source: VALID_SVG,
			controls: [{ type: "slider", id: "s-1", label: "Slider", min: 10, max: 20, value: 15 }],
		});
		assert.equal(res.valid, false);
		assert.ok(res.problems.some((p) => p.includes("unsupported type 'slider'")));

		// Non-button controls rejected: toggle
		res = validateVisualArtifact({
			version: 1,
			id: "toggle-test",
			title: "Toggle Test",
			renderer: "svg",
			source: VALID_SVG,
			controls: [{ type: "toggle", id: "t-1", label: "Toggle", value: true }],
		});
		assert.equal(res.valid, false);
		assert.ok(res.problems.some((p) => p.includes("unsupported type 'toggle'")));

		// Non-button controls rejected: select
		res = validateVisualArtifact({
			version: 1,
			id: "sel-test",
			title: "Select Test",
			renderer: "svg",
			source: VALID_SVG,
			controls: [
				{
					type: "select",
					id: "sel-1",
					label: "Pick",
					options: [{ label: "Opt A", value: "a" }],
					value: "a",
				},
			],
		});
		assert.equal(res.valid, false);
		assert.ok(res.problems.some((p) => p.includes("unsupported type 'select'")));

		// Exceeding MAX_CONTROLS
		const tooManyControls = Array.from({ length: 9 }, (_, i) => ({
			type: "button" as const,
			id: `btn-${i}`,
			label: `Btn ${i}`,
			action: "play" as const,
		}));
		res = validateVisualArtifact({
			version: 1,
			id: "max-ctrl-test",
			title: "Max Controls Test",
			renderer: "svg",
			source: VALID_SVG,
			controls: tooManyControls,
		});
		assert.equal(res.valid, false);
		assert.ok(res.problems.some((p) => p.includes("controls count exceeds limit")));
	});

	it("validates educational visual primitives", () => {
		// Memory blocks
		const memSvg = renderMemoryBlocksSvg({
			title: "Virtual Memory Paging",
			blocks: [
				{ address: "0x0000", label: "Kernel Space", status: "reserved" },
				{ address: "0x4000", label: "Page 0", value: "Frame 12", highlight: true },
				{ address: "0x5000", label: "Page 1", value: "Frame 15", status: "allocated" },
			],
		});
		assert.ok(memSvg.includes("<svg"));
		assert.ok(memSvg.includes("Virtual Memory Paging"));
		assert.ok(memSvg.includes("Frame 12"));

		const memVal = validateVisualArtifact({
			version: 1,
			id: "vm-paging",
			title: "Virtual Memory Paging",
			renderer: "svg",
			source: memSvg,
		});
		assert.equal(memVal.valid, true);

		// CPU registers
		const cpuSvg = renderCpuRegistersSvg({
			title: "Register File",
			registers: [
				{ name: "RAX", value: "0x00000001", highlight: true },
				{ name: "RSP", value: "0x7fffffffe000" },
			],
			stack: ["Return Address (main)", "Saved RBP", "Local var x = 42"],
		});
		assert.ok(cpuSvg.includes("Register File"));
		assert.ok(cpuSvg.includes("RAX"));
		const cpuVal = validateVisualArtifact({
			version: 1,
			id: "cpu-regs",
			title: "CPU Registers",
			renderer: "svg",
			source: cpuSvg,
		});
		assert.equal(cpuVal.valid, true);

		// Process timeline
		const procSvg = renderProcessTimelineSvg({
			title: "Round Robin Scheduling",
			processes: [
				{ pid: "P1", name: "Process 1", start: 0, duration: 4, state: "running" },
				{ pid: "P2", name: "Process 2", start: 4, duration: 4, state: "ready" },
			],
		});
		assert.ok(procSvg.includes("Round Robin Scheduling"));
		assert.ok(procSvg.includes("Process 1"));
		const procVal = validateVisualArtifact({
			version: 1,
			id: "proc-sched",
			title: "Process Scheduling",
			renderer: "svg",
			source: procSvg,
		});
		assert.equal(procVal.valid, true);
	});

	it("validates initialState CSS safety and step constraints (Fix B)", () => {
		const baseControls = [
			{ type: "button" as const, id: "btn-play", label: "Play", action: "play" as const },
			{ type: "button" as const, id: "btn-reset", label: "Reset", action: "reset" as const },
		];

		// 1. Negative step rejected
		let res = validateVisualArtifact({
			version: 1,
			id: "init-state-step-neg",
			title: "Init State Negative Step",
			renderer: "svg",
			source: VALID_SVG,
			controls: baseControls,
			initialState: { step: -1 },
		});
		assert.equal(res.valid, false);
		assert.ok(res.problems.some((p) => p.includes("cannot be negative")));

		// 2. Non-integer step rejected
		res = validateVisualArtifact({
			version: 1,
			id: "init-state-step-float",
			title: "Init State Float Step",
			renderer: "svg",
			source: VALID_SVG,
			controls: baseControls,
			initialState: { step: 1.5 },
		});
		assert.equal(res.valid, false);
		assert.ok(res.problems.some((p) => p.includes("must be an integer")));

		// 3. Unsafe CSS strings in initialState
		res = validateVisualArtifact({
			version: 1,
			id: "init-state-css",
			title: "Init State CSS Injection",
			renderer: "svg",
			source: VALID_SVG,
			controls: baseControls,
			initialState: { customPayload: "red; } body { background: black; } /*" },
		});
		assert.equal(res.valid, false);
		assert.ok(res.problems.some((p) => p.includes("disallowed characters or keywords for CSS safety")));

		// 4. Disallowed CSS url() expression in initialState string rejected
		res = validateVisualArtifact({
			version: 1,
			id: "init-state-css-url",
			title: "Init State CSS URL",
			renderer: "svg",
			source: VALID_SVG,
			controls: baseControls,
			initialState: { styleProp: "url(https://evil.com/bg.png)" },
		});
		assert.equal(res.valid, false);
		assert.ok(res.problems.some((p) => p.includes("disallowed characters or keywords for CSS safety")));
	});
});
