/*
 * Ghostcord — ServerCloner: copies a server's roles, categories, channels and permissions into a brand-new server you own.
 * Right-click a server → "Clone Server".
 */

import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import definePlugin from "@utils/types";
import { ChannelStore, GuildRoleStore, GuildStore, IconUtils, Menu, React, RestAPI, useState } from "@webpack/common";

import { GcButton, GcModal, GcProgress, openGc, sleep, toast } from "../_gc";
import { GC_AUTHOR } from "../_gc/voice";

const STEP = 700; // ms between API calls

async function iconData(guild: any) {
    if (!guild.icon) return null;
    try {
        const blob = await fetch(IconUtils.getGuildIconURL({ id: guild.id, icon: guild.icon, size: 256 })!).then(r => r.blob());
        return await new Promise<string>(res => { const fr = new FileReader(); fr.onload = () => res(fr.result as string); fr.readAsDataURL(blob); });
    } catch { return null; }
}

async function call<T = any>(fn: () => Promise<any>): Promise<T> {
    for (let tries = 0; ; tries++) {
        try { const r = await fn(); await sleep(STEP); return r?.body as T; } catch (e: any) {
            const retry = e?.body?.retry_after;
            if (retry && tries < 5) { await sleep(retry * 1000 + 250); continue; }
            throw e;
        }
    }
}

function Cloner({ guild, close }: { guild: any; close(): void; }) {
    const [name, setName] = useState(`${guild.name} (clone)`);
    const [opts, setOpts] = useState({ roles: true, channels: true, icon: true });
    const [prog, setProg] = useState<{ done: number; total: number; label: string; } | null>(null);
    const [err, setErr] = useState<string | null>(null);

    async function run() {
        const roles = Object.values(GuildRoleStore.getRolesSnapshot(guild.id) ?? {}) as any[];
        const allChannels = Object.values((ChannelStore as any).getMutableGuildChannelsForGuild?.(guild.id) ?? {}) as any[];
        const cats = allChannels.filter(c => c.type === 4).sort((a, b) => a.position - b.position);
        const rest = allChannels.filter(c => c.type !== 4 && [0, 2, 5, 13, 15, 16].includes(c.type)).sort((a, b) => a.position - b.position);
        const copyRoles = opts.roles ? roles.filter(r => r.id !== guild.id && !r.managed).sort((a, b) => b.position - a.position) : [];
        const total = 1 + copyRoles.length + (opts.channels ? cats.length + rest.length + 1 : 0);
        let done = 0;
        const tick = (label: string) => setProg({ done: ++done, total, label });

        try {
            setProg({ done: 0, total, label: "Creating server…" });
            const created = await call(() => RestAPI.post({ url: "/guilds", body: { name } }));
            const newId: string = created.id;
            if (opts.icon) { const icon = await iconData(guild); if (icon) await call(() => RestAPI.patch({ url: `/guilds/${newId}`, body: { icon } })); }
            tick("Server created");

            const roleMap: Record<string, string> = { [guild.id]: newId };
            const everyone = roles.find(r => r.id === guild.id);
            if (everyone) await call(() => RestAPI.patch({ url: `/guilds/${newId}/roles/${newId}`, body: { permissions: String(everyone.permissions) } })).catch(() => { });
            for (const r of copyRoles) {
                const nr = await call(() => RestAPI.post({
                    url: `/guilds/${newId}/roles`,
                    body: { name: r.name, permissions: String(r.permissions), color: r.color, hoist: r.hoist, mentionable: r.mentionable }
                })).catch(() => null);
                if (nr) roleMap[r.id] = nr.id;
                tick(`Role: ${r.name}`);
            }

            if (opts.channels) {
                const existing = await call<any[]>(() => RestAPI.get({ url: `/guilds/${newId}/channels` })).catch(() => []);
                for (const c of existing ?? []) await call(() => RestAPI.del({ url: `/channels/${c.id}` })).catch(() => { });
                tick("Cleared default channels");

                const overwrites = (c: any) => Object.values(c.permissionOverwrites ?? {})
                    .map((o: any) => ({ id: o.type === 0 ? roleMap[o.id] : o.id, type: o.type, allow: String(o.allow), deny: String(o.deny) }))
                    .filter(o => o.id && o.type === 0);
                const catMap: Record<string, string> = {};
                for (const c of cats) {
                    const nc = await call(() => RestAPI.post({ url: `/guilds/${newId}/channels`, body: { name: c.name, type: 4, permission_overwrites: overwrites(c) } })).catch(() => null);
                    if (nc) catMap[c.id] = nc.id;
                    tick(`Category: ${c.name}`);
                }
                for (const c of rest) {
                    const type = c.type === 5 || c.type === 15 || c.type === 16 ? 0 : c.type; // announcement/forum/media need Community → text
                    await call(() => RestAPI.post({
                        url: `/guilds/${newId}/channels`,
                        body: {
                            name: c.name, type, topic: c.topic, nsfw: c.nsfw, bitrate: c.bitrate ? Math.min(c.bitrate, 96000) : undefined,
                            user_limit: c.userLimit, rate_limit_per_user: c.rateLimitPerUser,
                            parent_id: c.parent_id ? catMap[c.parent_id] : undefined, permission_overwrites: overwrites(c)
                        }
                    })).catch(() => { });
                    tick(`#${c.name}`);
                }
            }
            toast(`Cloned into "${name}"`, "success");
            close();
        } catch (e: any) {
            setErr(e?.body?.message ?? "Discord refused the request. You can only own up to 100 servers.");
            setProg(null);
        }
    }

    return (
        <GcModal title="Clone server" subtitle={`Copy ${guild.name} into a new server you own`} onClose={close}
            footer={prog ? undefined : <>
                <GcButton kind="ghost" onClick={close}>Cancel</GcButton>
                <GcButton disabled={!name.trim()} onClick={run}>Clone</GcButton>
            </>}>
            {prog ? <GcProgress done={prog.done} total={prog.total} label={prog.label} /> : <>
                <input className="gc-input" value={name} onChange={e => setName((e.target as HTMLInputElement).value)} placeholder="New server name" />
                {(["roles", "channels", "icon"] as const).map(k => (
                    <label key={k} className="gc-item">
                        <input type="checkbox" checked={opts[k]} onChange={() => setOpts(o => ({ ...o, [k]: !o[k] }))} />
                        <div className="gc-item-info">
                            <div className="gc-item-name">{k === "roles" ? "Roles & permissions" : k === "channels" ? "Categories & channels" : "Server icon"}</div>
                        </div>
                    </label>
                ))}
                {err && <div className="gc-empty" style={{ color: "#f23f43" }}>{err}</div>}
                <p className="gc-text" style={{ fontSize: 12.5, color: "var(--text-muted)" }}>Messages, members, emojis and bots aren't copied. Big servers take a few minutes.</p>
            </>}
        </GcModal>
    );
}

const guildMenu: NavContextMenuPatchCallback = (children, { guild }) => {
    if (!guild) return;
    children.push(
        <Menu.MenuGroup>
            <Menu.MenuItem id="gc-clone-server" label="Clone Server" action={() => openGc(close => <Cloner guild={GuildStore.getGuild(guild.id) ?? guild} close={close} />)} />
        </Menu.MenuGroup>
    );
};

export default definePlugin({
    name: "ServerCloner",
    description: "Right-click a server → Clone Server: copies its roles, categories, channels and permissions into a new server you own.",
    authors: [GC_AUTHOR],
    contextMenus: { "guild-context": guildMenu }
});
