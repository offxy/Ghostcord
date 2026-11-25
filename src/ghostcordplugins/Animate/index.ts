/*
 * Vencord, a modification for Discord's desktop app
 * Copyright (c) 2023 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { getUserSettingLazy } from "@api/UserSettings";
import { Devs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";

const GifAutoPlay = getUserSettingLazy<boolean>("textAndImages", "gifAutoPlay")!;

const settings = definePluginSettings({
    icons: { type: OptionType.BOOLEAN, description: "Always animate server icons, avatars, decor and more", default: true },
    statusEmojis: { type: OptionType.BOOLEAN, description: "Always animate status emojis", default: true },
    serverBanners: { type: OptionType.BOOLEAN, description: "Always animate server banners", default: true },
    nameplates: { type: OptionType.BOOLEAN, description: "Always animate nameplates", default: true },
    roleGradients: { type: OptionType.BOOLEAN, description: "Always animate role gradients", default: true },
    gifs: {
        type: OptionType.BOOLEAN,
        description: "Always animate GIFs in messages/embeds (no 'GIF' badge, no hover needed, even when Discord is unfocused)",
        default: true,
        restartNeeded: true
    }
});

// ---- GIF forcing ----
const STYLE_ID = "vc-always-animate-gifs";
let observer: MutationObserver | null = null;
let prevAutoPlay: boolean | undefined;

function fixUrl(url: string): string | null {
    if (!url) return null;
    let u: URL;
    try { u = new URL(url, location.href); } catch { return null; }
    if (!/(media|cdn)\.discordapp\.(net|com)$/.test(u.hostname)) return null;

    const path = u.pathname.toLowerCase();
    const looksAnimated =
        path.endsWith(".gif") ||
        u.searchParams.get("animated") === "false" ||
        /\/(avatars|icons|banners|emojis|avatar-decoration-presets)\/.*a_/.test(path);
    if (!looksAnimated) return null;

    let changed = false;
    if (u.searchParams.get("animated") !== "true") {
        u.searchParams.set("animated", "true");
        changed = true;
    }
    // static .png/.webp render of a gif attachment -> ask for an animated webp
    if (path.endsWith(".gif") && u.searchParams.get("format") === "png") {
        u.searchParams.set("format", "webp");
        changed = true;
    }
    return changed ? u.toString() : null;
}

function fixImg(img: HTMLImageElement) {
    const fixed = fixUrl(img.getAttribute("src") ?? "");
    if (fixed) img.setAttribute("src", fixed);
    const ss = img.getAttribute("srcset");
    if (ss) {
        const newSs = ss.split(",").map(part => {
            const [url, ...rest] = part.trim().split(/\s+/);
            return [fixUrl(url) ?? url, ...rest].join(" ");
        }).join(", ");
        if (newSs !== ss) img.setAttribute("srcset", newSs);
    }
}

function fixVideo(v: HTMLVideoElement) {
    // Discord renders "gifv" (tenor/giphy/converted gifs) as muted looping videos and pauses them
    if (v.loop && v.muted && v.paused) {
        v.autoplay = true;
        v.play().catch(() => { });
    }
}

function scan(root: ParentNode) {
    root.querySelectorAll?.("img").forEach(fixImg);
    root.querySelectorAll?.("video").forEach(fixVideo);
}

function startGifs() {
    prevAutoPlay = GifAutoPlay.getSetting();
    if (!prevAutoPlay) GifAutoPlay.updateSetting(true);

    const style = document.createElement("style");
    style.id = STYLE_ID;
    // hide the "GIF" badge overlays Discord puts on paused gifs
    style.textContent = `
        [class*="gifTag"], [class*="imageAccessory"] [class*="gif"] { display: none !important; }
    `;
    document.head.appendChild(style);

    scan(document);
    observer = new MutationObserver(muts => {
        for (const m of muts) {
            if (m.type === "attributes") {
                const t = m.target as Element;
                if (t instanceof HTMLImageElement) fixImg(t);
                else if (t instanceof HTMLVideoElement) fixVideo(t);
                continue;
            }
            m.addedNodes.forEach(n => {
                if (n instanceof HTMLImageElement) fixImg(n);
                else if (n instanceof HTMLVideoElement) fixVideo(n);
                else if (n instanceof Element) scan(n);
            });
        }
    });
    observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["src", "srcset"]
    });

    // Discord pauses gifv videos on blur — resume them
    document.addEventListener("pause", onPause, true);
}

function onPause(e: Event) {
    const v = e.target;
    if (v instanceof HTMLVideoElement && v.loop && v.muted) setTimeout(() => v.play().catch(() => { }), 0);
}

function stopGifs() {
    observer?.disconnect();
    observer = null;
    document.getElementById(STYLE_ID)?.remove();
    document.removeEventListener("pause", onPause, true);
    if (prevAutoPlay === false) GifAutoPlay.updateSetting(false);
}

export default definePlugin({
    name: "AlwaysAnimatePlus",
    description: "Animates anything that can be animated — including GIFs in messages and embeds",
    tags: ["Appearance", "Fun"],
    authors: [Devs.FieryFlames],
    settings,

    start() {
        if (settings.store.gifs) startGifs();
    },
    stop() {
        stopGifs();
    },

    patches: [
        {
            find: "canAnimate:",
            predicate: () => settings.store.icons,
            all: true,
            noWarn: true,
            replacement: {
                match: /canAnimate:.+?([,}].*?\))/g,
                replace: (m, rest) => {
                    const destructuringMatch = rest.match(/}=.+/);
                    if (destructuringMatch == null) return `canAnimate:!0${rest}`;
                    return m;
                }
            }
        },
        {
            // Status emojis
            find: "#{intl::GUILD_OWNER}),children:",
            predicate: () => settings.store.statusEmojis,
            replacement: {
                match: /(\.CUSTOM_STATUS.+?animateEmoji:)\i/,
                replace: "$1!0"
            }
        },
        {
            // Guild Banner
            find: "#{intl::DISCOVERABLE_GUILD_HEADER_PUBLIC_INFO}",
            predicate: () => settings.store.serverBanners,
            replacement: {
                match: /(guildBanner:\i,animate:)\i(?=}\):null)/,
                replace: "$1!0"
            }
        },
        {
            // Gradient roles in chat
            find: "=!1,contentOnly:",
            replacement: {
                match: /animate:\i/,
                replace: "animate:!0"
            }
        },
        {
            // Gradient roles in member list
            find: ".roleStyle);",
            replacement: {
                match: /,animateGradient:/,
                replace: ",animateGradient:!0,_oldAnimateGradient:"
            }
        },
        {
            // Nameplates
            find: ".MINI_PREVIEW,[",
            predicate: () => settings.store.nameplates,
            replacement: {
                match: /animate:\i,loop:(?=!0===)/,
                replace: "animate:true,loop:true,_loop:"
            },
        },
        {
            // Role Gradients
            find: "animateGradient:",
            predicate: () => settings.store.roleGradients,
            all: true,
            noWarn: true,
            replacement: {
                match: /animateGradient:.+?([,}].*?\))/g,
                replace: (m, rest) => {
                    const destructuringMatch = rest.match(/}=.+/);
                    if (destructuringMatch == null) return `animateGradient:!0${rest}`;
                    return m;
                }
            }
        },
        {
            // Message/embed GIFs: Discord only plays them when autoplay is on AND the window is focused
            // (otherwise shows the static frame + "GIF" badge until hover). Force "should animate".
            find: "#{intl::GIF}",
            predicate: () => settings.store.gifs,
            all: true,
            noWarn: true,
            replacement: [
                {
                    match: /\bautoPlay:\i(?=[,}])/g,
                    replace: "autoPlay:!0"
                },
                {
                    match: /\bshouldAnimate:\i(?=[,}])/g,
                    replace: "shouldAnimate:!0"
                }
            ]
        },
    ]
});
