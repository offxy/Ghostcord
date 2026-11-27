/*
 * Ghostcord — EventLogs: keeps a timeline of things that happen to your account
 * (friends added/removed, servers joined/left/kicked, groups, blocks). Open it from the toolbox.
 */

import "./styles.css";

import * as DataStore from "@api/DataStore";
import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType } from "@utils/types";
import { ChannelStore, GuildStore, React, RelationshipStore, useEffect, UserStore, useState } from "@webpack/common";

import { confirmGc, GcButton, GcModal, openGc, toast } from "../_gc";
import { vaultGet, vaultPutSoon } from "../_gc/api";
import { GC_AUTHOR } from "../_gc/voice";

const KEY = "gc-event-logs";
type Kind = "friend+" | "friend-" | "request" | "block" | "guild+" | "guild-" | "group+" | "group-";
interface Ev { t: number; kind: Kind; text: string; id?: string; }

const LABEL: Record<Kind, [string, string]> = {
    "friend+": ["Friend added", "#23a55a"], "friend-": ["Friend removed", "#f23f43"], "request": ["Friend request", "#5865f2"],
    "block": ["Blocked", "#f23f43"], "guild+": ["Joined server", "#23a55a"], "guild-": ["Left / removed from server", "#f23f43"],
    "group+": ["Added to group", "#23a55a"], "group-": ["Left group", "#f0b232"]
};

const settings = definePluginSettings({
    notify: { type: OptionType.BOOLEAN, description: "Show a toast when something is logged", default: true },
    max: { type: OptionType.SLIDER, description: "How many events to keep", markers: [100, 250, 500, 1000], default: 500, stickToMarkers: true }
});

let ready = false;
const guildNames = new Map<string, string>();

async function log(kind: Kind, text: string, id?: string) {
    if (!ready) return;
    const list = (await DataStore.get<Ev[]>(KEY)) ?? [];
    await DataStore.set(KEY, [{ t: Date.now(), kind, text, id }, ...list].slice(0, settings.store.max));
    vaultPutSoon("event-logs", getAll);
    if (settings.store.notify) toast(`${LABEL[kind][0]}: ${text}`, kind.endsWith("-") || kind === "block" ? "error" : "info");
}

const getAll = async () => (await DataStore.get<Ev[]>(KEY)) ?? [];

async function syncDown() {
    try {
        const remote = await vaultGet<Ev[]>("event-logs");
        if (!remote?.data?.length) return;
        const local = await getAll();
        const k = (e: Ev) => `${e.t}:${e.kind}:${e.id ?? ""}`;
        const seen = new Set(local.map(k));
        const merged = [...local, ...remote.data.filter(e => !seen.has(k(e)))].sort((a, b) => b.t - a.t).slice(0, settings.store.max);
        await DataStore.set(KEY, merged);
        if (merged.length !== remote.data.length) vaultPutSoon("event-logs", getAll);
    } catch { }
}

const name = (id: string) => { const u: any = UserStore.getUser(id); return u ? (u.globalName ?? u.username) : id; };

function Viewer({ close }: { close(): void; }) {
    const [list, setList] = useState<Ev[] | null>(null);
    const [filter, setFilter] = useState<"all" | "friends" | "servers" | "groups">("all");
    useEffect(() => { getAll().then(setList); syncDown().then(() => getAll().then(setList)); }, []);
    const shown = (list ?? []).filter(e => filter === "all"
        || (filter === "friends" && ["friend+", "friend-", "request", "block"].includes(e.kind))
        || (filter === "servers" && e.kind.startsWith("guild"))
        || (filter === "groups" && e.kind.startsWith("group")));
    return (
        <GcModal title="Event logs" subtitle={list ? `${list.length} events recorded` : "Loading…"} wide onClose={close}
            footer={<GcButton kind="danger" disabled={!list?.length} onClick={async () => {
                if (await confirmGc("Clear event logs?", "Deletes them here and from your Ghostcord backup.", "Clear")) { await DataStore.set(KEY, []); vaultPutSoon("event-logs", getAll, 0); setList([]); }
            }}>Clear</GcButton>}>
            <div className="gc-el-tabs">
                {(["all", "friends", "servers", "groups"] as const).map(f =>
                    <button key={f} className={`gc-el-tab${filter === f ? " gc-el-on" : ""}`} onClick={() => setFilter(f)}>{f[0].toUpperCase() + f.slice(1)}</button>)}
            </div>
            <div className="gc-list">
                {list && !shown.length && <div className="gc-empty">Nothing logged yet.</div>}
                {shown.map((e, i) => (
                    <div key={i} className="gc-el-row">
                        <span className="gc-el-dot" style={{ background: LABEL[e.kind][1] }} />
                        <div className="gc-el-main">
                            <div className="gc-el-text"><b>{LABEL[e.kind][0]}</b> · {e.text}</div>
                            {e.id && <div className="gc-item-sub">{e.id}</div>}
                        </div>
                        <span className="gc-el-time">{new Date(e.t).toLocaleString()}</span>
                    </div>
                ))}
            </div>
        </GcModal>
    );
}

export const openLogs = () => openGc(close => <Viewer close={close} />);

export default definePlugin({
    name: "EventLogs",
    description: "Keeps a timeline of friends added/removed, servers joined/left/kicked, groups and blocks. Backed up to your Ghostcord account.",
    authors: [GC_AUTHOR],
    settings,
    toolboxActions: { "Event logs": openLogs },
    flux: {
        RELATIONSHIP_ADD({ relationship }: any) {
            const id = relationship?.id ?? relationship?.user?.id;
            const t = relationship?.type;
            if (t === 1) log("friend+", name(id), id);
            else if (t === 2) log("block", name(id), id);
            else if (t === 3) log("request", `from ${name(id)}`, id);
        },
        RELATIONSHIP_REMOVE({ relationship }: any) {
            const id = relationship?.id;
            if (relationship?.type === 1 || RelationshipStore.isFriend?.(id)) log("friend-", name(id), id);
        },
        GUILD_CREATE({ guild }: any) {
            if (!guild?.id) return;
            const fresh = !guildNames.has(guild.id);
            guildNames.set(guild.id, guild.name ?? guild.properties?.name);
            if (fresh && ready && !guild.unavailable) log("guild+", guildNames.get(guild.id) ?? guild.id, guild.id);
        },
        GUILD_DELETE({ guild }: any) {
            if (!guild?.id || guild.unavailable) return;
            log("guild-", guildNames.get(guild.id) ?? GuildStore.getGuild(guild.id)?.name ?? guild.id, guild.id);
            guildNames.delete(guild.id);
        },
        CHANNEL_CREATE({ channel }: any) {
            if (channel?.type === 3 && ready) log("group+", channel.name || "Group DM", channel.id);
        },
        CHANNEL_DELETE({ channel }: any) {
            if (channel?.type === 3) log("group-", channel.name || ChannelStore.getChannel(channel.id)?.name || "Group DM", channel.id);
        }
    },
    start() {
        Object.values(GuildStore.getGuilds()).forEach(g => guildNames.set(g.id, g.name));
        syncDown();
        setTimeout(() => { ready = true; }, 15_000); // skip the startup flood
    },
    stop() { ready = false; }
});
