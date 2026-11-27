/*
 * Ghostcord — PlatformSpoofer: show up as online from mobile, web, console, VR etc. instead of desktop.
 * Changes apply on the next connect, so press Ctrl+R after switching.
 */

import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType } from "@utils/types";
import { findStoreLazy } from "@webpack";

import { confirmGc } from "../_gc";
import { GC_AUTHOR } from "../_gc/voice";

const GatewayStore = findStoreLazy("GatewayConnectionStore");

const PLATFORMS = {
    desktop: { browser: "Discord Client", os: "Windows", device: "" },
    web: { browser: "Chrome", os: "Windows", device: "" },
    android: { browser: "Discord Android", os: "Android", device: "Pixel 8" },
    ios: { browser: "Discord iOS", os: "iOS", device: "iPhone15,2" },
    xbox: { browser: "Discord Embedded", os: "Xbox", device: "Xbox Series X" },
    playstation: { browser: "Discord Embedded", os: "PlayStation", device: "PS5" },
    vr: { browser: "Discord VR", os: "Android", device: "Quest 3" }
} as const;

const settings = definePluginSettings({
    platform: {
        type: OptionType.SELECT,
        description: "Platform to show up as (press Ctrl+R after changing)",
        options: [
            { label: "Mobile (Android)", value: "android", default: true },
            { label: "Mobile (iPhone)", value: "ios" },
            { label: "Web browser", value: "web" },
            { label: "Xbox", value: "xbox" },
            { label: "PlayStation", value: "playstation" },
            { label: "VR", value: "vr" },
            { label: "Desktop (normal)", value: "desktop" }
        ],
        onChange: async () => {
            if (await confirmGc("Reload to apply?", "Discord needs to reconnect for the new platform to show up.", "Reload now", false)) location.reload();
        }
    }
});

let socket: any;
let originalSend: ((...a: any[]) => any) | undefined;

function hook() {
    socket = GatewayStore.getSocket?.();
    if (!socket || originalSend) return;
    originalSend = socket.send;
    socket.send = function (op: number, data: any, ...rest: any[]) {
        if (op === 2 && data?.properties) {
            const p = PLATFORMS[settings.store.platform as keyof typeof PLATFORMS] ?? PLATFORMS.desktop;
            data = { ...data, properties: { ...data.properties, browser: p.browser, os: p.os, device: p.device } };
        }
        return originalSend!.call(this, op, data, ...rest);
    };
}

export default definePlugin({
    name: "PlatformSpoofer",
    description: "Show up as online from mobile, web, Xbox, PlayStation or VR instead of desktop.",
    authors: [GC_AUTHOR],
    settings,
    start() { hook(); },
    stop() {
        if (socket && originalSend) socket.send = originalSend;
        originalSend = undefined;
    }
});
