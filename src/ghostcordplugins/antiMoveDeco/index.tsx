/*
 * Ghostcord — AntiMoveDeco: if someone moves or disconnects you from voice, you go straight back.
 */

import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType } from "@utils/types";
import { ChannelStore, FluxDispatcher, UserStore } from "@webpack/common";

import { toast } from "../_gc";
import { currentVoice, GC_AUTHOR, joinVoice } from "../_gc/voice";

const settings = definePluginSettings({
    antiMove: { type: OptionType.BOOLEAN, description: "Move back when someone drags you to another channel", default: true },
    antiDisconnect: { type: OptionType.BOOLEAN, description: "Rejoin when someone disconnects you", default: true },
    notify: { type: OptionType.BOOLEAN, description: "Show a toast when it happens", default: true }
});

let wanted: string | null = null; // the channel *you* chose
let lastBounce = 0;

function onSelect({ channelId }: { channelId: string | null; }) { wanted = channelId ?? null; }

function onStates({ voiceStates }: { voiceStates: { userId: string; channelId?: string | null; }[]; }) {
    const me = UserStore.getCurrentUser()?.id;
    const mine = voiceStates?.find(s => s.userId === me);
    if (!mine || !wanted) return;
    const now = mine.channelId ?? null;
    if (now === wanted) return;
    if (Date.now() - lastBounce < 3000) return; // don't fight forever

    const moved = now !== null;
    if (moved ? !settings.store.antiMove : !settings.store.antiDisconnect) return;
    if (!ChannelStore.getChannel(wanted)) return;

    lastBounce = Date.now();
    const target = wanted;
    setTimeout(() => {
        joinVoice(target);
        wanted = target;
        if (settings.store.notify) toast(moved ? "Someone moved you — moved back" : "Someone disconnected you — rejoined", "success");
    }, 300);
}

export default definePlugin({
    name: "AntiMoveDeco",
    description: "Puts you back in your voice channel if someone moves or disconnects you.",
    authors: [GC_AUTHOR],
    settings,
    start() {
        wanted = currentVoice();
        FluxDispatcher.subscribe("VOICE_CHANNEL_SELECT", onSelect as any);
        FluxDispatcher.subscribe("VOICE_STATE_UPDATES", onStates as any);
    },
    stop() {
        FluxDispatcher.unsubscribe("VOICE_CHANNEL_SELECT", onSelect as any);
        FluxDispatcher.unsubscribe("VOICE_STATE_UPDATES", onStates as any);
    }
});
