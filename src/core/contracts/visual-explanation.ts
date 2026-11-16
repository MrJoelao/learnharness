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

export const DECLARATIVE_SVG_SCHEMA = "learnharness.visual.svg.v1" as const;

export type DeclarativeSvgElementType =
	| "rect"
	| "circle"
	| "ellipse"
	| "line"
	| "polyline"
	| "polygon"
	| "text";

export interface DeclarativeSvgRectElement {
	type: "rect";
	x: number;
	y: number;
	width: number;
	height: number;
	rx?: number;
	ry?: number;
	fill?: string;
	stroke?: string;
	strokeWidth?: number;
	opacity?: number;
}

export interface DeclarativeSvgCircleElement {
	type: "circle";
	cx: number;
	cy: number;
	r: number;
	fill?: string;
	stroke?: string;
	strokeWidth?: number;
	opacity?: number;
}

export interface DeclarativeSvgEllipseElement {
	type: "ellipse";
	cx: number;
	cy: number;
	rx: number;
	ry: number;
	fill?: string;
	stroke?: string;
	strokeWidth?: number;
	opacity?: number;
}

export interface DeclarativeSvgLineElement {
	type: "line";
	x1: number;
	y1: number;
	x2: number;
	y2: number;
	stroke?: string;
	strokeWidth?: number;
	opacity?: number;
}

export interface DeclarativeSvgPolylineElement {
	type: "polyline";
	points: string | [number, number][];
	fill?: string;
	stroke?: string;
	strokeWidth?: number;
	opacity?: number;
}

export interface DeclarativeSvgPolygonElement {
	type: "polygon";
	points: string | [number, number][];
	fill?: string;
	stroke?: string;
	strokeWidth?: number;
	opacity?: number;
}

export interface DeclarativeSvgTextElement {
	type: "text";
	x: number;
	y: number;
	text: string;
	fontSize?: number;
	fontFamily?: string;
	fontWeight?: string | number;
	anchor?: "start" | "middle" | "end";
	textAnchor?: "start" | "middle" | "end";
	fill?: string;
	opacity?: number;
}

export type DeclarativeSvgElement =
	| DeclarativeSvgRectElement
	| DeclarativeSvgCircleElement
	| DeclarativeSvgEllipseElement
	| DeclarativeSvgLineElement
	| DeclarativeSvgPolylineElement
	| DeclarativeSvgPolygonElement
	| DeclarativeSvgTextElement;

export interface DeclarativeSvgStep {
	id: string;
	label: string;
	description?: string;
	elements: DeclarativeSvgElement[];
}

export interface DeclarativeSvgViewBox {
	x?: number;
	y?: number;
	width: number;
	height: number;
}

export interface DeclarativeSvgDocument {
	schema: typeof DECLARATIVE_SVG_SCHEMA;
	viewBox: DeclarativeSvgViewBox;
	steps: DeclarativeSvgStep[];
}

export const VISUAL_ARTIFACT_LIMITS = {
	MAX_ID_LENGTH: 64,
	MAX_TITLE_LENGTH: 128,
	MAX_SUMMARY_LENGTH: 1024,
	MAX_LABEL_LENGTH: 128,
	MAX_SOURCE_BYTES: 65536, // 64 KB
	MAX_STATE_BYTES: 8192,   // 8 KB
	MAX_CONTROLS: 8,
	MAX_DESCRIPTION_LENGTH: 2048,
	MAX_SELECT_OPTIONS: 12,
	MAX_STEPS: 30,
	MAX_ELEMENTS_PER_STEP: 100,
	MAX_VIEWBOX_DIMENSION: 4000,
	MIN_COORDINATE: -10000,
	MAX_COORDINATE: 10000,
} as const;

