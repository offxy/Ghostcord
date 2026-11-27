/*
 * Ghostcord — AutoMute: mutes (and optionally deafens) you every time you join a voice channel.
 */

import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType } from "@utils/types";

import { toast } from "../_gc";
import { GC_AUTHOR, onSelfJoin, setDeafened, setMuted } from "../_gc/voice";

const settings = definePluginSettings({
    deafen: { type: OptionType.BOOLEAN, description: "Also deafen when joining", default: false },
    notify: { type: OptionType.BOOLEAN, description: "Show a toast when it kicks in", default: true }
});

let off: (() => void) | undefined;

export default definePlugin({
    name: "AutoMute",
    description: "Mutes you automatically every time you join a voice channel.",
    authors: [GC_AUTHOR],
    settings,
    start() {
        off = onSelfJoin(() => {
            setMuted(true);
            if (settings.store.deafen) setDeafened(true);
            if (settings.store.notify) toast(settings.store.deafen ? "Joined muted & deafened" : "Joined muted");
        });
    },
    stop() { off?.(); }
});
