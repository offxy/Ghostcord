/*
 * Ghostcord — Backpack: packs chat bar buttons (Discord's own AND plugin buttons) into one button.
 * Left-click to open and use packed buttons. Right-click the backpack to choose what's packed.
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
import { ContextMenuApi, Menu, React, ReactDOM, useEffect, useLayoutEffect, useRef, useState } from "@webpack/common";
import type { ReactNode } from "react";

import { GHOSTCORD_LOGO } from "@shared/ghostcordLogo";
import { GC_AUTHOR } from "../_gc/voice";

const KEY = "Backpack_packedButtons_v2";
const VC_GROUP = "vencord-chat-buttons";
const NO_SETTINGS = new Set(["Translate"]);
const NATIVE_NAMES: Record<string, string> = {
    gift: "Gift", gifts: "Gift", gif: "GIF", gifs: "GIF", sticker: "Stickers", stickers: "Stickers",
    emoji: "Emoji", emojis: "Emoji", app_launcher: "Apps", apps: "Apps", activity: "Activities", soundboard: "Soundboard"
};

let packed: Set<string> | null = null; // null = not loaded yet
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(l => l());
const save = () => DataStore.set(KEY, [...(packed ?? [])]);

function togglePacked(id: string) {
    if (!packed) return;
    packed.has(id) ? packed.delete(id) : packed.add(id);
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

function PackMenu({ entries }: { entries: Entry[]; }) {
    useBackpack();
    const natives = entries.filter(e => !e.plugin);
    const plugs = entries.filter(e => e.plugin).sort((a, b) => a.name.localeCompare(b.name));
    const row = (e: Entry) => (
        <Menu.MenuCheckboxItem key={e.id} id={`gc-bp-${e.id}`} label={e.name} checked={!!packed?.has(e.id)} action={() => togglePacked(e.id)} />
    );
    return (
        <Menu.Menu navId="gc-backpack-pack" onClose={ContextMenuApi.closeContextMenu} aria-label="Pack into Backpack">
            {natives.length > 0 && <Menu.MenuGroup label="Discord buttons">{natives.map(row)}</Menu.MenuGroup>}
            {plugs.length > 0 && <Menu.MenuGroup label="Plugin buttons">{plugs.map(row)}</Menu.MenuGroup>}
            <Menu.MenuGroup>
                <Menu.MenuItem id="gc-bp-all" label="Pack everything" action={() => { entries.forEach(e => packed?.add(e.id)); save(); emit(); }} />
                <Menu.MenuItem id="gc-bp-none" label="Unpack everything" action={() => { packed?.clear(); save(); emit(); }} />
            </Menu.MenuGroup>
        </Menu.Menu>
    );
}

const BagIcon = ({ className }: { className?: string; }) => (
    <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
        <path d="M9 3a3 3 0 0 1 6 0v1h1.5A4.5 4.5 0 0 1 21 8.5V19a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V8.5A4.5 4.5 0 0 1 7.5 4H9V3Zm2 1h2V3a1 1 0 1 0-2 0v1Zm-4 8a1 1 0 0 0 0 2h10a1 1 0 1 0 0-2H7Zm2 3.5a1 1 0 0 0-1 1V18a1 1 0 1 0 2 0v-1.5a1 1 0 0 0-1-1Z" />
    </svg>
);

function Panel({ anchor, items, onClose }: { anchor: HTMLElement; items: Entry[]; onClose(): void; }) {
    const ref = useRef<HTMLDivElement>(null);
    const [pos, setPos] = useState({ right: 0, bottom: 0 });

    useLayoutEffect(() => {
        const place = () => {
            const r = anchor.getBoundingClientRect();
            setPos({ right: Math.max(8, window.innerWidth - r.right - 6), bottom: window.innerHeight - r.top + 10 });
        };
        place();
        window.addEventListener("resize", place);
        const t = setInterval(place, 500); // follow the chat bar as it grows
        return () => { window.removeEventListener("resize", place); clearInterval(t); };
    }, [anchor]);

    useEffect(() => {
        const onDown = (e: MouseEvent) => {
            const t = e.target as HTMLElement;
            if (ref.current?.contains(t) || anchor.contains(t)) return;
            // keep open while a packed button's popup / picker / modal is up
            if (t.closest?.('[class*="layerContainer"], [role="dialog"], [role="menu"], [class*="popout"], .gc-backdrop')) return;
            onClose();
        };
        const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
        const id = setTimeout(() => document.addEventListener("mousedown", onDown, true), 0);
        document.addEventListener("keydown", onKey);
        return () => { clearTimeout(id); document.removeEventListener("mousedown", onDown, true); document.removeEventListener("keydown", onKey); };
    }, []);

    return ReactDOM.createPortal(
        <div ref={ref} className="gc-bp-panel" style={{ right: pos.right, bottom: pos.bottom }}>
            <div className="gc-bp-head">
                <img src={GHOSTCORD_LOGO} className="gc-bp-logo" alt="" />
                <span>Backpack</span>
                <span className="gc-bp-count">{items.length}</span>
            </div>
            {!items.length
                ? <div className="gc-bp-empty">Right-click the backpack to pack buttons.</div>
                : <div className="gc-bp-grid">
                    {items.map(e => (
                        <div key={e.id} className="gc-bp-item"
                            onContextMenu={ev => {
                                const p = e.plugin && plugins[e.plugin];
                                if (!p || NO_SETTINGS.has(e.plugin!)) return;
                                ev.preventDefault();
                                ev.stopPropagation();
                                openPluginModal(p);
                            }}>
                            <div className="gc-bp-btn">{e.node}</div>
                            <div className="gc-bp-label">{e.name}</div>
                        </div>
                    ))}
                </div>}
        </div>,
        document.body
    );
}

function BackpackBar({ buttons }: { buttons: ReactNode; }) {
    useBackpack();
    const [open, setOpen] = useState(false);
    const anchor = useRef<HTMLDivElement>(null);
    const { entries, props } = collect(buttons);

    // no plugin group means a chat bar we shouldn't touch (or one that's disabled)
    if (!props || !packed || props.type?.analyticsName !== "normal") return <>{buttons}</>;

    const inBag = entries.filter(e => packed!.has(e.id));
    const onBar = entries.filter(e => !packed!.has(e.id));

    return (
        <div className="gc-bp-bar">
            <div ref={anchor} className={`gc-bp-toggle${open ? " gc-bp-open" : ""}`}>
                <ChatBarButton
                    tooltip={`Backpack (${inBag.length})`}
                    onClick={() => setOpen(o => !o)}
                    onContextMenu={e => ContextMenuApi.openContextMenu(e, () => <PackMenu entries={entries} />)}
                >
                    <div className="gc-bp-icon">
                        <BagIcon />
                        {inBag.length > 0 && <span className="gc-bp-badge">{inBag.length}</span>}
                    </div>
                </ChatBarButton>
            </div>
            {onBar.map(e => <React.Fragment key={e.id}>{e.node}</React.Fragment>)}
            {open && anchor.current && <Panel anchor={anchor.current} items={inBag} onClose={() => setOpen(false)} />}
        </div>
    );
}

export default definePlugin({
    name: "Backpack",
    description: "Pack Discord's and plugins' chat bar buttons into one backpack. Left-click to use them, right-click to choose what's packed.",
    authors: [GC_AUTHOR],
    dependencies: ["ChatInputButtonAPI"],
    startAt: StartAt.Init,
    chatBarButtonWrapper: {
        wrapper: (buttons: ReactNode) => <ErrorBoundary noop fallback={() => <>{buttons}</>}><BackpackBar buttons={buttons} /></ErrorBoundary>,
        priority: 50
    },
    async start() {
        const saved = await DataStore.get<string[]>(KEY);
        // first run: pack every plugin button plus Gift / GIF / Stickers, keep Emoji on the bar
        packed = new Set(saved ?? ["native:gift", "native:gifts", "native:gif", "native:gifs", "native:sticker", "native:stickers", ...[...ChatBarButtonMap.keys()].filter(k => k !== "Backpack")]);
        if (!saved) save();
        emit();
    },
    stop() {
        packed = null;
        emit();
    }
});
