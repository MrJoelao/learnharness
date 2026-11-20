"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { FACTORY_SETTINGS, sanitizeUserSettings, type GeneralSettings, type UserSettings } from "@/src/core";
import { onSettingsSaved } from "@/components/settings-signal";

export interface ResolvedGeneralSettings {
	autoUpdate: boolean;
	studyHub: boolean;
	notes: boolean;
}

const DEFAULT_GENERAL: ResolvedGeneralSettings = {
	autoUpdate: FACTORY_SETTINGS.general.autoUpdate,
	studyHub: FACTORY_SETTINGS.general.studyHub,
	notes: FACTORY_SETTINGS.general.notes,
};

let currentSnapshot: ResolvedGeneralSettings = DEFAULT_GENERAL;
const listeners = new Set<() => void>();
let inFlight: Promise<ResolvedGeneralSettings> | null = null;
let initialized = false;

function emitChange() {
	for (const listener of listeners) listener();
}

export function fetchGeneralSettings(): Promise<ResolvedGeneralSettings> {
	if (inFlight) return inFlight;
	inFlight = fetch("/api/settings")
		.then((res) => (res.ok ? res.json() : null))
		.then((body: { settings?: UserSettings | null } | null) => {
			inFlight = null;
			if (!body) return currentSnapshot;
			const sanitized = sanitizeUserSettings(body.settings ?? undefined);
			const next: ResolvedGeneralSettings = {
				autoUpdate: sanitized?.general?.autoUpdate ?? FACTORY_SETTINGS.general.autoUpdate,
				studyHub: sanitized?.general?.studyHub ?? FACTORY_SETTINGS.general.studyHub,
				notes: sanitized?.general?.notes ?? FACTORY_SETTINGS.general.notes,
			};
			if (
				next.autoUpdate !== currentSnapshot.autoUpdate ||
				next.studyHub !== currentSnapshot.studyHub ||
				next.notes !== currentSnapshot.notes
			) {
				currentSnapshot = next;
				emitChange();
			}
			return currentSnapshot;
		})
		.catch(() => {
			inFlight = null;
			return currentSnapshot;
		});
	return inFlight;
}

function subscribe(callback: () => void): () => void {
	listeners.add(callback);
	if (!initialized && typeof window !== "undefined") {
		initialized = true;
		void fetchGeneralSettings();
	}
	return () => {
		listeners.delete(callback);
	};
}

function getSnapshot(): ResolvedGeneralSettings {
	return currentSnapshot;
}

function getServerSnapshot(): ResolvedGeneralSettings {
	return currentSnapshot;
}

if (typeof window !== "undefined") {
	onSettingsSaved((section) => {
		if (section === "general") {
			void fetchGeneralSettings();
		}
	});
}

/**
 * Live, reactive hook for GeneralSettings across the entire app.
 * Re-reads immediately whenever settings are saved.
 */
export function useGeneralSettings(): ResolvedGeneralSettings {
	return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export function _setGeneralSettingsForTest(next: ResolvedGeneralSettings) {
	currentSnapshot = next;
	emitChange();
}

export function _resetGeneralSettingsForTest() {
	currentSnapshot = DEFAULT_GENERAL;
	initialized = false;
	inFlight = null;
	emitChange();
}
