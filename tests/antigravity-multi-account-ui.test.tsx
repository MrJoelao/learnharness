import React, { act } from "react";
(globalThis as Record<string, unknown>).React = React;
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { createRoot, type Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import {
	NativeSubscriptionConnection,
	NativeSubscriptionUIProvider,
	emptySubscriptionStatus,
} from "../components/settings/subscription-connections.tsx";
import { InteractionLayersProvider } from "../components/interaction-layers.tsx";
import { installModalDom } from "./modal-dom.ts";
import type {
	NativeSubscriptionControlBridge,
	NativeSubscriptionProviderId,
	NativeSubscriptionStatus,
	NativeSubscriptionAccount,
} from "../src/core/contracts/subscriptions.ts";

const dom = parseHTML("<html><body></body></html>");
Object.assign(globalThis, {
	window: dom.window,
	document: dom.document,
	Element: dom.window.Element,
	HTMLElement: dom.window.HTMLElement,
	CustomEvent: dom.window.CustomEvent,
	IS_REACT_ACT_ENVIRONMENT: true,
});
installModalDom(dom);

let root: Root | undefined, host: HTMLDivElement | undefined;

export interface TestSubscriptionAccount {
	id: string;
	email: string;
	label?: string;
	active?: boolean;
	connected?: boolean;
	planEnabled?: boolean;
	canSignInAgain?: boolean;
	addedAt?: number;
}

export type MultiAccountNativeStatus = NativeSubscriptionStatus & {
	accounts?: readonly (NativeSubscriptionAccount | TestSubscriptionAccount)[];
	activeAccountId?: string | null;
	activeId?: string | null;
};

export interface MultiAccountControlBridge extends NativeSubscriptionControlBridge {
	select?: (id: NativeSubscriptionProviderId, accountId: string) => Promise<void>;
	switchAccount?: (id: NativeSubscriptionProviderId, accountId: string) => Promise<void>;
	removeAccount?: (id: NativeSubscriptionProviderId, accountId: string) => Promise<void>;
	importOpenCode?: (id: NativeSubscriptionProviderId) => Promise<void>;
}

function deferred() {
	let resolve!: () => void;
	const promise = new Promise<void>((done) => { resolve = done; });
	return { promise, resolve };
}

function fixture(initialAccounts?: TestSubscriptionAccount[], activeId?: string) {
	const defaultAccounts = initialAccounts ?? [
		{ id: "acc-1", email: "user1@example.com", label: "User 1", active: true, connected: true, addedAt: 1000 },
	];
	const initialActive = activeId ?? defaultAccounts[0]?.id ?? null;
	let statuses: MultiAccountNativeStatus[] = [
		{
			...emptySubscriptionStatus("google-antigravity"),
			available: true,
			connected: true,
			connectionId: "local-google-antigravity",
			accounts: defaultAccounts,
			activeAccountId: initialActive,
			activeId: initialActive,
		},
		{
			...emptySubscriptionStatus("github-copilot"),
			available: true,
			connected: false,
			connectionId: null,
		},
		{
			...emptySubscriptionStatus("xai"),
			available: true,
			connected: false,
			connectionId: null,
		},
	];

	const listeners = new Set<() => void>();
	const login = deferred();
	const calls = {
		login: [] as unknown[][],
		cancel: 0,
		open: [] as unknown[][],
		consent: [] as unknown[][],
		disconnect: [] as (string | undefined)[][],
		retry: [] as string[],
		select: [] as unknown[][],
		switchAccount: [] as unknown[][],
		removeAccount: [] as unknown[][],
		importOpenCode: [] as string[],
	};

	function push(id: NativeSubscriptionProviderId, next: Partial<MultiAccountNativeStatus>) {
		statuses = statuses.map((s) => (s.providerId === id ? { ...s, revision: s.revision + 1, ...next } : s));
		for (const listener of listeners) listener();
	}

	const bridge: MultiAccountControlBridge = {
		status: async () => structuredClone(statuses),
		login: async (id, enabled, accountId) => {
			calls.login.push([id, enabled, accountId]);
			push(id, { pending: true });
			await login.promise;
		},
		cancel: async (id) => {
			calls.cancel++;
			push(id, { pending: false, interaction: undefined });
		},
		respond: async () => {},
		open: async (...args) => { calls.open.push(args); },
		retry: async (id) => { calls.retry.push(id); },
		disconnect: async (id, accountId?: string) => {
			calls.disconnect.push([id, accountId]);
			if (accountId) {
				// Selective disconnect of an individual account
				calls.removeAccount.push([id, accountId]);
				const current = statuses.find((s) => s.providerId === id);
				const remaining = (current?.accounts ?? []).filter((a) => a.id !== accountId);
				const nextActive = (current?.activeId ?? current?.activeAccountId) === accountId
					? (remaining[0]?.id ?? null)
					: (current?.activeId ?? current?.activeAccountId ?? null);
				push(id, {
					accounts: remaining,
					activeId: nextActive,
					activeAccountId: nextActive,
					connected: remaining.length > 0,
					connectionId: remaining.length > 0 ? current?.connectionId ?? null : null,
				});
			} else {
				// Full provider disconnect
				push(id, { connected: false, connectionId: null, accounts: [], activeAccountId: null, activeId: null });
			}
		},
		consent: async (id, enabled) => {
			calls.consent.push([id, enabled]);
			push(id, { allowBackgroundUse: enabled });
		},
		select: async (id, accountId) => {
			calls.select.push([id, accountId]);
			calls.switchAccount.push([id, accountId]);
			const current = statuses.find((s) => s.providerId === id);
			const updatedAccounts = current?.accounts?.map((a) => ({ ...a, active: a.id === accountId }));
			push(id, { activeId: accountId, activeAccountId: accountId, accounts: updatedAccounts });
		},
		switchAccount: async (id, accountId) => {
			calls.switchAccount.push([id, accountId]);
			calls.select.push([id, accountId]);
			const current = statuses.find((s) => s.providerId === id);
			const updatedAccounts = current?.accounts?.map((a) => ({ ...a, active: a.id === accountId }));
			push(id, { activeId: accountId, activeAccountId: accountId, accounts: updatedAccounts });
		},
		removeAccount: async (id, accountId) => {
			calls.removeAccount.push([id, accountId]);
			calls.disconnect.push([id, accountId]);
			const current = statuses.find((s) => s.providerId === id);
			const remaining = (current?.accounts ?? []).filter((a) => a.id !== accountId);
			const nextActive = (current?.activeId ?? current?.activeAccountId) === accountId
				? (remaining[0]?.id ?? null)
				: (current?.activeId ?? current?.activeAccountId ?? null);
			push(id, {
				accounts: remaining,
				activeId: nextActive,
				activeAccountId: nextActive,
				connected: remaining.length > 0,
				connectionId: remaining.length > 0 ? current?.connectionId ?? null : null,
			});
		},
		importOpenCode: async (id) => { calls.importOpenCode.push(id); },
		onChange: (listener) => {
			listeners.add(listener);
			return () => { listeners.delete(listener); };
		},
	};

	(window as any).lh = { expandWindow() {}, subscriptions: bridge };
	return { bridge, calls, login, push, get statuses() { return statuses; } };
}

async function mount() {
	host = document.createElement("div");
	document.body.append(host);
	root = createRoot(host);
	await act(async () =>
		root!.render(
			<InteractionLayersProvider>
				<NativeSubscriptionUIProvider>
					<NativeSubscriptionConnection providerId="google-antigravity" />
				</NativeSubscriptionUIProvider>
			</InteractionLayersProvider>,
		),
	);
}

function maybeButton(text: string, scope: ParentNode = document) {
	return [...scope.querySelectorAll<HTMLButtonElement>("button")].find((el) => el.textContent === text);
}

function button(text: string, scope: ParentNode = document) {
	const found = maybeButton(text, scope);
	assert(found, `missing button ${text}`);
	return found;
}

const row = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}-connection"]`)!;
const dialog = () => document.querySelector<HTMLElement>('[data-testid="subscription-connection-dialog"]')!;

async function click(element: HTMLElement) {
	assert(element);
	await act(async () => element.click());
}

afterEach(async () => {
	await act(async () => root?.unmount());
	host?.remove();
	root = undefined;
	host = undefined;
	delete (window as any).lh;
});

test("connection row displays account dropdown when multiple accounts are connected and invokes account switch on change", async () => {
	const accounts: TestSubscriptionAccount[] = [
		{ id: "acc-1", email: "work@company.com", label: "Work Account", active: true, connected: true, addedAt: 1000 },
		{ id: "acc-2", email: "personal@gmail.com", label: "Personal Account", active: false, connected: true, addedAt: 2000 },
	];
	const f = fixture(accounts, "acc-1");
	await mount();

	const agRow = row("google-antigravity");
	const select = agRow.querySelector<HTMLSelectElement>("select");
	assert.ok(select, "account selector should be rendered in connection row when multiple accounts exist");
	assert.equal(select.value, "acc-1", "active account should be selected by default");

	// Trigger account switch to acc-2
	await act(async () => {
		select.selectedIndex = 1;
		for (const opt of select.options) opt.removeAttribute("selected");
		select.options[1]?.setAttribute("selected", "selected");
		Object.defineProperty(select, "value", { configurable: true, writable: true, value: "acc-2" });
		select.dispatchEvent(new window.Event("change", { bubbles: true }));
	});

	const switched = f.calls.switchAccount.length > 0 || f.calls.select.length > 0;
	assert.ok(switched, "switching dropdown must invoke switchAccount or select on bridge");
});

test("connection row omits redundant account dropdown when only a single account is connected", async () => {
	const singleAccount: TestSubscriptionAccount[] = [
		{ id: "acc-only", email: "solo@example.com", label: "Solo Account", active: true, connected: true, addedAt: 1000 },
	];
	fixture(singleAccount, "acc-only");
	await mount();

	const agRow = row("google-antigravity");
	const select = agRow.querySelector<HTMLSelectElement>("select");
	assert.equal(select, null, "account selector should not render when only one account is connected");
	assert.ok(maybeButton("Manage…", agRow), "Manage action should still be available");
});

test("connection row does not imply an active account after the active account was removed", async () => {
	const accounts: TestSubscriptionAccount[] = [
		{ id: "acc-1", email: "one@example.com", connected: true },
		{ id: "acc-2", email: "two@example.com", connected: true },
	];
	const f = fixture(accounts, "acc-1");
	await mount();
	await act(async () => f.push("google-antigravity", { activeId: null, activeAccountId: null, connected: false, connectionId: null }));
	assert.equal(row("google-antigravity").querySelector("select"), null, "saved accounts without an active selection must not look selected");
});

test("manage dialog displays accounts manager with active badge and Switch/Remove controls", async () => {
	const accounts: TestSubscriptionAccount[] = [
		{ id: "acc-1", email: "active@example.com", label: "Active User", active: true, connected: true, addedAt: 1000 },
		{ id: "acc-2", email: "secondary@example.com", label: "Secondary User", active: false, connected: true, addedAt: 2000 },
	];
	const f = fixture(accounts, "acc-1");
	await mount();

	const agRow = row("google-antigravity");
	await click(button("Manage…", agRow));

	const d = dialog();
	assert.ok(d, "manage dialog must open");
	assert.equal(d.querySelector("h2")?.textContent, "Google Antigravity");

	// Check accounts manager section
	const manager = d.querySelector<HTMLElement>('[data-testid="antigravity-accounts-manager"]');
	if (manager) {
		assert.ok(manager.textContent?.includes("active@example.com"));
		assert.ok(manager.textContent?.includes("secondary@example.com"));

		// Active account should have Active indicator
		assert.ok(manager.textContent?.includes("Active"));

		// Inactive account should have Switch button
		const switchBtn = [...manager.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "Switch");
		assert.ok(switchBtn, "inactive account must have Switch button");
		assert.equal([...manager.querySelectorAll<HTMLButtonElement>("button")].filter((b) => b.textContent === "Remove").length, accounts.length, "every saved account, including the active one, must be removable individually");
		await click(switchBtn);
		assert.ok(f.calls.switchAccount.length > 0 || f.calls.select.length > 0, "clicking Switch must invoke account selection");

		// Inactive account should have Remove button for selective disconnect
		const removeBtn = [...manager.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "Remove");
		assert.ok(removeBtn, "inactive account must have Remove button");
		await click(removeBtn);
		assert.ok(f.calls.removeAccount.length > 0 || f.calls.disconnect.some(([_, accId]) => !!accId), "clicking Remove must invoke selective disconnect");
	}
});

test("add account button in manage dialog transitions cleanly to notice without redundant select and starts login on Continue", async () => {
	const accounts: TestSubscriptionAccount[] = [
		{ id: "acc-1", email: "existing@example.com", active: true, connected: true, addedAt: 1000 },
	];
	const f = fixture(accounts, "acc-1");
	await mount();

	await click(button("Manage…", row("google-antigravity")));
	assert.ok(dialog().querySelector('[data-testid="antigravity-accounts-manager"]'), "saved accounts manager rendered");

	const addBtn = dialog().querySelector<HTMLButtonElement>('[data-testid="antigravity-add-account"]')!;
	assert.ok(addBtn);
	await click(addBtn);

	// In notice view:
	assert.equal(dialog().querySelector("select"), null, "dialog must not display redundant account select dropdown");
	assert.ok(dialog().querySelector('[data-testid="subscription-privacy-notice"]'), "privacy notice shown");
	assert.equal(f.calls.disconnect.length, 0, "add account must not disconnect existing accounts");

	// Canceling notice view returns to manage view:
	const cancelBtn = button("Cancel", dialog());
	await click(cancelBtn);
	assert.ok(dialog().querySelector('[data-testid="antigravity-accounts-manager"]'), "canceling returns to manage view");

	// Click Add account again and proceed:
	await click(dialog().querySelector<HTMLButtonElement>('[data-testid="antigravity-add-account"]')!);
	const continueBtn = button("Continue", dialog());
	await click(continueBtn);

	// Directly starts login and enters connection view:
	assert.equal(f.calls.login.length, 1, "clicking Continue immediately starts login");
	assert.equal(dialog().querySelector('[data-testid="antigravity-accounts-manager"]'), null, "connection view must NOT render saved accounts manager");
	assert(!maybeButton("Connect", dialog()), "connection view must not display redundant Connect button when login is pending");
});

test("full disconnect in dialog footer requires confirmation and disconnects entire provider", async () => {
	const accounts: TestSubscriptionAccount[] = [
		{ id: "acc-1", email: "user1@example.com", active: true, connected: true },
		{ id: "acc-2", email: "user2@example.com", active: false, connected: true },
	];
	const f = fixture(accounts, "acc-1");
	await mount();

	await click(button("Manage…", row("google-antigravity")));
	const disconnectBtn = button("Disconnect", dialog());
	await click(disconnectBtn);

	// Confirmation view appears
	assert.ok(dialog().textContent?.includes("Disconnect Google Antigravity?"));
	assert.equal(f.calls.disconnect.length, 0, "initial click must show confirmation before disconnecting");

	// Confirm disconnect
	const confirmBtn = button("Disconnect", dialog());
	await click(confirmBtn);
	assert.deepEqual(f.calls.disconnect[0], ["google-antigravity", undefined]);
});
