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

const API = "https://194-238-31-149.sslip.io/v1/users/online";
const OWNER_ID = "1402331570525835275";
const REFRESH = 30_000;

interface Row { id: string; since: number; name: string; tag: string; avatar: string; }

function duration(ms: number) {
    const m = Math.max(1, Math.floor(ms / 60_000));
    if (m < 60) return `${m}m`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ${m % 60}m`;
    return `${Math.floor(h / 24)}d ${h % 24}h`;
}

async function resolve(id: string, since: number): Promise<Row> {
    let user: any = UserStore.getUser(id);
    if (!user) { try { user = await UserUtils.getUser(id); } catch { } }
    return {
        id,
        since,
        name: user?.globalName ?? user?.username ?? "Unknown user",
        tag: user?.username ? `@${user.username}` : id,
        avatar: user ? IconUtils.getUserAvatarURL(user, false, 64) : GHOSTCORD_LOGO
    };
}

function UsersTab() {
    const [rows, setRows] = useState<Row[] | null>(null);
    const [error, setError] = useState(false);
    const [query, setQuery] = useState("");
    const [, tick] = useState(0);

    useEffect(() => {
        let dead = false;
        const load = async () => {
            try {
                const online: Record<string, number> = await fetch(API, { cache: "no-store" }).then(r => r.json());
                const list = await Promise.all(Object.entries(online).map(([id, since]) => resolve(id, since)));
                list.sort((a, b) => a.since - b.since);
                if (!dead) { setRows(list); setError(false); }
            } catch { if (!dead) setError(true); }
        };
        load();
        const a = setInterval(load, REFRESH);
        const b = setInterval(() => tick(n => n + 1), 30_000);
        return () => { dead = true; clearInterval(a); clearInterval(b); };
    }, []);

    const q = query.trim().toLowerCase();
    const shown = (rows ?? []).filter(r => !q || r.name.toLowerCase().includes(q) || r.tag.toLowerCase().includes(q) || r.id.includes(q));

    return (
        <div className="gc-users">
            <div className="gc-users-head">
                <img src={GHOSTCORD_LOGO} className="gc-users-logo" alt="" />
                <div>
                    <div className="gc-users-title">Ghostcord users</div>
                    <div className="gc-users-sub">
                        {rows ? <><b>{rows.length}</b> online right now · refreshes every 30s</> : "Loading…"}
                    </div>
                </div>
            </div>

            <input className="gc-users-search" placeholder="Search by name, username or ID" value={query}
                onChange={e => setQuery((e.target as HTMLInputElement).value)} />

            {error && <div className="gc-users-empty">Couldn't reach the Ghostcord API.</div>}
            {rows && !shown.length && !error && <div className="gc-users-empty">Nobody matches.</div>}

            <div className="gc-users-list">
                {shown.map(r => (
                    <div key={r.id} className="gc-users-row" onClick={() => openUserProfile(r.id)}>
                        <img src={r.avatar} className="gc-users-avatar" alt="" />
                        <div className="gc-users-info">
                            <div className="gc-users-name">{r.name}{r.id === OWNER_ID && <span className="gc-users-you">you</span>}</div>
                            <div className="gc-users-tag">{r.tag}</div>
                        </div>
                        <div className="gc-users-time"><span className="gc-users-dot" />{duration(Date.now() - r.since)}</div>
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
    description: "Owner-only settings tab listing everyone using Ghostcord right now.",
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
