/*
 * Ghostcord — Abbreviations: expands shortcuts like "brb" into full text when you send a message.
 */

import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType } from "@utils/types";

import { GC_AUTHOR } from "../_gc/voice";

const DEFAULTS = "brb=be right back\nidk=I don't know\nimo=in my opinion\nngl=not gonna lie\nomw=on my way\ntbh=to be honest\nty=thank you\nnp=no problem\nwyd=what are you doing\nhbu=how about you";

const settings = definePluginSettings({
    list: { type: OptionType.STRING, description: "One per line: short=full text", default: DEFAULTS, multiline: true } as any,
    caseSensitive: { type: OptionType.BOOLEAN, description: "Only expand exact-case matches", default: false }
});

function parse(): Map<string, string> {
    const map = new Map<string, string>();
    for (const line of String(settings.store.list).split(/\n|;/)) {
        const i = line.indexOf("=");
        if (i < 1) continue;
        const k = line.slice(0, i).trim(), v = line.slice(i + 1).trim();
        if (k && v) map.set(settings.store.caseSensitive ? k : k.toLowerCase(), v);
    }
    return map;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function expand(text: string) {
    const map = parse();
    if (!map.size) return text;
    const re = new RegExp(`(?<![\\w@:/])(${[...map.keys()].map(escape).join("|")})(?![\\w])`, settings.store.caseSensitive ? "g" : "gi");
    // leave code blocks and inline code alone
    return text.split(/(```[\s\S]*?```|`[^`]*`)/).map((part, i) =>
        i % 2 ? part : part.replace(re, m => map.get(settings.store.caseSensitive ? m : m.toLowerCase()) ?? m)
    ).join("");
}

export default definePlugin({
    name: "Abbreviations",
    description: "Expands your shortcuts (brb, idk, tbh…) into full text when you send. Edit the list in settings.",
    authors: [GC_AUTHOR],
    settings,
    onBeforeMessageSend(_, msg) {
        if (msg.content) msg.content = expand(msg.content);
    }
});
