"use client";

import { useEffect, useRef, useState } from "react";
import { DICTATION_LANGUAGES, type DictationLanguage } from "@/src/core";
import { MenuShell } from "@/components/menu-shell";
import { useInteractionLayers } from "@/components/interaction-layers";
import { Hint } from "@/components/ui/hint";
import { SettingsMenuTrigger, SettingsRow, ThinSelect } from "@/components/settings/controls";
import { SearchMenuList } from "@/components/settings/search-menu-list";
import { useDictationActive } from "@/components/dictation-state";
import { useDictationLanguage } from "@/components/dictation-preference";
import { onSettingsSaved } from "@/components/settings-signal";

export interface DictationProvidersAvailability {
	deepgram: boolean;
	codex: boolean;
	antigravity: boolean;
}

export function useDictationProviders() {
	const [providers, setProviders] = useState<DictationProvidersAvailability | undefined>(undefined);
	useEffect(() => {
		let cancelled = false;
		const load = () => {
			fetch("/api/stt/providers")
				.then((res) => (res.ok ? res.json() : null))
				.then((data) => {
					if (!cancelled && data && typeof data === "object") {
						setProviders({
							deepgram: Boolean((data as Record<string, unknown>).deepgram),
							codex: Boolean((data as Record<string, unknown>).codex),
							antigravity: Boolean((data as Record<string, unknown>).antigravity),
						});
					}
				})
				.catch(() => {});
		};
		load();
		return onSettingsSaved((section) => {
			if (section === "dictation" || section === "models" || section === "general") load();
		});
	}, []);
	return { providers };
}

type LanguagePreference = ReturnType<typeof useDictationLanguage>;

export function DictationLanguageSetting() {
	const preference = useDictationLanguage();
	const active = useDictationActive();
	return <SettingsRow label="Language" testid="row-dictation-language" dimmed={active}>
		<DictationLanguagePicker preference={preference} disabled={active} />
	</SettingsRow>;
}

export function DictationProviderSetting() {
	const { provider, saving, saveProvider, error } = useDictationLanguage();
	const active = useDictationActive();
	const { providers } = useDictationProviders();

	const deepgramAvailable = providers?.deepgram ?? true;
	const codexAvailable = providers?.codex ?? true;
	const antigravityAvailable = providers?.antigravity ?? true;

	return <>
		<SettingsRow label="Dictation provider" testid="row-dictation-provider" dimmed={active}>
			<ThinSelect
				value={provider ?? "deepgram"}
				ariaLabel="Dictation provider"
				testid="dictation-provider"
				disabled={active || saving || provider === undefined}
				onChange={(value) => {
					if (value === "codex" || value === "deepgram" || value === "antigravity") {
						void saveProvider(value);
					}
				}}
			>
				<option value="deepgram" disabled={providers !== undefined && !deepgramAvailable}>
					Deepgram{providers !== undefined && !deepgramAvailable ? " (no key)" : ""}
				</option>
				<option value="codex" disabled={providers !== undefined && !codexAvailable}>
					Codex CLI{providers !== undefined && !codexAvailable ? " (not connected)" : ""}
				</option>
				<option value="antigravity" disabled={providers !== undefined && !antigravityAvailable}>
					Google Antigravity{providers !== undefined && !antigravityAvailable ? " (not connected)" : ""}
				</option>
			</ThinSelect>
		</SettingsRow>
		{error && <p role="alert" className="px-1 text-xs text-destructive">{error}</p>}
	</>;
}

function DictationLanguagePicker({ preference, disabled }: {
	preference: LanguagePreference;
	disabled: boolean;
}) {
	const { language, saving, error, load, save } = preference;
	const [open, setOpen] = useState(false);
	const triggerRef = useRef<HTMLButtonElement>(null);
	const interactions = useInteractionLayers();
	const label = DICTATION_LANGUAGES.find((item) => item.code === language)?.label ?? "—";

	useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
	useEffect(() => {
		if (!open) return;
		const onPointerDown = (event: PointerEvent) => {
			const popup = interactions.getTopLayer();
			if (popup?.kind !== "popup" || popup.anchorRef?.current !== triggerRef.current || !interactions.isElementEligible(popup.rootRef.current)) return;
			const target = event.target as Element;
			if (target instanceof Element && target.closest('[data-testid="dictation-language-menu"]')) return;
			if (!triggerRef.current?.contains(target)) setOpen(false);
		};
		document.addEventListener("pointerdown", onPointerDown);
		return () => document.removeEventListener("pointerdown", onPointerDown);
	}, [open, interactions]);
	const pick = async (code: DictationLanguage) => {
		if (disabled || saving || language === undefined) return;
		if (await save(code)) {
			setOpen(false);
			if (interactions.isElementEligible(triggerRef.current) || interactions.isPopupOrigin(triggerRef.current)) triggerRef.current?.focus();
		}
	};

	return <>
		<Hint label={error ?? `Dictation language: ${label}`} side="top">
			<SettingsMenuTrigger
				ref={triggerRef}
				value={label}
				data-testid="dictation-language"
				aria-label={`Dictation language: ${label}`}
				aria-expanded={open && !disabled}
				disabled={disabled || saving}
				onClick={() => {
					setOpen((value) => !value);
					if (language === undefined) void load().catch(() => {});
				}}
				className="min-w-20 max-w-[65%]"
			/>
		</Hint>
		{open && !disabled && <MenuShell
			anchorRef={triggerRef}
			testid="dictation-language-menu"
			onClose={(reason) => { setOpen(false); if (reason === "escape") triggerRef.current?.focus(); return "closed"; }}
			preferredSide="down"
			menuClass="flex w-72 max-w-[calc(100vw-1rem)] flex-col rounded-xl border border-border bg-card p-2 text-xs shadow-xl"
		>
			<div onKeyDown={(event) => {
				if (event.key === "Enter") {
					// Empty search results must not submit the composer, but a
					// focused option button still needs Enter's native click.
					if (event.target instanceof HTMLInputElement) event.preventDefault();
					event.stopPropagation();
				}
			}}>
				{error && <div role="alert" className="mb-1.5 text-destructive">{error}</div>}
				<SearchMenuList
					items={DICTATION_LANGUAGES}
					itemKey={(item) => item.code}
					searchTerms={(item) => [item.code, item.label]}
					isSelected={(item) => item.code === language}
					onPick={(item) => { void pick(item.code); }}
					disabled={saving || language === undefined}
					searchTestid="dictation-language-search"
					listTestid="dictation-language-list"
					optionTestid={(item) => `dictation-language-${item.code}`}
					ariaLabel="Search dictation languages"
					placeholder="Search languages…"
					empty="No languages match."
					renderItem={(item) => <span className="text-card-foreground">{item.label}</span>}
				/>
			</div>
		</MenuShell>}
	</>;
}
