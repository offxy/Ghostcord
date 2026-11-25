/*
 * LastSeen — Equicord userplugin
 * Remembers the last time this client saw someone active (presence, messages,
 * typing, voice, reactions) and shows it on their profile and in the DM header.
 *
 * Discord doesn't expose a real "last online" time, so this only knows about
 * activity seen while the plugin is enabled.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import * as DataStore from "@api/DataStore";
import { definePluginSettings } from "@api/Settings";
import ErrorBoundary from "@components/ErrorBoundary";
import definePlugin, { OptionType } from "@utils/types";
import { findByPropsLazy, findComponentByCodeLazy } from "@webpack";
import { ChannelStore, FluxDispatcher, React, SelectedChannelStore, UserStore, useStateFromStores } from "@webpack/common";

const Section = findComponentByCodeLazy("headingVariant:", '"section"', "headingIcon:");
const PresenceStore = findByPropsLazy("getStatus", "getActivities");

const settings = definePluginSettings({
    language: {
        type: OptionType.SELECT,
        description: "Language",
        options: [
            { label: "English", value: "en", default: true },
            { label: "Français", value: "fr" }
        ]
    },
    showInDmHeader: { type: OptionType.BOOLEAN, description: "Show last seen next to the name in the DM header", default: true },
    showSeconds: { type: OptionType.BOOLEAN, description: "Include seconds in exact times", default: false },
    trackTyping: { type: OptionType.BOOLEAN, description: "Count typing as activity", default: true },
    trackReactions: { type: OptionType.BOOLEAN, description: "Count reactions as activity", default: true },
});

// ---------------------------------------------------------------------------
// Strings
// ---------------------------------------------------------------------------

const STRINGS = {
    en: {
        heading: "Last Seen", online: "Online", idle: "Idle", dnd: "Do Not Disturb", streaming: "Streaming",
        notTracked: "Not seen yet", activeNow: "Active now", lastActivity: "Last activity seen",
        waiting: "Waiting for activity", justNow: "just now", ago: (n: string) => `${n} ago`,
        today: (t: string) => `Today at ${t}`, yesterday: (t: string) => `Yesterday at ${t}`, at: (d: string, t: string) => `${d} at ${t}`,
        hint: "Tracked since you enabled LastSeen", lastSeen: "Last seen"
    },
    fr: {
        heading: "Vu pour la dernière fois", online: "En ligne", idle: "Inactif", dnd: "Ne pas déranger", streaming: "En stream",
        notTracked: "Pas encore vu", activeNow: "Actif maintenant", lastActivity: "Dernière activité vue",
        waiting: "En attente d'activité", justNow: "à l'instant", ago: (n: string) => `il y a ${n}`,
        today: (t: string) => `Aujourd'hui à ${t}`, yesterday: (t: string) => `Hier à ${t}`, at: (d: string, t: string) => `${d} à ${t}`,
        hint: "Suivi depuis l'activation de LastSeen", lastSeen: "Vu"
    }
};
const s = () => STRINGS[settings.store.language as "en" | "fr"] ?? STRINGS.en;
const locale = () => settings.store.language === "fr" ? "fr-FR" : undefined;

// ---------------------------------------------------------------------------
// Storage — memory first, DataStore throttled to once a minute per user
// ---------------------------------------------------------------------------

const KEY = "LastSeen_v2";
const cache = new Map<string, number>();
const dirty = new Set<string>();
let saveTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<(userId: string) => void>();

async function load() {
    try {
        const saved = await DataStore.get<Record<string, number>>(KEY);
        if (saved) for (const [id, ts] of Object.entries(saved)) if (!cache.has(id) || cache.get(id)! < ts) cache.set(id, ts);

        // migrate per-user keys from the old version (equicord_lastseen_<id>)
        const keys: IDBValidKey[] = await DataStore.keys().catch(() => []);
        const old = (keys as any[]).filter(k => typeof k === "string" && k.startsWith("equicord_lastseen_"));
        if (old.length) {
            for (const k of old) {
                const v = Number(await DataStore.get(k));
                const id = k.slice("equicord_lastseen_".length);
                if (Number.isFinite(v) && v > (cache.get(id) ?? 0)) cache.set(id, v);
            }
            await DataStore.delMany(old);
            await flush();
        }
    } catch (e) {
        console.error("[LastSeen] couldn't load", e);
    }
}

async function flush() {
    saveTimer = null;
    if (!dirty.size && cache.size === 0) return;
    dirty.clear();
    try { await DataStore.set(KEY, Object.fromEntries(cache)); } catch { /* ignore */ }
}

function seen(userId?: string | null) {
    if (!userId) return;
    const id = String(userId);
    cache.set(id, Date.now());
    dirty.add(id);
    if (!saveTimer) saveTimer = setTimeout(flush, 60_000);
    listeners.forEach(l => l(id));
}

// ---------------------------------------------------------------------------
// Flux handlers
// ---------------------------------------------------------------------------

const ACTIVE = new Set(["online", "idle", "dnd", "streaming"]);

function presenceEntry(e: any) {
    const id = e?.user?.id ?? e?.userId ?? e?.user_id;
    const status = String(e?.status ?? e?.presence?.status ?? "").toLowerCase();
    if (id && ACTIVE.has(status)) seen(id);
}

const handlers: Record<string, (d: any) => void> = {
    PRESENCE_UPDATES: d => (Array.isArray(d?.updates) ? d.updates : Array.isArray(d) ? d : [d]).forEach(presenceEntry),
    MESSAGE_CREATE: d => { if (!d?.optimistic) seen(d?.message?.author?.id); },
    TYPING_START: d => { if (settings.store.trackTyping) seen(d?.userId); },
    MESSAGE_REACTION_ADD: d => { if (settings.store.trackReactions) seen(d?.userId); },
    VOICE_STATE_UPDATES: d => (d?.voiceStates ?? []).forEach((v: any) => v?.channelId && seen(v.userId)),
};

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

function relative(ts: number) {
    const d = Math.max(0, Date.now() - ts);
    if (d < 45_000) return s().justNow;
    const rtf = new Intl.RelativeTimeFormat(locale(), { numeric: "always", style: "narrow" });
    const units: [Intl.RelativeTimeFormatUnit, number][] = [["day", 86_400_000], ["hour", 3_600_000], ["minute", 60_000]];
    for (const [unit, ms] of units) if (d >= ms) return rtf.format(-Math.floor(d / ms), unit);
    return s().justNow;
}

function exact(ts: number) {
    const date = new Date(ts);
    const now = new Date();
    const time = date.toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit", ...(settings.store.showSeconds && { second: "2-digit" }) });
    const yest = new Date(now); yest.setDate(now.getDate() - 1);

    if (date.toDateString() === now.toDateString()) return s().today(time);
    if (date.toDateString() === yest.toDateString()) return s().yesterday(time);
    const day = date.toLocaleDateString(locale(), { day: "numeric", month: "short", ...(date.getFullYear() !== now.getFullYear() && { year: "numeric" }) });
    return s().at(day, time);
}

function statusLabel(status: string) {
    const t = s();
    return status === "idle" ? t.idle : status === "dnd" ? t.dnd : status === "streaming" ? t.streaming : t.online;
}

// ---------------------------------------------------------------------------
// Hooks / components
// ---------------------------------------------------------------------------

function useLastSeen(userId: string) {
    const [ts, setTs] = React.useState(() => cache.get(userId) ?? null);
    const [, tick] = React.useReducer(x => x + 1, 0);

    React.useEffect(() => {
        setTs(cache.get(userId) ?? null);
        const l = (id: string) => id === userId && setTs(cache.get(userId) ?? null);
        listeners.add(l);
        const t = setInterval(tick, 30_000); // keep "5m ago" fresh
        return () => { listeners.delete(l); clearInterval(t); };
    }, [userId]);

    return ts;
}

function LastSeenCard({ userId }: { userId: string; }) {
    const status: string = useStateFromStores([PresenceStore], () => PresenceStore.getStatus?.(userId) ?? "offline", [userId]);
    const ts = useLastSeen(userId);
    const t = s();
    const online = ACTIVE.has(status);
    const state = online ? status : ts ? "offline" : "unknown";

    return (
        <div className={`vc-ls-card vc-ls-${state}`} title={ts ? new Date(ts).toLocaleString(locale()) : t.hint}>
            <span className="vc-ls-dot" aria-hidden />
            <div className="vc-ls-copy">
                <span className="vc-ls-main">{online ? statusLabel(status) : ts ? relative(ts) : t.notTracked}</span>
                <span className="vc-ls-sub">{online ? t.activeNow : ts ? exact(ts) : t.waiting}</span>
            </div>
        </div>
    );
}

// ---------------------------------------------------------------------------
// DM header pill
// ---------------------------------------------------------------------------

let observer: MutationObserver | null = null;
let headerTimer: ReturnType<typeof setTimeout> | null = null;
let headerInterval: ReturnType<typeof setInterval> | null = null;

function activeDmRecipient(): string | null {
    const ch: any = ChannelStore.getChannel(SelectedChannelStore.getChannelId());
    if (!ch || ch.type !== 1) return null;
    const r = ch.recipients?.[0] ?? ch.rawRecipients?.[0]?.id;
    return typeof r === "string" ? r : r?.id ?? null;
}

function findHeaderTitle(userId: string): HTMLElement | null {
    const u: any = UserStore.getUser(userId);
    const names = [u?.globalName, u?.username].filter(Boolean) as string[];
    if (!names.length) return null;

    const els = Array.from(document.querySelectorAll<HTMLElement>('h1, h2, [role="heading"], [class*="titleWrapper"] *, [class*="title_"]'));
    return els
        .filter(el => !el.classList.contains("vc-ls-pill") && names.includes((el.textContent ?? "").trim()))
        .filter(el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.top < 160 && r.bottom > 0; })
        .sort((a, b) => a.childElementCount - b.childElementCount)[0] ?? null;
}

function refreshHeader() {
    headerTimer = null;
    const pill = () => document.querySelector<HTMLElement>(".vc-ls-pill");
    const id = settings.store.showInDmHeader ? activeDmRecipient() : null;
    if (!id) { pill()?.remove(); return; }

    const title = findHeaderTitle(id);
    if (!title) return;

    let el = pill();
    if (!el || el.dataset.user !== id) {
        el?.remove();
        el = document.createElement("span");
        el.className = "vc-ls-pill";
        el.dataset.user = id;
    }
    if (el.previousElementSibling !== title) title.insertAdjacentElement("afterend", el);

    const status: string = PresenceStore.getStatus?.(id) ?? "offline";
    const ts = cache.get(id);
    const online = ACTIVE.has(status);
    const text = online ? statusLabel(status) : ts ? `${s().lastSeen} ${relative(ts)}` : s().notTracked;
    const cls = `vc-ls-pill vc-ls-${online ? status : ts ? "offline" : "unknown"}`;

    if (el.className !== cls) el.className = cls;
    if (el.textContent !== text) el.textContent = text;
    el.title = ts ? exact(ts) : s().hint;
}

function scheduleHeader() {
    if (!headerTimer) headerTimer = setTimeout(refreshHeader, 150);
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const CSS = String.raw`
.vc-ls-card, .vc-ls-pill {
    --ls-color: var(--text-muted, #80848e);
}
.vc-ls-online   { --ls-color: var(--status-positive, #23a55a); }
.vc-ls-idle     { --ls-color: var(--status-warning, #f0b232); }
.vc-ls-dnd      { --ls-color: var(--status-danger, #f23f43); }
.vc-ls-streaming{ --ls-color: #a970ff; }

.vc-ls-card {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-top: 6px;
    padding: 10px 12px;
    border: 1px solid var(--border-subtle, rgb(255 255 255 / 7%));
    border-radius: 12px;
    background:
        linear-gradient(90deg, color-mix(in srgb, var(--ls-color) 10%, transparent), transparent 70%),
        var(--background-base-lowest, var(--background-secondary, #2b2d31));
    transition: border-color .15s ease, background .15s ease;
}
.vc-ls-card:hover { border-color: color-mix(in srgb, var(--ls-color) 40%, transparent); }

.vc-ls-dot {
    position: relative;
    flex: 0 0 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--ls-color);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--ls-color) 18%, transparent);
}
.vc-ls-online .vc-ls-dot::after {
    content: "";
    position: absolute;
    inset: 0;
    border-radius: 50%;
    background: var(--ls-color);
    animation: vc-ls-ping 1.8s ease-out infinite;
}
@keyframes vc-ls-ping { from { transform: scale(1); opacity: .6; } to { transform: scale(2.6); opacity: 0; } }

.vc-ls-copy { display: flex; min-width: 0; flex-direction: column; gap: 1px; }
.vc-ls-main {
    color: var(--text-strong, var(--header-primary, #f2f3f5));
    font-size: 14px;
    font-weight: 600;
    user-select: text;
}
.vc-ls-sub {
    overflow: hidden;
    color: var(--text-muted, #949ba4);
    font-size: 12px;
    text-overflow: ellipsis;
    white-space: nowrap;
    user-select: text;
}

.vc-ls-pill {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    max-width: 220px;
    margin-left: 8px;
    padding: 2px 9px 2px 7px;
    border: 1px solid color-mix(in srgb, var(--ls-color) 30%, transparent);
    border-radius: 999px;
    background: color-mix(in srgb, var(--ls-color) 10%, transparent);
    color: var(--text-default, var(--text-normal, #dbdee1));
    font-size: 11px;
    font-weight: 500;
    line-height: 16px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    vertical-align: middle;
}
.vc-ls-pill::before {
    content: "";
    flex: 0 0 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--ls-color);
}
@media (prefers-reduced-motion: reduce) { .vc-ls-online .vc-ls-dot::after { animation: none; } }
`;

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

const Card = ErrorBoundary.wrap(LastSeenCard, { noop: true });

export default definePlugin({
    name: "LastSeen",
    description: "Shows when this client last saw someone active, on their profile and in the DM header. Only knows about activity since you enabled it.",
    authors: [{ name: "Equicord Community", id: 0n }],
    settings,

    patches: [
        {
            find: "#{intl::PROVISIONAL_ACCOUNT}),headingIcon:",
            replacement: {
                match: /(#{intl::USER_PROFILE_MEMBER_SINCE}\),.{0,100}userId:(\i\.id)}\)}\))/,
                replace: "$1,$self.renderLastSeen({userId:$2,isSideBar:true})"
            }
        },
        {
            find: ",applicationRoleConnection:",
            replacement: {
                match: /(#{intl::USER_PROFILE_MEMBER_SINCE}\),.{0,100}userId:(\i\.id),.{0,100}}\)}\)),/,
                replace: "$1,$self.renderLastSeen({userId:$2,isSideBar:false}),"
            }
        },
        {
            find: ".MODAL_V2,onClose:",
            replacement: {
                match: /(#{intl::USER_PROFILE_MEMBER_SINCE}\),.{0,100}userId:(\i\.id),.{0,100}}\)}\)),/,
                replace: "$1,$self.renderLastSeen({userId:$2,isSideBar:false}),"
            }
        }
    ],

    renderLastSeen({ userId, isSideBar }: { userId: string; isSideBar: boolean; }) {
        if (!userId || userId === UserStore.getCurrentUser()?.id) return null;
        return (
            <Section
                heading={s().heading}
                headingVariant={isSideBar ? "text-xs/semibold" : "text-xs/medium"}
                headingColor={isSideBar ? "text-strong" : "text-default"}
            >
                <Card userId={userId} />
            </Section>
        );
    },

    async start() {
        const style = document.createElement("style");
        style.id = "vc-lastseen-style";
        style.textContent = CSS;
        document.head.appendChild(style);

        for (const [ev, fn] of Object.entries(handlers)) FluxDispatcher.subscribe(ev as any, fn);
        FluxDispatcher.subscribe("PRESENCE_UPDATE" as any, handlers.PRESENCE_UPDATES);
        FluxDispatcher.subscribe("CHANNEL_SELECT", scheduleHeader);
        listeners.add(scheduleHeader);

        observer = new MutationObserver(muts => {
            // ignore our own pill changes so we don't loop
            if (muts.every(m => (m.target as HTMLElement)?.classList?.contains?.("vc-ls-pill"))) return;
            scheduleHeader();
        });
        observer.observe(document.body, { childList: true, subtree: true });
        headerInterval = setInterval(scheduleHeader, 30_000);

        await load();
        scheduleHeader();
    },

    stop() {
        for (const [ev, fn] of Object.entries(handlers)) FluxDispatcher.unsubscribe(ev as any, fn);
        FluxDispatcher.unsubscribe("PRESENCE_UPDATE" as any, handlers.PRESENCE_UPDATES);
        FluxDispatcher.unsubscribe("CHANNEL_SELECT", scheduleHeader);
        listeners.delete(scheduleHeader);
        observer?.disconnect();
        observer = null;
        if (headerTimer) clearTimeout(headerTimer);
        if (headerInterval) clearInterval(headerInterval);
        headerTimer = null;
        headerInterval = null;
        if (saveTimer) { clearTimeout(saveTimer); void flush(); }
        document.querySelectorAll(".vc-ls-pill").forEach(e => e.remove());
        document.getElementById("vc-lastseen-style")?.remove();
    }
});
