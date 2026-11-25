/*
 * Ghostcord — shows "Using Ghostcord · for 1h 23m" on profiles of people on Ghostcord right now.
 */

import "./styles.css";

import { addProfileBadge, BadgePosition, ProfileBadge, removeProfileBadge } from "@api/Badges";
import { GHOSTCORD_LOGO } from "@shared/ghostcordLogo";
import { Logger } from "@utils/Logger";
import definePlugin from "@utils/types";
import { React, Tooltip, UserStore, useEffect, useState } from "@webpack/common";

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

function useOnlineSince(userId: string) {
    const [, rerender] = useState(0);
    useEffect(() => {
        const l = () => rerender(n => n + 1);
        listeners.add(l);
        const tick = setInterval(l, 30_000); // keep the timer moving
        return () => { listeners.delete(l); clearInterval(tick); };
    }, []);
    return online[userId];
}

// Rendered in the badge row, which exists in every profile view (popouts, own panel, full profile, sidebar).
function GhostcordPill({ userId }: { userId: string; }) {
    const since = useOnlineSince(userId);
    if (!since) return null;
    const time = formatDuration(Date.now() - since);
    return (
        <Tooltip text={`Using Ghostcord for ${time}`}>
            {props => (
                <span {...props} className="gc-presence">
                    <img src={GHOSTCORD_LOGO} className="gc-presence-logo" alt="" />
                    <span className="gc-presence-text"><b>Ghostcord</b></span>
                    <span className="gc-presence-dot" />
                    <span className="gc-presence-time">{time}</span>
                </span>
            )}
        </Tooltip>
    );
}

const badge: ProfileBadge = {
    id: "ghostcord_presence",
    key: "ghostcord_presence",
    description: "Using Ghostcord",
    position: BadgePosition.START,
    shouldShow: ({ userId }) => !!userId && !!online[userId],
    component: ({ userId }) => <GhostcordPill userId={userId} />,
};

export default definePlugin({
    name: "GhostcordPresence",
    description: "Shows 'Using Ghostcord' and how long on the profiles of people who are on Ghostcord right now.",
    authors: [{ name: "offxy", id: 1402331570525835275n }],
    required: true,
    dependencies: ["BadgeAPI"],
    flux: {
        CONNECTION_OPEN() { ping(); }
    },
    async start() {
        addProfileBadge(badge);
        await ping();
        await loadOnline();
        pingTimer = setInterval(ping, 2 * 60_000);
        listTimer = setInterval(loadOnline, 60_000);
    },
    stop() {
        removeProfileBadge(badge);
        clearInterval(pingTimer);
        clearInterval(listTimer);
    },
});
