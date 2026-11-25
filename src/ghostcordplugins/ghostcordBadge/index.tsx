/*
 * Ghostcord — live ghost badge on people who are on Ghostcord right now.
 */

import { addProfileBadge, BadgePosition, ProfileBadge, removeProfileBadge } from "@api/Badges";
import { GHOSTCORD_LOGO } from "@shared/ghostcordLogo";
import definePlugin from "@utils/types";
import { UserStore } from "@webpack/common";

const API = "https://194-238-31-149.sslip.io/v1/users";
let users = new Set<string>();
let pingTimer: ReturnType<typeof setInterval> | undefined;
let listTimer: ReturnType<typeof setInterval> | undefined;

async function ping() {
    const id = UserStore.getCurrentUser()?.id;
    if (!id) return;
    users.add(id);
    try {
        await fetch(API + "/ping", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
    } catch { }
}

async function loadUsers() {
    try {
        const ids: string[] = await fetch(API).then(r => r.json());
        const me = UserStore.getCurrentUser()?.id;
        users = new Set(ids);
        if (me) users.add(me);
    } catch { }
}

const badge: ProfileBadge = {
    description: "On Ghostcord",
    iconSrc: GHOSTCORD_LOGO,
    position: BadgePosition.START,
    props: { style: { imageRendering: "pixelated", borderRadius: 4 } },
    shouldShow: ({ userId }) => users.has(userId),
};

export default definePlugin({
    name: "GhostcordBadge",
    description: "Shows a ghost badge on people who are using Ghostcord right now.",
    authors: [{ name: "offxy", id: 1402331570525835275n }],
    required: true,
    flux: {
        CONNECTION_OPEN() { ping(); }
    },
    async start() {
        addProfileBadge(badge);
        await ping();
        await loadUsers();
        pingTimer = setInterval(ping, 2 * 60_000);
        listTimer = setInterval(loadUsers, 60_000);
    },
    stop() {
        removeProfileBadge(badge);
        clearInterval(pingTimer);
        clearInterval(listTimer);
    },
});
