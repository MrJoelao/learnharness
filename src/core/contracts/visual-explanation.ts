/**
 * Visual Explanation Engine MVP — Contracts & Envelope (Phase 6)
 *
 * Provides a versioned, validated envelope for visual artifacts produced
 * by the teaching agent during a conversation.
 */

export type VisualRenderer = "svg" | "html";
export type VisualPresentation = "auto" | "inline" | "panel";

export type VisualButtonAction =
	| "play"
	| "pause"
	| "reset"
	| "step-forward"
	| "step-backward"
	| "custom";

export interface VisualButtonControl {
	type: "button";
	id: string;
	label: string;
	action: VisualButtonAction;
	disabled?: boolean;
}

export interface VisualSliderControl {
	type: "slider";
	id: string;
	label: string;
	min: number;
	max: number;
	step?: number;
	value: number;
}

export interface VisualToggleControl {
	type: "toggle";
	id: string;
	label: string;
	value: boolean;
}

export interface VisualSelectOption {
	label: string;
	value: string;
}

export interface VisualSelectControl {
	type: "select";
	id: string;
	label: string;
	options: VisualSelectOption[];
	value: string;
}

export type VisualControlDescriptor =
	| VisualButtonControl
	| VisualSliderControl
	| VisualToggleControl
	| VisualSelectControl;

export interface VisualArtifactAccessibility {
	description?: string;
	reducedMotionFallback?: boolean;
}

export interface VisualArtifact {
	version: 1;
	id: string;
	title: string;
	summary?: string;
	renderer: VisualRenderer;
	source: string;
	presentation: VisualPresentation;
	initialState?: Record<string, unknown>;
	controls?: VisualControlDescriptor[];
	accessibility?: VisualArtifactAccessibility;
}

export const VISUAL_ARTIFACT_LIMITS = {
	MAX_ID_LENGTH: 64,
	MAX_TITLE_LENGTH: 128,
	MAX_SUMMARY_LENGTH: 1024,
	MAX_SOURCE_BYTES: 65536, // 64 KB
	MAX_STATE_BYTES: 8192,   // 8 KB
	MAX_CONTROLS: 10,
	MAX_DESCRIPTION_LENGTH: 2048,
	MAX_SELECT_OPTIONS: 12,
} as const;
