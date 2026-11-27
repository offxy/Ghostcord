/*
 * Ghostcord — AutoJoin: joins your saved voice channel when Discord starts.
 * Right-click any voice channel → "Set as Auto Join".
 */

import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType } from "@utils/types";
import { ChannelStore, Menu } from "@webpack/common";

import { sleep, toast } from "../_gc";
import { currentVoice, GC_AUTHOR, joinVoice } from "../_gc/voice";

const settings = definePluginSettings({
    channelId: { type: OptionType.STRING, description: "Voice channel ID to join on startup (or right-click a voice channel)", default: "" },
    delay: { type: OptionType.SLIDER, description: "Seconds to wait after startup", markers: [2, 5, 10, 20, 30], default: 5, stickToMarkers: false }
});

const channelMenu: NavContextMenuPatchCallback = (children, { channel }) => {
    if (!channel || ![2, 13].includes(channel.type)) return;
    const saved = settings.store.channelId === channel.id;
    children.push(
        <Menu.MenuGroup>
            <Menu.MenuItem
                id="gc-autojoin"
                label={saved ? "Remove Auto Join" : "Set as Auto Join"}
                action={() => {
                    settings.store.channelId = saved ? "" : channel.id;
                    toast(saved ? "Auto Join removed" : `Auto Join set to #${channel.name}`, "success");
                }}
            />
        </Menu.MenuGroup>
    );
};

export default definePlugin({
    name: "AutoJoin",
    description: "Joins your saved voice channel automatically when Discord starts.",
    authors: [GC_AUTHOR],
    settings,
    contextMenus: { "channel-context": channelMenu },
    async start() {
        const id = settings.store.channelId.trim();
        if (!id) return;
        await sleep(settings.store.delay * 1000);
        for (let i = 0; i < 20 && !ChannelStore.getChannel(id); i++) await sleep(1000);
        const ch = ChannelStore.getChannel(id);
        if (!ch) return toast("Auto Join: channel not found", "error");
        if (currentVoice() === id) return;
        joinVoice(id);
        toast(`Auto joined #${ch.name}`, "success");
    }
});
