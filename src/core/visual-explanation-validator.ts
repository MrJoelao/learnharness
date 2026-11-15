/**
 * Host-side validator and sanitizer for Visual Explanation Engine artifacts.
 *
 * Ensures artifacts are strictly bounded, well-formed, and completely free of
 * executable scripts, dangerous handlers, external network requests, or
 * privileged capabilities.
 */

import {
	type VisualArtifact,
	type VisualControlDescriptor,
	type VisualRenderer,
	type VisualPresentation,
	VISUAL_ARTIFACT_LIMITS,
} from "./contracts/visual-explanation.ts";

export interface ValidationResult {
	valid: boolean;
	problems: string[];
	sanitized?: VisualArtifact;
}

const ALLOWED_RENDERERS: readonly VisualRenderer[] = ["svg", "html"];
const ALLOWED_PRESENTATIONS: readonly VisualPresentation[] = ["auto", "inline", "panel"];
const ALLOWED_BUTTON_ACTIONS = ["play", "pause", "reset", "step-forward", "step-backward", "custom"] as const;

const ID_REGEX = /^[a-zA-Z0-9_-]{1,64}$/;

// Tags that are prohibited in SVG artifacts for security
const FORBIDDEN_SVG_TAG_REGEX = /<\s*(script|foreignobject|iframe|object|embed|applet|meta|base|link)\b/i;
// Event handler attributes (onclick, onload, onerror, etc.)
const EVENT_HANDLER_REGEX = /\son[a-zA-Z]+\s*=/i;
// Unsafe protocol references (javascript:, vbscript:, data: in links)
const UNSAFE_PROTOCOL_REGEX = /(href|src|xlink:href)\s*=\s*["']\s*(javascript|vbscript|data):/i;
// External HTTP/HTTPS network URLs
const EXTERNAL_URL_REGEX = /(href|src|xlink:href)\s*=\s*["']\s*(https?:|\/\/)/i;
// Prohibited DTD / external entities
const DTD_ENTITY_REGEX = /<!(ENTITY|DOCTYPE)[\s\S]*?(SYSTEM|PUBLIC)/i;

// Forbidden privileged capabilities / property names in arbitrary payloads
const FORBIDDEN_PROPERTY_NAMES = [
	"filesystem",
	"fs",
	"network",
	"plugin",
	"pluginApi",
	"token",
	"password",
	"cookie",
	"localStorage",
	"sessionStorage",
	"eval",
	"exec",
	"spawn",
];

export function validateVisualArtifact(input: unknown): ValidationResult {
	const problems: string[] = [];

	if (typeof input !== "object" || input === null) {
		return { valid: false, problems: ["Artifact must be a non-null object."] };
	}

	const record = input as Record<string, unknown>;

	// Check for forbidden privileged properties anywhere in the root
	for (const prop of FORBIDDEN_PROPERTY_NAMES) {
		if (prop in record && record[prop] !== undefined) {
			problems.push(`Unrecognized or privileged capability '${prop}' is not permitted.`);
		}
	}

	// 1. Version
	if (record.version !== 1) {
		problems.push(`Unsupported artifact version: ${String(record.version)}. Expected version 1.`);
	}

	// 2. ID
	if (typeof record.id !== "string" || !ID_REGEX.test(record.id)) {
		problems.push(
			`Invalid artifact id: must be 1-${VISUAL_ARTIFACT_LIMITS.MAX_ID_LENGTH} alphanumeric characters, dashes, or underscores.`,
		);
	}

	// 3. Title
	if (
		typeof record.title !== "string" ||
		record.title.trim().length === 0 ||
		record.title.length > VISUAL_ARTIFACT_LIMITS.MAX_TITLE_LENGTH
	) {
		problems.push(
			`Invalid artifact title: must be non-empty and up to ${VISUAL_ARTIFACT_LIMITS.MAX_TITLE_LENGTH} characters.`,
		);
	}

	// 4. Summary (optional)
	let summary: string | undefined;
	if (record.summary !== undefined) {
		if (typeof record.summary !== "string") {
			problems.push("Artifact summary must be a string.");
		} else if (record.summary.length > VISUAL_ARTIFACT_LIMITS.MAX_SUMMARY_LENGTH) {
			problems.push(`Artifact summary exceeds maximum length of ${VISUAL_ARTIFACT_LIMITS.MAX_SUMMARY_LENGTH} characters.`);
		} else {
			summary = record.summary.trim();
		}
	}

	// 5. Renderer
	const renderer = record.renderer as VisualRenderer;
	if (!ALLOWED_RENDERERS.includes(renderer)) {
		problems.push(`Unsupported renderer '${String(record.renderer)}'. Allowed: ${ALLOWED_RENDERERS.join(", ")}.`);
	}

	// 6. Presentation
	let presentation: VisualPresentation = "auto";
	if (record.presentation !== undefined) {
		if (!ALLOWED_PRESENTATIONS.includes(record.presentation as VisualPresentation)) {
			problems.push(`Unsupported presentation '${String(record.presentation)}'. Allowed: ${ALLOWED_PRESENTATIONS.join(", ")}.`);
		} else {
			presentation = record.presentation as VisualPresentation;
		}
	}

	// 7. Source
	let source = "";
	if (typeof record.source !== "string" || record.source.trim().length === 0) {
		problems.push("Artifact source must be a non-empty string.");
	} else {
		source = record.source;
		const sourceBytes = Buffer.byteLength(source, "utf8");
		if (sourceBytes > VISUAL_ARTIFACT_LIMITS.MAX_SOURCE_BYTES) {
			problems.push(
				`Artifact source size (${sourceBytes} bytes) exceeds limit of ${VISUAL_ARTIFACT_LIMITS.MAX_SOURCE_BYTES} bytes.`,
			);
		}

		if (renderer === "svg") {
			const svgValidation = validateSvgSource(source);
			problems.push(...svgValidation.problems);
			if (svgValidation.sanitized) {
				source = svgValidation.sanitized;
			}
		} else if (renderer === "html") {
			const htmlValidation = validateHtmlSource(source);
			problems.push(...htmlValidation.problems);
		}
	}

	// 8. Initial State (optional)
	let initialState: Record<string, unknown> | undefined;
	if (record.initialState !== undefined) {
		if (typeof record.initialState !== "object" || record.initialState === null || Array.isArray(record.initialState)) {
			problems.push("Artifact initialState must be a plain object.");
		} else {
			try {
				const stateJson = JSON.stringify(record.initialState);
				if (Buffer.byteLength(stateJson, "utf8") > VISUAL_ARTIFACT_LIMITS.MAX_STATE_BYTES) {
					problems.push(`Artifact initialState exceeds ${VISUAL_ARTIFACT_LIMITS.MAX_STATE_BYTES} byte limit.`);
				} else {
					initialState = JSON.parse(stateJson) as Record<string, unknown>;
				}
			} catch {
				problems.push("Artifact initialState could not be serialized to JSON.");
			}
		}
	}

	// 9. Controls (optional)
	let controls: VisualControlDescriptor[] | undefined;
	if (record.controls !== undefined) {
		if (!Array.isArray(record.controls)) {
			problems.push("Artifact controls must be an array.");
		} else if (record.controls.length > VISUAL_ARTIFACT_LIMITS.MAX_CONTROLS) {
			problems.push(`Artifact controls count exceeds limit of ${VISUAL_ARTIFACT_LIMITS.MAX_CONTROLS}.`);
		} else {
			controls = [];
			const seenControlIds = new Set<string>();
			for (let i = 0; i < record.controls.length; i++) {
				const ctrl = record.controls[i];
				const ctrlValidation = validateControlDescriptor(ctrl, i, seenControlIds);
				problems.push(...ctrlValidation.problems);
				if (ctrlValidation.control) {
					controls.push(ctrlValidation.control);
				}
			}
		}
	}

	// 10. Accessibility (optional)
	let accessibility: VisualArtifact["accessibility"];
	if (record.accessibility !== undefined) {
		if (typeof record.accessibility !== "object" || record.accessibility === null || Array.isArray(record.accessibility)) {
			problems.push("Artifact accessibility must be an object.");
		} else {
			const a = record.accessibility as Record<string, unknown>;
			accessibility = {};
			if (a.description !== undefined) {
				if (typeof a.description !== "string") {
					problems.push("Accessibility description must be a string.");
				} else if (a.description.length > VISUAL_ARTIFACT_LIMITS.MAX_DESCRIPTION_LENGTH) {
					problems.push(`Accessibility description exceeds limit of ${VISUAL_ARTIFACT_LIMITS.MAX_DESCRIPTION_LENGTH} characters.`);
				} else {
					accessibility.description = a.description.trim();
				}
			}
			if (a.reducedMotionFallback !== undefined) {
				if (typeof a.reducedMotionFallback !== "boolean") {
					problems.push("Accessibility reducedMotionFallback must be a boolean.");
				} else {
					accessibility.reducedMotionFallback = a.reducedMotionFallback;
				}
			}
		}
	}

	if (problems.length > 0) {
		return { valid: false, problems };
	}

	const sanitized: VisualArtifact = {
		version: 1,
		id: (record.id as string).trim(),
		title: (record.title as string).trim(),
		...(summary !== undefined ? { summary } : {}),
		renderer,
		source,
		presentation,
		...(initialState !== undefined ? { initialState } : {}),
		...(controls !== undefined && controls.length > 0 ? { controls } : {}),
		...(accessibility !== undefined ? { accessibility } : {}),
	};

	return { valid: true, problems: [], sanitized };
}

function validateSvgSource(source: string): { problems: string[]; sanitized?: string } {
	const problems: string[] = [];

	if (DTD_ENTITY_REGEX.test(source)) {
		problems.push("SVG must not contain external DTD or entity declarations.");
	}

	if (FORBIDDEN_SVG_TAG_REGEX.test(source)) {
		problems.push("SVG contains forbidden tags (<script>, <foreignObject>, <iframe>, <link>, etc.).");
	}

	if (EVENT_HANDLER_REGEX.test(source)) {
		problems.push("SVG contains inline event handlers (on* attributes).");
	}

	if (UNSAFE_PROTOCOL_REGEX.test(source)) {
		problems.push("SVG contains unsafe protocol handlers (javascript:, vbscript:, data:).");
	}

	if (EXTERNAL_URL_REGEX.test(source)) {
		problems.push("SVG must not reference external URLs (http://, https://, //). Only local #fragment IDs are allowed.");
	}

	// Must contain <svg and </svg>
	if (!/<svg\b[^>]*>/i.test(source) || !/<\/svg>/i.test(source)) {
		problems.push("SVG source must be enclosed in valid <svg>...</svg> root tags.");
	}

	let sanitized = source;
	// Ensure xmlns is present if missing on root <svg>
	if (problems.length === 0) {
		if (!/<svg\b[^>]*xmlns\s*=/i.test(sanitized)) {
			sanitized = sanitized.replace(/<svg\b/i, '<svg xmlns="http://www.w3.org/2000/svg"');
		}
	}

	return { problems, sanitized };
}

function validateHtmlSource(source: string): { problems: string[] } {
	const problems: string[] = [];

	// HTML must not access host filesystem paths or application handles
	if (/\b(__dirname|process\.env|require\(|import\s*\(|window\.parent\.document)\b/.test(source)) {
		problems.push("HTML source contains disallowed host environment expressions.");
	}

	// Reject external script references
	if (/<script\b[^>]*src\s*=\s*["'][^"']+["']/i.test(source)) {
		problems.push("HTML source must not load external scripts via src.");
	}

	return { problems };
}

function validateControlDescriptor(
	ctrl: unknown,
	index: number,
	seenIds: Set<string>,
): { problems: string[]; control?: VisualControlDescriptor } {
	const problems: string[] = [];

	if (typeof ctrl !== "object" || ctrl === null) {
		return { problems: [`Control at index ${index} must be an object.`] };
	}

	const c = ctrl as Record<string, unknown>;

	if (typeof c.id !== "string" || !ID_REGEX.test(c.id)) {
		problems.push(`Control at index ${index} has invalid id: must be 1-${VISUAL_ARTIFACT_LIMITS.MAX_ID_LENGTH} alphanumeric chars.`);
	} else if (seenIds.has(c.id)) {
		problems.push(`Duplicate control id '${c.id}' at index ${index}. Control IDs must be unique.`);
	} else {
		seenIds.add(c.id);
	}

	if (typeof c.label !== "string" || c.label.trim().length === 0 || c.label.length > 64) {
		problems.push(`Control at index ${index} must have a label between 1 and 64 characters.`);
	}

	switch (c.type) {
		case "button": {
			const action = c.action as string;
			if (!ALLOWED_BUTTON_ACTIONS.includes(action as (typeof ALLOWED_BUTTON_ACTIONS)[number])) {
				problems.push(
					`Button control '${String(c.id)}' has invalid action '${action}'. Allowed: ${ALLOWED_BUTTON_ACTIONS.join(", ")}.`,
				);
			}
			if (c.disabled !== undefined && typeof c.disabled !== "boolean") {
				problems.push(`Button control '${String(c.id)}' disabled must be a boolean.`);
			}
			if (problems.length === 0) {
				return {
					problems: [],
					control: {
						type: "button",
						id: c.id as string,
						label: (c.label as string).trim(),
						action: action as (typeof ALLOWED_BUTTON_ACTIONS)[number],
						...(c.disabled !== undefined ? { disabled: c.disabled as boolean } : {}),
					},
				};
			}
			break;
		}
		case "slider": {
			const min = c.min;
			const max = c.max;
			const val = c.value;
			if (typeof min !== "number" || !Number.isFinite(min)) {
				problems.push(`Slider control '${String(c.id)}' min must be a finite number.`);
			}
			if (typeof max !== "number" || !Number.isFinite(max)) {
				problems.push(`Slider control '${String(c.id)}' max must be a finite number.`);
			}
			if (typeof min === "number" && typeof max === "number" && min >= max) {
				problems.push(`Slider control '${String(c.id)}' min (${min}) must be strictly less than max (${max}).`);
			}
			if (typeof val !== "number" || !Number.isFinite(val)) {
				problems.push(`Slider control '${String(c.id)}' value must be a finite number.`);
			} else if (typeof min === "number" && typeof max === "number" && (val < min || val > max)) {
				problems.push(`Slider control '${String(c.id)}' value (${val}) is outside [min, max] range.`);
			}
			let step: number | undefined;
			if (c.step !== undefined) {
				if (typeof c.step !== "number" || !Number.isFinite(c.step) || c.step <= 0) {
					problems.push(`Slider control '${String(c.id)}' step must be a positive number.`);
				} else {
					step = c.step;
				}
			}
			if (problems.length === 0) {
				return {
					problems: [],
					control: {
						type: "slider",
						id: c.id as string,
						label: (c.label as string).trim(),
						min: min as number,
						max: max as number,
						...(step !== undefined ? { step } : {}),
						value: val as number,
					},
				};
			}
			break;
		}
		case "toggle": {
			if (typeof c.value !== "boolean") {
				problems.push(`Toggle control '${String(c.id)}' value must be a boolean.`);
			}
			if (problems.length === 0) {
				return {
					problems: [],
					control: {
						type: "toggle",
						id: c.id as string,
						label: (c.label as string).trim(),
						value: c.value as boolean,
					},
				};
			}
			break;
		}
		case "select": {
			if (!Array.isArray(c.options) || c.options.length === 0 || c.options.length > VISUAL_ARTIFACT_LIMITS.MAX_SELECT_OPTIONS) {
				problems.push(
					`Select control '${String(c.id)}' options must be an array of 1-${VISUAL_ARTIFACT_LIMITS.MAX_SELECT_OPTIONS} items.`,
				);
			}
			const options: Array<{ label: string; value: string }> = [];
			const optionValues = new Set<string>();
			if (Array.isArray(c.options)) {
				for (let optIdx = 0; optIdx < c.options.length; optIdx++) {
					const opt = c.options[optIdx] as Record<string, unknown>;
					if (typeof opt !== "object" || opt === null || typeof opt.label !== "string" || typeof opt.value !== "string") {
						problems.push(`Select control '${String(c.id)}' option at ${optIdx} must have string label and value.`);
					} else {
						options.push({ label: opt.label.trim(), value: opt.value.trim() });
						optionValues.add(opt.value.trim());
					}
				}
			}
			if (typeof c.value !== "string" || !optionValues.has(c.value.trim())) {
				problems.push(`Select control '${String(c.id)}' value must match one of the available option values.`);
			}
			if (problems.length === 0) {
				return {
					problems: [],
					control: {
						type: "select",
						id: c.id as string,
						label: (c.label as string).trim(),
						options,
						value: (c.value as string).trim(),
					},
				};
			}
			break;
		}
		default:
			problems.push(`Control at index ${index} has unsupported type '${String(c.type)}'. Allowed: button, slider, toggle, select.`);
	}

	return { problems };
}
