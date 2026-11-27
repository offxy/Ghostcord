/*
 * Ghostcord — AudioLimiter: caps how loud in-app audio can get (videos, voice messages, soundboard previews, embeds)
 * and runs it through a limiter so sudden earrape gets squashed.
 */

import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType } from "@utils/types";

import { GC_AUTHOR } from "../_gc/voice";

const settings = definePluginSettings({
    maxVolume: { type: OptionType.SLIDER, description: "Max volume for in-app media (%)", markers: [10, 25, 50, 75, 100], default: 70, stickToMarkers: false },
    limiter: { type: OptionType.BOOLEAN, description: "Squash sudden loud spikes (compressor)", default: true },
    threshold: { type: OptionType.SLIDER, description: "Limiter threshold (dB) — lower = more squashing", markers: [-40, -30, -20, -10, 0], default: -18, stickToMarkers: false }
});

const desc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "volume")!;
let ctx: AudioContext | undefined;
const wired = new WeakSet<HTMLMediaElement>();

const cap = () => settings.store.maxVolume / 100;

function wire(el: HTMLMediaElement) {
    if (!settings.store.limiter || wired.has(el)) return;
    try {
        ctx ??= new AudioContext();
        const src = ctx.createMediaElementSource(el);
        const comp = ctx.createDynamicsCompressor();
        comp.threshold.value = settings.store.threshold;
        comp.knee.value = 6;
        comp.ratio.value = 20;
        comp.attack.value = 0.002;
        comp.release.value = 0.2;
        src.connect(comp).connect(ctx.destination);
        wired.add(el);
        if (ctx.state === "suspended") ctx.resume();
    } catch { /* cross-origin media without CORS can't be routed — the volume cap still applies */ wired.add(el); }
}

function onPlay(e: Event) {
    const el = e.target as HTMLMediaElement;
    if (!(el instanceof HTMLMediaElement)) return;
    if (desc.get!.call(el) > cap()) desc.set!.call(el, cap());
    wire(el);
}

export default definePlugin({
    name: "AudioLimiter",
    description: "Caps the volume of videos, voice messages and other in-app audio, and squashes sudden loud spikes.",
    authors: [GC_AUTHOR],
    settings,
    start() {
        Object.defineProperty(HTMLMediaElement.prototype, "volume", {
            configurable: true,
            get() { return desc.get!.call(this); },
            set(v: number) { desc.set!.call(this, Math.min(v, cap())); }
        });
        document.addEventListener("play", onPlay, true);
    },
    stop() {
        Object.defineProperty(HTMLMediaElement.prototype, "volume", desc);
        document.removeEventListener("play", onPlay, true);
    }
});
