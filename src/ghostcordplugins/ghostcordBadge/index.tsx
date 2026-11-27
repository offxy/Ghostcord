/*
 * Ghostcord — shows "Using Ghostcord · for 1h 23m" on profiles of people on Ghostcord right now.
 */

import "./styles.css";

import { GHOSTCORD_LOGO } from "@shared/ghostcordLogo";
import { Logger } from "@utils/Logger";
import definePlugin from "@utils/types";
import { React, UserStore, useEffect, useState } from "@webpack/common";

const API = "https://194-238-31-149.sslip.io/v1/users";
const logger = new Logger("GhostcordPresence");

let online: Record<string, number> = {};
const listeners = new Set<() => void>();
let pingTimer: ReturnType<typeof setInterval> | undefined;
let listTimer: ReturnType<typeof setInterval> | undefined;

async function ping() {
    const id = UserStore.getCurrentUser()?.id;
    if (!id) return;
    try {
        const res = await fetch(API + "/ping", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id })
        }).then(r => r.json());
        if (res?.since) { online[id] = res.since; listeners.forEach(l => l()); }
    } catch (e) {
        logger.error("Ping failed", e);
    }
}

// The API only tells us about the users we ask for, so we batch up the profiles that are on screen.
const checked = new Map<string, number>(); // userId -> last checked
const queue = new Set<string>();
let queueTimer: ReturnType<typeof setTimeout> | undefined;

const viewed = new Map<string, number>(); // userId -> last time a profile with them was on screen

function want(userId: string, force = false) {
    if (!userId) return;
    viewed.set(userId, Date.now());
    if (!force && Date.now() - (checked.get(userId) ?? 0) < 60_000) return;
    queue.add(userId);
    clearTimeout(queueTimer);
    queueTimer = setTimeout(flush, 250);
}

async function flush() {
    const ids = [...queue].slice(0, 100);
    ids.forEach(id => { queue.delete(id); checked.set(id, Date.now()); });
    if (!ids.length) return;
    try {
        const res: Record<string, number> = await fetch(`${API}/online?ids=${ids.join(",")}`, { cache: "no-store" }).then(r => r.json());
        const me = UserStore.getCurrentUser()?.id;
        for (const id of ids) { if (id !== me) delete online[id]; }
        Object.assign(online, res);
        listeners.forEach(l => l());
    } catch (e) {
        logger.error("Couldn't check who's on Ghostcord", e);
    }
    if (queue.size) flush();
}

function loadOnline() {
    // re-check people whose profiles were on screen in the last 10 minutes
    const cutoff = Date.now() - 10 * 60_000;
    for (const [id, t] of viewed) {
        if (t < cutoff) { viewed.delete(id); checked.delete(id); continue; }
        queue.add(id);
    }
    if (queue.size) flush();
}

function formatDuration(ms: number) {
    const m = Math.max(1, Math.floor(ms / 60_000));
    if (m < 60) return `${m}m`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ${m % 60}m`;
    const d = Math.floor(h / 24);
    return `${d}d ${h % 24}h`;
}

function useOnlineSince(userId: string) {
    const [, rerender] = useState(0);
    useEffect(() => {
        const l = () => rerender(n => n + 1);
        listeners.add(l);
        const tick = setInterval(l, 30_000); // keep the timer moving
        return () => { listeners.delete(l); clearInterval(tick); };
    }, []);
    useEffect(() => { want(userId); }, [userId]);
    return online[userId];
}

// "Using Ghostcord · for 1h 23m" line, shown in every profile view.
function GhostcordLine({ userId }: { userId?: string; }) {
    const since = useOnlineSince(userId ?? "");
    if (!userId || !since) return null;
    return (
        <div className="gc-presence-wrap">
            <div className="gc-presence" title="This user is using Ghostcord right now">
                <img src={GHOSTCORD_LOGO} className="gc-presence-logo" alt="" />
                <span className="gc-presence-text">Using <b>Ghostcord</b></span>
                <span className="gc-presence-dot" />
                <span className="gc-presence-time">for {formatDuration(Date.now() - since)}</span>
            </div>
        </div>
    );
}

export default definePlugin({
    name: "GhostcordPresence",
    description: "Shows 'Using Ghostcord' and how long on the profiles of people who are on Ghostcord right now.",
    authors: [{ name: "offxy", id: 1402331570525835275n }],
    required: true,
    dependencies: ["ProfileCollectionsAPI", "ProfileSectionsAPI"],
    // message / member-list popouts, your own account panel popout, DM sidebar
    renderProfileCollection: {
        render: (props: any) => <GhostcordLine userId={props?.user?.id ?? props?.userId} />,
        priority: 100,
    },
    // full profile window (the DM sidebar is already covered above)
    renderProfileSection: {
        render: ({ userId, isSideBar }) => isSideBar ? null : <GhostcordLine userId={userId} />,
        priority: 100,
    },
    flux: {
        CONNECTION_OPEN() { ping(); }
    },
    async start() {
        await ping();
        await loadOnline();
        pingTimer = setInterval(ping, 2 * 60_000);
        listTimer = setInterval(loadOnline, 60_000);
    },
    stop() {
        clearInterval(pingTimer);
        clearInterval(listTimer);
    },
});
