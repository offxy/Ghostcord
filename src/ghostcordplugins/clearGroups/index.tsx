/*
 * Ghostcord — ClearGroups: pick group DMs from a list and leave them all, silently.
 */

import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType } from "@utils/types";
import { ChannelStore, IconUtils, React, RestAPI, UserStore } from "@webpack/common";

import { GcBulkPicker, openGc } from "../_gc";
import { GC_AUTHOR } from "../_gc/voice";

const settings = definePluginSettings({
    delay: { type: OptionType.SLIDER, description: "Delay between leaves (ms)", markers: [500, 1000, 2000, 3000, 5000], default: 1500, stickToMarkers: false },
    open: { type: OptionType.COMPONENT, description: "", component: () => <button className="gc-btn gc-btn-danger" onClick={openPicker}>Choose groups to leave</button> }
});

export function groupName(c: any) {
    if (c.name) return c.name;
    const names = (c.recipients ?? []).map((id: string) => UserStore.getUser(id)?.username).filter(Boolean);
    return names.length ? names.join(", ") : "Unnamed group";
}

export function openPicker() {
    const items = ChannelStore.getSortedPrivateChannels()
        .filter(c => c.type === 3)
        .map(c => ({
            id: c.id,
            name: groupName(c),
            sub: `${(c.recipients?.length ?? 0) + 1} members`,
            icon: IconUtils.getChannelIconURL?.({ id: c.id, icon: c.icon ?? undefined, size: 64 })
        }));
    openGc(close => (
        <GcBulkPicker title="Leave group DMs" subtitle={`You're in ${items.length} groups — leaves are silent`} items={items} verb="Leave"
            delay={settings.store.delay} onClose={close}
            action={id => RestAPI.del({ url: `/channels/${id}`, query: { silent: true } }) as any} />
    ));
}

export default definePlugin({
    name: "ClearGroups",
    description: "Leave lots of group DMs at once, without the 'left the group' message.",
    authors: [GC_AUTHOR],
    settings,
    toolboxActions: { "Leave group DMs…": openPicker }
});
