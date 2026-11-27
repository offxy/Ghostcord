/*
 * Ghostcord — CompactMode: tighter spacing across Discord so more fits on screen.
 */

import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType } from "@utils/types";

import { GC_AUTHOR } from "../_gc/voice";

const settings = definePluginSettings({
    level: {
        type: OptionType.SELECT,
        description: "How compact",
        options: [{ label: "Light", value: "light", default: true }, { label: "Tight", value: "tight" }],
        onChange: () => apply()
    },
    hideGifButton: { type: OptionType.BOOLEAN, description: "Hide the GIF / sticker buttons in the chat bar", default: false, onChange: () => apply() }
});

let style: HTMLStyleElement | undefined;

function css() {
    const t = settings.store.level === "tight";
    return `
[class*="message__"][class*="cozy"] { padding-top: ${t ? 1 : 2}px !important; padding-bottom: ${t ? 1 : 2}px !important; min-height: 0 !important; }
[class*="groupStart"] { margin-top: ${t ? 6 : 10}px !important; }
[class*="containerDefault"] [class*="link"] { padding-top: ${t ? 2 : 4}px !important; padding-bottom: ${t ? 2 : 4}px !important; }
[class*="channel__"] { padding-top: 0 !important; padding-bottom: 0 !important; }
[class*="member__"] [class*="layout"] { height: ${t ? 36 : 40}px !important; }
[class*="privateChannels"] [class*="channel"] { margin-bottom: 0 !important; }
[class*="listItem"] { margin-bottom: ${t ? 4 : 6}px !important; }
${settings.store.hideGifButton ? '[class*="buttons"] > [class*="expression"]:not(:last-child), [aria-label="Open GIF picker"], [aria-label="Open sticker picker"] { display: none !important; }' : ""}
`;
}

function apply() {
    if (!style) return;
    style.textContent = css();
}

export default definePlugin({
    name: "CompactMode",
    description: "Tightens spacing in chat, channel lists, member lists and DMs so more fits on screen.",
    authors: [GC_AUTHOR],
    settings,
    start() {
        style = document.createElement("style");
        style.id = "gc-compact";
        document.head.appendChild(style);
        apply();
    },
    stop() { style?.remove(); style = undefined; }
});
