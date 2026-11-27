/*
 * Ghostcord — LeaveAllServers: pick servers from a list and leave them in one go.
 */

import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType } from "@utils/types";
import { GuildStore, IconUtils, React, RestAPI, UserStore } from "@webpack/common";

import { GcBulkPicker, openGc } from "../_gc";
import { GC_AUTHOR } from "../_gc/voice";

const settings = definePluginSettings({
    delay: { type: OptionType.SLIDER, description: "Delay between leaves (ms)", markers: [500, 1000, 2000, 3000, 5000], default: 1500, stickToMarkers: false },
    open: { type: OptionType.COMPONENT, description: "", component: () => <button className="gc-btn gc-btn-danger" onClick={openPicker}>Choose servers to leave</button> }
});

export function openPicker() {
    const me = UserStore.getCurrentUser()?.id;
    const items = Object.values(GuildStore.getGuilds())
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(g => ({
            id: g.id,
            name: g.name,
            icon: IconUtils.getGuildIconURL({ id: g.id, icon: g.icon ?? undefined, size: 64 }),
            locked: g.ownerId === me ? "You own this server" : undefined
        }));
    openGc(close => (
        <GcBulkPicker title="Leave servers" subtitle={`You're in ${items.length} servers`} items={items} verb="Leave"
            delay={settings.store.delay} onClose={close}
            action={id => RestAPI.del({ url: `/users/@me/guilds/${id}`, body: { lurking: false } }) as any} />
    ));
}

export default definePlugin({
    name: "LeaveAllServers",
    description: "Leave lots of servers at once. Pick them from a list (servers you own are skipped).",
    authors: [GC_AUTHOR],
    settings,
    toolboxActions: { "Leave servers…": openPicker }
});
