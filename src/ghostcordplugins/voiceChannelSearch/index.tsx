/*
 * Ghostcord — VoiceChannelSearch: see every active voice channel across your servers, search by channel or person, click to join.
 */

import "./styles.css";

import definePlugin from "@utils/types";
import { ChannelStore, GuildStore, IconUtils, React, UserStore, useState, VoiceStateStore } from "@webpack/common";

import { GcModal, openGc } from "../_gc";
import { GC_AUTHOR, joinVoice } from "../_gc/voice";

interface Active { channel: any; guild: any; users: any[]; }

function collect(): Active[] {
    const all = VoiceStateStore.getAllVoiceStates();
    const out: Active[] = [];
    for (const guildId of Object.keys(all)) {
        const byChannel: Record<string, any[]> = {};
        for (const state of Object.values(all[guildId])) {
            if (!state.channelId) continue;
            (byChannel[state.channelId] ??= []).push(UserStore.getUser(state.userId) ?? { id: state.userId, username: "Unknown" });
        }
        for (const [id, users] of Object.entries(byChannel)) {
            const channel = ChannelStore.getChannel(id);
            if (!channel) continue;
            out.push({ channel, guild: GuildStore.getGuild(channel.guild_id), users });
        }
    }
    return out.sort((a, b) => b.users.length - a.users.length);
}

function SearchModal({ close }: { close(): void; }) {
    const [q, setQ] = useState("");
    const [list] = useState(collect);
    const s = q.trim().toLowerCase();
    const shown = list.filter(a => !s
        || a.channel.name.toLowerCase().includes(s)
        || a.guild?.name.toLowerCase().includes(s)
        || a.users.some(u => (u.globalName ?? u.username ?? "").toLowerCase().includes(s) || u.username?.toLowerCase().includes(s)));
    const people = list.reduce((n, a) => n + a.users.length, 0);

    return (
        <GcModal title="Voice channels" subtitle={`${list.length} active channels · ${people} people in voice`} wide onClose={close}>
            <input className="gc-input" autoFocus placeholder="Search channels, servers or people" value={q} onChange={e => setQ((e.target as HTMLInputElement).value)} />
            <div className="gc-list">
                {!shown.length && <div className="gc-empty">No one's in voice{s ? " matching that" : ""}.</div>}
                {shown.map(a => (
                    <div key={a.channel.id} className="gc-vcs-row" onClick={() => { joinVoice(a.channel.id); close(); }}>
                        {a.guild?.icon
                            ? <img className="gc-item-icon" src={IconUtils.getGuildIconURL({ id: a.guild.id, icon: a.guild.icon, size: 64 })} alt="" />
                            : <div className="gc-item-icon gc-item-fallback">{a.guild?.name?.[0] ?? "?"}</div>}
                        <div className="gc-vcs-info">
                            <div className="gc-item-name">🔊 {a.channel.name}</div>
                            <div className="gc-item-sub">{a.guild?.name ?? "Unknown server"}</div>
                        </div>
                        <div className="gc-vcs-users">
                            {a.users.slice(0, 5).map(u => (
                                <img key={u.id} className="gc-vcs-av" title={u.globalName ?? u.username}
                                    src={u.avatar !== undefined ? IconUtils.getUserAvatarURL(u, false, 32) : undefined} alt="" />
                            ))}
                            <span className="gc-chip">{a.users.length}</span>
                        </div>
                    </div>
                ))}
            </div>
        </GcModal>
    );
}

export const openSearch = () => openGc(close => <SearchModal close={close} />);

export default definePlugin({
    name: "VoiceChannelSearch",
    description: "Lists every active voice channel across your servers. Search by channel, server or person and click to join.",
    authors: [GC_AUTHOR],
    toolboxActions: { "Search voice channels…": openSearch }
});
