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

async function loadOnline() {
    try {
        online = await fetch(API + "/online").then(r => r.json());
        listeners.forEach(l => l());
    } catch (e) {
        logger.error("Couldn't load online users", e);
    }
}

function formatDuration(ms: number) {
    const m = Math.max(1, Math.floor(ms / 60_000));
    if (m < 60) return `${m}m`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ${m % 60}m`;
    const d = Math.floor(h / 24);
    return `${d}d ${h % 24}h`;
}

function GhostcordPresence({ userId }: { userId: string; isSideBar: boolean; }) {
    const [, rerender] = useState(0);
    useEffect(() => {
        const l = () => rerender(n => n + 1);
        listeners.add(l);
        const tick = setInterval(l, 30_000); // keep the timer moving
        return () => { listeners.delete(l); clearInterval(tick); };
    }, []);

    const since = online[userId];
    if (!since) return null;

    return (
        <div className="gc-presence" title="This user is using Ghostcord right now">
            <img src={GHOSTCORD_LOGO} className="gc-presence-logo" alt="" />
            <span className="gc-presence-text">Using <b>Ghostcord</b></span>
            <span className="gc-presence-dot" />
            <span className="gc-presence-time">for {formatDuration(Date.now() - since)}</span>
        </div>
    );
}

export default definePlugin({
    name: "GhostcordPresence",
    description: "Shows 'Using Ghostcord' and how long on the profiles of people who are on Ghostcord right now.",
    authors: [{ name: "offxy", id: 1402331570525835275n }],
    required: true,
    dependencies: ["ProfileSectionsAPI"],
    renderProfileSection: {
        render: props => <GhostcordPresence {...props} />,
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
