/*
 * Ghostcord — owner-only "Users" tab: everyone running Ghostcord right now.
 */

import "./styles.css";

import SettingsPlugin from "@plugins/_core/settings";
import { GHOSTCORD_LOGO } from "@shared/ghostcordLogo";
import { openUserProfile } from "@utils/discord";
import { removeFromArray } from "@utils/misc";
import definePlugin from "@utils/types";
import { IconUtils, React, UserStore, UserUtils, useEffect, useState } from "@webpack/common";

import { gcFetch } from "../_gc/api";

const OWNER_ID = "1402331570525835275";
const REFRESH = 30_000;

interface Row { id: string; online: boolean; since: number; lastSeen: number; firstSeen: number | null; name: string; tag: string; avatar: string; }
type Filter = "online" | "offline" | "all";

function duration(ms: number) {
    const m = Math.max(1, Math.floor(ms / 60_000));
    if (m < 60) return `${m}m`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ${m % 60}m`;
    return `${Math.floor(h / 24)}d ${h % 24}h`;
}

function ago(t: number) {
    const m = Math.floor((Date.now() - t) / 60_000);
    if (m < 1) return "just now";
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    const d = Math.floor(h / 24);
    if (d < 30) return `${d}d ago`;
    return new Date(t).toLocaleDateString();
}

const userCache = new Map<string, any>();
async function resolve(r: { id: string; online: boolean; since: number; lastSeen: number; firstSeen: number | null; }): Promise<Row> {
    let user: any = UserStore.getUser(r.id) ?? userCache.get(r.id);
    if (!user) { try { user = await UserUtils.getUser(r.id); userCache.set(r.id, user); } catch { } }
    return {
        ...r,
        name: user?.globalName ?? user?.username ?? "Unknown user",
        tag: user?.username ? `@${user.username}` : r.id,
        avatar: user ? IconUtils.getUserAvatarURL(user, false, 64) : GHOSTCORD_LOGO
    };
}

function UsersTab() {
    const [rows, setRows] = useState<Row[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [stats, setStats] = useState<{ online: number; total: number; today: number; week: number; newToday: number; } | null>(null);
    const [query, setQuery] = useState("");
    const [filter, setFilter] = useState<Filter>("online");
    const [, tick] = useState(0);

    useEffect(() => {
        let dead = false;
        const load = async () => {
            try {
                const [all, st] = await Promise.all([gcFetch("/users/all") as Promise<Row[]>, gcFetch("/users/stats")]);
                if (dead) return;
                setStats(st);
                // resolve names in small batches so the list fills in fast
                const out: Row[] = [];
                for (let i = 0; i < all.length; i += 25) {
                    out.push(...await Promise.all(all.slice(i, i + 25).map(resolve)));
                    if (dead) return;
                    setRows([...out]);
                }
                setRows(out);
                setError(null);
            } catch (e: any) {
                if (dead) return;
                setError(e?.code === "NO_AUTH" ? "Log in to Ghostcord Cloud (Settings → Cloud) so the API knows it's you."
                    : e?.status === 403 ? "Your account isn't an admin on the Ghostcord API (ADMIN_IDS in .env)."
                        : "Couldn't reach the Ghostcord API.");
            }
        };
        load();
        const a = setInterval(load, REFRESH);
        const b = setInterval(() => tick(n => n + 1), 30_000);
        return () => { dead = true; clearInterval(a); clearInterval(b); };
    }, []);

    const q = query.trim().toLowerCase();
    const all = rows ?? [];
    const counts = { online: all.filter(r => r.online).length, offline: all.filter(r => !r.online).length, all: all.length };
    const shown = all
        .filter(r => filter === "all" || (filter === "online") === r.online)
        .filter(r => !q || r.name.toLowerCase().includes(q) || r.tag.toLowerCase().includes(q) || r.id.includes(q))
        .sort((a, b) => a.online !== b.online ? (a.online ? -1 : 1) : a.online ? a.since - b.since : b.lastSeen - a.lastSeen);

    return (
        <div className="gc-users">
            <div className="gc-users-head">
                <img src={GHOSTCORD_LOGO} className="gc-users-logo" alt="" />
                <div>
                    <div className="gc-users-title">Ghostcord users</div>
                    <div className="gc-users-sub">
                        {rows ? <><b>{counts.online}</b> online · <b>{counts.all}</b> total · refreshes every 30s</> : "Loading…"}
                    </div>
                </div>
            </div>

            {stats && (
                <div className="gc-users-stats">
                    {([["Online now", stats.online], ["Today", stats.today], ["This week", stats.week], ["All time", stats.total], ["New today", stats.newToday]] as const).map(([k, v]) => (
                        <div key={k} className="gc-users-stat"><div className="gc-users-stat-n">{v}</div><div className="gc-users-stat-l">{k}</div></div>
                    ))}
                </div>
            )}

            <div className="gc-users-tools">
                <div className="gc-users-tabs">
                    {(["online", "offline", "all"] as Filter[]).map(f => (
                        <button key={f} className={`gc-users-tab${filter === f ? " gc-users-tab-on" : ""}`} onClick={() => setFilter(f)}>
                            {f[0].toUpperCase() + f.slice(1)} <span>{counts[f]}</span>
                        </button>
                    ))}
                </div>
                <input className="gc-users-search" placeholder="Search by name, username or ID" value={query}
                    onChange={e => setQuery((e.target as HTMLInputElement).value)} />
            </div>

            {error && <div className="gc-users-empty">{error}</div>}
            {rows && !shown.length && !error && <div className="gc-users-empty">{q ? "Nobody matches." : filter === "online" ? "Nobody's online right now." : "No one here yet."}</div>}

            <div className="gc-users-list">
                {shown.map(r => (
                    <div key={r.id} className={`gc-users-row${r.online ? "" : " gc-users-off"}`} onClick={() => openUserProfile(r.id)}>
                        <div className="gc-users-avwrap">
                            <img src={r.avatar} className="gc-users-avatar" alt="" />
                            <span className={`gc-users-status ${r.online ? "gc-on" : "gc-off"}`} />
                        </div>
                        <div className="gc-users-info">
                            <div className="gc-users-name">{r.name}{r.id === OWNER_ID && <span className="gc-users-you">you</span>}</div>
                            <div className="gc-users-tag">{r.tag}{r.firstSeen ? ` · joined ${new Date(r.firstSeen).toLocaleDateString()}` : ""}</div>
                        </div>
                        <div className="gc-users-time" title={new Date(r.online ? r.since : r.lastSeen).toLocaleString()}>
                            {r.online ? <>online {duration(Date.now() - r.since)}</> : <>last seen {ago(r.lastSeen)}</>}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}

const UsersIcon = (props: any) => (
    <svg width={props.width ?? 20} height={props.height ?? 20} className={props.className} viewBox="0 0 24 24" fill="currentColor">
        <path d="M16 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm-8 0a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm0 2c-2.7 0-8 1.3-8 4v2h10v-2c0-1 .4-1.9 1.1-2.6C9.9 13.6 8.8 13 8 13Zm8 0c-2.7 0-8 1.3-8 4v2h16v-2c0-2.7-5.3-4-8-4Z" />
    </svg>
);

let added = false;
function addEntry() {
    if (added || UserStore.getCurrentUser()?.id !== OWNER_ID) return;
    SettingsPlugin.customEntries.push({ key: "ghostcord_users", title: "Users", Component: UsersTab, Icon: UsersIcon });
    added = true;
}

let waitTimer: ReturnType<typeof setInterval> | undefined;

export default definePlugin({
    name: "GhostcordUsers",
    description: "Owner-only settings tab listing everyone who uses Ghostcord — online and offline, with stats.",
    authors: [{ name: "offxy", id: 1402331570525835275n }],
    required: true,
    dependencies: ["Settings"],
    start() {
        addEntry();
        // account may not be loaded yet at startup
        if (!added) waitTimer = setInterval(() => { addEntry(); if (added) clearInterval(waitTimer); }, 2000);
    },
    stop() {
        clearInterval(waitTimer);
        removeFromArray(SettingsPlugin.customEntries, e => e.key === "ghostcord_users");
        added = false;
    }
});
