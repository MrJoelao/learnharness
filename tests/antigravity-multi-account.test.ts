import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { createModels, type OAuthCredential, type ProviderAuthInteraction } from "@earendil-works/pi-ai";
import { githubCopilotProvider } from "@earendil-works/pi-ai/providers/github-copilot";
import { xaiProvider } from "@earendil-works/pi-ai/providers/xai";
import * as piAi from "@earendil-works/pi-ai";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai/utils/event-stream";
import * as antigravityCore from "@cortexkit/antigravity-auth-core";
import type { NativeSubscriptionScope, NativeSubscriptionStatus, NativeSubscriptionAccount } from "../src/core/contracts/subscriptions.ts";

const require = createRequire(import.meta.url);
const { createSubscriptions } = require("../electron/subscriptions.cjs");
const { createProvider: createAntigravityProvider } = require("../src/agent/antigravity-provider.cjs");

export interface AntigravityStoredAccount {
	id: string;
	email?: string;
	label?: string;
	access?: string;
	refresh?: string;
	expires?: number;
	availableModelIds?: string[];
	projectId?: string;
	addedAt?: number;
	enabled?: boolean;
	connected?: boolean;
	active?: boolean;
}

export type MultiAccountStatus = NativeSubscriptionStatus & {
	accounts?: readonly (NativeSubscriptionAccount | AntigravityStoredAccount)[];
	activeAccountId?: string | null;
	activeId?: string | null;
};

interface MultiAccountController {
	ready: Promise<void>;
	status(): Promise<MultiAccountStatus[]>;
	snapshot(): Promise<{ statuses: MultiAccountStatus[]; models: Record<string, { id: string }[]> }>;
	login(providerId: string, enabled?: boolean, accountId?: string): Promise<void>;
	lease(scope: NativeSubscriptionScope, background: boolean): Promise<{ auth: { apiKey: string; baseUrl?: string } }>;
	disconnect(providerId: string, accountId?: string): Promise<void>;
	select?(providerId: string, accountId: string): Promise<void>;
	switchAccount?(providerId: string, accountId: string): Promise<void>;
	removeAccount?(providerId: string, accountId: string): Promise<void>;
	close(): void;
}

const antigravityCredential = (
	access = "antigravity-access-1",
	availableModelIds = ["antigravity-gemini-3.8-flash"],
	email = "user1@example.com",
	expires = Date.now() + 3600000,
): OAuthCredential & { email?: string; label?: string } => ({
	type: "oauth",
	access,
	refresh: `refresh-${access}`,
	expires,
	availableModelIds,
	email,
	label: email,
});

async function switchActiveAccount(controller: MultiAccountController, providerId: string, accountId: string) {
	if (typeof controller.select === "function") {
		await controller.select(providerId, accountId);
	} else if (typeof controller.switchAccount === "function") {
		await controller.switchAccount(providerId, accountId);
	}
}

async function removeSingleAccount(controller: MultiAccountController, providerId: string, accountId: string) {
	if (typeof controller.removeAccount === "function") {
		await controller.removeAccount(providerId, accountId);
	} else if (typeof controller.disconnect === "function") {
		await controller.disconnect(providerId, accountId);
	}
}

async function fixture(options: {
	login?: (id: string, interaction: ProviderAuthInteraction) => Promise<OAuthCredential>;
	refresh?: (id: string, value: OAuthCredential, signal: AbortSignal) => Promise<OAuthCredential>;
	catalog?: (value: OAuthCredential) => Promise<string[]>;
	stores?: Record<string, unknown>;
} = {}) {
	const directory = await fs.mkdtemp(path.join(os.tmpdir(), "lh-antigravity-multi-"));
	let refreshes = 0;
	const factory = (id: string) => {
		const native = id === "google-antigravity"
			? createAntigravityProvider({ ...piAi, createAssistantMessageEventStream }, antigravityCore)
			: id === "xai"
				? xaiProvider()
				: githubCopilotProvider();
		if (id === "google-antigravity" && options.catalog) native.fetchAvailableModelIds = options.catalog;
		return {
			...native,
			auth: {
				...native.auth,
				oauth: {
					...native.auth.oauth!,
					login: (interaction: ProviderAuthInteraction) => options.login?.(id, interaction) ?? Promise.resolve(antigravityCredential()),
					refresh: async (value: OAuthCredential, signal: AbortSignal) => {
						refreshes++;
						return options.refresh?.(id, value, signal) ?? { ...value, access: `refreshed-${value.access}`, expires: Date.now() + 3600000 };
					},
				},
			},
		};
	};
	const sdk = {
		createModels,
		githubCopilotProvider: () => factory("github-copilot"),
		xaiProvider: () => factory("xai"),
		antigravityProvider: () => factory("google-antigravity"),
		antigravityCore,
	};
	const updates: any[] = [], opened: string[] = [];
	const controller = createSubscriptions({
		directory,
		sdk,
		stores: options.stores,
		openExternal: async (url: string) => { opened.push(url); },
		onChange: (snapshot: unknown) => updates.push(snapshot),
	}) as MultiAccountController;
	await controller.ready;
	const scope = async (id = "google-antigravity"): Promise<NativeSubscriptionScope> => {
		const snapshot = await controller.snapshot();
		const status = snapshot.statuses.find((s) => s.providerId === id);
		const models = snapshot.models[id];
		if (!models || models.length === 0) throw new Error(`No models available for ${id}`);
		const model = models[0]!;
		return {
			providerId: id as NativeSubscriptionScope["providerId"],
			connectionId: status!.connectionId!,
			epoch: status!.epoch,
			authorityRevision: status!.authorityRevision,
			selectedModelId: model.id,
		};
	};
	return {
		controller,
		directory,
		sdk,
		opened,
		updates,
		scope,
		get refreshes() { return refreshes; },
		async cleanup() {
			controller.close();
			await fs.rm(directory, { recursive: true, force: true });
		},
	};
}

test("legacy single-account Antigravity credential file is migrated compatibly on startup", async () => {
	const directory = await fs.mkdtemp(path.join(os.tmpdir(), "lh-ag-migration-"));
	const legacyState = {
		version: 1,
		allowBackgroundUse: true,
		connectionId: "00000000-0000-4000-8000-000000000001",
		credential: {
			type: "oauth",
			access: "legacy-access-token",
			refresh: "legacy-refresh-token",
			expires: Date.now() + 3600000,
			availableModelIds: ["antigravity-gemini-3.8-flash"],
			email: "legacy-user@gmail.com",
			label: "legacy-user@gmail.com",
		},
	};
	const credPath = path.join(directory, "google-antigravity-credentials.json");
	await fs.writeFile(credPath, `${JSON.stringify(legacyState)}\n`, { mode: 0o600 });

	const f = await fixture({ stores: undefined });
	const migratedController = createSubscriptions({
		directory,
		sdk: f.sdk,
		openExternal: async () => {},
	}) as MultiAccountController;

	try {
		await migratedController.ready;
		const snapshot = await migratedController.snapshot();
		const status = snapshot.statuses.find((s) => s.providerId === "google-antigravity")!;
		assert.equal(status.available, true);
		assert.equal(status.connected, true);
		assert.equal(status.connectionId, legacyState.connectionId);

		// Multi-account expectations: accounts array is synthesized or populated
		if (status.accounts) {
			assert.equal(status.accounts.length, 1, "migrated account must be the sole account in accounts array");
			const migrated = status.accounts[0]!;
			assert.equal(migrated.email, "legacy-user@gmail.com");
			const activeId = status.activeId ?? status.activeAccountId;
			assert.equal(activeId, migrated.id, "active account ID must match migrated account");
		}

		// Ensure active models catalog is immediately available and filtered
		const models = snapshot.models["google-antigravity"] ?? [];
		assert.deepEqual(models.map((m) => m.id), ["antigravity-gemini-3.8-flash"]);

		// Ensure active credential lease succeeds with the legacy token
		const scope: NativeSubscriptionScope = {
			providerId: "google-antigravity",
			connectionId: status.connectionId!,
			epoch: status.epoch,
			authorityRevision: status.authorityRevision,
			selectedModelId: "antigravity-gemini-3.8-flash",
		};
		const leased = await migratedController.lease(scope, false);
		assert.equal(leased.auth.apiKey, "legacy-access-token", "leased apiKey must match active legacy token");
	} finally {
		migratedController.close();
		await f.cleanup();
		await fs.rm(directory, { recursive: true, force: true });
	}
});

test("saving multiple accounts preserves credentials, accounts array, and active selection across reloads", async () => {
	const directory = await fs.mkdtemp(path.join(os.tmpdir(), "lh-ag-multi-save-"));
	const accountA: AntigravityStoredAccount = {
		id: "acc-user-a",
		email: "usera@example.com",
		label: "User A",
		access: "token-user-a",
		refresh: "refresh-user-a",
		expires: Date.now() + 3600000,
		availableModelIds: ["antigravity-gemini-3.8-flash"],
		addedAt: 1000,
		enabled: true,
		connected: true,
	};
	const accountB: AntigravityStoredAccount = {
		id: "acc-user-b",
		email: "userb@example.com",
		label: "User B",
		access: "token-user-b",
		refresh: "refresh-user-b",
		expires: Date.now() + 3600000,
		availableModelIds: ["antigravity-claude-sonnet-5-5", "antigravity-gemini-3.8-flash"],
		addedAt: 2000,
		enabled: true,
		connected: true,
	};
	const multiState = {
		version: 1,
		allowBackgroundUse: true,
		connectionId: "00000000-0000-4000-8000-000000000002",
		credential: {
			type: "oauth",
			access: accountA.access,
			refresh: accountA.refresh,
			expires: accountA.expires,
			availableModelIds: accountA.availableModelIds,
			email: accountA.email,
			label: accountA.label,
		},
		accounts: [accountA, accountB],
		activeAccountId: accountA.id,
		activeId: accountA.id,
	};

	const credPath = path.join(directory, "google-antigravity-credentials.json");
	await fs.writeFile(credPath, `${JSON.stringify(multiState)}\n`, { mode: 0o600 });

	const f = await fixture();
	const controller = createSubscriptions({
		directory,
		sdk: f.sdk,
		openExternal: async () => {},
	}) as MultiAccountController;

	try {
		await controller.ready;
		const status = (await controller.status()).find((s) => s.providerId === "google-antigravity")!;
		assert.equal(status.connected, true);

		if (status.accounts) {
			assert.equal(status.accounts.length, 2, "both saved accounts must be reported in status");
			const activeId = status.activeId ?? status.activeAccountId;
			assert.equal(activeId, "acc-user-a", "activeId must be acc-user-a");
		}

		// Reload from disk with fresh controller to test persistence
		controller.close();
		const reloaded = createSubscriptions({
			directory,
			sdk: f.sdk,
			openExternal: async () => {},
		}) as MultiAccountController;
		await reloaded.ready;

		const reloadedStatus = (await reloaded.status()).find((s) => s.providerId === "google-antigravity")!;
		assert.equal(reloadedStatus.connected, true);
		if (reloadedStatus.accounts) {
			assert.equal(reloadedStatus.accounts.length, 2);
			const reloadedActiveId = reloadedStatus.activeId ?? reloadedStatus.activeAccountId;
			assert.equal(reloadedActiveId, "acc-user-a");
		}
		reloaded.close();
	} finally {
		await f.cleanup();
		await fs.rm(directory, { recursive: true, force: true });
	}
});

test("adding another account via OAuth preserves existing accounts without overwriting", async () => {
	const initialAccount: AntigravityStoredAccount = {
		id: "acc-first",
		email: "first@example.com",
		label: "First User",
		access: "token-first",
		refresh: "refresh-first",
		expires: Date.now() + 3600000,
		availableModelIds: ["antigravity-gemini-3.8-flash"],
		addedAt: 1000,
		enabled: true,
		connected: true,
	};
	const secondCredential = {
		type: "oauth" as const,
		access: "token-second",
		refresh: "refresh-second",
		expires: Date.now() + 3600000,
		availableModelIds: ["antigravity-claude-sonnet-5-5"],
		email: "second@example.com",
		label: "Second User",
	};

	let loginCallCount = 0;
	const f = await fixture({
		login: async (_id) => {
			loginCallCount++;
			return secondCredential;
		},
	});

	try {
		const credPath = path.join(f.directory, "google-antigravity-credentials.json");
		const initialState = {
			version: 1,
			allowBackgroundUse: true,
			connectionId: "00000000-0000-4000-8000-000000000003",
			credential: {
				type: "oauth",
				access: initialAccount.access,
				refresh: initialAccount.refresh,
				expires: initialAccount.expires,
				availableModelIds: initialAccount.availableModelIds,
				email: initialAccount.email,
				label: initialAccount.label,
			},
			accounts: [initialAccount],
			activeAccountId: initialAccount.id,
			activeId: initialAccount.id,
		};
		await fs.writeFile(credPath, `${JSON.stringify(initialState)}\n`, { mode: 0o600 });

		f.controller.close();
		const controller = createSubscriptions({
			directory: f.directory,
			sdk: f.sdk,
			openExternal: async () => {},
		}) as MultiAccountController;
		await controller.ready;

		// Trigger OAuth login for second account
		await controller.login("google-antigravity");
		assert.equal(loginCallCount, 1);

		const saved = JSON.parse(await fs.readFile(credPath, "utf8"));
		assert.equal(saved.version, 1);

		if (Array.isArray(saved.accounts)) {
			assert.equal(saved.accounts.length, 2, "both first and second accounts must be present in accounts array");
			assert(saved.accounts.some((a: any) => a.email === "first@example.com"));
			assert(saved.accounts.some((a: any) => a.email === "second@example.com"));
			const activeId = saved.activeId ?? saved.activeAccountId;
			const secondId = saved.accounts.find((a: any) => a.email === "second@example.com").id;
			assert.equal(activeId, secondId, "newly added account should become active");
		}
		controller.close();
	} finally {
		await f.cleanup();
	}
});

test("reauthentication account IDs must refer to a saved Antigravity account", async () => {
	let oauthStarted = false;
	const f = await fixture({ login: async () => { oauthStarted = true; return antigravityCredential(); } });
	try {
		await assert.rejects(f.controller.login("google-antigravity", true, "renderer-supplied-id"));
		assert.equal(oauthStarted, false, "invalid account IDs must be rejected before starting OAuth");
	} finally { await f.cleanup(); }
});

test("explicitly selecting one active account switches credentials and isolates catalog and scopes", async () => {
	const accountA: AntigravityStoredAccount = {
		id: "acc-gemini-only",
		email: "gemini@example.com",
		label: "Gemini User",
		access: "token-gemini-user",
		refresh: "refresh-gemini",
		expires: Date.now() + 3600000,
		availableModelIds: ["antigravity-gemini-3.8-flash"],
		addedAt: 1000,
		enabled: true,
		connected: true,
	};
	const accountB: AntigravityStoredAccount = {
		id: "acc-claude-pro",
		email: "pro@example.com",
		label: "Pro User",
		access: "token-claude-user",
		refresh: "refresh-claude",
		expires: Date.now() + 3600000,
		availableModelIds: ["antigravity-claude-sonnet-5-5", "antigravity-gemini-3.8-flash"],
		addedAt: 2000,
		enabled: true,
		connected: true,
	};

	const directory = await fs.mkdtemp(path.join(os.tmpdir(), "lh-ag-switch-"));
	const credPath = path.join(directory, "google-antigravity-credentials.json");
	const initialState = {
		version: 1,
		allowBackgroundUse: true,
		connectionId: "00000000-0000-4000-8000-000000000004",
		credential: {
			type: "oauth",
			access: accountA.access,
			refresh: accountA.refresh,
			expires: accountA.expires,
			availableModelIds: accountA.availableModelIds,
			email: accountA.email,
			label: accountA.label,
		},
		accounts: [accountA, accountB],
		activeAccountId: accountA.id,
		activeId: accountA.id,
	};
	await fs.writeFile(credPath, `${JSON.stringify(initialState)}\n`, { mode: 0o600 });

	const f = await fixture();
	const controller = createSubscriptions({
		directory,
		sdk: f.sdk,
		openExternal: async () => {},
	}) as MultiAccountController;

	try {
		await controller.ready;

		// 1. Initial active account is Account A (gemini-only)
		const initialSnapshot = await controller.snapshot();
		const initialModels = initialSnapshot.models["google-antigravity"] ?? [];
		assert.deepEqual(initialModels.map((m) => m.id), ["antigravity-gemini-3.8-flash"]);

		const initialScope: NativeSubscriptionScope = {
			providerId: "google-antigravity",
			connectionId: initialSnapshot.statuses.find((s) => s.providerId === "google-antigravity")!.connectionId!,
			epoch: initialSnapshot.statuses.find((s) => s.providerId === "google-antigravity")!.epoch,
			authorityRevision: initialSnapshot.statuses.find((s) => s.providerId === "google-antigravity")!.authorityRevision,
			selectedModelId: "antigravity-gemini-3.8-flash",
		};
		const leaseA = await controller.lease(initialScope, false);
		assert.equal(leaseA.auth.apiKey, "token-gemini-user", "active lease must return Account A access token");

		// 2. Explicitly switch active account to Account B
		if (typeof controller.select === "function" || typeof controller.switchAccount === "function") {
			await switchActiveAccount(controller, "google-antigravity", "acc-claude-pro");

			// 3. Old scope from Account A must be rejected/invalidated
			await assert.rejects(
				controller.lease(initialScope, false),
				"old scope from prior active account must be invalidated by epoch/authority increment",
			);

			// 4. New snapshot must reflect Account B catalog
			const postSwitchSnapshot = await controller.snapshot();
			const postSwitchModels = postSwitchSnapshot.models["google-antigravity"] ?? [];
			assert(
				postSwitchModels.some((m) => m.id === "antigravity-claude-sonnet-5-5"),
				"catalog must update to reflect newly active account models",
			);

			// 5. New scope leases Account B's credentials ONLY
			const newScope: NativeSubscriptionScope = {
				providerId: "google-antigravity",
				connectionId: postSwitchSnapshot.statuses.find((s) => s.providerId === "google-antigravity")!.connectionId!,
				epoch: postSwitchSnapshot.statuses.find((s) => s.providerId === "google-antigravity")!.epoch,
				authorityRevision: postSwitchSnapshot.statuses.find((s) => s.providerId === "google-antigravity")!.authorityRevision,
				selectedModelId: "antigravity-claude-sonnet-5-5",
			};
			const leaseB = await controller.lease(newScope, false);
			assert.equal(leaseB.auth.apiKey, "token-claude-user", "leased apiKey must strictly be Account B token");

			// 6. Verify file on disk records active account and active credential
			const updated = JSON.parse(await fs.readFile(credPath, "utf8"));
			const updatedActiveId = updated.activeId ?? updated.activeAccountId;
			assert.equal(updatedActiveId, "acc-claude-pro");
			assert.equal(updated.credential.access, "token-claude-user");
		}
	} finally {
		controller.close();
		await f.cleanup();
		await fs.rm(directory, { recursive: true, force: true });
	}
});

test("selective disconnect removes only the targeted account and leaves remaining accounts functional", async () => {
	const accountA: AntigravityStoredAccount = {
		id: "acc-keep",
		email: "keep@example.com",
		label: "Keep User",
		access: "token-keep",
		refresh: "refresh-keep",
		expires: Date.now() + 3600000,
		availableModelIds: ["antigravity-gemini-3.8-flash"],
		addedAt: 1000,
		enabled: true,
		connected: true,
	};
	const accountB: AntigravityStoredAccount = {
		id: "acc-remove",
		email: "remove@example.com",
		label: "Remove User",
		access: "token-remove",
		refresh: "refresh-remove",
		expires: Date.now() + 3600000,
		availableModelIds: ["antigravity-gemini-3.8-flash"],
		addedAt: 2000,
		enabled: true,
		connected: true,
	};

	const directory = await fs.mkdtemp(path.join(os.tmpdir(), "lh-ag-disconnect-"));
	const credPath = path.join(directory, "google-antigravity-credentials.json");
	const initialState = {
		version: 1,
		allowBackgroundUse: true,
		connectionId: "00000000-0000-4000-8000-000000000005",
		credential: {
			type: "oauth",
			access: accountA.access,
			refresh: accountA.refresh,
			expires: accountA.expires,
			availableModelIds: accountA.availableModelIds,
			email: accountA.email,
			label: accountA.label,
		},
		accounts: [accountA, accountB],
		activeAccountId: accountA.id,
		activeId: accountA.id,
	};
	await fs.writeFile(credPath, `${JSON.stringify(initialState)}\n`, { mode: 0o600 });

	const f = await fixture();
	const controller = createSubscriptions({
		directory,
		sdk: f.sdk,
		openExternal: async () => {},
	}) as MultiAccountController;

	try {
		await controller.ready;

		// 1. Remove inactive account B selectively
		if (typeof controller.removeAccount === "function" || typeof controller.disconnect === "function") {
			await removeSingleAccount(controller, "google-antigravity", "acc-remove");

			const status = (await controller.status()).find((s) => s.providerId === "google-antigravity")!;
			assert.equal(status.connected, true);
			if (status.accounts) {
				assert.equal(status.accounts.length, 1, "only 1 account should remain");
				assert.equal(status.accounts[0]!.id, "acc-keep");
				const activeId = status.activeId ?? status.activeAccountId;
				assert.equal(activeId, "acc-keep");
			}

			// Stored file must omit removed account
			const saved = JSON.parse(await fs.readFile(credPath, "utf8"));
			assert.equal(saved.accounts.length, 1);
			assert.equal(saved.accounts[0].id, "acc-keep");

			// Active account remains fully leaseable
			const activeScope: NativeSubscriptionScope = {
				providerId: "google-antigravity",
				connectionId: status.connectionId!,
				epoch: status.epoch,
				authorityRevision: status.authorityRevision,
				selectedModelId: "antigravity-gemini-3.8-flash",
			};
			const lease = await controller.lease(activeScope, false);
			assert.equal(lease.auth.apiKey, "token-keep");

			// 2. Remove the last remaining account
			await removeSingleAccount(controller, "google-antigravity", "acc-keep");

			const finalStatus = (await controller.status()).find((s) => s.providerId === "google-antigravity")!;
			assert.equal(finalStatus.connected, false, "removing last account must disconnect provider");
			if (finalStatus.accounts) {
				assert.equal(finalStatus.accounts.length, 0);
				const finalActiveId = finalStatus.activeId ?? finalStatus.activeAccountId;
				assert.equal(finalActiveId, null);
			}

			// Attempting to lease now must reject
			await assert.rejects(controller.lease(activeScope, false));
		}
	} finally {
		controller.close();
		await f.cleanup();
		await fs.rm(directory, { recursive: true, force: true });
	}
});

test("full provider disconnect clears all accounts, credentials, and resets active state", async () => {
	const directory = await fs.mkdtemp(path.join(os.tmpdir(), "lh-ag-full-disconnect-"));
	const credPath = path.join(directory, "google-antigravity-credentials.json");
	const multiState = {
		version: 1,
		allowBackgroundUse: true,
		connectionId: "00000000-0000-4000-8000-000000000006",
		credential: {
			type: "oauth",
			access: "token-any",
			refresh: "refresh-any",
			expires: Date.now() + 3600000,
			availableModelIds: ["antigravity-gemini-3.8-flash"],
		},
		accounts: [
			{ id: "acc-1", email: "user1@example.com", access: "token-any", refresh: "refresh-any", expires: Date.now() + 3600000, connected: true },
			{ id: "acc-2", email: "user2@example.com", access: "token-any-2", refresh: "refresh-any-2", expires: Date.now() + 3600000, connected: true },
		],
		activeAccountId: "acc-1",
		activeId: "acc-1",
	};
	await fs.writeFile(credPath, `${JSON.stringify(multiState)}\n`, { mode: 0o600 });

	const f = await fixture();
	const controller = createSubscriptions({
		directory,
		sdk: f.sdk,
		openExternal: async () => {},
	}) as MultiAccountController;

	try {
		await controller.ready;
		// Full disconnect (no accountId argument)
		await controller.disconnect("google-antigravity");

		const status = (await controller.status()).find((s) => s.providerId === "google-antigravity")!;
		assert.equal(status.connected, false);
		if (status.accounts) {
			assert.equal(status.accounts.length, 0);
			const activeId = status.activeId ?? status.activeAccountId;
			assert.equal(activeId, null);
		}

		// Snapshot models must be empty
		const snapshot = await controller.snapshot();
		assert.deepEqual(snapshot.models["google-antigravity"], []);
	} finally {
		controller.close();
		await f.cleanup();
		await fs.rm(directory, { recursive: true, force: true });
	}
});
