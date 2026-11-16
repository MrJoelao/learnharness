/**
 * Tests for Visual Explanation Engine — Declarative SVG Schema, Validator & React Renderer (Phase 6)
 */

import React from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
	validateVisualArtifact,
	validateDeclarativeSvgDocument,
	isDeclarativeSvg,
	parseDeclarativeSvg,
} from "../src/core/visual-explanation-validator.ts";
import {
	DECLARATIVE_SVG_SCHEMA,
	type DeclarativeSvgDocument,
	type VisualArtifact,
} from "../src/core/contracts/visual-explanation.ts";
import { DeclarativeSvgRenderer } from "../components/artifacts/declarative-svg-renderer.tsx";
import { createVisualExplanationTool } from "../src/agent/tools/visual-explanation.ts";
import { chatStore } from "../src/store/chats.ts";

const VALID_DECLARATIVE_DOC: DeclarativeSvgDocument = {
	schema: "learnharness.visual.svg.v1",
	viewBox: { width: 800, height: 450 },
	steps: [
		{
			id: "step-1",
			label: "Initial Memory Layout",
			description: "Stack and heap before function call",
			elements: [
				{
					type: "rect",
					x: 40,
					y: 60,
					width: 160,
					height: 80,
					fill: "#64748b",
					stroke: "#334155",
					strokeWidth: 2,
				},
				{
					type: "circle",
					cx: 250,
					cy: 100,
					r: 40,
					fill: "#3b82f6",
					stroke: "#1d4ed8",
				},
				{
					type: "ellipse",
					cx: 400,
					cy: 100,
					rx: 60,
					ry: 30,
					fill: "#10b981",
				},
				{
					type: "line",
					x1: 40,
					y1: 200,
					x2: 300,
					y2: 200,
					stroke: "#ef4444",
					strokeWidth: 2,
				},
				{
					type: "polyline",
					points: "50,250 100,280 150,240 200,290",
					stroke: "#8b5cf6",
					strokeWidth: 2,
				},
				{
					type: "polygon",
					points: "300,250 350,220 400,270",
					fill: "#f59e0b",
				},
				{
					type: "text",
					x: 120,
					y: 105,
					text: "Memory Block",
					fontSize: 16,
					anchor: "middle",
					fill: "#ffffff",
				},
			],
		},
		{
			id: "step-2",
			label: "Allocated Stack Frame",
			description: "Local variables pushed to stack",
			elements: [
				{
					type: "rect",
					x: 40,
					y: 60,
					width: 200,
					height: 120,
					fill: "#2563eb",
				},
				{
					type: "text",
					x: 140,
					y: 120,
					text: "Stack Frame [foo()]",
					fontSize: 14,
					anchor: "middle",
					fill: "#ffffff",
				},
			],
		},
	],
};

const VALID_DECLARATIVE_JSON = JSON.stringify(VALID_DECLARATIVE_DOC);

describe("Declarative SVG Schema and Validator", () => {
	it("validates a fully conformant declarative SVG document", () => {
		const res = validateDeclarativeSvgDocument(VALID_DECLARATIVE_DOC);
		assert.equal(res.valid, true);
		assert.equal(res.problems.length, 0);
		assert.ok(res.document);
		assert.equal(res.document?.steps.length, 2);
		assert.equal(res.document?.steps[0]?.elements.length, 7);
	});

	it("identifies and parses declarative SVG JSON in VisualArtifact envelope", () => {
		assert.equal(isDeclarativeSvg(VALID_DECLARATIVE_JSON), true);
		assert.equal(isDeclarativeSvg("<svg></svg>"), false);
		assert.equal(isDeclarativeSvg("not json"), false);

		const parsed = parseDeclarativeSvg(VALID_DECLARATIVE_JSON);
		assert.ok(parsed);
		assert.equal(parsed?.schema, DECLARATIVE_SVG_SCHEMA);

		const artifact: VisualArtifact = {
			version: 1,
			id: "decl-visual-1",
			title: "Declarative Memory Model",
			renderer: "svg",
			source: VALID_DECLARATIVE_JSON,
			presentation: "inline",
		};

		const res = validateVisualArtifact(artifact);
		assert.equal(res.valid, true);
		assert.equal(res.problems.length, 0);
		assert.ok(res.sanitized);
		assert.equal(res.sanitized?.id, "decl-visual-1");
	});

	it("rejects unknown or invalid declarative SVG schema", () => {
		const invalidSchema = {
			...VALID_DECLARATIVE_DOC,
			schema: "learnharness.visual.custom.v9",
		};
		const res = validateDeclarativeSvgDocument(invalidSchema);
		assert.equal(res.valid, false);
		assert.ok(res.problems.some((p) => p.includes("Unsupported or missing declarative SVG schema")));
	});

	it("rejects invalid or non-finite viewBox dimensions", () => {
		// Negative width
		let res = validateDeclarativeSvgDocument({
			...VALID_DECLARATIVE_DOC,
			viewBox: { width: -100, height: 400 },
		});
		assert.equal(res.valid, false);
		assert.ok(res.problems.some((p) => p.includes("viewBox width must be a finite positive number")));

		// NaN height
		res = validateDeclarativeSvgDocument({
			...VALID_DECLARATIVE_DOC,
			viewBox: { width: 800, height: Number.NaN },
		});
		assert.equal(res.valid, false);

		// Oversized viewBox (>4000)
		res = validateDeclarativeSvgDocument({
			...VALID_DECLARATIVE_DOC,
			viewBox: { width: 5000, height: 400 },
		});
		assert.equal(res.valid, false);
	});

	it("rejects non-allowlisted SVG element types", () => {
		const forbiddenElements = [
			{ type: "script", text: "alert(1)" },
			{ type: "foreignObject", width: 100, height: 100 },
			{ type: "iframe", src: "https://evil.com" },
			{ type: "image", href: "https://evil.com/pic.png" },
			{ type: "use", href: "#icon" },
			{ type: "unknownCustomComponent", props: {} },
		];

		for (const el of forbiddenElements) {
			const doc = {
				schema: DECLARATIVE_SVG_SCHEMA,
				viewBox: { width: 400, height: 200 },
				steps: [
					{
						id: "s1",
						label: "Step 1",
						elements: [el],
					},
				],
			};
			const res = validateDeclarativeSvgDocument(doc);
			assert.equal(res.valid, false);
			assert.ok(res.problems.some((p) => p.includes("disallowed type")));
		}
	});

	it("rejects event handlers and executable attributes on elements", () => {
		const doc = {
			schema: DECLARATIVE_SVG_SCHEMA,
			viewBox: { width: 400, height: 200 },
			steps: [
				{
					id: "s1",
					label: "Step 1",
					elements: [
						{
							type: "rect",
							x: 10,
							y: 10,
							width: 100,
							height: 50,
							onClick: "handleClick()",
							dangerouslySetInnerHTML: { __html: "<script>bad</script>" },
						},
					],
				},
			],
		};
		const res = validateDeclarativeSvgDocument(doc);
		assert.equal(res.valid, false);
		assert.ok(res.problems.some((p) => p.includes("disallowed attribute 'onClick'")));
	});

	it("rejects unsafe color functions and CSS injections in fills and strokes", () => {
		const unsafeColors = [
			"url(https://evil.com/leak)",
			"expression(alert(1))",
			"javascript:void(0)",
			"red; background: black;",
			"data:text/css,...",
		];

		for (const color of unsafeColors) {
			const doc = {
				schema: DECLARATIVE_SVG_SCHEMA,
				viewBox: { width: 400, height: 200 },
				steps: [
					{
						id: "s1",
						label: "Step 1",
						elements: [
							{
								type: "rect",
								x: 10,
								y: 10,
								width: 50,
								height: 50,
								fill: color,
							},
						],
					},
				],
			};
			const res = validateDeclarativeSvgDocument(doc);
			assert.equal(res.valid, false);
			assert.ok(res.problems.some((p) => p.includes("invalid or unsafe fill color")));
		}
	});

	it("enforces resource limits: max steps (30) and max elements (100)", () => {
		// Exceed max steps
		const tooManySteps: unknown[] = [];
		for (let i = 0; i < 31; i++) {
			tooManySteps.push({ id: `step-${i}`, label: `Step ${i}`, elements: [] });
		}
		let res = validateDeclarativeSvgDocument({
			schema: DECLARATIVE_SVG_SCHEMA,
			viewBox: { width: 400, height: 200 },
			steps: tooManySteps,
		});
		assert.equal(res.valid, false);
		assert.ok(res.problems.some((p) => p.includes("exceeds maximum limit of 30")));

		// Exceed max elements per step
		const tooManyElements: unknown[] = [];
		for (let i = 0; i < 101; i++) {
			tooManyElements.push({ type: "rect", x: i, y: i, width: 10, height: 10 });
		}
		res = validateDeclarativeSvgDocument({
			schema: DECLARATIVE_SVG_SCHEMA,
			viewBox: { width: 400, height: 200 },
			steps: [{ id: "step-1", label: "Dense Step", elements: tooManyElements }],
		});
		assert.equal(res.valid, false);
		assert.ok(res.problems.some((p) => p.includes("exceeds maximum limit of 100")));
	});

	it("rejects non-finite coordinate values", () => {
		const doc = {
			schema: DECLARATIVE_SVG_SCHEMA,
			viewBox: { width: 400, height: 200 },
			steps: [
				{
					id: "s1",
					label: "Step 1",
					elements: [
						{
							type: "circle",
							cx: Number.POSITIVE_INFINITY,
							cy: 50,
							r: 20,
						},
					],
				},
			],
		};
		const res = validateDeclarativeSvgDocument(doc);
		assert.equal(res.valid, false);
		assert.ok(res.problems.some((p) => p.includes("must be a finite coordinate")));
	});
});

describe("Declarative SVG React Renderer", () => {
	it("renders all allowlisted primitive elements into native SVG tags", () => {
		const html = renderToStaticMarkup(
			<DeclarativeSvgRenderer document={VALID_DECLARATIVE_DOC} currentStep={0} />,
		);

		assert.ok(html.includes("<svg"), "Must render root svg tag");
		assert.ok(html.includes('viewBox="0 0 800 450"'), "Must render viewBox attribute");
		assert.ok(html.includes("<rect"), "Must render rect element");
		assert.ok(html.includes("<circle"), "Must render circle element");
		assert.ok(html.includes("<ellipse"), "Must render ellipse element");
		assert.ok(html.includes("<line"), "Must render line element");
		assert.ok(html.includes("<polyline"), "Must render polyline element");
		assert.ok(html.includes("<polygon"), "Must render polygon element");
		assert.ok(html.includes("<text"), "Must render text element");
		assert.ok(html.includes("Memory Block"), "Must render text content");

		// Verifies no dangerouslySetInnerHTML or script evaluation was used
		assert.ok(!html.includes("dangerouslySetInnerHTML"));
		assert.ok(!html.includes("<script"));
	});

	it("renders elements corresponding to the active step index", () => {
		// Step 0
		const step0Html = renderToStaticMarkup(
			<DeclarativeSvgRenderer document={VALID_DECLARATIVE_DOC} currentStep={0} />,
		);
		assert.ok(step0Html.includes("Memory Block"));
		assert.ok(!step0Html.includes("Stack Frame [foo()]"));

		// Step 1
		const step1Html = renderToStaticMarkup(
			<DeclarativeSvgRenderer document={VALID_DECLARATIVE_DOC} currentStep={1} />,
		);
		assert.ok(step1Html.includes("Stack Frame [foo()]"));
		assert.ok(!step1Html.includes("Memory Block"));
	});

	it("renders accessible description when present on active step", () => {
		const html = renderToStaticMarkup(
			<DeclarativeSvgRenderer document={VALID_DECLARATIVE_DOC} currentStep={0} />,
		);
		assert.ok(html.includes("<desc>Stack and heap before function call</desc>"));
	});

	it("renders fallback for empty document without throwing", () => {
		const emptyDoc = {
			schema: DECLARATIVE_SVG_SCHEMA,
			viewBox: { width: 400, height: 200 },
			steps: [],
		};
		const html = renderToStaticMarkup(
			<DeclarativeSvgRenderer document={emptyDoc as unknown as DeclarativeSvgDocument} currentStep={0} />,
		);
		assert.ok(html.includes("No visualization elements available"));
	});
});

describe("Visual Explanation Agent Tool — Host-Managed ID & Boundary Rules", () => {
	it("automatically generates a host ID on create when agent omits id", async () => {
		const chat = chatStore.createChat("Host ID Generation Test");
		const tool = createVisualExplanationTool({ chatId: chat.id, chatStore });

		const result = await tool.execute("call_host_id", {
			action: "create",
			title: "Host Generated ID Visual",
			renderer: "svg",
			source: VALID_DECLARATIVE_JSON,
		});

		assert.equal(result.isError, undefined);
		const details = result.details as { ok: boolean; action: string; artifact: VisualArtifact };
		assert.equal(details.ok, true);
		assert.ok(details.artifact.id.startsWith("vis-"), "Host must generate prefixed unique ID");

		const stored = chatStore.getVisualArtifact(chat.id, details.artifact.id);
		assert.ok(stored);
		assert.equal(stored?.title, "Host Generated ID Visual");

		chatStore.deleteChat(chat.id);
	});

	it("rejects cross-chat updates targeting an artifact belonging to another session", async () => {
		const chatA = chatStore.createChat("Session A");
		const chatB = chatStore.createChat("Session B");

		const toolA = createVisualExplanationTool({ chatId: chatA.id, chatStore });
		const toolB = createVisualExplanationTool({ chatId: chatB.id, chatStore });

		// Create artifact in chat A
		await toolA.execute("call_a", {
			action: "create",
			id: "isolated-visual",
			title: "Chat A Visual",
			renderer: "svg",
			source: VALID_DECLARATIVE_JSON,
		});

		// Attempt to update from chat B
		const updateFromB = await toolB.execute("call_b", {
			action: "update",
			id: "isolated-visual",
			title: "Hijacked Title",
		});

		assert.equal(updateFromB.isError, true);
		const problems = (updateFromB.details as { problems?: string[] })?.problems ?? [];
		assert.ok(problems.some((p) => p.includes("not found in this session")));

		// Chat A artifact is unmodified
		const storedA = chatStore.getVisualArtifact(chatA.id, "isolated-visual");
		assert.equal(storedA?.title, "Chat A Visual");

		chatStore.deleteChat(chatA.id);
		chatStore.deleteChat(chatB.id);
	});
});
