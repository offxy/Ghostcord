/*
 * Ghostcord — Backpack: packs chat bar buttons (Discord's own AND plugin buttons) into one button.
 * Click to slide the buttons out. Right-click the backpack to choose what stays on the bar.
 * Right-click a packed plugin button to open that plugin's settings.
 */

import "./styles.css";

import { ChatBarButton, ChatBarButtonMap } from "@api/ChatButtons";
import * as DataStore from "@api/DataStore";
import { Settings } from "@api/Settings";
import { plugins } from "@api/PluginManager";
import ErrorBoundary from "@components/ErrorBoundary";
import { openPluginModal } from "@components/settings/tabs/plugins/PluginModal";
import definePlugin, { StartAt } from "@utils/types";
import { ContextMenuApi, Menu, React, useEffect, useRef, useState } from "@webpack/common";
import type { ReactNode } from "react";

import { GC_AUTHOR } from "../_gc/voice";

const KEY = "Backpack_unpackedButtons_v3";
const VC_GROUP = "vencord-chat-buttons";
const NO_SETTINGS = new Set(["Translate"]);
const NATIVE_NAMES: Record<string, string> = {
    gift: "Gift", gifts: "Gift", gif: "GIF", gifs: "GIF", sticker: "Stickers", stickers: "Stickers",
    emoji: "Emoji", emojis: "Emoji", app_launcher: "Apps", apps: "Apps", activity: "Activities", soundboard: "Soundboard"
};

let unpacked: Set<string> | null = null; // buttons kept on the bar; everything else is packed. null = not loaded yet
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(l => l());
const save = () => DataStore.set(KEY, [...(unpacked ?? [])]);

function togglePacked(id: string) {
    if (!unpacked) return;
    unpacked.has(id) ? unpacked.delete(id) : unpacked.add(id);
    save();
    emit();
}

function useBackpack() {
    const [, rerender] = useState(0);
    useEffect(() => {
        const l = () => rerender(n => n + 1);
        listeners.add(l);
        return () => void listeners.delete(l);
    }, []);
}

interface Entry { id: string; name: string; node: ReactNode; plugin?: string; }

const nativeName = (key: string) => NATIVE_NAMES[key.toLowerCase()] ?? key.replace(/[-_]/g, " ").replace(/\b\w/g, c => c.toUpperCase());

/** Turn Discord's button list into individual entries we can pack/unpack. */
function collect(buttons: ReactNode): { entries: Entry[]; props: any; } {
    const list = (Array.isArray(buttons) ? buttons : [buttons]).flat().filter(Boolean) as any[];
    const entries: Entry[] = [];
    let props: any = null;
    list.forEach((el, i) => {
        const key = String(el?.key ?? `btn-${i}`);
        if (key === VC_GROUP) {
            props = el.props;
            const isMainChat = props?.type?.analyticsName === "normal";
            const isAnyChat = ["normal", "sidebar"].includes(props?.type?.analyticsName);
            const enabled = Settings.uiElements?.chatBarButtons ?? {};
            for (const [id, { render: Button }] of ChatBarButtonMap) {
                if (id === "Backpack" || enabled[id]?.enabled === false) continue;
                entries.push({
                    id, name: id, plugin: id,
                    node: <ErrorBoundary noop key={id}><Button {...props} isMainChat={isMainChat} isAnyChat={isAnyChat} /></ErrorBoundary>
                });
            }
        } else {
            entries.push({ id: `native:${key}`, name: nativeName(key), node: el });
        }
    });
    return { entries, props };
}

const APPS_ID = "native:apps-launcher";
const LAUNCHER = "[data-gc-bp-launcher]";

/**
 * Discord renders the Apps button outside the button row we get, right after it.
 * Find it by walking up from our bar and taking the next sibling that holds a button.
 */
function tagLauncher(from: HTMLElement | null) {
    const bar = from?.closest('[class*="channelTextArea"], form') ?? document;
    const known = bar.querySelector<HTMLElement>(LAUNCHER);
    if (known?.isConnected) return known;
    let el: HTMLElement | null = from;
    for (let i = 0; el && i < 5; i++, el = el.parentElement) {
        let sib = el.nextElementSibling as HTMLElement | null;
        while (sib) {
            const small = sib.getBoundingClientRect().width <= 64; // a single icon button, never a whole region
            if (small && !sib.contains(from) && (sib.matches('button, [role="button"]') || sib.querySelector('button, [role="button"]'))) {
                sib.setAttribute("data-gc-bp-launcher", "");
                return sib;
            }
            sib = sib.nextElementSibling as HTMLElement | null;
        }
    }
    // fallback: anything labelled "Apps" in this chat bar
    const byLabel = bar.querySelector<HTMLElement>('[aria-label="Apps"], [aria-label*="App Launcher" i], [class*="AppLauncher"], [class*="appLauncher"]');
    const host = byLabel?.closest<HTMLElement>('[class*="buttonContainer"], [class*="container"]') ?? byLabel;
    host?.setAttribute("data-gc-bp-launcher", "");
    return host ?? null;
}

const findLauncher = (from: HTMLElement | null) => tagLauncher(from);

const AppsIcon = () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
        <path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z" rx="2" />
    </svg>
);

function appsEntry(root: React.RefObject<HTMLDivElement | null>): Entry {
    return {
        id: APPS_ID, name: "Apps",
        node: (
            <ChatBarButton tooltip="Apps" onClick={() => {
                const l = findLauncher(root.current);
                (l?.querySelector<HTMLElement>('[role="button"], button') ?? l)?.click();
            }}>
                <AppsIcon />
            </ChatBarButton>
        )
    };
}

/** Hide Discord's real Apps button (but keep it in place so its popout still anchors next to the backpack). */
let hideStyle: HTMLStyleElement | undefined;
function syncAppsHidden() {
    const hide = !!unpacked && !unpacked.has(APPS_ID);
    if (hide && !hideStyle) {
        hideStyle = document.createElement("style");
        hideStyle.id = "gc-bp-hide-apps";
        hideStyle.textContent = `${LAUNCHER} { width: 0 !important; min-width: 0 !important; max-width: 0 !important; flex: 0 0 0 !important; margin: 0 !important; padding: 0 !important; overflow: hidden !important; opacity: 0 !important; pointer-events: none !important; }`;
        document.head.appendChild(hideStyle);
    } else if (!hide && hideStyle) {
        hideStyle.remove();
        hideStyle = undefined;
    }
}
listeners.add(syncAppsHidden);

function PackMenu({ entries }: { entries: Entry[]; }) {
    useBackpack();
    const natives = entries.filter(e => !e.plugin);
    const plugs = entries.filter(e => e.plugin).sort((a, b) => a.name.localeCompare(b.name));
    const row = (e: Entry) => (
        <Menu.MenuCheckboxItem key={e.id} id={`gc-bp-${e.id}`} label={e.name} checked={!unpacked?.has(e.id)} action={() => togglePacked(e.id)} />
    );
    return (
        <Menu.Menu navId="gc-backpack-pack" onClose={ContextMenuApi.closeContextMenu} aria-label="Pack into Backpack">
            {natives.length > 0 && <Menu.MenuGroup label="Discord buttons">{natives.map(row)}</Menu.MenuGroup>}
            {plugs.length > 0 && <Menu.MenuGroup label="Plugin buttons">{plugs.map(row)}</Menu.MenuGroup>}
            <Menu.MenuGroup>
                <Menu.MenuItem id="gc-bp-all" label="Pack everything" action={() => { unpacked?.clear(); save(); emit(); }} />
                <Menu.MenuItem id="gc-bp-none" label="Unpack everything" action={() => { entries.forEach(e => unpacked?.add(e.id)); save(); emit(); }} />
            </Menu.MenuGroup>
        </Menu.Menu>
    );
}

const BagIcon = ({ className }: { className?: string; }) => (
    <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
        <path d="M9 3a3 3 0 0 1 6 0v1h1.5A4.5 4.5 0 0 1 21 8.5V19a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V8.5A4.5 4.5 0 0 1 7.5 4H9V3Zm2 1h2V3a1 1 0 1 0-2 0v1Zm-4 8a1 1 0 0 0 0 2h10a1 1 0 1 0 0-2H7Zm2 3.5a1 1 0 0 0-1 1V18a1 1 0 1 0 2 0v-1.5a1 1 0 0 0-1-1Z" />
    </svg>
);

function BackpackBar({ buttons }: { buttons: ReactNode; }) {
    useBackpack();
    const [open, setOpen] = useState(false);
    const [settled, setSettled] = useState(false); // drawer finished opening → stop clipping
    const root = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (!open) { setSettled(false); return; }
        const t = setTimeout(() => setSettled(true), 340);
        return () => clearTimeout(t);
    }, [open]);
    const collected = collect(buttons);
    const { props } = collected;
    const entries = props ? [...collected.entries, appsEntry(root)] : collected.entries;

    useEffect(() => { tagLauncher(root.current); });

    // close on outside click / Esc — but not while a packed button's picker, popup or modal is open
    useEffect(() => {
        if (!open) return;
        const onDown = (e: MouseEvent) => {
            const t = e.target as HTMLElement;
            if (root.current?.contains(t)) return;
            if (t.closest?.('[class*="layerContainer"], [role="dialog"], [role="menu"], [class*="popout"], [class*="picker"], .gc-backdrop')) return;
            setOpen(false);
        };
        const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
        document.addEventListener("mousedown", onDown, true);
        document.addEventListener("keydown", onKey);
        return () => { document.removeEventListener("mousedown", onDown, true); document.removeEventListener("keydown", onKey); };
    }, [open]);

    if (!props || !unpacked || props.type?.analyticsName !== "normal") return <>{buttons}</>;

    const inBag = entries.filter(e => !unpacked!.has(e.id));
    const onBar = entries.filter(e => unpacked!.has(e.id));

    return (
        <div ref={root} className={`gc-bp-bar${open ? " gc-bp-open" : ""}${settled ? " gc-bp-settled" : ""}`}>
            {onBar.map(e => <React.Fragment key={e.id}>{e.node}</React.Fragment>)}
            <div className="gc-bp-drawer" aria-hidden={!open}>
                <div className="gc-bp-drawer-inner">
                    {inBag.map((e, i) => (
                        <div key={e.id} className="gc-bp-slot" style={{ transitionDelay: open ? `${(inBag.length - 1 - i) * 28}ms` : "0ms" }}
                            onContextMenu={ev => {
                                const p = e.plugin && plugins[e.plugin];
                                if (!p || NO_SETTINGS.has(e.plugin!)) return;
                                ev.preventDefault();
                                ev.stopPropagation();
                                openPluginModal(p);
                            }}>
                            {e.node}
                        </div>
                    ))}
                </div>
            </div>
            {inBag.length > 0 && <div className="gc-bp-sep" />}
            <div className="gc-bp-toggle">
                <ChatBarButton
                    tooltip={open ? "Close backpack" : `Backpack (${inBag.length})`}
                    onClick={() => setOpen(o => !o)}
                    onContextMenu={e => ContextMenuApi.openContextMenu(e, () => <PackMenu entries={entries} />)}
                >
                    <div className="gc-bp-icon">
                        <BagIcon />
                        {!open && inBag.length > 0 && <span className="gc-bp-badge">{inBag.length}</span>}
                    </div>
                </ChatBarButton>
            </div>
        </div>
    );
}

export default definePlugin({
    name: "Backpack",
    description: "Packs all your chat bar buttons into one backpack that slides open. Right-click it to choose what stays out.",
    authors: [GC_AUTHOR],
    dependencies: ["ChatInputButtonAPI"],
    startAt: StartAt.Init,
    chatBarButtonWrapper: {
        wrapper: (buttons: ReactNode) => <ErrorBoundary noop fallback={() => <>{buttons}</>}><BackpackBar buttons={buttons} /></ErrorBoundary>,
        priority: 50
    },
    async start() {
        unpacked = new Set((await DataStore.get<string[]>(KEY)) ?? []);
        emit();
    },
    stop() {
        unpacked = null;
        emit();
    }
});
