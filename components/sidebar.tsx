"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, Suspense, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { MenuShell } from "@/components/menu-shell";
import { DeleteSessionDialog } from "@/components/delete-session-dialog";
import type { ThemeMode, ChatDeleteMode } from "@/src/core";
import {
	DumbbellIcon,
	FolderPlusIcon,
	GraduationCapIcon,
	ArchiveIcon,
	PanelLeftCloseIcon,
	PanelLeftOpenIcon,
	PlusIcon,
	SearchIcon,
	SettingsIcon,
	XIcon,
	ChevronRightIcon,
	FolderIcon,
	FolderOpenIcon,
	MoreVerticalIcon,
	MessageSquareDotIcon,
} from "lucide-react";
import { ActivitySection, useActivity } from "@/components/activity-dock";
import { CoverageMenuBlock } from "@/components/extraction-coverage";
import { LhMark } from "@/components/lh-mark";
import { BrailleSpinner } from "@/components/braille-spinner";
import { KeyboardShortcuts } from "@/components/keyboard-shortcuts";
import { SettingsDialogProvider, useSettingsDialog } from "@/components/settings/settings-dialog.tsx";
import { Hint } from "@/components/ui/hint";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { fuzzyScore } from "@/src/core";
import { useServerEvent, useServerResync } from "@/components/server-events";
import {
	chatFolderIsEmpty,
	type ChatListItem,
	type ChatDirectoryItem,
	type ChatFolder,
	type ChatOrganization,
	type ChatOrganizationAction,
} from "@/src/core";
import {
	MoveDestinationDialog,
	DeleteFolderDialog,
	OrganizationFeedbackToast,
	computeUndoAction,
	getSiblingMoveAction,
	type MoveTargetItem,
	type OrganizationFeedback,
} from "@/components/chat-organization-interactions";
import { ChatFolderTree, ArchiveView, getChatFolderChain, getFolderChatCount, getAncestorFolderIds } from "@/components/chat-folder-tree";
import { kbdEventForAction, bindingForAction, formatBinding } from "@/src/core";
import { notifySettingsSaved } from "@/components/settings-signal";
import { PluginWidgets } from "@/components/plugins";
import { PluginSidebarActions } from "@/components/plugin-chrome";
import { HostContentRootContext, HostRouteLifetimeProvider } from "@/components/host-content-root";
import { InteractionLayersProvider } from "@/components/interaction-layers";

/**
 * Toggleable sidebar — NOT a modal drawer: no backdrop, no focus theft. It
 * sits inline next to the content and can stay open while working in a
 * session. Open state persists across pages (provider lives in the root
 * layout) and across reloads (localStorage).
 */

const STORAGE_KEY = "lh:sidebar-open";

/*
 * Narrow-window behavior (owner, 2026-09-17): below SIDEBAR_AUTOCLOSE the
 * sidebar would squeeze the page below the 640px window floor (the two
 * numbers compose: 640 + 288 sidebar = 928), so it auto-closes — and
 * auto-RESTORES when the window widens again (owner choice: the sidebar
 * pops back, not a manual re-open). The whole behavior is one expression:
 * rendered = pref && !narrow, where pref is the persisted user choice.
 * Manual closes persist and stay closed; auto-close does not touch the
 * preference. Opening the sidebar while narrow asks the Electron shell to
 * widen the window to the threshold (window.lh.expandWindow, IPC in
 * electron/main.cjs) — the resize listener flips `narrow` and the sidebar
 * appears. In the plain browser there is no window to widen and no
 * suppression — a narrow tab opens the sidebar if the user says so.
 *
 * Mirrors SIDEBAR_AUTOCLOSE in electron/main.cjs — keep in sync.
 */
import type { ChatGPTControlBridge, NativeSubscriptionControlBridge } from "@/src/core";
import type { UpdateState } from "@/components/settings/update-settings.tsx";
import { FilePathDropZone } from "@/components/file-path-drop-zone";
const SIDEBAR_AUTOCLOSE = 928;

// Module scope, guarded for SSR (the server has no navigator).
const IS_ELECTRON = typeof navigator !== "undefined" && navigator.userAgent.includes("Electron");

declare global {
	interface Window {
		/** Preload bridge (electron/preload.cjs) — Electron only, absent in the browser. */
		lh?: {
			/** Read-only host OS; determines the native-control gutter. */
			platform?: string;
			/** Resolve an OS-backed File without copying/uploading its contents. */
			getPathForFile?: (file: File) => string;
			/** Choose one original directory path, without reading its contents. */
			chooseAttachmentFolder?: () => Promise<string | null>;
			/** External Next desktop-dev uses the server's web connections. */
			subscriptionTransport?: "desktop" | "web";
			openSubscriptionBrowser?: (action: string) => Promise<void>;
			chatgpt?: ChatGPTControlBridge;
			subscriptions?: NativeSubscriptionControlBridge;
			expandWindow: () => void;
			/** Native chrome follows the appearance (light-mode wave): main sets
			 *  themeSource and repaints the window background / overlay. */
			setAppearance?: (a: { mode: ThemeMode; background: string }) => void;
			/** The zoom truth (owner round 7): subscribes to "lh:zoom" pushes; returns unsubscribe. */
			onZoom?: (cb: (factor: number) => void) => () => void;
			getZoom?: () => Promise<number>;
			/** Observational update events and a snapshot for late subscribers. */
			onUpdateStatus?: (cb: (status: UpdateState) => void) => () => void;
			getUpdateState?: () => Promise<UpdateState>;
			/** Explicit manual check also downloads and stages available updates. */
			checkForUpdates?: () => Promise<void>;
			installUpdate?: () => void;
			onOpenSettings?: (cb: (section: string) => void) => () => void;
		};
	}
}

const SidebarContext = createContext<{ open: boolean; toggle: () => void }>({
	open: false,
	toggle: () => {},
});

export function useSidebar() {
	return useContext(SidebarContext);
}

export function SidebarProvider({ children }: { children: React.ReactNode }) {
	useEffect(() => {
		const bridge = window.lh?.chatgpt;
		if (!bridge) return;
		const off = bridge.onChange(() => notifySettingsSaved("keys"));
		notifySettingsSaved("keys"); // cover changes missed before this root-lifetime subscription
		return off;
	}, []);
	// Start closed so server and client first-render agree (no hydration
	// mismatch); the stored value is applied after mount.
	const [open, setOpen] = useState(false);
	const [narrow, setNarrow] = useState(false);
	const [mounted, setMounted] = useState(false);

	useEffect(() => {
		// Electron shell detection (merged chrome, 2026-09-17): keys the
		// .lh-electron CSS (app/globals.css) that turns the header bands
		// into the window's drag surface. Post-mount only — server HTML
		// and first client render must agree (no hydration mismatch),
		// and in the plain browser the class never appears.
		if (IS_ELECTRON) {
			document.documentElement.classList.add("lh-electron");
			document.documentElement.dataset.lhPlatform = window.lh?.platform ?? "";
		}

		// THE ZOOM TRUTH (owner round 7, 2026-10-05): ⌘±/⌘0 zoom the UI
		// (Electron zoomFactor) while the native traffic lights stay
		// physical-fixed — the CSS gutter lengths divide by this factor so
		// their RENDERED size never moves. getZoom covers the first-paint
		// race; every later change arrives as an lh:zoom push.
		const setZoomVar = (factor: number) =>
			document.documentElement.style.setProperty("--lh-zoom", String(factor));
		const off = window.lh?.onZoom?.(setZoomVar);
		void window.lh?.getZoom?.().then(setZoomVar);

		const stored = localStorage.getItem(STORAGE_KEY);
		// Default: open (first run introduces the sidebar).
		setOpen(stored === null ? true : stored === "1");
		setMounted(true);
		return () => off?.();
	}, []);

	// Narrow-window auto-close/auto-restore (see SIDEBAR_AUTOCLOSE note):
	// fires only on actual resizes — a boolean compare, no layout work.
	// Both this and the mount effect land before the first paint, so a
	// narrow window never flashes the open sidebar on load.
	useEffect(() => {
		if (!IS_ELECTRON) return; // plain-browser tabs open freely
		const onResize = () => setNarrow(window.innerWidth < SIDEBAR_AUTOCLOSE);
		onResize();
		window.addEventListener("resize", onResize);
		return () => window.removeEventListener("resize", onResize);
	}, []);

	const toggle = useCallback(() => {
		// Opening while narrow (auto-closed, or the user's own closed-at-
		// narrow): ask the shell to widen to the threshold — the resize
		// listener flips `narrow` and the sidebar appears. The preference
		// persists like any other open, so a restart at a narrow width
		// still auto-restores when widened.
		if (narrow && !open) {
			localStorage.setItem(STORAGE_KEY, "0");
			setOpen(true);
			window.lh?.expandWindow();
			return;
		}
		setOpen((v) => {
			localStorage.setItem(STORAGE_KEY, v ? "0" : "1");
			return !v;
		});
	}, [narrow, open]);

	// ⌘B: the global shortcut dispatches kbdEventForAction("toggle-sidebar")
	// and the context answers on exactly that name — the shared spelling
	// is the fix for the interlude bug (the listener sat on the pre-
	// convention name "lh:toggle-sidebar" while the dispatcher sent
	// "lh:kbd-toggle-sidebar", so ⌘B silently did nothing; owner
	// 2026-09-25).
	useEffect(() => {
		const event = kbdEventForAction("toggle-sidebar");
		const onToggle = () => toggle();
		window.addEventListener(event, onToggle);
		return () => window.removeEventListener(event, onToggle);
	}, [toggle]);

	return (
		<SidebarContext.Provider value={{ open: open && !narrow, toggle }}>
			{/* transitions gated on mount: no slide-in flash on page load */}
			<div className={cn("flex h-dvh", mounted && "[&_.sidebar-motion]:transition-[width,margin,opacity]")}>{children}</div>
		</SidebarContext.Provider>
	);
}

/** Hamburger for page headers — only visible when the sidebar is closed.
 *
 *  Owner, round 6c: the toggle is ALWAYS MOUNTED, owning a slot whose
 *  width+margin animate in LOCKSTEP with the sidebar's own width
 *  transition (same duration-200, same easing, both gated on mount) —
 *  before, it mounted/unmounted in one frame, so its 48px footprint
 *  (button + gap) popped and dragged the title and chips sideways while
 *  the sidebar was still mid-slide. When open the slot is exactly zero
 *  (w-0 -mr-3: width 0, the negative margin cancels the header's gap-3),
 *  so resting layouts are pixel-identical to the old conditional render.
 *  The icon fades with the slot and is clipped by it as it collapses —
 *  no popping in either direction. */
export function SidebarToggle() {
	const { open, toggle } = useSidebar();
	return (
		<span
			className={cn(
				"sidebar-motion lh-no-drag relative flex h-9 shrink-0 overflow-hidden duration-200",
				open ? "w-0 -mr-3" : "w-9 mr-0 lh-closed-toggle",
			)}
		>
			<Hint label="Open sidebar" action="toggle-sidebar">
			<Button
				variant="ghost"
				size="icon"
				aria-label="Open sidebar"
				aria-hidden={open}
				tabIndex={open ? -1 : 0}
				onClick={toggle}
				className={cn("sidebar-motion duration-200", open ? "pointer-events-none opacity-0" : "opacity-100")}
			>
				{/* Owner, round 6: size-4, SAME as the close glyph — the toggle
				    must not grow when the sidebar is closed (it did: size-5 here).
				    The small look is the standard, both directions. */}
				<PanelLeftOpenIcon className="size-4" />
			</Button>
			</Hint>
		</span>
	);
}

/**
 * The row's status indicator (owner, minimal-color round): the braille
 * spinner, ONLY while a teach turn is in flight — monochrome motion, the
 * terminal's own glyph, existing exactly as long as the work does and
 * vanishing the moment it ends. Every other state renders NOTHING:
 * phases only advance (all sessions end in Teaching — phase-as-signal was
 * decoration, now retired app-wide), and question-pending is the dominant
 * RESTING state of real sessions — a resting state has no scan value, so
 * the meta line's "Waiting for input" text carries it. Idle is the
 * absence of a signal, by design.
 */
function SessionStatus({ busy }: { busy: boolean }) {
	if (!busy) return null;
	return <BrailleSpinner />;
}

/** Compact "how long ago": "just now", "5m ago", "3h ago", "2d ago",
 *  then a plain date. How long a session has been WAITING matters more
 *  than an absolute timestamp. Beyond a week the date renders ISO
 *  (YYYY-MM-DD, zero-padded) — the international standard: unambiguous
 *  in any locale and it sorts (owner, typography round 5; the old
 *  M/D/YYYY was the US convention. A user-locale setting can come later
 *  — trivial, a format function swap). Pure — exported for tests. */
export function timeAgo(iso: string, now = new Date()): string {
	const ms = now.getTime() - new Date(iso).getTime();
	if (ms < 60_000) return "just now";
	const min = Math.floor(ms / 60_000);
	if (min < 60) return `${min}m ago`;
	const h = Math.floor(min / 60);
	if (h < 24) return `${h}h ago`;
	const d = Math.floor(h / 24);
	if (d < 7) return `${d}d ago`;
	const date = new Date(iso);
	const mm = String(date.getMonth() + 1).padStart(2, "0");
	const dd = String(date.getDate()).padStart(2, "0");
	return `${date.getFullYear()}-${mm}-${dd}`;
}

/** The row's second line: the state when a state exists (waiting/working),
 *  otherwise just how long ago. The message count is DROPPED (owner,
 *  typography round 5): it informed no decision — clutter. messageCount
 *  still rides the API payload, so this is a one-line flip back if it's
 *  ever wanted. */
export type SessionRowItem = ChatListItem | ChatDirectoryItem;

function sessionStatusText(chat: SessionRowItem): string | null {
	if (chat.compacting) return "Compacting context";
	if (chat.pendingQuestion) return "Waiting for input";
	if ((chat.kind ?? "teach") === "practice" && chat.pendingProblem) {
		return "Problem waiting";
	}
	if (chat.busy) return "Working…";
	return null;
}

/**
 * Renders the session status indicator in the right metadata cluster.
 * Keeps rows strictly single-line (never expands row height).
 * Uses subtle monochromatic icons / spinners with tooltips and accessible screen-reader labels.
 */
export function SessionStatusMeta({
	status,
	isBusy,
}: {
	status: string | null;
	isBusy?: boolean;
}) {
	if (isBusy || status === "Working…" || status === "Compacting context") {
		const label = status === "Compacting context" ? "Compacting context" : "Working";
		const tooltip = status === "Compacting context" ? "Compacting context" : "Working…";
		return (
			<Hint label={tooltip} side="left">
				<span
					className="inline-flex size-3 shrink-0 items-center justify-center text-muted-foreground/70 transition-colors hover:text-muted-foreground/90 cursor-default"
					title={tooltip}
				>
					<BrailleSpinner label={label} />
					<span className="sr-only">{tooltip}</span>
				</span>
			</Hint>
		);
	}

	if (!status) return null;

	if (status === "Waiting for input" || status === "Problem waiting") {
		return (
			<Hint label={status} side="left">
				<span
					className="inline-flex size-3 shrink-0 items-center justify-center text-muted-foreground/60 transition-colors hover:text-muted-foreground/90 cursor-default"
					title={status}
				>
					<MessageSquareDotIcon className="size-3 shrink-0" aria-hidden="true" />
					<span className="sr-only">{status}</span>
				</span>
			</Hint>
		);
	}

	return (
		<Hint label={status} side="left">
			<span
				className="inline-flex size-3 shrink-0 items-center justify-center text-muted-foreground/60 transition-colors hover:text-muted-foreground/90 cursor-default"
				title={status}
			>
				<span className="sr-only">{status}</span>
			</span>
		</Hint>
	);
}

/**
 * One session row: the status spinner (only while working), then title +
 * state-aware meta. Exported for render tests — pure function of the
 * list item.
 */
export function SessionRow({
	chat,
	active,
	onOpen,
	kbdSelected = false,
	onContextMenu,
	folderPath,
	style,
}: {
	chat: SessionRowItem;
	active: boolean;
	onOpen: () => void;
	/** Keyboard-cycle highlight (shortcut wave A: Alt+↑/↓ + Alt+Enter) —
	 *  visually distinct from the active session, which stays filled. */
	kbdSelected?: boolean;
	/** Right-click opens the context menu (wave 6: Rename / Delete). */
	onContextMenu?: (e: React.MouseEvent<HTMLButtonElement>) => void;
	/** Optional folder path displayed during search (e.g. "SO Lab / Assembly") */
	folderPath?: string | null;
	style?: React.CSSProperties;
}) {
	const status = sessionStatusText(chat);
	const isBusy = Boolean(chat.busy || chat.compacting);

	return (
		<button
			type="button"
			onClick={onOpen}
			onContextMenu={onContextMenu}
			data-session-id={chat.id}
			data-testid={kbdSelected ? "session-row-kbd" : "session-row"}
			className={cn(
				"group relative mb-0.5 flex w-full items-center gap-1.5 rounded-lg py-1.5 pl-2.5 pr-2 text-left transition-colors hover:bg-muted/40 cursor-pointer",
				active && "bg-accent text-foreground",
				kbdSelected && !active && "bg-accent/40 ring-1 ring-border/80",
			)}
			style={style}
		>
			<span className="min-w-0 flex-1">
				{folderPath && (
					<span
						data-testid="session-folder-path"
						className="block truncate text-[10px] text-muted-foreground/75 font-mono leading-none mb-0.5"
					>
						{folderPath}
					</span>
				)}
				{/* Title and date row with dedicated icon slot and fixed-position date */}
				<div className="flex h-5 items-center justify-between gap-1.5 min-w-0">
					<span className="truncate font-prose text-sm leading-snug text-foreground min-w-0">
						{chat.title}
					</span>
					<div className="flex items-center gap-1.5 shrink-0 ml-auto pl-1.5">
						<SessionStatusMeta status={status} isBusy={isBusy} />
						{(chat.kind ?? "teach") === "practice" && (
							<DumbbellIcon className="size-3 shrink-0 text-muted-foreground/60" aria-label="Practice session" />
						)}
						<span className="min-w-[44px] text-right text-[10px] tabular-nums text-muted-foreground/60 shrink-0">
							{timeAgo(chat.updatedAt)}
						</span>
					</div>
				</div>
			</span>
		</button>
	);
}

/** The inline-rename row (wave 6): same geometry as SessionRow, but the
 *  title line becomes a text input — select-all on entry (the click means
 *  "replace", the header rename's rule), Enter/blur commits, Esc discards.
 *  The meta line stays so the row never changes height mid-edit. */
export function RenameRow({
	chat,
	onCommit,
	onCancel,
	style,
}: {
	chat: SessionRowItem;
	onCommit: (next: string) => void;
	onCancel: () => void;
	style?: React.CSSProperties;
}) {
	const [draft, setDraft] = useState(chat.title);
	const inputRef = useRef<HTMLInputElement | null>(null);
	const committedRef = useRef(false);
	const cancelledRef = useRef(false);
	const status = sessionStatusText(chat);
	const isBusy = Boolean(chat.busy || chat.compacting);

	useEffect(() => {
		const el = inputRef.current;
		if (el) {
			el.focus();
			el.select();
		}
	}, []);

	const handleCommit = (val: string) => {
		if (committedRef.current || cancelledRef.current) return;
		committedRef.current = true;
		const trimmed = val.trim();
		if (!trimmed) {
			onCancel();
		} else {
			onCommit(trimmed);
		}
	};

	const handleCancel = () => {
		if (committedRef.current || cancelledRef.current) return;
		cancelledRef.current = true;
		onCancel();
	};

	return (
		<div
			data-testid="session-rename-row"
			className="relative mb-0.5 flex w-full items-center gap-1.5 rounded-lg bg-accent py-1.5 pl-2.5 pr-2"
			style={style}
		>
			{/* NOTHING MOVES (owner, polish round): an idle row renders no
			    status spacer (SessionStatus is null when not busy), so the
			    title starts at the row's own px-2.5. The input here is borderless
			    and padding-free at the exact title x; the underline is the only editing cue. */}
			<span className="flex min-w-0 w-full flex-col">
				<div className="flex h-5 items-center justify-between gap-1.5 min-w-0">
					<input
						ref={inputRef}
						value={draft}
						spellCheck={false}
						onChange={(e) => setDraft(e.target.value)}
						onBlur={() => handleCommit(draft)}
						onKeyDown={(e) => {
							if (e.key === "Enter") {
								e.preventDefault();
								handleCommit(draft);
							}
							if (e.key === "Escape") {
								e.stopPropagation();
								handleCancel();
							}
						}}
						aria-label="Rename session"
						data-testid="session-rename-input"
						className="w-full min-w-0 truncate border-0 border-b border-border bg-transparent px-0 font-prose text-sm leading-snug text-foreground outline-none"
					/>
					<div className="flex items-center gap-1.5 shrink-0 ml-auto pl-1.5">
						<SessionStatusMeta status={status} isBusy={isBusy} />
						{(chat.kind ?? "teach") === "practice" && (
							<DumbbellIcon className="size-3 shrink-0 text-muted-foreground/60" aria-label="Practice session" />
						)}
						<span className="min-w-[44px] text-right text-[10px] tabular-nums text-muted-foreground/60 shrink-0">
							{timeAgo(chat.updatedAt)}
						</span>
					</div>
				</div>
			</span>
		</div>
	);
}

/** The three-way kind filter (practice sessions, owner 2026-10-04):
 *  Teaching / All / Practice — a client-side filter over the same
 *  snapshot, persisted in localStorage, defaulting to All. */
export type SessionKindFilter = "teach" | "all" | "practice";
const KIND_FILTER_KEY = "lh:session-kind-filter";

function useSafeRouter() {
	try {
		return useRouter();
	} catch {
		return {
			push: (url: string) => {
				if (typeof window !== "undefined") window.location.href = url;
			},
			back: () => {
				if (typeof window !== "undefined") window.history.back();
			},
			forward: () => {
				if (typeof window !== "undefined") window.history.forward();
			},
			refresh: () => {},
			replace: (url: string) => {
				if (typeof window !== "undefined") window.location.replace(url);
			},
			prefetch: () => {},
		};
	}
}

function useSafePathname() {
	try {
		const p = usePathname();
		if (p) return p;
	} catch {
		// fallback
	}
	if (typeof window !== "undefined" && window.location?.pathname) {
		return window.location.pathname;
	}
	return "";
}

function useSafeSearchParams() {
	try {
		const sp = useSearchParams();
		if (sp) return sp;
	} catch {
		// fallback
	}
	if (typeof window !== "undefined" && window.location?.search !== undefined) {
		return new URLSearchParams(window.location.search);
	}
	return null;
}

export function SessionsSidebar({
	initialArchivedFolders,
	initialArchivedChats,
	initialExpandedFolderIds,
	initialChats,
	initialFolders,
}: {
	initialArchivedFolders?: ChatFolder[];
	initialArchivedChats?: ChatDirectoryItem[];
	initialExpandedFolderIds?: Set<string>;
	initialChats?: ChatDirectoryItem[];
	initialFolders?: ChatFolder[];
} = {}) {
	const { open, toggle } = useSidebar();
	const { feed: activityFeed, topicOrganization, topicOrganizationError } = useActivity();
	const hasActiveJobs = (activityFeed?.jobs?.length ?? 0) > 0 || (activityFeed?.extractions?.length ?? 0) > 0 || topicOrganization !== null || topicOrganizationError !== null;
	const [organization, setOrganization] = useState<ChatOrganization | null>(null);
	const [folders, setFolders] = useState<ChatFolder[]>(initialFolders ?? []);
	const [chats, setChats] = useState<ChatDirectoryItem[] | null>(initialChats ?? null);
	const [archivedFolders, setArchivedFolders] = useState<ChatFolder[]>(initialArchivedFolders ?? []);
	const [archivedChats, setArchivedChats] = useState<ChatDirectoryItem[]>(initialArchivedChats ?? []);
	const pathname = useSafePathname();
	const searchParams = useSafeSearchParams();

	const isArchiveRoute = pathname === "/archive";
	const isChatRoute = Boolean(pathname?.startsWith("/chat/"));
	const currentChatId = isChatRoute ? pathname.replace("/chat/", "").split("/")[0] : null;

	const currentArchivedChat = useMemo(() => {
		if (!currentChatId) return null;
		return archivedChats.find((c) => c.id === currentChatId) ?? null;
	}, [currentChatId, archivedChats]);

	const isCurrentChatArchived = Boolean(currentArchivedChat);

	// Segregate active folders and chats so archived items are excluded from Sessions active tree
	const activeFolders = useMemo(() => folders.filter((f) => !f.archivedAt), [folders]);
	const activeChats = useMemo(() => (chats ?? []).filter((c) => !c.archivedAt), [chats]);

	const isCurrentChatActive = useMemo(() => {
		if (!currentChatId) return false;
		if (activeChats.some((c) => c.id === currentChatId)) return true;
		if (chats !== null && !isCurrentChatArchived) return true;
		return false;
	}, [currentChatId, activeChats, chats, isCurrentChatArchived]);

	const isArchiveMode = isArchiveRoute || (isChatRoute && isCurrentChatArchived && !isCurrentChatActive);

	const urlFolderParam = useMemo(() => {
		if (searchParams) return searchParams.get("folder");
		if (typeof window !== "undefined" && window.location?.search !== undefined) {
			return new URLSearchParams(window.location.search).get("folder");
		}
		return null;
	}, [searchParams]);

	const urlViewParam = useMemo(() => {
		if (searchParams) return searchParams.get("view");
		if (typeof window !== "undefined" && window.location?.search !== undefined) {
			return new URLSearchParams(window.location.search).get("view");
		}
		return null;
	}, [searchParams]);

	const urlFromParam = useMemo(() => {
		if (searchParams) return searchParams.get("from");
		if (typeof window !== "undefined" && window.location?.search !== undefined) {
			return new URLSearchParams(window.location.search).get("from");
		}
		return null;
	}, [searchParams]);

	const { selectedArchiveFolderId, isUnorganizedArchivedActive, isAllArchivedActive } = useMemo(() => {
		if (!isArchiveMode) {
			return {
				selectedArchiveFolderId: null,
				isUnorganizedArchivedActive: false,
				isAllArchivedActive: false,
			};
		}

		if (isArchiveRoute) {
			if (urlFolderParam) {
				return {
					selectedArchiveFolderId: urlFolderParam,
					isUnorganizedArchivedActive: false,
					isAllArchivedActive: false,
				};
			}
			if (urlViewParam === "unorganized") {
				return {
					selectedArchiveFolderId: null,
					isUnorganizedArchivedActive: true,
					isAllArchivedActive: false,
				};
			}
			return {
				selectedArchiveFolderId: null,
				isUnorganizedArchivedActive: false,
				isAllArchivedActive: true,
			};
		}

		// isChatRoute && isCurrentChatArchived:
		const hasUrlContext = urlFromParam === "archive" || urlFolderParam !== null || urlViewParam !== null;

		if (hasUrlContext) {
			if (urlFolderParam) {
				return {
					selectedArchiveFolderId: urlFolderParam,
					isUnorganizedArchivedActive: false,
					isAllArchivedActive: false,
				};
			}
			if (urlViewParam === "unorganized") {
				return {
					selectedArchiveFolderId: null,
					isUnorganizedArchivedActive: true,
					isAllArchivedActive: false,
				};
			}
			return {
				selectedArchiveFolderId: null,
				isUnorganizedArchivedActive: false,
				isAllArchivedActive: true,
			};
		}

		// Direct archived-chat URL without context: derive selection from persisted placement:
		// - select the original archived folder if it exists in archived navigation,
		// - Unorganized if folderId === null,
		// - All Archived if the original folder remains active/not represented in Archive tree.
		if (currentArchivedChat) {
			if (currentArchivedChat.folderId === null) {
				return {
					selectedArchiveFolderId: null,
					isUnorganizedArchivedActive: true,
					isAllArchivedActive: false,
				};
			}
			const folderInArchive = archivedFolders.some((f) => f.id === currentArchivedChat.folderId);
			if (folderInArchive) {
				return {
					selectedArchiveFolderId: currentArchivedChat.folderId,
					isUnorganizedArchivedActive: false,
					isAllArchivedActive: false,
				};
			}
			return {
				selectedArchiveFolderId: null,
				isUnorganizedArchivedActive: false,
				isAllArchivedActive: true,
			};
		}

		return {
			selectedArchiveFolderId: null,
			isUnorganizedArchivedActive: false,
			isAllArchivedActive: true,
		};
	}, [
		isArchiveMode,
		isArchiveRoute,
		urlFolderParam,
		urlViewParam,
		urlFromParam,
		currentArchivedChat,
		archivedFolders,
	]);

	const unorganizedArchivedChatsCount = useMemo(() => {
		return archivedChats.filter((c) => !c.folderId).length;
	}, [archivedChats]);

	const archivedFolderIdSet = useMemo(() => new Set(archivedFolders.map((f) => f.id)), [archivedFolders]);

	const archivedRootFolders = useMemo(() => {
		return archivedFolders.filter((f) => f.parentId === null || !archivedFolderIdSet.has(f.parentId));
	}, [archivedFolders, archivedFolderIdSet]);

	// Ancestors to auto-expand for selected folder and selected chat's folder context
	const archivedAncestorsToExpand = useMemo(() => {
		const toExpand = new Set<string>();
		if (selectedArchiveFolderId) {
			for (const id of getAncestorFolderIds(selectedArchiveFolderId, archivedFolders)) {
				toExpand.add(id);
			}
		}
		if (isCurrentChatArchived && currentArchivedChat?.folderId) {
			const chatFolderInArchived = archivedFolders.some((f) => f.id === currentArchivedChat.folderId);
			if (chatFolderInArchived) {
				for (const id of getAncestorFolderIds(currentArchivedChat.folderId, archivedFolders)) {
					toExpand.add(id);
				}
			}
		}
		return toExpand;
	}, [selectedArchiveFolderId, isCurrentChatArchived, currentArchivedChat, archivedFolders]);

	const [expandedFolderIds, setExpandedFolderIds] = useState<Set<string>>(() => {
		const base = initialExpandedFolderIds
			? new Set(initialExpandedFolderIds)
			: new Set((initialArchivedFolders ?? []).map((f) => f.id));
		const initFolders = initialArchivedFolders ?? [];
		const initChatId = pathname?.startsWith("/chat/") ? pathname.replace("/chat/", "").split("/")[0] : null;
		const initChat = initChatId ? (initialArchivedChats ?? []).find((c) => c.id === initChatId) : null;
		const initFolderParam =
			(typeof window !== "undefined" && window.location?.search
				? new URLSearchParams(window.location.search).get("folder")
				: null) ?? null;
		const targetFolder = initFolderParam || initChat?.folderId;
		if (targetFolder && initFolders.length > 0) {
			for (const id of getAncestorFolderIds(targetFolder, initFolders)) {
				base.add(id);
			}
		}
		return base;
	});

	useEffect(() => {
		if (archivedAncestorsToExpand.size === 0) return;
		setExpandedFolderIds((prev) => {
			let changed = false;
			for (const id of archivedAncestorsToExpand) {
				if (!prev.has(id)) {
					changed = true;
					break;
				}
			}
			if (!changed) return prev;
			const next = new Set(prev);
			for (const id of archivedAncestorsToExpand) {
				next.add(id);
			}
			return next;
		});
	}, [archivedAncestorsToExpand]);

	const [unorganizedExpanded, setUnorganizedExpanded] = useState(true);
	const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
	const [query, setQuery] = useState("");
	const [kindFilter, setKindFilter] = useState<SessionKindFilter>("all");

	useEffect(() => {
		const stored = window.localStorage.getItem(KIND_FILTER_KEY);
		if (stored === "teach" || stored === "all" || stored === "practice") setKindFilter(stored);
	}, []);
	const setFilter = useCallback((f: SessionKindFilter) => {
		setKindFilter(f);
		window.localStorage.setItem(KIND_FILTER_KEY, f);
	}, []);
	const router = useSafeRouter();
	const { open: openSettings } = useSettingsDialog();

	// Listen for archive folder filtering events from archive page or sidebar
	useEffect(() => {
		const onFolderFiltered = (e: Event) => {
			const { folderId } = (e as CustomEvent<{ folderId: string | null }>).detail ?? {};
			setSelectedFolderId(folderId === "all" ? null : folderId ?? null);
		};
		window.addEventListener("lh:archive-folder-filtered", onFolderFiltered);
		return () => window.removeEventListener("lh:archive-folder-filtered", onFolderFiltered);
	}, []);

	const newSession = useCallback(
		(mode?: "practice", folderId?: string | null) => {
			const targetFolder = folderId ?? selectedFolderId;
			const params = new URLSearchParams();
			if (mode === "practice") params.set("mode", "practice");
			if (targetFolder) params.set("folderId", targetFolder);
			const qs = params.toString();
			router.push(`/chat/new${qs ? `?${qs}` : ""}`);
		},
		[router, selectedFolderId],
	);

	const toggleFolder = useCallback((folderId: string) => {
		setExpandedFolderIds((prev) => {
			const next = new Set(prev);
			if (next.has(folderId)) next.delete(folderId);
			else next.add(folderId);
			return next;
		});
	}, []);

	// Auto-expand folder chain for the currently active session
	useEffect(() => {
		if (!pathname?.startsWith("/chat/")) return;
		const chatId = pathname.replace("/chat/", "");
		if (!chatId || !chats || folders.length === 0) return;
		const chat = chats.find((c) => c.id === chatId);
		if (chat?.folderId) {
			const chain = getChatFolderChain(chat.folderId, folders);
			setExpandedFolderIds((prev) => {
				const next = new Set(prev);
				let changed = false;
				for (const id of chain) {
					if (!next.has(id)) {
						next.add(id);
						changed = true;
					}
				}
				return changed ? next : prev;
			});
		}
	}, [pathname, chats, folders]);

	/* FUZZY: subsequence match ranked by fuzzyScore over ACTIVE chats */
	const shown = useMemo(() => {
		const q = query.trim();
		let list = activeChats;
		if (list && kindFilter !== "all") {
			list = list.filter((c) => (c.kind ?? "teach") === kindFilter);
		}
		if (!list) return list ?? null;
		if (!q) return list;
		return list
			.map((c) => ({ c, score: fuzzyScore(q, c.title) }))
			.filter((r): r is { c: ChatDirectoryItem; score: number } => r.score !== null)
			.sort((a, b) => b.score - a.score)
			.map((r) => r.c);
	}, [activeChats, query, kindFilter]);

	const refreshInFlightRef = useRef(false);
	const refresh = useCallback(async () => {
		if (refreshInFlightRef.current) return;
		refreshInFlightRef.current = true;
		try {
			const [orgRes, chatsRes, archRes] = await Promise.all([
				fetch("/api/chats/organization", { cache: "no-store" }),
				fetch("/api/chats", { cache: "no-store" }).catch(() => null),
				fetch("/api/chats/organization?archived=true", { cache: "no-store" }).catch(() => null),
			]);

			if (orgRes.ok) {
				const d = (await orgRes.json()) as { organization: ChatOrganization; chats: ChatDirectoryItem[] };
				let rawChats = d.chats;
				if (chatsRes && chatsRes.ok) {
					try {
						const cData = (await chatsRes.json()) as { chats: ChatListItem[] };
						const busyMap = new Map(cData.chats.map((c) => [c.id, Boolean(c.busy)]));
						const compactingMap = new Map(cData.chats.map((c) => [c.id, Boolean(c.compacting)]));
						rawChats = rawChats.map((c) => ({
							...c,
							busy: busyMap.get(c.id) ?? c.busy,
							compacting: compactingMap.get(c.id) ?? c.compacting,
						}));
					} catch {
						// fallback
					}
				}
				setOrganization(d.organization);
				setFolders(d.organization.folders);
				setChats(rawChats);
			}

			if (archRes && archRes.ok) {
				const archData = (await archRes.json()) as {
					folders: ChatFolder[];
					chats: ChatDirectoryItem[];
				};
				setArchivedFolders(archData.folders ?? []);
				setArchivedChats(archData.chats ?? []);
			}
		} catch {
			setChats((prev) => prev ?? []);
		} finally {
			refreshInFlightRef.current = false;
		}
	}, []);

	// Listen for chat restored event
	useEffect(() => {
		const onChatRestored = (e: Event) => {
			const { id } = (e as CustomEvent<{ id: string }>).detail ?? {};
			if (!id) return;
			setArchivedChats((prev) => prev.filter((c) => c.id !== id));
			void refresh();
		};
		window.addEventListener("lh:chat-restored", onChatRestored);
		return () => window.removeEventListener("lh:chat-restored", onChatRestored);
	}, [refresh]);

	const createFolder = useCallback(
		async (name = "New folder", parentId: string | null = selectedFolderId) => {
			try {
				const res = await fetch("/api/chats/organization", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ action: "create-folder", name, parentId }),
				});
				if (!res.ok) throw new Error("Could not create folder");
				const data = (await res.json()) as { createdFolderId?: string };
				if (parentId) {
					setExpandedFolderIds((prev) => new Set([...prev, parentId]));
				}
				if (data.createdFolderId) {
					setExpandedFolderIds((prev) => new Set([...prev, data.createdFolderId!]));
				}
				void refresh();
			} catch (err) {
				console.error("Failed to create folder:", err);
			}
		},
		[selectedFolderId, refresh],
	);

	/* Instant rename propagation (2026-09-17): the chat header's rename
	   commits dispatch lh:chat-renamed; patch the snapshot in place instead
	   of waiting for the 2.5s poll. */
	useEffect(() => {
		const onRenamed = (e: Event) => {
			const { id, title } = (e as CustomEvent<{ id: string; title: string }>).detail;
			setChats((prev) => (prev ? prev.map((c) => (c.id === id ? { ...c, title } : c)) : prev));
		};
		window.addEventListener("lh:chat-renamed", onRenamed);
		return () => window.removeEventListener("lh:chat-renamed", onRenamed);
	}, []);

	/* Turn state synchronization */
	const chatsRef = useRef(chats);
	chatsRef.current = chats;
	useEffect(() => {
		const onTurnState = (e: Event) => {
			const { id, running } = (e as CustomEvent<{ id: string; running: boolean }>).detail;
			if (running) {
				if (chatsRef.current?.some((c) => c.id === id)) {
					setChats((prev) => (prev ? prev.map((c) => (c.id === id ? { ...c, busy: true } : c)) : prev));
				} else {
					void refresh();
				}
				return;
			}
			setChats((prev) => (prev ? prev.map((c) => (c.id === id ? { ...c, busy: false } : c)) : prev));
			void refresh();
		};
		window.addEventListener("lh:turn-state", onTurnState);
		return () => window.removeEventListener("lh:turn-state", onTurnState);
	}, [refresh]);

	const refreshRef = useRef(refresh);
	refreshRef.current = refresh;
	const eventDebounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	const scheduleEventRefresh = () => {
		if (eventDebounceRef.current) clearTimeout(eventDebounceRef.current);
		eventDebounceRef.current = setTimeout(() => {
			eventDebounceRef.current = undefined;
			void refreshRef.current();
		}, 250);
	};
	useServerEvent("chats-changed", scheduleEventRefresh);
	useServerEvent("chat-organization-changed", scheduleEventRefresh);
	useServerEvent("turn-started", scheduleEventRefresh);
	useServerEvent("turn-settled", scheduleEventRefresh);
	useServerEvent("compaction-changed", scheduleEventRefresh);
	useServerResync(() => void refreshRef.current());
	useEffect(
		() => () => {
			if (eventDebounceRef.current) clearTimeout(eventDebounceRef.current);
		},
		[],
	);

	const [kbdIndex, setKbdIndex] = useState<number | null>(null);
	const searchRef = useRef<HTMLInputElement>(null);
	const listRef = useRef<HTMLDivElement>(null);

	const [ctxChatId, setCtxChatId] = useState<string | null>(null);
	const ctxAnchorRef = useRef<HTMLElement | null>(null);
	const [ctxFolderId, setCtxFolderId] = useState<string | null>(null);
	const ctxFolderAnchorRef = useRef<HTMLElement | null>(null);

	const [renamingId, setRenamingId] = useState<string | null>(null);
	const [renamingFolderId, setRenamingFolderId] = useState<string | null>(null);
	const [deleting, setDeleting] = useState<Pick<ChatListItem, "id" | "title"> | null>(null);
	const [deletingFolder, setDeletingFolder] = useState<ChatFolder | null>(null);
	const [movingTarget, setMovingTarget] = useState<MoveTargetItem | null>(null);
	const [feedback, setFeedback] = useState<OrganizationFeedback | null>(null);

	const [isNewMenuOpen, setIsNewMenuOpen] = useState(false);
	const newMenuAnchorRef = useRef<HTMLButtonElement | null>(null);

	// Auto-dismiss feedback toast
	useEffect(() => {
		if (!feedback) return;
		const timer = setTimeout(() => {
			setFeedback(null);
		}, 6000);
		return () => clearTimeout(timer);
	}, [feedback]);

	const closeContextMenus = useCallback(() => {
		setCtxChatId(null);
		setCtxFolderId(null);
		setIsNewMenuOpen(false);
	}, []);

	const openContext = (e: React.MouseEvent<HTMLButtonElement>, chat: ChatDirectoryItem) => {
		e.preventDefault();
		closeContextMenus();
		ctxAnchorRef.current = e.currentTarget;
		setCtxChatId(chat.id);
	};

	const openFolderContext = (e: React.MouseEvent<HTMLElement>, folder: ChatFolder) => {
		e.preventDefault();
		closeContextMenus();
		ctxFolderAnchorRef.current = e.currentTarget;
		setCtxFolderId(folder.id);
	};

	const isAnyMenuOpen =
		ctxChatId !== null ||
		ctxFolderId !== null ||
		isNewMenuOpen;

	useEffect(() => {
		if (!isAnyMenuOpen) return;
		const onPointerDown = (e: PointerEvent) => {
			const target = e.target as Node;
			if (target instanceof Element && target.closest("[data-lh-menu]")) return;
			if (ctxAnchorRef.current?.contains(target)) return;
			if (ctxFolderAnchorRef.current?.contains(target)) return;
			if (newMenuAnchorRef.current?.contains(target)) return;
			closeContextMenus();
		};
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				e.stopPropagation();
				if (isNewMenuOpen) {
					newMenuAnchorRef.current?.focus();
				}
				closeContextMenus();
			}
		};
		document.addEventListener("pointerdown", onPointerDown);
		document.addEventListener("keydown", onKeyDown);
		return () => {
			document.removeEventListener("pointerdown", onPointerDown);
			document.removeEventListener("keydown", onKeyDown);
		};
	}, [isAnyMenuOpen, isNewMenuOpen, closeContextMenus]);

	const executeAction = useCallback(
		async (
			action: ChatOrganizationAction,
			priorState?: { organization: ChatOrganization; chats: ChatDirectoryItem[] },
		): Promise<boolean> => {
			let undoPayload: { undoAction: ChatOrganizationAction; description: string } | null = null;
			if (priorState) {
				undoPayload = computeUndoAction(action, priorState);
			}
			try {
				const res = await fetch("/api/chats/organization", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(action),
				});
				if (!res.ok) {
					const data = (await res.json().catch(() => ({}))) as { error?: string };
					const errMsg = data.error || `Action failed (${res.status})`;
					setFeedback({ type: "error", message: errMsg });
					return false;
				}
				void refresh();
				if (undoPayload) {
					setFeedback({
						type: "success",
						message: undoPayload.description,
						onUndo: () => {
							void executeAction(undoPayload!.undoAction);
						},
					});
				}
				return true;
			} catch (err) {
				console.error("Organization action failed:", err);
				setFeedback({ type: "error", message: "Network error. Try again." });
				return false;
			}
		},
		[refresh],
	);

	const handleDestinationMove = useCallback(
		(destinationParentId: string | null) => {
			if (!movingTarget) return;
			const { kind, id, isRestore } = movingTarget;
			setMovingTarget(null);
			const prior = organization && chats ? { organization, chats } : undefined;

			const action: ChatOrganizationAction = isRestore
				? { action: "restore", kind, id, targetParentId: destinationParentId }
				: { action: "move", kind, id, parentId: destinationParentId };

			void executeAction(action, prior);
		},
		[movingTarget, executeAction, organization, chats],
	);

	const confirmDeleteFolder = useCallback(() => {
		if (!deletingFolder) return;
		const folderId = deletingFolder.id;
		setDeletingFolder(null);
		// Permanent deletion - no undo
		void executeAction({ action: "delete-folder", id: folderId });
	}, [deletingFolder, executeAction]);

	const commitRename = useCallback(async (id: string, next: string) => {
		setRenamingId(null);
		const t = next.trim();
		if (t === "") return;
		try {
			const res = await fetch(`/api/chats/${id}`, {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ title: t }),
			});
			if (!res.ok) throw new Error(`rename failed: ${res.status}`);
			window.dispatchEvent(new CustomEvent("lh:chat-renamed", { detail: { id, title: t } }));
		} catch (err) {
			console.error("rename failed:", err);
		}
	}, []);

	const onDeleted = useCallback(
		(id: string, _mode: ChatDeleteMode, graphRevision: number) => {
			setDeleting(null);
			setChats((prev) => (prev ? prev.filter((c) => c.id !== id) : prev));
			if (pathname === `/chat/${id}`) router.push("/");
			window.dispatchEvent(new CustomEvent("lh:graph-revision", { detail: { revision: graphRevision } }));
		},
		[pathname, router],
	);

	useEffect(() => {
		const onFocusSearch = () => {
			if (!open) toggle();
			requestAnimationFrame(() => {
				searchRef.current?.focus();
				searchRef.current?.select();
			});
		};
		const onKeyDown = (e: KeyboardEvent) => {
			if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
				e.preventDefault();
				onFocusSearch();
			}
		};
		window.addEventListener("lh:kbd-sessions-search", onFocusSearch);
		window.addEventListener("keydown", onKeyDown);
		return () => {
			window.removeEventListener("lh:kbd-sessions-search", onFocusSearch);
			window.removeEventListener("keydown", onKeyDown);
		};
	}, [open, toggle]);

	useEffect(() => {
		const onToggleArchive = () => {
			if (pathname === "/archive") {
				router.push("/");
			} else {
				router.push("/archive");
			}
		};
		window.addEventListener("lh:kbd-toggle-archive", onToggleArchive);
		return () => {
			window.removeEventListener("lh:kbd-toggle-archive", onToggleArchive);
		};
	}, [pathname, router]);

	useEffect(() => {
		if (kbdIndex === null || !shown || kbdIndex >= shown.length) return;
		const targetChat = shown[kbdIndex];
		if (!targetChat) return;
		const row = listRef.current?.querySelector<HTMLElement>(`[data-session-id="${targetChat.id}"]`);
		row?.scrollIntoView({ block: "nearest" });
	}, [kbdIndex, shown]);

	useEffect(() => {
		if (!open) return;
		void refresh();
	}, [open, pathname, refresh]);

	const renderArchivedFolderSidebar = (folder: ChatFolder, depth: number): ReactNode => {
		const open = expandedFolderIds.has(folder.id);
		const isSelected = selectedArchiveFolderId === folder.id;
		const count = getFolderChatCount(folder.id, archivedFolders, archivedChats);
		const childFolders = archivedFolders.filter((f) => f.parentId === folder.id);
		const hasChildFolders = childFolders.length > 0;

		return (
			<div key={folder.id} data-testid={`sidebar-archive-folder-${folder.id}`} className="relative">
				<div
					className={cn(
						"group flex w-full items-center gap-1.5 rounded-lg py-1.5 pr-2 transition-colors hover:bg-accent/60 cursor-pointer select-none",
						isSelected ? "bg-accent text-foreground font-semibold" : "text-muted-foreground hover:text-foreground",
					)}
					style={{ paddingLeft: `${8 + depth * 14}px` }}
					onClick={() => {
						router.push(`/archive?folder=${folder.id}`);
						window.dispatchEvent(
							new CustomEvent("lh:archive-select-folder", { detail: { folderId: folder.id } }),
						);
					}}
					onContextMenu={(e) => openFolderContext(e, folder)}
				>
					{hasChildFolders ? (
						<button
							type="button"
							aria-expanded={open}
							aria-label={`${open ? "Collapse" : "Expand"} folder ${folder.name}`}
							data-testid={`sidebar-archive-folder-toggle-${folder.id}`}
							onClick={(e) => {
								e.stopPropagation();
								toggleFolder(folder.id);
							}}
							className="flex size-4 shrink-0 items-center justify-center rounded text-muted-foreground/70 hover:text-foreground"
						>
							<ChevronRightIcon
								className={cn("size-3.5 transition-transform duration-150", open && "rotate-90")}
							/>
						</button>
					) : (
						<span
							data-testid={`sidebar-archive-folder-spacer-${folder.id}`}
							className="size-4 shrink-0"
							aria-hidden="true"
						/>
					)}

					<span className="flex size-4 shrink-0 items-center justify-center text-muted-foreground/70">
						{open ? <FolderOpenIcon className="size-3.5" /> : <FolderIcon className="size-3.5" />}
					</span>

					<span className="min-w-0 flex-1 truncate font-prose text-sm text-foreground/90 font-medium leading-snug">
						{folder.name}
					</span>

					<span className="text-[10px] tabular-nums font-mono text-muted-foreground/60 px-1 py-0.2 rounded bg-muted/30 shrink-0 select-none">
						{count}
					</span>

					<button
						type="button"
						data-testid={`sidebar-archive-folder-options-${folder.id}`}
						aria-label={`Options for archived folder ${folder.name}`}
						onClick={(e) => {
							e.stopPropagation();
							openFolderContext(e, folder);
						}}
						className="hidden group-hover:flex group-focus-within:flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent/80 hover:text-foreground cursor-pointer ml-1"
					>
						<MoreVerticalIcon className="size-3" />
					</button>
				</div>

				{open && childFolders.length > 0 && (
					<div className="flex flex-col">
						{childFolders.map((child) => renderArchivedFolderSidebar(child, depth + 1))}
					</div>
				)}
			</div>
		);
	};

	return (
		<aside
			className={cn("sidebar-motion shrink-0 overflow-hidden duration-200", open ? "w-72" : "w-0")}
			aria-hidden={!open}
		>
			<div className="flex h-full w-72 flex-col border-r bg-background">
				{/* Top bar: LearnHarness mark (leads home) + close toggle */}
				<div className="lh-drag lh-lights-gutter flex h-11 items-center justify-between px-3">
					<Hint label="Home" action="jump-graph" side="right">
						<Link
							href="/"
							data-testid="sidebar-brand-home"
							aria-label="LearnHarness home"
							className="lh-no-drag flex size-8 items-center justify-center rounded-md transition-colors hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50"
						>
							<LhMark className="size-5" />
						</Link>
					</Hint>
					<Hint label="Close sidebar" action="toggle-sidebar">
						<Button
							variant="ghost"
							size="icon"
							aria-label="Close sidebar"
							onClick={toggle}
							className="lh-no-drag size-8"
						>
							<PanelLeftCloseIcon className="size-4" />
						</Button>
					</Hint>
				</div>

				{/* Sessions header or Archive header */}
				{isArchiveMode ? (
					<div className="px-2 pt-1.5 pb-1 flex flex-col gap-1.5">
						<div className="flex items-center justify-between px-1">
							<span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/80">
								Archive
							</span>
							<span className="text-[10px] text-muted-foreground/60 tabular-nums">
								({archivedChats.length + archivedFolders.length})
							</span>
						</div>
					</div>
				) : (
					<div className="px-2 pt-1.5 pb-1 flex flex-col gap-1.5">
						<div className="flex items-center justify-between px-1">
							<span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/80">
								Sessions
							</span>
							<Hint label="New folder" side="bottom">
								<button
									type="button"
									data-testid="new-folder-button"
									aria-label="New folder"
									onClick={() => void createFolder()}
									className="flex size-5 items-center justify-center rounded text-muted-foreground/70 transition-colors hover:bg-accent hover:text-foreground cursor-pointer"
								>
									<FolderPlusIcon className="size-3.5" />
								</button>
							</Hint>
						</div>

						{/* Full width search bar */}
						<div className="relative w-full">
							<Input
								ref={searchRef}
								data-testid="session-search"
								value={query}
								onChange={(e) => {
									setQuery(e.target.value);
									setKbdIndex(null);
								}}
								onKeyDown={(e) => {
									if (e.key === "Escape") {
										e.stopPropagation();
										if (query) {
											setQuery("");
											setKbdIndex(null);
										} else {
											e.currentTarget.blur();
										}
										return;
									}
									if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
									const n = shown?.length ?? 0;
									if (n === 0) return;
									if (e.key === "ArrowDown" || e.key === "ArrowUp") {
										e.preventDefault();
										const dir = e.key === "ArrowDown" ? 1 : -1;
										setKbdIndex((i) =>
											i === null || i >= n ? (dir === 1 ? 0 : n - 1) : (i + dir + n) % n,
										);
										return;
									}
									if (e.key === "Enter") {
										const target = shown![kbdIndex !== null && kbdIndex < n ? kbdIndex : 0];
										if (!target) return;
										e.preventDefault();
										router.push(`/chat/${target.id}`);
										setKbdIndex(null);
										e.currentTarget.blur();
									}
								}}
								placeholder="Search sessions…"
								aria-label="Search sessions"
								className="h-7 w-full rounded-md border-border/70 bg-background pl-7 pr-14 text-xs placeholder:text-muted-foreground/60 focus-visible:ring-1 focus-visible:ring-ring"
							/>
							<SearchIcon className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/70" />
							{query ? (
								<button
									type="button"
									onClick={() => {
										setQuery("");
										setKbdIndex(null);
										searchRef.current?.focus();
									}}
									className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground/60 hover:text-foreground cursor-pointer"
									aria-label="Clear search"
								>
									<XIcon className="size-3" />
								</button>
							) : (
								<kbd className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 rounded border border-border/60 bg-muted/40 px-1 py-0.5 text-[9px] font-mono text-muted-foreground/70 select-none">
									{formatBinding(bindingForAction("sessions-search"))}
								</kbd>
							)}
						</div>

						{/* Compact Filters: All / Teaching / Practice */}
						<div
							className="flex h-7 items-center gap-0.5 rounded-full border border-border/70 bg-card/70 p-0.5 shadow-xs backdrop-blur"
							data-testid="session-kind-filter"
							role="radiogroup"
							aria-label="Filter sessions by kind"
						>
							{(["all", "teach", "practice"] as const).map((f) => (
								<button
									key={f}
									type="button"
									role="radio"
									aria-checked={kindFilter === f}
									data-testid={`kind-filter-${f}`}
									onClick={() => setFilter(f)}
									className={cn(
										"flex-1 h-full rounded-full px-1.5 text-[10px] font-medium uppercase tracking-wider transition-all duration-150 ease-out active:scale-95 cursor-pointer flex items-center justify-center focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none",
										kindFilter === f
											? "bg-accent text-foreground font-semibold shadow-xs"
											: "text-muted-foreground hover:text-foreground hover:bg-muted/30",
									)}
								>
									{f === "all" ? "All" : f === "teach" ? "Teaching" : "Practice"}
								</button>
							))}
						</div>
					</div>
				)}

				<div ref={listRef} className="flex-1 overflow-y-auto p-2">
					{isArchiveMode ? (
						<div className="flex flex-col gap-1">
							{/* Archive Destinations: All Archived, Unorganized */}
							<div className="space-y-0.5">
								<Link
									href="/archive"
									data-testid="sidebar-archive-all"
									className={cn(
										"group flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs transition-colors hover:bg-accent/60 cursor-pointer select-none",
										isAllArchivedActive
											? "bg-accent text-foreground font-semibold"
											: "text-muted-foreground hover:text-foreground",
									)}
								>
									<ArchiveIcon className="size-3.5 shrink-0" />
									<span className="min-w-0 flex-1 truncate">All Archived</span>
									<span className="text-[10px] tabular-nums text-muted-foreground/70 px-1.5 py-0.5 rounded bg-muted/30">
										{archivedChats.length}
									</span>
								</Link>

								<Link
									href="/archive?view=unorganized"
									data-testid="sidebar-archive-unorganized"
									className={cn(
										"group flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs transition-colors hover:bg-accent/60 cursor-pointer select-none",
										isUnorganizedArchivedActive
											? "bg-accent text-foreground font-semibold"
											: "text-muted-foreground hover:text-foreground",
									)}
								>
									<FolderIcon className="size-3.5 shrink-0" />
									<span className="min-w-0 flex-1 truncate">Unorganized</span>
									<span className="text-[10px] tabular-nums text-muted-foreground/70 px-1.5 py-0.5 rounded bg-muted/30">
										{unorganizedArchivedChatsCount}
									</span>
								</Link>
							</div>

							{/* Hierarchical genuinely archived folders */}
							{archivedFolders.length > 0 && (
								<div className="pt-2">
									<div className="px-2.5 pb-1 flex items-center justify-between">
										<span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
											Archived Folders
										</span>
										<span className="text-[10px] text-muted-foreground/60 tabular-nums">
											({archivedFolders.length})
										</span>
									</div>
									<div data-testid="sidebar-archived-folders" className="space-y-0.5">
										{archivedRootFolders.map((f) => renderArchivedFolderSidebar(f, 0))}
									</div>
								</div>
							)}
						</div>
					) : chats === null ? (
						<div className="px-2 py-4 text-xs text-muted-foreground">Loading…</div>
					) : (
						<ChatFolderTree
							folders={activeFolders}
							chats={shown ?? []}
							activeChatId={pathname?.startsWith("/chat/") ? pathname.replace("/chat/", "") : null}
							kbdChatId={kbdIndex !== null && shown && kbdIndex < shown.length ? shown[kbdIndex]!.id : null}
							expandedFolderIds={expandedFolderIds}
							onToggleFolder={toggleFolder}
							onSelectChat={(id) => {
								setKbdIndex(null);
								router.push(`/chat/${id}`);
							}}
							onContextMenuChat={openContext}
							onNewSessionInFolder={(fId) => newSession(undefined, fId)}
							onFolderContextMenu={openFolderContext}
							selectedFolderId={selectedFolderId}
							onSelectFolder={setSelectedFolderId}
							renamingId={renamingId}
							onCommitRename={commitRename}
							onCancelRename={() => setRenamingId(null)}
							organization={organization}
							renamingFolderId={renamingFolderId}
							onCommitFolderRename={(id, name) => {
								setRenamingFolderId(null);
								if (!name.trim()) return;
								void executeAction(
									{ action: "rename-folder", id, name: name.trim() },
									organization && chats ? { organization, chats } : undefined,
								);
							}}
							onCancelFolderRename={() => setRenamingFolderId(null)}
							onMoveItem={(kind, id, targetParentId, targetOrder) => {
								void executeAction(
									{
										action: "move",
										kind,
										id,
										parentId: targetParentId,
										...(targetOrder !== undefined ? { targetOrder } : {}),
									},
									organization && chats ? { organization, chats } : undefined,
								);
							}}
							onReorderSiblings={(parentId, kind, ids) => {
								void executeAction(
									{ action: "reorder-siblings", parentId, kind, ids },
									organization && chats ? { organization, chats } : undefined,
								);
							}}
							isSearchActive={query.trim() !== ""}
							searchQuery={query}
							unorganizedExpanded={unorganizedExpanded}
							onToggleUnorganized={() => setUnorganizedExpanded((v) => !v)}
							emptyMessage={query.trim() ? "No sessions match." : "No sessions yet."}
						/>
					)}
				</div>

				{/* Feedback status / toast with undo */}
				<OrganizationFeedbackToast
					feedback={feedback}
					onDismiss={() => setFeedback(null)}
				/>

				{/* Native session entry points share the plugin placement grid. */}
				<PluginSidebarActions>
				{/* Simple borderless New session row with popover menu */}
				<div className="relative px-2 py-0.5">
					<Hint label="New session" action="new-session" side="right">
						<button
							ref={newMenuAnchorRef}
							type="button"
							data-testid="new-menu-trigger"
							aria-haspopup="true"
							aria-expanded={isNewMenuOpen}
							onClick={() => setIsNewMenuOpen((v) => !v)}
							onKeyDown={(e) => {
								if (e.key === "ArrowUp" || e.key === "ArrowDown") {
									e.preventDefault();
									setIsNewMenuOpen(true);
								}
							}}
							className={cn(
								"flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs uppercase tracking-wider text-muted-foreground transition-colors hover:bg-accent hover:text-foreground cursor-pointer",
								isNewMenuOpen && "bg-accent text-foreground",
							)}
						>
							<PlusIcon className="size-3 shrink-0" />
							<span>New session</span>
						</button>
					</Hint>

					{isNewMenuOpen && (
						<MenuShell
							anchorRef={newMenuAnchorRef}
							testid="new-unified-menu"
							preferredSide="up"
							align="left"
							menuClass="flex w-64 flex-col rounded-xl border border-border bg-card text-xs shadow-2xl overflow-hidden"
							onClose={(reason) => {
								setIsNewMenuOpen(false);
								if (reason === "escape") newMenuAnchorRef.current?.focus();
								return "closed";
							}}
						>
							{/* Session Mode Options */}
							<div className="p-1.5 flex flex-col gap-1">
								<button
									type="button"
									data-testid="new-session"
									onClick={() => {
										setIsNewMenuOpen(false);
										void newSession();
									}}
									className="lh-new-session-option group flex items-start gap-2.5 rounded-lg p-2 text-left transition-all duration-150 hover:bg-accent cursor-pointer active:scale-[0.99]"
								>
									<div className="flex size-7 shrink-0 items-center justify-center rounded-md border border-border/60 bg-muted/40 group-hover:bg-accent-foreground/10 group-hover:border-border transition-colors">
										<GraduationCapIcon className="size-3.5 text-foreground/80" />
									</div>
									<div className="flex flex-col min-w-0">
										<span className="font-medium text-foreground text-xs leading-none">New Teaching Session</span>
										<span className="text-[10px] text-muted-foreground/80 mt-1">Guided curriculum with interactive tutor</span>
									</div>
								</button>

								<button
									type="button"
									data-testid="new-session-practice"
									onClick={() => {
										setIsNewMenuOpen(false);
										router.push("/chat/new?mode=practice");
									}}
									className="lh-new-session-option group flex items-start gap-2.5 rounded-lg p-2 text-left transition-all duration-150 hover:bg-accent cursor-pointer active:scale-[0.99]"
								>
									<div className="flex size-7 shrink-0 items-center justify-center rounded-md border border-border/60 bg-muted/40 group-hover:bg-accent-foreground/10 group-hover:border-border transition-colors">
										<DumbbellIcon className="size-3.5 text-foreground/80" />
									</div>
									<div className="flex flex-col min-w-0">
										<span className="font-medium text-foreground text-xs leading-none">New Practice Session</span>
										<span className="text-[10px] text-muted-foreground/80 mt-1">Review questions and active recall</span>
									</div>
								</button>
							</div>
						</MenuShell>
					)}
				</div>
				</PluginSidebarActions>

				{/* Divider above Archive / Settings */}
				<div className="mx-2 my-1 border-t border-border/40" />

				{/* Archive navigation entry button */}
				<div className="px-2 py-0.5">
					<Hint label="Archive" action="toggle-archive" side="right">
						<button
							type="button"
							data-testid="archive-nav-button"
							aria-label="Browse archived sessions"
							onClick={() => router.push("/archive")}
							className={cn(
								"flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs uppercase tracking-wider text-muted-foreground transition-colors hover:bg-accent hover:text-foreground cursor-pointer",
								(pathname === "/archive" || isArchiveMode) && "bg-accent text-foreground font-semibold",
							)}
						>
							<ArchiveIcon className="size-3" />
							<span>Archive</span>
						</button>
					</Hint>
				</div>

				{hasActiveJobs && <ActivitySection />}

				<div className="px-2 pb-2 pt-0.5">
					<Hint label="Settings" action="open-settings" side="right">
						<button
							type="button"
							onClick={() => openSettings()}
							data-testid="settings-entry"
							className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs uppercase tracking-wider text-muted-foreground transition-colors hover:bg-accent hover:text-foreground cursor-pointer"
						>
							<SettingsIcon className="size-3" />
							<span>Settings</span>
						</button>
					</Hint>
				</div>
			</div>

			{/* Active Session Context Menu */}
			{ctxChatId !== null && (
				<MenuShell
					anchorRef={ctxAnchorRef}
					testid="session-context-menu"
					preferredSide="down"
					menuClass="flex w-52 flex-col gap-0.5 rounded-xl border bg-card p-2 text-xs shadow-xl"
				>
					<button
						type="button"
						data-testid="ctx-rename"
						onClick={() => {
							setRenamingId(ctxChatId);
							closeContextMenus();
						}}
						className="flex items-center rounded-lg px-2.5 py-1.5 text-left text-foreground transition-colors hover:bg-accent cursor-pointer"
					>
						Rename
					</button>
					<button
						type="button"
						data-testid="ctx-move"
						onClick={() => {
							const target = chats?.find((c) => c.id === ctxChatId);
							if (target) {
								setMovingTarget({
									kind: "chat",
									id: target.id,
									title: target.title,
									parentId: target.folderId,
								});
							}
							closeContextMenus();
						}}
						className="flex items-center rounded-lg px-2.5 py-1.5 text-left text-foreground transition-colors hover:bg-accent cursor-pointer"
					>
						Move to…
					</button>
					{(() => {
						const targetChat = chats?.find((c) => c.id === ctxChatId);
						if (!targetChat) return null;
						const siblings = chats?.filter((c) => c.folderId === targetChat.folderId) ?? [];
						const idx = siblings.findIndex((c) => c.id === ctxChatId);
						const canMoveUp = idx > 0;
						const canMoveDown = idx >= 0 && idx < siblings.length - 1;
						return (
							<>
								{canMoveUp && (
									<button
										type="button"
										data-testid="ctx-move-up"
										onClick={() => {
											if (organization && chats) {
												const action = getSiblingMoveAction("chat", ctxChatId, "up", organization, chats);
												if (action) void executeAction(action, { organization, chats });
											}
											closeContextMenus();
										}}
										className="flex items-center rounded-lg px-2.5 py-1.5 text-left text-foreground transition-colors hover:bg-accent cursor-pointer"
									>
										Move up
									</button>
								)}
								{canMoveDown && (
									<button
										type="button"
										data-testid="ctx-move-down"
										onClick={() => {
											if (organization && chats) {
												const action = getSiblingMoveAction("chat", ctxChatId, "down", organization, chats);
												if (action) void executeAction(action, { organization, chats });
											}
											closeContextMenus();
										}}
										className="flex items-center rounded-lg px-2.5 py-1.5 text-left text-foreground transition-colors hover:bg-accent cursor-pointer"
									>
										Move down
									</button>
								)}
							</>
						);
					})()}
					<button
						type="button"
						data-testid="ctx-archive"
						onClick={() => {
							const chatId = ctxChatId;
							closeContextMenus();
							if (organization && chats) {
								void executeAction({ action: "archive", kind: "chat", id: chatId }, { organization, chats });
							}
						}}
						className="flex items-center rounded-lg px-2.5 py-1.5 text-left text-foreground transition-colors hover:bg-accent cursor-pointer"
					>
						Archive
					</button>
					<button
						type="button"
						data-testid="ctx-export-md"
						onClick={() => {
							const chatId = ctxChatId;
							closeContextMenus();
							const a = document.createElement("a");
							a.href = `/api/chats/${chatId}/markdown`;
							a.download = "";
							document.body.appendChild(a);
							a.click();
							a.remove();
						}}
						className="flex items-center rounded-lg px-2.5 py-1.5 text-left text-foreground transition-colors hover:bg-accent cursor-pointer"
					>
						Export as Markdown…
					</button>
					<button
						type="button"
						data-testid="ctx-delete"
						onClick={() => {
							const target = chats?.find((c) => c.id === ctxChatId);
							if (target) setDeleting(target);
							closeContextMenus();
						}}
						className="flex items-center rounded-lg px-2.5 py-1.5 text-left text-destructive transition-colors hover:bg-destructive/10 hover:text-destructive cursor-pointer"
					>
						Delete…
					</button>
					<div className="my-0.5 border-t border-border/60" aria-hidden="true" />
					<CoverageMenuBlock chatId={ctxChatId} />
				</MenuShell>
			)}

			{/* Folder Context Menu (Active or Archived) */}
			{ctxFolderId !== null && (
				<MenuShell
					anchorRef={ctxFolderAnchorRef}
					testid="folder-context-menu"
					preferredSide="down"
					menuClass="flex w-52 flex-col gap-0.5 rounded-xl border bg-card p-2 text-xs shadow-xl"
				>
					{(() => {
						const targetFolder =
							folders.find((f) => f.id === ctxFolderId) ??
							archivedFolders.find((f) => f.id === ctxFolderId);
						const isFolderArchived = Boolean(targetFolder?.archivedAt) || isArchiveMode;

						if (isFolderArchived) {
							return (
								<>
									<button
										type="button"
										data-testid="ctx-restore-folder"
										onClick={() => {
											const fId = ctxFolderId;
											closeContextMenus();
											void executeAction(
												{ action: "restore", kind: "folder", id: fId },
												organization && chats ? { organization, chats } : undefined,
											);
										}}
										className="flex items-center rounded-lg px-2.5 py-1.5 text-left text-foreground transition-colors hover:bg-accent cursor-pointer"
									>
										Restore folder
									</button>
									<button
										type="button"
										data-testid="ctx-restore-to-folder"
										onClick={() => {
											if (targetFolder) {
												setMovingTarget({
													kind: "folder",
													id: targetFolder.id,
													title: targetFolder.name,
													parentId: null,
													isRestore: true,
												});
											}
											closeContextMenus();
										}}
										className="flex items-center rounded-lg px-2.5 py-1.5 text-left text-foreground transition-colors hover:bg-accent cursor-pointer"
									>
										Restore to…
									</button>
									<button
										type="button"
										data-testid="ctx-delete-folder"
										onClick={() => {
											if (targetFolder) setDeletingFolder(targetFolder);
											closeContextMenus();
										}}
										className="flex items-center rounded-lg px-2.5 py-1.5 text-left text-destructive transition-colors hover:bg-destructive/10 hover:text-destructive cursor-pointer"
									>
										Delete folder…
									</button>
								</>
							);
						}

						return (
							<>
								<button
									type="button"
									data-testid="ctx-folder-new-subfolder"
									onClick={() => {
										const fId = ctxFolderId;
										closeContextMenus();
										void createFolder("New folder", fId);
									}}
									className="flex items-center rounded-lg px-2.5 py-1.5 text-left text-foreground transition-colors hover:bg-accent cursor-pointer"
								>
									New subfolder…
								</button>
								<button
									type="button"
									data-testid="ctx-folder-rename"
									onClick={() => {
										setRenamingFolderId(ctxFolderId);
										closeContextMenus();
									}}
									className="flex items-center rounded-lg px-2.5 py-1.5 text-left text-foreground transition-colors hover:bg-accent cursor-pointer"
								>
									Rename
								</button>
								<button
									type="button"
									data-testid="ctx-folder-move"
									onClick={() => {
										const target = folders.find((f) => f.id === ctxFolderId);
										if (target) {
											setMovingTarget({
												kind: "folder",
												id: target.id,
												title: target.name,
												parentId: target.parentId,
											});
										}
										closeContextMenus();
									}}
									className="flex items-center rounded-lg px-2.5 py-1.5 text-left text-foreground transition-colors hover:bg-accent cursor-pointer"
								>
									Move to…
								</button>
								{(() => {
									const target = folders.find((f) => f.id === ctxFolderId);
									if (!target) return null;
									const siblings = folders.filter((f) => f.parentId === target.parentId);
									const idx = siblings.findIndex((f) => f.id === ctxFolderId);
									const canMoveUp = idx > 0;
									const canMoveDown = idx >= 0 && idx < siblings.length - 1;
									return (
										<>
											{canMoveUp && (
												<button
													type="button"
													data-testid="ctx-folder-move-up"
													onClick={() => {
														if (organization && chats) {
															const action = getSiblingMoveAction("folder", ctxFolderId, "up", organization, chats);
															if (action) void executeAction(action, { organization, chats });
														}
														closeContextMenus();
													}}
													className="flex items-center rounded-lg px-2.5 py-1.5 text-left text-foreground transition-colors hover:bg-accent cursor-pointer"
												>
													Move up
												</button>
											)}
											{canMoveDown && (
												<button
													type="button"
													data-testid="ctx-folder-move-down"
													onClick={() => {
														if (organization && chats) {
															const action = getSiblingMoveAction("folder", ctxFolderId, "down", organization, chats);
															if (action) void executeAction(action, { organization, chats });
														}
														closeContextMenus();
													}}
													className="flex items-center rounded-lg px-2.5 py-1.5 text-left text-foreground transition-colors hover:bg-accent cursor-pointer"
												>
													Move down
												</button>
											)}
										</>
									);
								})()}
								<button
									type="button"
									data-testid="ctx-folder-archive"
									onClick={() => {
										const fId = ctxFolderId;
										closeContextMenus();
										if (organization && chats) {
											void executeAction({ action: "archive", kind: "folder", id: fId }, { organization, chats });
										}
									}}
									className="flex items-center rounded-lg px-2.5 py-1.5 text-left text-foreground transition-colors hover:bg-accent cursor-pointer"
								>
									Archive folder
								</button>
								{(() => {
									const isFolderEmpty = organization
										? chatFolderIsEmpty(organization, ctxFolderId, new Set(chats?.map((c) => c.id) ?? []))
										: false;
									return (
										<button
											type="button"
											data-testid="ctx-folder-delete"
											disabled={!isFolderEmpty}
											title={!isFolderEmpty ? "Only empty folders can be removed. Move their entries out first." : undefined}
											onClick={() => {
												const target = folders.find((f) => f.id === ctxFolderId);
												if (target && isFolderEmpty) setDeletingFolder(target);
												closeContextMenus();
											}}
											className={cn(
												"flex items-center rounded-lg px-2.5 py-1.5 text-left transition-colors",
												!isFolderEmpty
													? "opacity-40 cursor-not-allowed text-muted-foreground"
													: "text-destructive hover:bg-destructive/10 hover:text-destructive cursor-pointer",
											)}
										>
											Delete folder…
										</button>
									);
								})()}
							</>
						);
					})()}
				</MenuShell>
			)}

			{/* Move Destination Dialog */}
			<MoveDestinationDialog
				item={movingTarget}
				folders={folders.filter((f) => !f.archivedAt)}
				organization={organization}
				onClose={() => setMovingTarget(null)}
				onMove={handleDestinationMove}
			/>

			{/* Delete Folder Dialog */}
			<DeleteFolderDialog
				folder={deletingFolder}
				onClose={() => setDeletingFolder(null)}
				onConfirm={confirmDeleteFolder}
			/>

			{/* Existing Delete Session Dialog */}
			<DeleteSessionDialog
				chat={deleting}
				onClose={() => setDeleting(null)}
				onDeleted={onDeleted}
			/>
		</aside>
	);
}

/** The app frame: sidebar inline + content. Rendered once in the root layout. */
export function AppShell({ children }: { children: React.ReactNode }) {
	const [contentRoot, setContentRoot] = useState<HTMLElement | null>(null);
	const pathname = usePathname();
	return (
		<HostRouteLifetimeProvider pathname={pathname}>
		<HostContentRootContext.Provider value={contentRoot}>
		<InteractionLayersProvider><SettingsDialogProvider>
			<SessionsSidebar />
			<FilePathDropZone className="relative isolate min-w-0 flex-1" onContentRoot={setContentRoot}>{children}</FilePathDropZone>
			{/* The single document-level keydown listener (keyboard wave A) —
			    after the content in the tree, but it's window-level so order only
			    matters for the events it dispatches, never for DOM priority. */}
			<KeyboardShortcuts />
			<PluginWidgets />
		</SettingsDialogProvider></InteractionLayersProvider>
		</HostContentRootContext.Provider>
		</HostRouteLifetimeProvider>
	);
}
