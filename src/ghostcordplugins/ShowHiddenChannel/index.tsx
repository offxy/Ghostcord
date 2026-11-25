/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ShowHiddenChannelsPlus — companion restyle for Equicord's ShowHiddenChannels.
 * Keeps the original plugin's patches (they stay up to date with Discord) and
 * re-skins its lock screen + hidden channel rows. Requires ShowHiddenChannels enabled.
 */

import { definePluginSettings } from "@api/Settings";
import { EquicordDevs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";

const settings = definePluginSettings({
    accent: {
        type: OptionType.SELECT,
        description: "Accent color for hidden channels",
        options: [
            { label: "Red", value: "var(--status-danger, #f23f43)", default: true },
            { label: "Blurple", value: "var(--brand-500, #5865f2)" },
            { label: "Yellow", value: "var(--status-warning, #f0b232)" },
            { label: "Grey", value: "var(--text-muted, #949ba4)" }
        ],
        onChange: () => applyStyle()
    },
    dimHiddenRows: {
        type: OptionType.BOOLEAN,
        description: "Fade hidden channels in the sidebar (full opacity on hover)",
        default: true,
        onChange: () => applyStyle()
    },
    stripeHiddenRows: {
        type: OptionType.BOOLEAN,
        description: "Add a colored accent stripe to hidden channels in the sidebar",
        default: true,
        onChange: () => applyStyle()
    },
    glassLockScreen: {
        type: OptionType.BOOLEAN,
        description: "Card/glass style for the lock screen (off = flat)",
        default: true,
        onChange: () => applyStyle()
    }
});

// Attribute selectors so this works whether the classes are "shc-…" or "vc-shc-…".
const S = (name: string) => `[class*="shc-${name}"]`;

function buildCss() {
    const { accent, dimHiddenRows, stripeHiddenRows, glassLockScreen } = settings.store;

    return `
:root { --shcp-accent: ${accent}; }

/* ---------- lock screen ---------- */
${S("lock-screen-outer-container")} {
    display: flex; align-items: center; justify-content: center;
    height: 100%; overflow-y: auto; padding: 32px 16px;
    background:
        radial-gradient(1200px 500px at 50% -10%, color-mix(in srgb, var(--shcp-accent) 14%, transparent), transparent 70%),
        var(--background-primary);
}

${S("lock-screen-container")} {
    width: min(640px, 100%);
    display: flex; flex-direction: column; align-items: stretch; gap: 14px;
    padding: 28px;
    border-radius: 16px;
    text-align: left;
    ${glassLockScreen ? `
    background: color-mix(in srgb, var(--background-secondary) 82%, transparent);
    backdrop-filter: blur(12px);
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--shcp-accent) 25%, transparent),
                0 20px 50px -20px rgba(0,0,0,.55);` : `
    background: var(--background-secondary);
    border: 1px solid var(--background-modifier-accent);`}
    animation: shcp-in .28s cubic-bezier(.2,.8,.2,1);
}
@keyframes shcp-in { from { opacity: 0; transform: translateY(8px) scale(.985); } }

/* big lock logo -> accent tile */
${S("lock-screen-logo")} {
    align-self: center;
    width: 72px !important; height: 72px !important;
    padding: 16px; border-radius: 20px;
    color: var(--shcp-accent) !important;
    background: color-mix(in srgb, var(--shcp-accent) 14%, transparent);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--shcp-accent) 30%, transparent);
    margin-bottom: 4px;
}
${S("lock-screen-logo")} path { fill: currentColor; }

${S("lock-screen-heading-container")} {
    display: flex; align-items: center; justify-content: center; gap: 8px;
    text-align: center;
}
${S("lock-screen-heading-container")} h1,
${S("lock-screen-heading-container")} h2,
${S("lock-screen-container")} > h2:first-of-type {
    font-size: 20px; font-weight: 800; color: var(--header-primary);
}

/* every info line becomes a row in a list */
${S("lock-screen-container")} > div:not(${S("lock-screen-heading-container")}):not(${S("lock-screen-allowed-users-and-roles-container")}),
${S("lock-screen-container")} > h3,
${S("lock-screen-container")} > p {
    margin: 0;
    padding: 10px 12px;
    border-radius: 10px;
    background: var(--background-tertiary, rgba(0,0,0,.15));
    color: var(--text-normal);
    font-size: 14px;
}

${S("lock-screen-topic-container")} {
    border-left: 3px solid var(--shcp-accent);
    max-height: 160px; overflow-y: auto;
}

/* tags */
${S("lock-screen-tags-container")} { display: flex; flex-wrap: wrap; gap: 6px; }
${S("lock-screen-tags-container")} > div {
    padding: 3px 10px; border-radius: 999px; font-size: 12px; font-weight: 600;
    background: var(--background-modifier-accent);
}

/* allowed users & roles */
${S("lock-screen-allowed-users-and-roles-container")} {
    display: flex; flex-direction: column; gap: 8px;
    padding: 12px; border-radius: 12px;
    background: var(--background-tertiary, rgba(0,0,0,.15));
    border: 1px solid var(--background-modifier-accent);
}
${S("lock-screen-allowed-users-and-roles-container")} button {
    border-radius: 8px !important;
    transition: background .15s ease, transform .15s ease;
}
${S("lock-screen-allowed-users-and-roles-container")} button:hover { transform: translateY(-1px); }

/* role pills a bit rounder */
${S("lock-screen-allowed-users-and-roles-container")} [class*="role"] { border-radius: 999px !important; }

/* ---------- sidebar hidden channel rows ---------- */
${S("hidden-channel-icon")} {
    color: var(--shcp-accent) !important;
    opacity: .9;
    transition: transform .15s ease, opacity .15s ease;
}
${S("hidden-channel-icon")} path { fill: currentColor; }

${dimHiddenRows ? `
[class*="containerDefault"]:has(${S("hidden-channel-icon")}) { opacity: .55; transition: opacity .15s ease; }
[class*="containerDefault"]:has(${S("hidden-channel-icon")}):hover { opacity: 1; }
[class*="containerDefault"]:has(${S("hidden-channel-icon")}):hover ${S("hidden-channel-icon")} { transform: scale(1.12); opacity: 1; }
` : ""}

${stripeHiddenRows ? `
[class*="containerDefault"]:has(${S("hidden-channel-icon")}) [class*="link"] {
    box-shadow: inset 2px 0 0 var(--shcp-accent);
    background: linear-gradient(90deg, color-mix(in srgb, var(--shcp-accent) 10%, transparent), transparent 60%);
}
` : ""}
`;
}

let styleEl: HTMLStyleElement | null = null;

function applyStyle() {
    if (!styleEl) return;
    styleEl.textContent = buildCss();
}

export default definePlugin({
    name: "ShowHiddenChannelsPlus",
    description: "New look for ShowHiddenChannels: card-style lock screen, accent colors and highlighted hidden channels",
    tags: ["Appearance", "Channels"],
    authors: [EquicordDevs.omaw],
    dependencies: ["ShowHiddenChannels"],
    settings,

    start() {
        styleEl = document.createElement("style");
        styleEl.id = "vc-shcp-style";
        document.head.appendChild(styleEl);
        applyStyle();
    },

    stop() {
        styleEl?.remove();
        styleEl = null;
    }
});
