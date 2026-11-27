/*
 * Ghostcord — ValidSearch: check any user ID instantly — see if the account exists, who it is, when it was made,
 * and which of your servers / friends you share. Paste an ID, @mention or profile link.
 */

import "./styles.css";

import { copyToClipboard } from "@utils/clipboard";
import { openUserProfile } from "@utils/discord";
import definePlugin from "@utils/types";
import { GuildMemberStore, GuildStore, IconUtils, React, RelationshipStore, SnowflakeUtils, UserStore, UserUtils, useState } from "@webpack/common";

import { GcButton, GcModal, openGc, toast } from "../_gc";
import { GC_AUTHOR } from "../_gc/voice";

interface Result { user: any; created: number; guilds: string[]; friend: boolean; blocked: boolean; }

const extractId = (s: string) => s.match(/\d{17,20}/)?.[0] ?? null;

async function lookup(id: string): Promise<Result | null> {
    let user: any = UserStore.getUser(id);
    if (!user) { try { user = await UserUtils.getUser(id); } catch { return null; } }
    if (!user) return null;
    const guilds = Object.values(GuildStore.getGuilds()).filter(g => GuildMemberStore.isMember(g.id, id)).map(g => g.name);
    return { user, created: SnowflakeUtils.extractTimestamp(id), guilds, friend: RelationshipStore.isFriend(id), blocked: RelationshipStore.isBlocked(id) };
}

function Search({ close }: { close(): void; }) {
    const [q, setQ] = useState("");
    const [state, setState] = useState<"idle" | "loading" | "invalid" | "notfound">("idle");
    const [res, setRes] = useState<Result | null>(null);

    async function go() {
        const id = extractId(q);
        setRes(null);
        if (!id) return setState("invalid");
        setState("loading");
        const r = await lookup(id);
        if (!r) return setState("notfound");
        setRes(r);
        setState("idle");
    }

    const u = res?.user;
    return (
        <GcModal title="User lookup" subtitle="Paste a user ID, mention or profile link" onClose={close}>
            <div className="gc-row-tools">
                <input className="gc-input" autoFocus placeholder="123456789012345678" value={q}
                    onChange={e => setQ((e.target as HTMLInputElement).value)} onKeyDown={e => e.key === "Enter" && go()} />
                <GcButton onClick={go}>Search</GcButton>
            </div>
            {state === "loading" && <div className="gc-empty">Looking up…</div>}
            {state === "invalid" && <div className="gc-empty gc-vs-err">That's not a valid user ID.</div>}
            {state === "notfound" && <div className="gc-empty gc-vs-err">No account with that ID (deleted or never existed).</div>}
            {u && res && (
                <div className="gc-vs-card">
                    <img className="gc-vs-av" src={IconUtils.getUserAvatarURL(u, true, 128)} alt="" />
                    <div className="gc-vs-info">
                        <div className="gc-vs-name">{u.globalName ?? u.username}{u.bot && <span className="gc-chip">BOT</span>}</div>
                        <div className="gc-item-sub">@{u.username} · {u.id}</div>
                        <div className="gc-vs-facts">
                            <span className="gc-chip">Created {new Date(res.created).toLocaleDateString()}</span>
                            {res.friend && <span className="gc-chip gc-vs-green">Friend</span>}
                            {res.blocked && <span className="gc-chip gc-vs-red">Blocked</span>}
                            <span className="gc-chip">{res.guilds.length} mutual server{res.guilds.length === 1 ? "" : "s"}</span>
                        </div>
                        {!!res.guilds.length && <div className="gc-vs-guilds">{res.guilds.slice(0, 12).join(" · ")}{res.guilds.length > 12 ? ` +${res.guilds.length - 12}` : ""}</div>}
                        <div className="gc-sp-actions">
                            <GcButton kind="ghost" onClick={() => { openUserProfile(u.id); close(); }}>Open profile</GcButton>
                            <GcButton kind="ghost" onClick={() => { copyToClipboard(u.id); toast("ID copied", "success"); }}>Copy ID</GcButton>
                        </div>
                    </div>
                </div>
            )}
        </GcModal>
    );
}

export const openSearch = () => openGc(close => <Search close={close} />);

export default definePlugin({
    name: "ValidSearch",
    description: "Look up any user ID: check it exists, see who it is, account age, and mutual servers. Open it from the toolbox.",
    authors: [GC_AUTHOR],
    toolboxActions: { "User lookup…": openSearch }
});
