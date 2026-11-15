/**
 * Visual Explanation Engine — Agent Tool (Phase 6)
 *
 * Exposes the visual_explanation tool to the teaching agent, allowing it to
 * create and update structured, interactive visual artifacts during conversation.
 */

import { Type, type Static } from "typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { invalidInputResult, serverExecute } from "../tool-execute.ts";
import type { ChatStore } from "../../core/ports.ts";
import type {
	VisualArtifact,
	VisualButtonAction,
	VisualControlDescriptor,
	VisualPresentation,
	VisualRenderer,
} from "../../core/contracts/visual-explanation.ts";
import { validateVisualArtifact } from "../../core/visual-explanation-validator.ts";

export interface VisualExplanationToolContext {
	chatId: string;
	chatStore: ChatStore;
}

const visualButtonActionSchema = Type.Union([
	Type.Literal("play"),
	Type.Literal("pause"),
	Type.Literal("reset"),
	Type.Literal("step-forward"),
	Type.Literal("step-backward"),
	Type.Literal("custom"),
]);

const visualControlSchema = Type.Union([
	Type.Object({
		type: Type.Literal("button"),
		id: Type.String({ minLength: 1, maxLength: 64 }),
		label: Type.String({ minLength: 1, maxLength: 64 }),
		action: visualButtonActionSchema,
		disabled: Type.Optional(Type.Boolean()),
	}),
	Type.Object({
		type: Type.Literal("slider"),
		id: Type.String({ minLength: 1, maxLength: 64 }),
		label: Type.String({ minLength: 1, maxLength: 64 }),
		min: Type.Number(),
		max: Type.Number(),
		step: Type.Optional(Type.Number()),
		value: Type.Number(),
	}),
	Type.Object({
		type: Type.Literal("toggle"),
		id: Type.String({ minLength: 1, maxLength: 64 }),
		label: Type.String({ minLength: 1, maxLength: 64 }),
		value: Type.Boolean(),
	}),
	Type.Object({
		type: Type.Literal("select"),
		id: Type.String({ minLength: 1, maxLength: 64 }),
		label: Type.String({ minLength: 1, maxLength: 64 }),
		options: Type.Array(
			Type.Object({
				label: Type.String(),
				value: Type.String(),
			}),
			{ minItems: 1, maxItems: 12 },
		),
		value: Type.String(),
	}),
]);

export const visualExplanationInputSchema = Type.Object({
	action: Type.Union([Type.Literal("create"), Type.Literal("update")], {
		description: "'create' to author a new visual artifact, or 'update' to patch/replace an existing artifact by ID.",
	}),
	id: Type.String({
		minLength: 1,
		maxLength: 64,
		description:
			"Stable artifact ID (e.g. 'memory-layout', 'paging-translation', 'pipeline-stages'). Reference the same ID when updating.",
	}),
	title: Type.Optional(Type.String({ maxLength: 128, description: "Title of the visual explanation." })),
	summary: Type.Optional(Type.String({ maxLength: 1024, description: "Brief summary of what this visualization explains." })),
	renderer: Type.Optional(
		Type.Union([Type.Literal("svg"), Type.Literal("html")], {
			description: "Renderer type: 'svg' (default, declarative vector graphics) or 'html' (sandboxed HTML document).",
		}),
	),
	source: Type.Optional(Type.String({ description: "Visual markup (SVG tags or HTML content). Must be self-contained." })),
	presentation: Type.Optional(
		Type.Union([Type.Literal("auto"), Type.Literal("inline"), Type.Literal("panel")], {
			description: "Presentation mode: 'inline' in transcript, 'panel' in expanded view, or 'auto'.",
		}),
	),
	initialState: Type.Optional(
		Type.Record(Type.String(), Type.Unknown(), {
			description: "Optional initial state values (e.g. current step, active register values, highlight indices).",
		}),
	),
	controls: Type.Optional(
		Type.Array(visualControlSchema, {
			maxItems: 10,
			description: "Declarative UI controls for learner interaction (step buttons, reset, parameter sliders).",
		}),
	),
	accessibility: Type.Optional(
		Type.Object({
			description: Type.Optional(Type.String({ description: "Accessible text description for learners and screen readers." })),
			reducedMotionFallback: Type.Optional(
				Type.Boolean({ description: "If true, animations are disabled when prefers-reduced-motion is active." }),
			),
		}),
	),
});

export type VisualExplanationInput = Static<typeof visualExplanationInputSchema>;

export function createVisualExplanationTool(ctx: VisualExplanationToolContext): AgentTool<typeof visualExplanationInputSchema> {
	return {
		name: "visual_explanation",
		label: "visual_explanation",
		description:
			"Create or update an interactive visual explanation artifact (memory layouts, stack/heap, CPU registers, " +
			"process scheduling, trees, packet flows, algorithm step machines). " +
			"Use when a visual or interactive representation materially aids comprehension. " +
			"Do NOT call for simple definitions or tables. " +
			"Specify action: 'create' for a fresh visual, or action: 'update' with the existing id to modify one. " +
			"Always accompany the visualization with a clear textual explanation in your response.",
		parameters: visualExplanationInputSchema,
		executionMode: "sequential",
		execute: serverExecute("visual_explanation", visualExplanationInputSchema, async (input: VisualExplanationInput) => {
			const { chatId, chatStore } = ctx;
			const { action, id } = input;

			if (action === "create") {
				const existing = chatStore.getVisualArtifact(chatId, id);
				if (existing) {
					return invalidInputResult("visual_explanation", [
						`Artifact with ID '${id}' already exists in this session. Use action: 'update' to update it, or choose a new unique ID.`,
					]);
				}

				const candidate: VisualArtifact = {
					version: 1,
					id,
					title: input.title ?? id,
					...(input.summary ? { summary: input.summary } : {}),
					renderer: input.renderer ?? "svg",
					source: input.source ?? "",
					presentation: input.presentation ?? "auto",
					...(input.initialState ? { initialState: input.initialState } : {}),
					...(input.controls ? { controls: input.controls as VisualControlDescriptor[] } : {}),
					...(input.accessibility ? { accessibility: input.accessibility } : {}),
				};

				const validation = validateVisualArtifact(candidate);
				if (!validation.valid || !validation.sanitized) {
					return invalidInputResult("visual_explanation", validation.problems);
				}

				chatStore.saveVisualArtifact(chatId, validation.sanitized);

				return {
					text: JSON.stringify({
						ok: true,
						action: "create",
						id: validation.sanitized.id,
						title: validation.sanitized.title,
						renderer: validation.sanitized.renderer,
						presentation: validation.sanitized.presentation,
					}),
					details: {
						ok: true,
						action: "create",
						artifact: validation.sanitized,
					},
				};
			}

			if (action === "update") {
				const existing = chatStore.getVisualArtifact(chatId, id);
				if (!existing) {
					return invalidInputResult("visual_explanation", [
						`Artifact with ID '${id}' was not found in this session. Cannot update a non-existent artifact. Check existing artifact IDs or use action: 'create'.`,
					]);
				}

				// Merge updates onto existing artifact, preserving state and identity
				const merged: VisualArtifact = {
					version: 1,
					id: existing.id,
					title: input.title ?? existing.title,
					summary: input.summary !== undefined ? input.summary : existing.summary,
					renderer: input.renderer ?? existing.renderer,
					source: input.source ?? existing.source,
					presentation: input.presentation ?? existing.presentation,
					initialState: input.initialState
						? { ...(existing.initialState ?? {}), ...input.initialState }
						: existing.initialState,
					controls: (input.controls as VisualControlDescriptor[] | undefined) ?? existing.controls,
					accessibility: input.accessibility ?? existing.accessibility,
				};

				const validation = validateVisualArtifact(merged);
				if (!validation.valid || !validation.sanitized) {
					// Invariant: Failed update preserves last known good artifact
					return invalidInputResult("visual_explanation", [
						"Update validation failed. The existing artifact remains unchanged.",
						...validation.problems,
					]);
				}

				chatStore.saveVisualArtifact(chatId, validation.sanitized);

				return {
					text: JSON.stringify({
						ok: true,
						action: "update",
						id: validation.sanitized.id,
						title: validation.sanitized.title,
						renderer: validation.sanitized.renderer,
						presentation: validation.sanitized.presentation,
					}),
					details: {
						ok: true,
						action: "update",
						artifact: validation.sanitized,
					},
				};
			}

			return invalidInputResult("visual_explanation", ["Invalid action specified. Must be 'create' or 'update'."]);
		}),
	};
}
