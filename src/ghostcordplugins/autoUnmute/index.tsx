/*
 * Ghostcord — AutoUnmute: undeafens and unmutes you every time you join a voice channel.
 */

import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType } from "@utils/types";

import { toast } from "../_gc";
import { GC_AUTHOR, isDeafened, isMuted, onSelfJoin, setDeafened, setMuted } from "../_gc/voice";

const settings = definePluginSettings({
    notify: { type: OptionType.BOOLEAN, description: "Show a toast when it kicks in", default: true }
});

let off: (() => void) | undefined;

export default definePlugin({
    name: "AutoUnmute",
    description: "Unmutes and undeafens you automatically when you join a voice channel. Don't use with AutoMute.",
    authors: [GC_AUTHOR],
    settings,
    start() {
        off = onSelfJoin(() => {
            if (!isMuted() && !isDeafened()) return;
            setDeafened(false);
            setMuted(false);
            if (settings.store.notify) toast("Unmuted for you", "success");
        });
    },
    stop() { off?.(); }
});
