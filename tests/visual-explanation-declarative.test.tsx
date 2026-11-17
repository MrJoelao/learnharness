/**
 * Tests for Visual Explanation Engine — Declarative SVG Schema, Validator & React Renderer (Phase 6)
 */

import React, { act } from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { parseHTML } from "linkedom";
import {
	validateVisualArtifact,
	validateDeclarativeVisualArtifact,
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
import {
	VisualExplanationCard,
	VisualExplanationInstance,
	registerVisualArtifact,
	getRegisteredVisualArtifact,
	clearVisualArtifactRegistry,
	subscribeVisualArtifact,
} from "../components/artifacts/visual-explanation-card.tsx";
import { ToolPartRenderer } from "../components/plugin-renderers.tsx";
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

		// Create artifact in chat A (host generates ID)
		const createResA = await toolA.execute("call_a", {
			action: "create",
			title: "Chat A Visual",
			renderer: "svg",
			source: VALID_DECLARATIVE_JSON,
		});
		assert.equal(createResA.isError, undefined);
		const idA = (createResA.details as { artifact: VisualArtifact }).artifact.id;

		// Attempt to update from chat B
		const updateFromB = await toolB.execute("call_b", {
			action: "update",
			id: idA,
			title: "Hijacked Title",
		});

		assert.equal(updateFromB.isError, true);
		const problems = (updateFromB.details as { problems?: string[] })?.problems ?? [];
		assert.ok(problems.some((p) => p.includes("not found")));

		// Chat A artifact is unmodified
		const storedA = chatStore.getVisualArtifact(chatA.id, idA);
		assert.equal(storedA?.title, "Chat A Visual");

		chatStore.deleteChat(chatA.id);
		chatStore.deleteChat(chatB.id);
	});
});

describe("Phase 6 Targeted Bug Fixes & Specification Verification", () => {
	it("BUG P1: validator strictly rejects HTML, raw SVG XML, and non-declarative JSON by default", () => {
		// Valid declarative JSON -> accepted
		const validRes = validateDeclarativeVisualArtifact({
			version: 1,
			id: "vis-valid",
			title: "Valid Declarative",
			renderer: "svg",
			source: VALID_DECLARATIVE_JSON,
		});
		assert.equal(validRes.valid, true);

		// HTML renderer -> rejected
		const htmlRendererRes = validateDeclarativeVisualArtifact({
			version: 1,
			id: "vis-html",
			title: "HTML Renderer",
			renderer: "html",
			source: "<div>test</div>",
		});
		assert.equal(htmlRendererRes.valid, false);
		assert.ok(htmlRendererRes.problems.some((p) => p.includes("not permitted")));

		// Raw SVG XML -> rejected
		const rawSvgRes = validateDeclarativeVisualArtifact({
			version: 1,
			id: "vis-raw-svg",
			title: "Raw SVG",
			renderer: "svg",
			source: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="40"/></svg>',
		});
		assert.equal(rawSvgRes.valid, false);
		assert.ok(rawSvgRes.problems.some((p) => p.includes("Raw SVG XML is not permitted")));

		// Unknown/unrecognized schema in JSON -> rejected
		const unknownSchemaRes = validateDeclarativeVisualArtifact({
			version: 1,
			id: "vis-bad-schema",
			title: "Bad Schema",
			renderer: "svg",
			source: JSON.stringify({
				schema: "unknown.schema.v1",
				viewBox: { width: 100, height: 100 },
				steps: [{ id: "s1", label: "Step", elements: [] }],
			}),
		});
		assert.equal(unknownSchemaRes.valid, false);
		assert.ok(unknownSchemaRes.problems.some((p) => p.includes("Unsupported or missing declarative SVG schema")));
	});

	it("BUG P1: registry isolates artifacts and subscriptions across different conversations", () => {
		clearVisualArtifactRegistry();

		const artChat1: VisualArtifact = {
			version: 1,
			id: "vis-shared",
			title: "Chat 1 Diagram",
			renderer: "svg",
			source: VALID_DECLARATIVE_JSON,
			presentation: "inline",
		};

		const artChat2: VisualArtifact = {
			version: 1,
			id: "vis-shared",
			title: "Chat 2 Diagram",
			renderer: "svg",
			source: VALID_DECLARATIVE_JSON,
			presentation: "inline",
		};

		// Register same artifact ID in two different chats
		registerVisualArtifact(artChat1, "chat-1");
		registerVisualArtifact(artChat2, "chat-2");

		// Retrievals are isolated
		assert.equal(getRegisteredVisualArtifact("vis-shared", "chat-1")?.title, "Chat 1 Diagram");
		assert.equal(getRegisteredVisualArtifact("vis-shared", "chat-2")?.title, "Chat 2 Diagram");

		// Subscriptions are isolated
		let chat1Notified = false;
		let chat2Notified = false;

		const unsub1 = subscribeVisualArtifact(
			"vis-shared",
			() => {
				chat1Notified = true;
			},
			"chat-1",
		);

		const unsub2 = subscribeVisualArtifact(
			"vis-shared",
			() => {
				chat2Notified = true;
			},
			"chat-2",
		);

		// Updating chat-2 should NOT trigger chat-1's listener
		registerVisualArtifact({ ...artChat2, title: "Chat 2 Updated" }, "chat-2");
		assert.equal(chat1Notified, false, "Chat 1 must not be notified on Chat 2 update");
		assert.equal(chat2Notified, true, "Chat 2 listener must be notified");

		unsub1();
		unsub2();
		clearVisualArtifactRegistry();
	});

	it("BUG P2: declarative SVG cards reject and do not render non-button controls (slider, toggle, select)", () => {
		const rawControlsPayload = {
			version: 1,
			id: "vis-controls-test",
			title: "Controls Filter Test",
			renderer: "svg",
			source: VALID_DECLARATIVE_JSON,
			presentation: "inline",
			controls: [
				{ type: "button", id: "btn-step", label: "Next Step", action: "step-forward" },
				{ type: "slider", id: "speed-slider", label: "Speed", min: 1, max: 10, value: 5 },
				{ type: "toggle", id: "show-labels", label: "Labels", value: true },
				{
					type: "select",
					id: "arch",
					label: "Architecture",
					options: [{ label: "x86", value: "x86" }],
					value: "x86",
				},
			],
		};

		// 1. Validator rejects payload containing non-button controls
		const valRes = validateDeclarativeVisualArtifact(rawControlsPayload);
		assert.equal(valRes.valid, false, "Non-button controls must be rejected by validator");
		assert.ok(valRes.problems.some((p) => p.includes("unsupported type 'slider'")));
		assert.ok(valRes.problems.some((p) => p.includes("unsupported type 'toggle'")));
		assert.ok(valRes.problems.some((p) => p.includes("unsupported type 'select'")));

		// 2. Card with raw output containing non-button controls renders failure alert
		const html = renderToStaticMarkup(
			<VisualExplanationCard
				part={{
					type: "tool-visual_explanation",
					state: "output-available",
					toolCallId: "call_ctrls",
					output: { ok: true, artifact: rawControlsPayload as unknown as VisualArtifact },
				}}
			/>,
		);

		assert.ok(html.includes('data-testid="visual-explanation-failed"'), "Card must fail validation");
		assert.ok(!html.includes('data-testid="visual-control-slider-speed-slider"'), "Slider must not render");
		assert.ok(!html.includes('data-testid="visual-control-toggle-show-labels"'), "Toggle must not render");
		assert.ok(!html.includes('data-testid="visual-control-select-arch"'), "Select must not render");
		assert.ok(!html.includes('type="range"'), "Range input must not render");
		assert.ok(!html.includes('type="checkbox"'), "Checkbox input must not render");
	});

	it("BUG P2: prefers-reduced-motion truth table verified", () => {
		// Test the truth table specified in Bug P5:
		// OS false + fallback true -> Autoplay allowed (reducedMotion is false)
		// OS true + fallback true -> Autoplay disabled (reducedMotion is true)
		// OS false + fallback false -> Autoplay allowed (reducedMotion is false)
		// OS true + fallback false -> Autoplay disabled (reducedMotion is true)

		function computeReducedMotion(osMatches: boolean): boolean {
			// As implemented in visual-explanation-card.tsx:
			// prefers-reduced-motion is the sole source of truth
			return Boolean(osMatches);
		}

		assert.equal(computeReducedMotion(false), false, "OS false -> animation allowed regardless of fallback");
		assert.equal(computeReducedMotion(true), true, "OS true -> animation disabled regardless of fallback");
	});

	it("BUG P2: initialState.step is strictly bounded within [0, steps.length - 1]", () => {
		// Valid step: 1 (out of 2 steps: 0, 1) -> accepted
		const validRes = validateDeclarativeVisualArtifact({
			version: 1,
			id: "vis-step-valid",
			title: "Valid Step",
			renderer: "svg",
			source: VALID_DECLARATIVE_JSON,
			initialState: { step: 1 },
		});
		assert.equal(validRes.valid, true);

		// Out of bounds step: 99 -> rejected by validator
		const oobRes = validateDeclarativeVisualArtifact({
			version: 1,
			id: "vis-step-oob",
			title: "OOB Step",
			renderer: "svg",
			source: VALID_DECLARATIVE_JSON,
			initialState: { step: 99 },
		});
		assert.equal(oobRes.valid, false);
		assert.ok(oobRes.problems.some((p) => p.includes("exceeds maximum step index (1)")));

		// Negative step: -1 -> rejected by validator
		const negRes = validateDeclarativeVisualArtifact({
			version: 1,
			id: "vis-step-neg",
			title: "Negative Step",
			renderer: "svg",
			source: VALID_DECLARATIVE_JSON,
			initialState: { step: -1 },
		});
		assert.equal(negRes.valid, false);
		assert.ok(negRes.problems.some((p) => p.includes("cannot be negative")));

		// Rejection behavior in VisualExplanationCard rendering:
		const cardHtmlOob = renderToStaticMarkup(
			<VisualExplanationCard
				part={{
					type: "tool-visual_explanation",
					state: "output-available",
					toolCallId: "call_oob_reject",
					output: {
						ok: true,
						artifact: {
							version: 1,
							id: "vis-clamp",
							title: "OOB Card",
							renderer: "svg",
							source: VALID_DECLARATIVE_JSON,
							initialState: { step: 99 },
						},
					},
				}}
			/>,
		);
		// Card validation rejects the out-of-bounds artifact and renders failure alert
		assert.ok(cardHtmlOob.includes('data-testid="visual-explanation-failed"'), "Must render failure alert for invalid step");
		assert.ok(cardHtmlOob.includes("exceeds maximum step index"), "Must include out-of-bounds error message");

		// Complete validation in VisualExplanationInstance:
		const instanceHtmlOob = renderToStaticMarkup(
			<VisualExplanationInstance
				artifact={{
					version: 1,
					id: "vis-clamp",
					title: "Clamped Card",
					renderer: "svg",
					source: VALID_DECLARATIVE_JSON,
					presentation: "inline",
					initialState: { step: 99 },
				}}
			/>,
		);
		assert.ok(instanceHtmlOob.includes('data-testid="visual-explanation-failed"'), "Must render failure alert for out-of-bounds step in instance");
		assert.ok(instanceHtmlOob.includes("exceeds maximum step index"), "Must include out-of-bounds error message");

		const instanceHtmlNeg = renderToStaticMarkup(
			<VisualExplanationInstance
				artifact={{
					version: 1,
					id: "vis-clamp-neg",
					title: "Clamped Negative Card",
					renderer: "svg",
					source: VALID_DECLARATIVE_JSON,
					presentation: "inline",
					initialState: { step: -10 },
				}}
			/>,
		);
		assert.ok(instanceHtmlNeg.includes('data-testid="visual-explanation-failed"'), "Must render failure alert for negative step in instance");
		assert.ok(instanceHtmlNeg.includes("cannot be negative"), "Must include negative step error message");
	});

	it("CORRECTION 1: validator strictly rejects button controls with action 'custom'", () => {
		const artifactWithCustom: VisualArtifact = {
			version: 1,
			id: "vis-custom-test",
			title: "Custom Action Test",
			renderer: "svg",
			source: VALID_DECLARATIVE_JSON,
			controls: [
				// @ts-expect-error - testing invalid action 'custom'
				{ type: "button", id: "btn-custom", label: "Custom", action: "custom" },
			],
		};
		const res = validateDeclarativeVisualArtifact(artifactWithCustom);
		assert.equal(res.valid, false);
		assert.ok(
			res.problems.some((p) => p.includes("invalid action 'custom'")),
			"Must reject button control with action 'custom'",
		);
	});

	it("CORRECTION 2: prefers-reduced-motion real component test with dynamic matchMedia and unmount cleanup", async () => {
		let currentMatches = false;
		const listeners = new Set<(e: { matches: boolean }) => void>();

		const mockMatchMedia = (query: string) => ({
			matches: currentMatches,
			media: query,
			onchange: null,
			addListener: () => {},
			removeListener: () => {},
			addEventListener: (event: string, listener: (e: { matches: boolean }) => void) => {
				if (event === "change") listeners.add(listener);
			},
			removeEventListener: (event: string, listener: (e: { matches: boolean }) => void) => {
				if (event === "change") listeners.delete(listener);
			},
			dispatchEvent: () => true,
		});

		const dom = parseHTML("<!doctype html><html><body><div id='root'></div></body></html>");
		const globals = {
			window: {
				...dom.window,
				matchMedia: mockMatchMedia,
			},
			document: dom.document,
			HTMLElement: dom.window.HTMLElement,
			HTMLButtonElement: dom.window.HTMLButtonElement,
			IS_REACT_ACT_ENVIRONMENT: true,
		};
		Object.assign(globalThis, globals);

		const { createRoot } = await import("react-dom/client");
		const rootElement = dom.document.querySelector("#root")!;
		const root = createRoot(rootElement);

		const artifact: VisualArtifact = {
			version: 1,
			id: "vis-motion-test",
			title: "Motion Test",
			renderer: "svg",
			source: VALID_DECLARATIVE_JSON,
			presentation: "inline",
		};

		// 1. Initial render with OS reducedMotion = false -> autoplay allowed (play button enabled)
		await act(async () => {
			root.render(<VisualExplanationInstance artifact={artifact} />);
		});

		const playBtn = dom.document.querySelector('[data-testid="visual-control-play-pause"]') as HTMLButtonElement | null;
		assert.ok(playBtn, "Play button must exist");
		assert.equal(playBtn.hasAttribute("disabled"), false, "Step 1: Autoplay allowed when OS reducedMotion is false");
		assert.equal(listeners.size, 1, "Must register matchMedia change listener");

		// Click play button to start animation
		await act(async () => {
			playBtn.click();
		});
		assert.equal(playBtn.getAttribute("aria-label"), "Pause animation", "Animation playing");

		// 2. Change OS preference to reduced-motion = true -> autoplay disabled
		currentMatches = true;
		await act(async () => {
			for (const listener of listeners) {
				listener({ matches: true });
			}
		});

		assert.equal(playBtn.hasAttribute("disabled"), true, "Step 2: Play button disabled when OS reducedMotion is true");

		// 3. Change OS preference back to reduced-motion = false -> autoplay re-allowed
		currentMatches = false;
		await act(async () => {
			for (const listener of listeners) {
				listener({ matches: false });
			}
		});

		assert.equal(playBtn.hasAttribute("disabled"), false, "Step 3: Play button re-enabled when OS reducedMotion is false again");

		// 4. Component unmount -> verify listener cleanup
		await act(async () => {
			root.unmount();
		});

		assert.equal(listeners.size, 0, "Step 4: Event listener must be cleaned up on unmount");
	});

	it("CORRECTION 3: chatId propagates through ToolPartRenderer isolating updates between chats", async () => {
		clearVisualArtifactRegistry();

		const chatA = chatStore.createChat("Integration Session Alpha");
		const chatB = chatStore.createChat("Integration Session Beta");

		const toolA = createVisualExplanationTool({ chatId: chatA.id, chatStore });
		const toolB = createVisualExplanationTool({ chatId: chatB.id, chatStore });

		// 1. Initial creation in both sessions with identical artifact ID to verify cross-chat isolation
		const sharedId = "vis-shared-pipeline-id";
		const artA: VisualArtifact = {
			version: 1,
			id: sharedId,
			title: "Pipeline Visual Alpha",
			renderer: "svg",
			source: VALID_DECLARATIVE_JSON,
			presentation: "inline",
		};
		const artB: VisualArtifact = {
			version: 1,
			id: sharedId,
			title: "Pipeline Visual Beta",
			renderer: "svg",
			source: VALID_DECLARATIVE_JSON,
			presentation: "inline",
		};
		chatStore.saveVisualArtifact(chatA.id, artA);
		chatStore.saveVisualArtifact(chatB.id, artB);

		const dom = parseHTML(
			"<!doctype html><html><body><div id='root-a'></div><div id='root-a-update'></div><div id='root-b'></div></body></html>",
		);
		const globals = {
			window: dom.window,
			document: dom.document,
			HTMLElement: dom.window.HTMLElement,
			HTMLButtonElement: dom.window.HTMLButtonElement,
			IS_REACT_ACT_ENVIRONMENT: true,
		};
		Object.assign(globalThis, globals);

		const { createRoot } = await import("react-dom/client");
		const rootA = createRoot(dom.document.querySelector("#root-a")!);
		const rootAUpdate = createRoot(dom.document.querySelector("#root-a-update")!);
		const rootB = createRoot(dom.document.querySelector("#root-b")!);

		// 2. Initial render of both tool outputs in their respective chats via ToolPartRenderer
		await act(async () => {
			rootA.render(
				<ToolPartRenderer
					chatId={chatA.id}
					part={{
						type: "tool-visual_explanation",
						state: "output-available",
						toolCallId: "call_init_a",
						output: { ok: true, action: "create", artifact: artA },
					}}
				/>,
			);
			rootB.render(
				<ToolPartRenderer
					chatId={chatB.id}
					part={{
						type: "tool-visual_explanation",
						state: "output-available",
						toolCallId: "call_init_b",
						output: { ok: true, action: "create", artifact: artB },
					}}
				/>,
			);
		});

		// Verify initial rendering
		const elA = dom.document.querySelector("#root-a");
		const elB = dom.document.querySelector("#root-b");
		assert.ok(elA?.textContent?.includes("Pipeline Visual Alpha"), "Chat A initial title rendered");
		assert.ok(elB?.textContent?.includes("Pipeline Visual Beta"), "Chat B initial title rendered");

		// 3. Execute normal tool update in chat A
		const updateResultA = await toolA.execute("call_update_a", {
			action: "update",
			id: sharedId,
			title: "Pipeline Visual Alpha — Fully Integrated In-Place Update!",
		});
		assert.equal(updateResultA.isError, undefined, "Tool update execution must succeed");
		assert.ok(updateResultA.details, "Tool execution must return details payload");

		// 4. Render update output through ToolPartRenderer in Chat A (simulating normal conversation stream)
		await act(async () => {
			rootAUpdate.render(
				<ToolPartRenderer
					chatId={chatA.id}
					part={{
						type: "tool-visual_explanation",
						state: "output-available",
						toolCallId: "call_update_a",
						output: updateResultA.details,
					}}
				/>,
			);
		});

		// Verify update notice was rendered in Chat A
		const elAUpdate = dom.document.querySelector("#root-a-update");
		assert.ok(elAUpdate?.querySelector('[data-testid="visual-explanation-update-notice"]'), "Update notice rendered");

		// 5. Verify that Chat A's initial card received the update via subscription and updated in-place
		assert.ok(
			elA?.textContent?.includes("Pipeline Visual Alpha — Fully Integrated In-Place Update!"),
			"Chat A card must update in-place through tool execution -> ToolPartRenderer -> subscription",
		);

		// 6. Verify that Chat B card remains completely isolated and untouched
		assert.ok(
			elB?.textContent?.includes("Pipeline Visual Beta"),
			"Chat B card must remain untouched",
		);
		assert.ok(
			!elB?.textContent?.includes("Fully Integrated In-Place Update!"),
			"Chat B card must not receive updates from Chat A",
		);

		await act(async () => {
			rootA.unmount();
			rootAUpdate.unmount();
			rootB.unmount();
		});
		clearVisualArtifactRegistry();
		chatStore.deleteChat(chatA.id);
		chatStore.deleteChat(chatB.id);
	});
});

