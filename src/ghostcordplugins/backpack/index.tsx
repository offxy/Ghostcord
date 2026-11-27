/*
 * Ghostcord — Backpack: packs other plugins' chat bar buttons into one button.
 * Left-click to open and use packed buttons. Right-click to choose what's packed.
 * Right-click a packed button to open that plugin's settings.
 */

import "./styles.css";

import { ChatBarButton, ChatBarButtonFactory, ChatBarButtonMap } from "@api/ChatButtons";
import { ContextMenuApi, Menu, React, useEffect, useRef, useState } from "@webpack/common";
import * as DataStore from "@api/DataStore";
import { plugins } from "@api/PluginManager";
import { Settings } from "@api/Settings";
import ErrorBoundary from "@components/ErrorBoundary";
import { openPluginModal } from "@components/settings/tabs/plugins/PluginModal";
import definePlugin from "@utils/types";

import { GC_AUTHOR } from "../_gc/voice";

const KEY = "Backpack_packedButtons";
const SELF = "Backpack";
const NO_SETTINGS = new Set(["Translate"]);

let packed = new Set<string>();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(l => l());

function useBackpack() {
    const [, rerender] = useState(0);
    useEffect(() => {
        const l = () => rerender(n => n + 1);
        listeners.add(l);
        return () => void listeners.delete(l);
    }, []);
}

/** Hide packed buttons from the normal chat bar, show unpacked ones again. */
function syncBar(id: string, isPacked: boolean) {
    const bar = Settings.uiElements.chatBarButtons;
    bar[id] ??= {} as any;
    bar[id].enabled = !isPacked;
}

async function save() { await DataStore.set(KEY, [...packed]); }

function setPacked(id: string, v: boolean) {
    v ? packed.add(id) : packed.delete(id);
    syncBar(id, v);
    save();
    emit();
}

const available = () => [...ChatBarButtonMap.keys()].filter(k => k !== SELF).sort((a, b) => a.localeCompare(b));

function PackMenu() {
    return (
        <Menu.Menu navId="gc-backpack-pack" onClose={ContextMenuApi.closeContextMenu} aria-label="Pack Plugins into Backpack">
            <Menu.MenuGroup label="Pack Plugins into Backpack">
                {available().map(id => (
                    <Menu.MenuCheckboxItem key={id} id={`gc-bp-${id}`} label={id} checked={packed.has(id)} action={() => setPacked(id, !packed.has(id))} />
                ))}
            </Menu.MenuGroup>
        </Menu.Menu>
    );
}

const ChevronIcon = ({ open, className }: { open?: boolean; className?: string; }) => (
    <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="currentColor" style={{ transition: "transform .18s", transform: open ? "rotate(180deg)" : "none" }}>
        <path d="M5.3 15.7a1 1 0 0 0 1.4 0L12 10.42l5.3 5.3a1 1 0 0 0 1.4-1.42l-6-6a1 1 0 0 0-1.4 0l-6 6a1 1 0 0 0 0 1.42Z" />
    </svg>
);

const BackpackButton: ChatBarButtonFactory = props => {
    useBackpack();
    const [open, setOpen] = useState(false);
    const wrap = useRef<HTMLDivElement>(null);

    // close on outside click, unless a packed plugin opened a popup/modal
    useEffect(() => {
        if (!open) return;
        let blockers = 0;
        const obs = new MutationObserver(muts => {
            for (const m of muts) {
                m.addedNodes.forEach(n => { if (n instanceof HTMLElement && n.matches?.('[class*="layerContainer"] *, [role="dialog"], .gc-backdrop')) blockers++; });
                m.removedNodes.forEach(n => { if (n instanceof HTMLElement && n.matches?.('[role="dialog"], .gc-backdrop')) blockers = Math.max(0, blockers - 1); });
            }
        });
        obs.observe(document.body, { childList: true, subtree: true });
        const onDown = (e: MouseEvent) => {
            const t = e.target as Node;
            if (wrap.current?.contains(t)) return;
            if (blockers || document.querySelector('[role="dialog"], .gc-backdrop')) return;
            if ((t as HTMLElement).closest?.('[class*="layerContainer"], [class*="popout"], [role="menu"]')) return;
            setOpen(false);
        };
        setTimeout(() => document.addEventListener("mousedown", onDown), 0);
        return () => { obs.disconnect(); document.removeEventListener("mousedown", onDown); };
    }, [open]);

    if (!props.isMainChat) return null;
    const items = [...packed].filter(id => ChatBarButtonMap.has(id));

    return (
        <div className="gc-bp-wrap" ref={wrap}>
            <ChatBarButton
                tooltip={`Backpack (${items.length})`}
                onClick={() => setOpen(o => !o)}
                onContextMenu={e => ContextMenuApi.openContextMenu(e, () => <PackMenu />)}
            >
                <div className="gc-bp-icon">
                    <ChevronIcon open={open} />
                    {items.length > 0 && <span className="gc-bp-badge">{items.length}</span>}
                </div>
            </ChatBarButton>
            {open && (
                <div className="gc-bp-panel" onMouseDown={e => e.stopPropagation()}>
                    {!items.length && <div className="gc-bp-empty">Right-click to pack plugins.</div>}
                    {items.map(id => {
                        const Button = ChatBarButtonMap.get(id)!.render;
                        const plugin = plugins[id];
                        return (
                            <div key={id} className="gc-bp-item" title={id}
                                onContextMenu={e => {
                                    if (!plugin || NO_SETTINGS.has(id)) return;
                                    e.preventDefault();
                                    e.stopPropagation();
                                    openPluginModal(plugin);
                                }}>
                                <ErrorBoundary noop>
                                    <Button {...props} />
                                </ErrorBoundary>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
};

export default definePlugin({
    name: SELF,
    description: "Organize chat bar buttons into a backpack. Left-click to use packed buttons, right-click to pack/unpack buttons.",
    authors: [GC_AUTHOR],
    dependencies: ["ChatInputButtonAPI"],
    chatBarButton: { icon: (p: any) => <ChevronIcon {...p} />, render: BackpackButton },
    async start() {
        const saved = await DataStore.get<string[]>(KEY);
        if (saved) packed = new Set(saved);
        else {
            // first run: pack everything except the backpack itself
            await new Promise(r => setTimeout(r, 1500));
            packed = new Set(available());
            await save();
        }
        packed.forEach(id => syncBar(id, true));
        emit();
    },
    stop() {
        // put the buttons back on the bar but keep the saved list for next time
        packed.forEach(id => syncBar(id, false));
        packed.clear();
        emit();
    }
});
