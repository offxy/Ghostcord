/*
 * Ghostcord UI kit — shared toast, modal and helpers used by every Ghostcord plugin.
 */

import "./styles.css";

import { GHOSTCORD_LOGO } from "@shared/ghostcordLogo";
import { createRoot, React, useEffect, useState } from "@webpack/common";
import type { ReactNode } from "react";

export const GC_API = "https://194-238-31-149.sslip.io/v1";
export const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// ---------- toast ----------
export type ToastKind = "info" | "success" | "error";
export function toast(message: string, kind: ToastKind = "info", duration = 2800) {
    let host = document.getElementById("gc-toasts");
    if (!host) {
        host = document.createElement("div");
        host.id = "gc-toasts";
        document.body.appendChild(host);
    }
    const el = document.createElement("div");
    el.className = `gc-toast gc-toast-${kind}`;
    const logo = document.createElement("img");
    logo.src = GHOSTCORD_LOGO;
    logo.className = "gc-toast-logo";
    const text = document.createElement("span");
    text.textContent = message;
    el.append(logo, text);
    host.appendChild(el);
    requestAnimationFrame(() => el.classList.add("gc-toast-in"));
    setTimeout(() => {
        el.classList.remove("gc-toast-in");
        setTimeout(() => { el.remove(); if (host && !host.childElementCount) host.remove(); }, 220);
    }, duration);
}

// ---------- modal ----------
export interface GcModalProps {
    title: string;
    subtitle?: string;
    children?: ReactNode;
    footer?: ReactNode;
    wide?: boolean;
    onClose(): void;
}

export function GcModal({ title, subtitle, children, footer, wide, onClose }: GcModalProps) {
    const [shown, setShown] = useState(false);
    useEffect(() => {
        requestAnimationFrame(() => setShown(true));
        const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
        document.addEventListener("keydown", esc);
        return () => document.removeEventListener("keydown", esc);
    }, []);
    return (
        <div className={`gc-backdrop${shown ? " gc-shown" : ""}`} onMouseDown={e => e.target === e.currentTarget && onClose()}>
            <div className={`gc-modal${wide ? " gc-wide" : ""}`}>
                <div className="gc-modal-head">
                    <img src={GHOSTCORD_LOGO} className="gc-modal-logo" alt="" />
                    <div className="gc-modal-titles">
                        <div className="gc-modal-title">{title}</div>
                        {subtitle && <div className="gc-modal-sub">{subtitle}</div>}
                    </div>
                    <button className="gc-x" onClick={onClose} aria-label="Close">✕</button>
                </div>
                <div className="gc-modal-body">{children}</div>
                {footer && <div className="gc-modal-foot">{footer}</div>}
            </div>
        </div>
    );
}

/** Opens a component in its own overlay. The component gets a `close` prop. */
export function openGc(render: (close: () => void) => ReactNode) {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const close = () => { root.unmount(); host.remove(); };
    root.render(<>{render(close)}</>);
    return close;
}

export function confirmGc(title: string, body: string, confirmText = "Confirm", danger = true): Promise<boolean> {
    return new Promise(resolve => {
        openGc(close => {
            const done = (v: boolean) => { close(); resolve(v); };
            return (
                <GcModal title={title} onClose={() => done(false)} footer={<>
                    <GcButton kind="ghost" onClick={() => done(false)}>Cancel</GcButton>
                    <GcButton kind={danger ? "danger" : "primary"} onClick={() => done(true)}>{confirmText}</GcButton>
                </>}>
                    <p className="gc-text">{body}</p>
                </GcModal>
            );
        });
    });
}

export function promptGc(title: string, initial = "", placeholder = ""): Promise<string | null> {
    return new Promise(resolve => {
        openGc(close => {
            const Inner = () => {
                const [v, setV] = useState(initial);
                const done = (r: string | null) => { close(); resolve(r); };
                return (
                    <GcModal title={title} onClose={() => done(null)} footer={<>
                        <GcButton kind="ghost" onClick={() => done(null)}>Cancel</GcButton>
                        <GcButton onClick={() => done(v)}>Save</GcButton>
                    </>}>
                        <textarea className="gc-input gc-textarea" autoFocus value={v} placeholder={placeholder}
                            onChange={e => setV((e.target as HTMLTextAreaElement).value)}
                            onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); done(v); } }} />
                    </GcModal>
                );
            };
            return <Inner />;
        });
    });
}

// ---------- small components ----------
export function GcButton({ kind = "primary", disabled, onClick, children }: { kind?: "primary" | "danger" | "ghost"; disabled?: boolean; onClick?(): void; children: ReactNode; }) {
    return <button className={`gc-btn gc-btn-${kind}`} disabled={disabled} onClick={onClick}>{children}</button>;
}

export function GcProgress({ done, total, label }: { done: number; total: number; label?: string; }) {
    const pct = total ? Math.round(done / total * 100) : 0;
    return (
        <div className="gc-progress">
            <div className="gc-progress-top"><span>{label}</span><span>{done}/{total}</span></div>
            <div className="gc-progress-bar"><div style={{ width: `${pct}%` }} /></div>
        </div>
    );
}

/** Bulk picker: list of items with checkboxes, search, select all, and a run action with progress. */
export interface PickItem { id: string; name: string; sub?: string; icon?: string; locked?: string; }
export function GcBulkPicker({ title, subtitle, items, action, verb, delay, onClose }: {
    title: string; subtitle: string; items: PickItem[]; verb: string; delay: number;
    action(id: string): Promise<void>; onClose(): void;
}) {
    const [sel, setSel] = useState<Set<string>>(new Set());
    const [q, setQ] = useState("");
    const [run, setRun] = useState<{ done: number; total: number; failed: number; } | null>(null);
    const stop = React.useRef(false);

    const shown = items.filter(i => !q || i.name.toLowerCase().includes(q.toLowerCase()) || i.id.includes(q));
    const selectable = shown.filter(i => !i.locked);
    const allOn = selectable.length > 0 && selectable.every(i => sel.has(i.id));
    const toggle = (id: string) => setSel(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

    async function go() {
        const ids = [...sel];
        if (!ids.length) return;
        if (!await confirmGc(`${verb} ${ids.length}?`, `This will ${verb.toLowerCase()} ${ids.length} item${ids.length === 1 ? "" : "s"}. You can't undo this.`, verb)) return;
        stop.current = false;
        let failed = 0;
        setRun({ done: 0, total: ids.length, failed: 0 });
        for (let i = 0; i < ids.length; i++) {
            if (stop.current) break;
            try { await action(ids[i]); } catch { failed++; }
            setRun({ done: i + 1, total: ids.length, failed });
            await sleep(delay);
        }
        toast(`${verb}: ${ids.length - failed} done${failed ? `, ${failed} failed` : ""}`, failed ? "error" : "success");
        onClose();
    }

    return (
        <GcModal title={title} subtitle={subtitle} wide onClose={() => { stop.current = true; onClose(); }} footer={run
            ? <GcButton kind="ghost" onClick={() => { stop.current = true; }}>Stop</GcButton>
            : <>
                <span className="gc-count">{sel.size} selected</span>
                <GcButton kind="ghost" onClick={onClose}>Cancel</GcButton>
                <GcButton kind="danger" disabled={!sel.size} onClick={go}>{verb}</GcButton>
            </>}>
            {run ? <GcProgress done={run.done} total={run.total} label={`${verb}…${run.failed ? ` (${run.failed} failed)` : ""}`} /> : <>
                <div className="gc-row-tools">
                    <input className="gc-input" placeholder="Search" value={q} onChange={e => setQ((e.target as HTMLInputElement).value)} />
                    <GcButton kind="ghost" onClick={() => setSel(s => {
                        const n = new Set(s);
                        selectable.forEach(i => allOn ? n.delete(i.id) : n.add(i.id));
                        return n;
                    })}>{allOn ? "Unselect all" : "Select all"}</GcButton>
                </div>
                <div className="gc-list">
                    {!shown.length && <div className="gc-empty">Nothing here.</div>}
                    {shown.map(i => (
                        <label key={i.id} className={`gc-item${i.locked ? " gc-locked" : ""}${sel.has(i.id) ? " gc-on" : ""}`}>
                            <input type="checkbox" disabled={!!i.locked} checked={sel.has(i.id)} onChange={() => toggle(i.id)} />
                            {i.icon ? <img src={i.icon} className="gc-item-icon" alt="" /> : <div className="gc-item-icon gc-item-fallback">{i.name[0]}</div>}
                            <div className="gc-item-info">
                                <div className="gc-item-name">{i.name}</div>
                                {(i.locked || i.sub) && <div className="gc-item-sub">{i.locked ?? i.sub}</div>}
                            </div>
                        </label>
                    ))}
                </div>
            </>}
        </GcModal>
    );
}

export const GcIcon = (props: any) => (
    <img src={GHOSTCORD_LOGO} width={props.width ?? 18} height={props.height ?? 18} className={props.className}
        style={{ imageRendering: "pixelated", objectFit: "contain" }} alt="" />
);
