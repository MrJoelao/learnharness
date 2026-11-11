"use client";

/**
 * References panel backwards-compatibility shim.
 * The implementation has moved to the unified Sources panel (components/sources-panel.tsx)
 * which consolidates both session source documents (#623) and additional references (#613).
 */

export {
	SourcesChip,
	ReferencesChip,
	referenceLabel,
	putReferences,
	urlDomain,
	documentKindBadge,
	type SourcesChipProps,
} from "@/components/sources-panel";
