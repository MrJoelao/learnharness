import type { PluginModeDefinition, PluginModeMetadata } from "./plugins.ts";

export const PLUGIN_MODE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const boundedText = (value: unknown, field: string, max: number, optional = false): string | undefined => {
	if (optional && value === undefined) return undefined;
	if (typeof value !== "string" || !value.trim() || value.trim().length > max) throw new Error(`Mode ${field} must contain 1 to ${max} characters`);
	return value.trim();
};
function stringList(value: unknown, field: string, maxItems: number, maxLength: number): string[] | undefined {
	if (value === undefined) return undefined;
	if (!Array.isArray(value) || value.length > maxItems) throw new Error(`Mode ${field} must be an array of at most ${maxItems} strings`);
	const result = value.map((item) => boundedText(item, field, maxLength)!);
	if (new Set(result.map((item) => item.toLocaleLowerCase())).size !== result.length) throw new Error(`Mode ${field} entries must be unique`);
	return result;
}

/** Validate and detach metadata before it enters a catalog or lifecycle map. */
export function preparePluginMode(definition: PluginModeDefinition, pluginId: string): { metadata: PluginModeMetadata; initializeWorkspace: PluginModeDefinition["initializeWorkspace"] } {
	if (!definition || typeof definition !== "object" || Array.isArray(definition)) throw new Error("Mode definition must be an object");
	const allowed = new Set(["id", "name", "description", "category", "icon", "tags", "difficulty", "activityType", "capabilities", "initializeWorkspace"]);
	if (Object.keys(definition).some(key => !allowed.has(key))) throw new Error("Mode definition contains an unsupported property");
	if (typeof definition.id !== "string" || !PLUGIN_MODE_ID_PATTERN.test(definition.id)) throw new Error("Mode id must be a stable 1–128 character route-safe identifier");
	const name = boundedText(definition.name, "name", 100)!;
	const description = boundedText(definition.description, "description", 1000)!;
	const category = boundedText(definition.category, "category", 80)!;
	const icon = boundedText(definition.icon, "icon", 512, true);
	const tags = stringList(definition.tags, "tags", 20, 40);
	const capabilities = stringList(definition.capabilities, "capabilities", 20, 80);
	const activityType = boundedText(definition.activityType, "activityType", 80, true);
	if (definition.difficulty !== undefined && !["beginner", "intermediate", "advanced"].includes(definition.difficulty)) throw new Error("Mode difficulty must be beginner, intermediate or advanced");
	if (typeof definition.initializeWorkspace !== "function") throw new Error("Mode initializeWorkspace must be a function");
	const metadata: PluginModeMetadata = Object.freeze({
		pluginId, id: definition.id, name, description, category,
		...(icon === undefined ? {} : { icon }), ...(tags === undefined ? {} : { tags: Object.freeze(tags) as unknown as string[] }),
		...(definition.difficulty === undefined ? {} : { difficulty: definition.difficulty }),
		...(activityType === undefined ? {} : { activityType }),
		...(capabilities === undefined ? {} : { capabilities: Object.freeze(capabilities) as unknown as string[] }),
	});
	return { metadata, initializeWorkspace: definition.initializeWorkspace.bind(definition) };
}
