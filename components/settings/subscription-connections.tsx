"use client";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import { NATIVE_SUBSCRIPTIONS, type NativeSubscriptionProviderId, type NativeSubscriptionStatus } from "@/src/core";
import { Button } from "@/components/ui/button";
import { notifySettingsSaved } from "@/components/settings-signal";
import { ConnectionDialog, ConnectionFooter, ConnectionRow } from "./connection-controls";
import { ChatGPTConnection } from "./chatgpt-connection";
import { Toggle } from "./controls";
import { useNativeSubscriptionBridge } from "./subscription-client";
import type { CloseOutcome } from "@/components/interaction-layers";

export const COPILOT_POLICY_NOTICE = "Pi's native Copilot sign-in may enable additional models whose policy is not yet configured. Models explicitly disabled by policy are not enabled. Organization restrictions still apply.";
export const ANTIGRAVITY_DISCLAIMER_NOTICE = "Not supported or endorsed by Google. Google's Antigravity FAQ and Terms say that using third-party software to access Antigravity violates its Terms and may result in suspension or termination of your account. Continue only if you accept that risk.";
export const SUBSCRIPTION_BACKGROUND_HINT = "Allow LearnHarness helper agents and automatic follow-ups to use this connection.";
export function subscriptionNotice(label: string, web = false): string { return `Your prompts, tool results, and relevant session context are sent to ${label} to run the work you select. Credentials are stored ${web ? "on the machine running LearnHarness" : "locally"} in an owner-only plaintext file. Provider terms, data-use policies, and plan limits apply. This connection never falls back to an API key.`; }
export function subscriptionDisconnectCopy(label: string, web = false): string { return `Disconnect ${label} from LearnHarness? This stops work using this connection and removes its saved credentials from ${web ? "the machine running LearnHarness" : "this device"}. It does not cancel your subscription or revoke access at the provider. Saved model choices will remain unavailable until you reconnect or change them.`; }
export function emptySubscriptionStatus(providerId: NativeSubscriptionProviderId): NativeSubscriptionStatus { return { providerId, available: false, connected: false, pending: false, allowBackgroundUse: true, connectionId: null, epoch: 0, authorityRevision: 0, revision: 0 }; }
const Context = createContext({
	statuses: [] as NativeSubscriptionStatus[],
	busy: false,
	open: (_providerId: NativeSubscriptionProviderId, _accountId?: string) => {},
	select: (_providerId: NativeSubscriptionProviderId, _accountId: string) => {},
});
const CONTROL_ERROR = "The connection could not be changed. Try again.";

export function NativeSubscriptionUIProvider({ children }: { children: React.ReactNode }) {
	const bridge = useNativeSubscriptionBridge();
	const web = typeof window !== "undefined" && bridge !== window.lh?.subscriptions;
	const [statuses, setStatuses] = useState<NativeSubscriptionStatus[]>([]);
	const [dialog, setDialog] = useState<NativeSubscriptionProviderId | null>(null);
	const [view, setView] = useState<"notice" | "connection" | "manage">("notice");
	const [confirm, setConfirm] = useState(false), [background, setBackground] = useState(true), [backgroundDirty, setBackgroundDirty] = useState(false), [promptValue, setPromptValue] = useState("");
	const [managedAccountId, setManagedAccountId] = useState<string | null>(null);
	const [registration, setRegistration] = useState("");
	const [operation, setOperation] = useState<"login" | "control" | null>(null), [error, setError] = useState<string | null>(null);
	const mounted = useRef(false), sequence = useRef(0), generation = useRef(0), statusesRef = useRef(statuses);
	const descriptor = NATIVE_SUBSCRIPTIONS.find((p) => p.providerId === dialog);
	const status = statuses.find((s) => s.providerId === dialog) ?? (dialog ? emptySubscriptionStatus(dialog) : undefined);
	const interaction = status?.interaction, prompt = interaction?.prompt;
	const management = view === "manage";
	const busy = operation === "control" || status?.committing === true;
	const isAntigravity = dialog === "google-antigravity";
	const hasAccounts = isAntigravity && !!status?.accounts && status.accounts.length > 0;
	const managed = isAntigravity && status?.accounts && status.accounts.length > 0
		? status.accounts.find((a) => a.id === managedAccountId) ?? status.accounts.find((a) => a.id === (status.activeAccountId ?? status.activeId)) ?? status.accounts[0]
		: undefined;
	const managedPresent = !!managed && !!status?.accounts?.some((a) => a.id === managed.id);
	async function refresh() {
		const request = ++sequence.current;
		try {
			const values = await bridge?.status();
			if (!mounted.current || request !== sequence.current || !Array.isArray(values)) return;
			const accepted = NATIVE_SUBSCRIPTIONS.map(({ providerId }) => {
				const next = values.find((s) => s.providerId === providerId), old = statusesRef.current.find((s) => s.providerId === providerId);
				return next && (!old || next.revision >= old.revision) ? next : old ?? emptySubscriptionStatus(providerId);
			});
			statusesRef.current = accepted; setStatuses(accepted);
		} catch { if (mounted.current && request === sequence.current) setError("The desktop connection is unavailable. Retry when the app is ready."); }
	}
	useEffect(() => {
		mounted.current = true; void refresh();
		const off = bridge?.onChange(() => { void refresh(); notifySettingsSaved("keys"); });
		return () => { mounted.current = false; generation.current++; off?.(); };
		// The root-lifetime subscriber reads current state through refs.
	}, [bridge]);
	useEffect(() => { setPromptValue(""); }, [prompt?.id]);
	function open(providerId: NativeSubscriptionProviderId, accountId?: string) {
		if (operation || statusesRef.current.some((s) => s.pending)) return;
		generation.current++; setError(null); setConfirm(false); setBackgroundDirty(false);
		const current = statusesRef.current.find((s) => s.providerId === providerId);
		setBackground(current?.allowBackgroundUse ?? true);
		setRegistration(accountId ?? "");
		const activeId = current?.activeAccountId ?? current?.activeId ?? current?.accounts?.find((a) => a.connected)?.id ?? null;
		setManagedAccountId(accountId ?? activeId ?? current?.accounts?.[0]?.id ?? null);
		const isConnected = !!current?.connectionId || (current?.accounts && current.accounts.length > 0);
		setView(isConnected ? "manage" : "notice"); setDialog(providerId);
	}
	async function control(action: () => Promise<void>, close = false) {
		if (busy) return;
		const owner = ++generation.current; setOperation("control"); setError(null);
		try { await action(); await refresh(); if (mounted.current && owner === generation.current && close) setDialog(null); }
		catch { if (mounted.current && owner === generation.current) setError(CONTROL_ERROR); }
		finally { if (mounted.current && owner === generation.current) setOperation(null); }
	}
	// Antigravity multi-account: switches the active account without disconnect/reconnect.
	function select(providerId: NativeSubscriptionProviderId, accountId: string) {
		if (bridge && !busy) {
			setManagedAccountId(accountId);
			void control(async () => {
				if (typeof bridge.switchAccount === "function") await bridge.switchAccount(providerId, accountId);
				else if (typeof bridge.select === "function") await bridge.select(providerId, accountId);
			});
		}
	}
	function close(): CloseOutcome {
		if (!dialog || busy) return "blocked";
		if (confirm) { setConfirm(false); setError(null); return "handled-without-close"; }
		if ((status?.pending || operation === "login") && bridge) { void control(() => bridge.cancel(dialog), true); return "pending"; }
		generation.current++; setDialog(null); setError(null);
		return "closed";
	}
	function handleCancel() {
		if (confirm) { setConfirm(false); setError(null); return; }
		if (hasAccounts && view === "notice") { setView("manage"); setError(null); return; }
		if (hasAccounts && view === "connection") {
			if ((status?.pending || operation === "login") && bridge) void control(() => bridge.cancel(dialog));
			setView("manage"); setError(null); return;
		}
		close();
	}
	function beginSignIn(accountId?: string) {
		if (operation || busy || !status) return;
		generation.current++; setError(null); setConfirm(false); setBackground(status.allowBackgroundUse); setBackgroundDirty(false);
		setRegistration(accountId ?? ""); setView("notice");
	}
	async function login() {
		if (!dialog || !bridge || operation || !status?.available) return;
		const owner = ++generation.current; setOperation("login"); setError(null);
		const addingAccount = hasAccounts;
		try {
			await bridge.login(dialog, backgroundDirty ? background : undefined, registration || undefined);
			await refresh();
			if (mounted.current && generation.current === owner) {
				if (addingAccount) setView("manage");
				else setDialog(null);
			}
		}
		catch { if (mounted.current && generation.current === owner) setError("Sign-in did not complete. Try connecting again."); }
		finally { if (mounted.current && generation.current === owner) setOperation(null); }
	}
	async function removeAccount(accountId: string) {
		if (!dialog || !bridge) return;
		await control(async () => {
			if (typeof bridge.removeAccount === "function") {
				await bridge.removeAccount(dialog, accountId);
			} else {
				await bridge.disconnect(dialog, accountId);
			}
			await refresh();
			const updated = statusesRef.current.find((s) => s.providerId === dialog);
			const remaining = updated?.accounts?.filter((a) => a.id !== accountId) ?? [];
			if (remaining.length > 0) {
				const nextActive = updated?.activeAccountId ?? updated?.activeId ?? remaining[0]?.id ?? null;
				setManagedAccountId(nextActive);
			} else {
				setDialog(null);
			}
		});
	}
	async function fullDisconnect() {
		if (!dialog || !bridge) return;
		await control(async () => {
			await bridge.disconnect(dialog);
			await refresh();
			setDialog(null);
		}, true);
	}
	return <Context.Provider value={{ statuses, busy: !!operation, open, select }}>
		{children}
		{dialog && descriptor && status && <ConnectionDialog key={`${dialog}:${view}:${confirm}`} label={`${descriptor.label} connection`} testid="subscription-connection-dialog" backdropTestid="subscription-dialog-backdrop" busy={busy} onClose={close}>
			<div className="flex items-center gap-2">
				{isAntigravity && (
					/* eslint-disable-next-line @next/next/no-img-element */
					<img src="/siwc/google-logo.svg" width="18" height="18" alt="" aria-hidden="true" className="shrink-0" />
				)}
				<h2 className="text-sm font-semibold text-foreground">{descriptor.label}</h2>
			</div>
			{confirm ? <>
				<p className="mt-3 text-sm font-semibold text-error">Disconnect {descriptor.label}?</p>
				<p className="mt-3 text-xs leading-relaxed text-muted-foreground">{subscriptionDisconnectCopy(descriptor.label, web)}</p>
			</> : view === "notice" ? <>
				{hasAccounts && <p className="mt-3 text-xs font-semibold text-foreground">Add another Google account</p>}
				<p className="mt-3 text-xs leading-relaxed text-muted-foreground" data-testid="subscription-privacy-notice">{subscriptionNotice(descriptor.label, web)}</p>
				{dialog === "github-copilot" && <p className="mt-3 text-xs leading-relaxed text-muted-foreground" data-testid="copilot-policy-notice">{COPILOT_POLICY_NOTICE}</p>}
				{dialog === "google-antigravity" && <p className="mt-3 text-xs leading-relaxed text-destructive" data-testid="antigravity-disclaimer-notice">{ANTIGRAVITY_DISCLAIMER_NOTICE}</p>}
			</> : view === "manage" ? <>
				{hasAccounts && (
					<div className="mt-4 space-y-2 text-xs" data-testid="antigravity-accounts-manager">
						<div className="flex items-center justify-between">
							<span className="font-semibold text-foreground">Saved accounts</span>
							<Button variant="outline" size="xs" data-testid="antigravity-add-account" className="cursor-pointer gap-1.5 text-xs text-foreground hover:bg-muted" onClick={() => { setRegistration(""); setView("notice"); setError(null); }} disabled={busy || status.pending || !status.available}>
								{/* eslint-disable-next-line @next/next/no-img-element */}
								<img src="/siwc/google-logo.svg" width="13" height="13" alt="" aria-hidden="true" className="shrink-0" />
								Add account
							</Button>
						</div>
						<div className="divide-y divide-border rounded-md border border-border bg-background/50 overflow-hidden">
							{status.accounts!.map((a) => {
								const isActive = a.id === (status.activeAccountId ?? status.activeId) || (!status.activeAccountId && !status.activeId && a.active);
								return <div key={a.id} className="flex items-center justify-between px-3 py-2.5 hover:bg-muted/30 transition-colors">
									<div className="flex min-w-0 items-center gap-2.5">
										{/* eslint-disable-next-line @next/next/no-img-element */}
										<img src="/siwc/google-logo.svg" width="16" height="16" alt="" aria-hidden="true" className="shrink-0 opacity-90" />
										<div className="flex min-w-0 flex-col">
											<span className="truncate font-medium text-foreground">{a.email || "Google account"}</span>
											{isActive && <span className="text-[10px] text-primary">Active</span>}
										</div>
									</div>
									<div className="flex shrink-0 items-center gap-1.5">
										{!isActive && (
											<Button variant="outline" size="xs" className="cursor-pointer text-xs" disabled={busy || status.pending} onClick={() => select(dialog, a.id)} data-testid={`antigravity-switch-${a.id}`}>Switch</Button>
										)}
										<Button variant="ghost" size="xs" className="cursor-pointer text-xs text-error hover:bg-error/10 hover:text-error" disabled={busy || status.pending} onClick={() => removeAccount(a.id)} data-testid={`antigravity-remove-${a.id}`}>Remove</Button>
									</div>
								</div>;
							})}
						</div>
					</div>
				)}
				<div className="mt-4 flex items-center gap-3 text-xs text-foreground">
					<Toggle label="Allow background use" checked={status.allowBackgroundUse} disabled={busy || !!operation || status.pending || !status.available} onChange={(enabled) => { setBackground(enabled); if (bridge) void control(() => bridge.consent(dialog, enabled)); }} />
					<span>Allow background use<span className="mt-1 block leading-relaxed text-muted-foreground">{SUBSCRIPTION_BACKGROUND_HINT}</span></span>
				</div>
			</> : <>
				<div className="mt-4 flex items-center gap-3 text-xs text-foreground">
					<Toggle label="Allow background use" checked={management ? status.allowBackgroundUse : background} disabled={busy || !!operation || status.pending || !status.available} onChange={(enabled) => { setBackground(enabled); if (management && bridge) void control(() => bridge.consent(dialog, enabled)); else setBackgroundDirty(true); }} />
					<span>Allow background use<span className="mt-1 block leading-relaxed text-muted-foreground">{SUBSCRIPTION_BACKGROUND_HINT}</span></span>
				</div>
				{!status.available && <p className="mt-3 text-xs text-muted-foreground">Subscription sign-in requires the desktop app's private server connection. API-key connections remain available here.</p>}
				{view === "connection" && interaction && <div className="mt-3 space-y-3 text-xs" data-testid="subscription-login-interaction">
					{interaction.progress && <p role="status" className="text-muted-foreground">{interaction.progress}</p>}
					{interaction.userCode && <p>Device code: <code className="select-text font-mono rounded bg-muted px-1.5 py-0.5">{interaction.userCode}</code></p>}
					{interaction.browser && <Button variant="outline" size="sm" disabled={busy} className="inline-flex items-center gap-2 cursor-pointer bg-background hover:bg-muted" onClick={() => bridge && void bridge.open(dialog, interaction.attemptId, interaction.browser!.id).catch(() => setError("The browser could not be opened. Try again."))}>
						{isAntigravity && (
							/* eslint-disable-next-line @next/next/no-img-element */
							<img src="/siwc/google-logo.svg" width="16" height="16" alt="" aria-hidden="true" className="shrink-0" />
						)}
						Open browser
					</Button>}
					{prompt && <form className="space-y-2 pt-2 border-t border-border/50" onSubmit={(event) => { event.preventDefault(); if (bridge) void bridge.respond(dialog, interaction.attemptId, prompt.id, promptValue).catch(() => setError(CONTROL_ERROR)); }}>
						<label className="block text-muted-foreground" htmlFor="subscription-auth-prompt">{prompt.message}</label>
						{prompt.type === "select" ? <select id="subscription-auth-prompt" value={promptValue} onChange={(event) => setPromptValue(event.target.value)} className="w-full rounded-sm border border-border bg-background px-2.5 py-1.5 text-foreground"><option value="" disabled>Select…</option>{prompt.options?.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select> : <input id="subscription-auth-prompt" type={prompt.type === "secret" ? "password" : "text"} autoComplete="off" value={promptValue} placeholder={prompt.placeholder} onChange={(event) => setPromptValue(event.target.value)} className="w-full rounded-sm border border-border bg-background px-2.5 py-1.5 text-foreground placeholder:text-muted-foreground/60 font-mono text-[11px]" />}
						<Button type="submit" variant="outline" size="sm" disabled={busy || (prompt.type === "select" && !promptValue)}>Continue</Button>
					</form>}
				</div>}
			</>}
			{(error || status.error) && <p role="alert" className="mt-3 text-xs text-error">{error || status.error}</p>}
			<ConnectionFooter testid="subscription-connection-footer" leading={!confirm && management && (status.connectionId || (isAntigravity && managed)) && !status.pending && <Button variant="ghost" size="sm" className="cursor-pointer text-error hover:bg-error/10 hover:text-error" data-testid={isAntigravity ? "antigravity-disconnect" : undefined} disabled={busy || !!operation} onClick={() => setConfirm(true)}>Disconnect</Button>}>
				{!confirm && management && (status.connectionId || (isAntigravity && managed)) && status.available && !status.connected && !!status.error && !status.pending && <>
					{status.error && <Button variant="outline" size="sm" disabled={busy || !!operation} onClick={() => bridge && void control(() => bridge.retry(dialog))}>Retry</Button>}
					<Button variant="outline" size="sm" disabled={!status.available || busy || !!operation} onClick={() => beginSignIn()}>Sign in again</Button>
				</>}
				{!confirm && management && isAntigravity && managedPresent && managed && !managed.connected && managed.canSignInAgain === true && status.available && (
					<Button variant="outline" size="sm" disabled={busy || !!operation} onClick={() => beginSignIn(managed.id)}>Sign in again</Button>
				)}
				<Button variant={!confirm && management ? "outline" : "ghost"} size="sm" disabled={busy} onClick={handleCancel}>{confirm || !management ? "Cancel" : "Close"}</Button>
				{confirm ? (
					<Button variant="destructive" size="sm" disabled={busy} onClick={() => void fullDisconnect()}>Disconnect</Button>
				) : view === "notice" ? (
					<Button variant="outline" size="sm" disabled={!status.available || !!operation} className={isAntigravity ? "cursor-pointer inline-flex items-center gap-2" : undefined} onClick={() => { setView("connection"); if (hasAccounts) void login(); }}>
						{isAntigravity && (
							/* eslint-disable-next-line @next/next/no-img-element */
							<img src="/siwc/google-logo.svg" width="16" height="16" alt="" aria-hidden="true" className="shrink-0" />
						)}
						Continue
					</Button>
				) : view === "connection" && !interaction && !status.pending && operation !== "login" ? (
					<Button variant="outline" size="sm" disabled={!status.available || !!operation || status.pending} className={isAntigravity ? "cursor-pointer inline-flex items-center gap-2" : undefined} onClick={() => void login()}>
						{isAntigravity && (
							/* eslint-disable-next-line @next/next/no-img-element */
							<img src="/siwc/google-logo.svg" width="16" height="16" alt="" aria-hidden="true" className="shrink-0" />
						)}
						Connect
					</Button>
				) : null}
			</ConnectionFooter>
		</ConnectionDialog>}
	</Context.Provider>;
}

export function NativeSubscriptionConnection({ providerId, labelClassName }: { providerId: NativeSubscriptionProviderId; labelClassName?: string }) {
	const ui = useContext(Context), descriptor = NATIVE_SUBSCRIPTIONS.find((p) => p.providerId === providerId)!;
	const status = ui.statuses.find((s) => s.providerId === providerId) ?? emptySubscriptionStatus(providerId);
	const isAntigravity = providerId === "google-antigravity";
	const activeId = status.activeAccountId ?? status.activeId ?? null;
	const active = activeId ? status.accounts?.find((a) => a.id === activeId) : undefined;
	const accounts = status.accounts ?? [];
	const isConnected = !!status.connectionId || accounts.length > 0;
	return <div className="flex flex-col gap-2" data-testid={`${providerId}-connection`}>
		<ConnectionRow label={descriptor.label} labelClassName={labelClassName} action={isConnected ? "Manage…" : "Connect"} disabled={ui.busy || !status.available || ui.statuses.some((s) => s.pending)} onAction={() => ui.open(providerId, active?.id)}>
			{isAntigravity && active && accounts.length > 1 && (
				<select aria-label="Google Antigravity account" value={active.id} disabled={ui.busy || status.pending} onChange={(event) => ui.select(providerId, event.target.value)} className="min-w-0 rounded-sm border border-border bg-background px-2 py-1 text-xs text-foreground">
					{accounts.map((a) => <option key={a.id} value={a.id}>{a.email || "Google account"}</option>)}
				</select>
			)}
		</ConnectionRow>
		{status.error && <p role="alert" className="text-xs text-error">{status.error}</p>}
	</div>;
}
export function SubscriptionConnections({ setup = false }: { setup?: boolean }) {
	// Providers uses ordinary settings-label typography. The setup surface
	// keeps its existing compact labels; dialogs and actions are untouched.
	const labelClassName = setup ? undefined : "font-prose text-(length:--lh-prose-size) text-foreground";
	return <div className="space-y-3" data-testid="subscription-connections"><ChatGPTConnection setup={setup} labelClassName={labelClassName} />{NATIVE_SUBSCRIPTIONS.map((p) => <NativeSubscriptionConnection key={p.providerId} providerId={p.providerId} labelClassName={labelClassName} />)}</div>;
}
export function NativeSubscriptionBackgroundAccess({ provider }: { provider: string | undefined }) {
	const ui = useContext(Context), descriptor = NATIVE_SUBSCRIPTIONS.find((p) => p.logicalId === provider);
	const status = ui.statuses.find((s) => s.providerId === descriptor?.providerId);
	if (!descriptor || !status?.connected || status.allowBackgroundUse) return null;
	return <Button type="button" size="xs" variant="ghost" disabled={ui.busy} onClick={() => ui.open(descriptor.providerId)}>Enable background use</Button>;
}
