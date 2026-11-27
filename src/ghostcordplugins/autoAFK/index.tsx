/*
 * Ghostcord — AutoAFK: goes Idle (and optionally deafens) after you stop using your PC, then puts everything back.
 */

import { definePluginSettings } from "@api/Settings";
import { getUserSettingLazy } from "@api/UserSettings";
import definePlugin, { OptionType } from "@utils/types";

import { toast } from "../_gc";
import { currentVoice, GC_AUTHOR, isDeafened, setDeafened } from "../_gc/voice";

const StatusSetting = getUserSettingLazy<string>("status", "status");

const settings = definePluginSettings({
    minutes: { type: OptionType.SLIDER, description: "Minutes without activity before going AFK", markers: [1, 3, 5, 10, 15, 30, 60], default: 10, stickToMarkers: false },
    deafen: { type: OptionType.BOOLEAN, description: "Deafen while AFK in voice", default: true },
    notify: { type: OptionType.BOOLEAN, description: "Show a toast when you come back", default: true }
});

let lastActive = Date.now();
let afk = false;
let prevStatus: string | undefined;
let didDeafen = false;
let timer: ReturnType<typeof setInterval> | undefined;
const EVENTS = ["mousemove", "mousedown", "keydown", "wheel", "touchstart"] as const;

function goAfk() {
    afk = true;
    prevStatus = StatusSetting?.getSetting();
    if (prevStatus === "online") StatusSetting?.updateSetting("idle");
    if (settings.store.deafen && currentVoice() && !isDeafened()) { setDeafened(true); didDeafen = true; }
}

function comeBack() {
    afk = false;
    if (prevStatus === "online" && StatusSetting?.getSetting() === "idle") StatusSetting.updateSetting("online");
    if (didDeafen) { setDeafened(false); didDeafen = false; }
    if (settings.store.notify) toast("Welcome back — AFK cleared", "success");
}

function activity() {
    lastActive = Date.now();
    if (afk) comeBack();
}

export default definePlugin({
    name: "AutoAFK",
    description: "Sets you to Idle and deafens you after a while without activity, and restores everything when you're back.",
    authors: [GC_AUTHOR],
    settings,
    start() {
        lastActive = Date.now();
        EVENTS.forEach(e => window.addEventListener(e, activity, { passive: true }));
        timer = setInterval(() => {
            if (!afk && Date.now() - lastActive > settings.store.minutes * 60_000) goAfk();
        }, 15_000);
    },
    stop() {
        EVENTS.forEach(e => window.removeEventListener(e, activity));
        clearInterval(timer);
        if (afk) comeBack();
    }
});
