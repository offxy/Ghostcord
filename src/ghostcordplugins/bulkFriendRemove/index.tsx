/*
 * Ghostcord — BulkFriendRemove: pick friends from a list and remove them in one go.
 */

import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType } from "@utils/types";
import { IconUtils, React, RelationshipStore, RestAPI, UserStore } from "@webpack/common";

import { GcBulkPicker, openGc } from "../_gc";
import { GC_AUTHOR } from "../_gc/voice";

const settings = definePluginSettings({
    delay: { type: OptionType.SLIDER, description: "Delay between removals (ms)", markers: [500, 1000, 2000, 3000, 5000], default: 1500, stickToMarkers: false },
    open: { type: OptionType.COMPONENT, description: "", component: () => <button className="gc-btn gc-btn-danger" onClick={openPicker}>Choose friends to remove</button> }
});

export function openPicker() {
    const items = RelationshipStore.getFriendIDs()
        .map(id => UserStore.getUser(id))
        .filter(Boolean)
        .map(u => ({
            id: u.id,
            name: (u as any).globalName ?? u.username,
            sub: `@${u.username}`,
            icon: IconUtils.getUserAvatarURL(u, false, 64)
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
    openGc(close => (
        <GcBulkPicker title="Remove friends" subtitle={`You have ${items.length} friends`} items={items} verb="Remove"
            delay={settings.store.delay} onClose={close}
            action={id => RestAPI.del({ url: `/users/@me/relationships/${id}` }) as any} />
    ));
}

export default definePlugin({
    name: "BulkFriendRemove",
    description: "Remove lots of friends at once. Pick them from a searchable list.",
    authors: [GC_AUTHOR],
    settings,
    toolboxActions: { "Remove friends…": openPicker }
});
