/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * VoiceChatUtilsPlus — rewrite of Equicord's VoiceChatUtils.
 * Disable the original VoiceChatUtils before enabling this one.
 */

import { findGroupChildrenByChildId, NavContextMenuPatchCallback } from "@api/ContextMenu";
import { definePluginSettings } from "@api/Settings";
import { insertTextIntoChatInputBox } from "@utils/discord";
import definePlugin, { OptionType } from "@utils/types";
import { Channel } from "@vencord/discord-types";
import { Alerts, GuildChannelStore, Menu, PermissionsBits, PermissionStore, RestAPI, showToast, UserStore, VoiceStateStore } from "@webpack/common";

const settings = definePluginSettings({
    waitAfter: {
        type: OptionType.SLIDER,
        description: "Pause after this many requests",
        markers: [1, 3, 5, 7, 10, 15, 20],
        default: 5,
        stickToMarkers: true
    },
    waitSeconds: {
        type: OptionType.SLIDER,
        description: "Seconds to pause",
        markers: [0, 0.5, 1, 2, 3, 5],
        default: 1,
        stickToMarkers: true
    },
    includeSelf: {
        type: OptionType.BOOLEAN,
        description: "Include yourself in mute/deafen/disconnect actions (moves always include you)",
        default: false
    },
    confirmDestructive: {
        type: OptionType.BOOLEAN,
        description: "Ask for confirmation before disconnecting or moving everyone",
        default: true
    }
});

/* ---------------- helpers ---------------- */

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// One bulk action at a time per channel, so double-clicks don't double-fire.
const running = new Map<string, { cancelled: boolean; }>();

function getVoiceUserIds(channelId: string, includeSelf: boolean) {
    const me = UserStore.getCurrentUser()?.id;
    return Object.keys(VoiceStateStore.getVoiceStatesForChannel(channelId) ?? {})
        .filter(id => includeSelf || id !== me);
}

async function patchMember(guildId: string, userId: string, body: Record<string, any>, attempt = 0): Promise<boolean> {
    try {
        await RestAPI.patch({ url: `/guilds/${guildId}/members/${userId}`, body });
        return true;
    } catch (e: any) {
        // Respect Discord's rate limit instead of failing the whole batch.
        if (e?.status === 429 && attempt < 3) {
            const retry = Number(e?.body?.retry_after ?? 1);
            await sleep(Math.ceil(retry * 1000) + 100);
            return patchMember(guildId, userId, body, attempt + 1);
        }
        return false;
    }
}

async function bulk(channel: Channel, label: string, body: Record<string, any>, includeSelf = settings.store.includeSelf) {
    if (running.has(channel.id)) {
        running.get(channel.id)!.cancelled = true;
        showToast({ text: "Cancelled the running action", variant: "default" });
        return;
    }

    const ids = getVoiceUserIds(channel.id, includeSelf);
    if (!ids.length) return showToast({ text: "Nobody to apply that to", variant: "default" });

    const job = { cancelled: false };
    running.set(channel.id, job);

    const { waitAfter, waitSeconds } = settings.store;
    let ok = 0, failed = 0;

    showToast({ text: `${label}: ${ids.length} user${ids.length === 1 ? "" : "s"}…`, variant: "default" });

    try {
        for (let i = 0; i < ids.length; i++) {
            if (job.cancelled) break;
            (await patchMember(channel.guild_id, ids[i], body)) ? ok++ : failed++;
            if (waitSeconds > 0 && (i + 1) % waitAfter === 0 && i + 1 < ids.length) await sleep(waitSeconds * 1000);
        }
    } finally {
        running.delete(channel.id);
    }

    const msg = `${label}: ${ok} done${failed ? `, ${failed} failed` : ""}${job.cancelled ? " (cancelled)" : ""}`;
    showToast({ text: msg, variant: failed ? "critical" : "success" });
}

function confirm(title: string, body: string, onConfirm: () => void) {
    if (!settings.store.confirmDestructive) return onConfirm();
    Alerts.show({ title, body, confirmText: "Do it", cancelText: "Cancel", onConfirm });
}

function mentionAll(channel: Channel) {
    const ids = getVoiceUserIds(channel.id, false);
    if (!ids.length) return showToast({ text: "Nobody else is in this channel", variant: "default" });
    insertTextIntoChatInputBox(ids.map(id => `<@${id}>`).join(" ") + " ");
}

async function copyIds(channel: Channel) {
    const ids = getVoiceUserIds(channel.id, true);
    await navigator.clipboard.writeText(ids.join("\n"));
    showToast({ text: `Copied ${ids.length} user ID${ids.length === 1 ? "" : "s"}`, variant: "success" });
}

/* ---------------- menu ---------------- */

const can = (perm: bigint, channel: Channel) => PermissionStore.can(perm, channel);

function VoiceTools({ channel }: { channel: Channel; }) {
    const count = Object.keys(VoiceStateStore.getVoiceStatesForChannel(channel.id) ?? {}).length;
    const canMute = can(PermissionsBits.MUTE_MEMBERS, channel);
    const canDeaf = can(PermissionsBits.DEAFEN_MEMBERS, channel);
    const canMove = can(PermissionsBits.MOVE_MEMBERS, channel);
    const isRunning = running.has(channel.id);

    const targets = (GuildChannelStore.getChannels(channel.guild_id)?.VOCAL ?? [])
        .map((c: any) => c.channel as Channel)
        .filter(c => c.id !== channel.id && can(PermissionsBits.CONNECT, c));

    return (
        <Menu.MenuItem id="vcu-plus" label={`Voice Tools (${count})`}>
            {isRunning && (
                <Menu.MenuItem id="vcu-cancel" label="Cancel running action" color="danger" action={() => bulk(channel, "", {})} />
            )}

            <Menu.MenuGroup>
                <Menu.MenuItem id="vcu-mention" label="Mention everyone here" action={() => mentionAll(channel)} />
                <Menu.MenuItem id="vcu-copy" label="Copy user IDs" action={() => copyIds(channel)} />
            </Menu.MenuGroup>

            {(canMute || canDeaf) && (
                <Menu.MenuGroup>
                    {canMute && <Menu.MenuItem id="vcu-mute" label="Server mute all" action={() => bulk(channel, "Mute", { mute: true })} />}
                    {canMute && <Menu.MenuItem id="vcu-unmute" label="Unmute all" action={() => bulk(channel, "Unmute", { mute: false })} />}
                    {canDeaf && <Menu.MenuItem id="vcu-deaf" label="Server deafen all" action={() => bulk(channel, "Deafen", { deaf: true })} />}
                    {canDeaf && <Menu.MenuItem id="vcu-undeaf" label="Undeafen all" action={() => bulk(channel, "Undeafen", { deaf: false })} />}
                </Menu.MenuGroup>
            )}

            {canMove && (
                <Menu.MenuGroup>
                    <Menu.MenuItem id="vcu-move" label="Move everyone to…" disabled={!targets.length}>
                        {targets.map(t => (
                            <Menu.MenuItem
                                key={t.id}
                                id={`vcu-move-${t.id}`}
                                label={t.name}
                                action={() => confirm(
                                    "Move everyone?",
                                    `Move ${count} user${count === 1 ? "" : "s"} from #${channel.name} to #${t.name}?`,
                                    () => bulk(channel, `Move to #${t.name}`, { channel_id: t.id }, true)
                                )}
                            />
                        ))}
                    </Menu.MenuItem>
                    <Menu.MenuItem
                        id="vcu-disconnect"
                        label="Disconnect everyone"
                        color="danger"
                        action={() => confirm(
                            "Disconnect everyone?",
                            `Kick ${count} user${count === 1 ? "" : "s"} out of #${channel.name}?`,
                            () => bulk(channel, "Disconnect", { channel_id: null })
                        )}
                    />
                </Menu.MenuGroup>
            )}
        </Menu.MenuItem>
    );
}

const channelPatch: NavContextMenuPatchCallback = (children, { channel }: { channel?: Channel; }) => {
    if (!channel || (channel.type !== 2 && channel.type !== 13)) return;
    if (!Object.keys(VoiceStateStore.getVoiceStatesForChannel(channel.id) ?? {}).length) return;

    const group = findGroupChildrenByChildId(["mark-channel-read", "mute-channel"], children) ?? children;
    group.push(VoiceTools({ channel }));
};

export default definePlugin({
    name: "VoiceChatUtilsPlus",
    description: "Bulk voice tools: mute, deafen, move, disconnect, mention or copy everyone in a voice channel — permission-aware, rate-limit safe, cancellable",
    tags: ["Voice", "Utility"],
    authors: [{ name: "you", id: 0n }],
    settings,
    contextMenus: {
        "channel-context": channelPatch
    }
});
