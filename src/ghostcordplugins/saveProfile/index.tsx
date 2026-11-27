/*
 * Ghostcord — SaveProfile: snapshot anyone's profile (name, avatar, banner, bio) so you keep it even if they change it.
 * Right-click a user → "Save Profile". Browse saved ones from the toolbox.
 */

import "./styles.css";

import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import * as DataStore from "@api/DataStore";
import { copyToClipboard } from "@utils/clipboard";
import definePlugin from "@utils/types";
import { IconUtils, Menu, React, UserProfileStore, useEffect, UserStore, useState } from "@webpack/common";

import { confirmGc, GcButton, GcModal, openGc, toast } from "../_gc";
import { vaultGet, vaultPutSoon } from "../_gc/api";
import { GC_AUTHOR } from "../_gc/voice";

const KEY = "gc-saved-profiles";

interface Saved {
    id: string; username: string; globalName?: string; avatar?: string; banner?: string;
    bio?: string; pronouns?: string; accent?: number; savedAt: number;
}

async function all(): Promise<Saved[]> { return (await DataStore.get<Saved[]>(KEY)) ?? []; }

/** Save locally and back up to your Ghostcord API. */
async function store(list: Saved[]) {
    await DataStore.set(KEY, list);
    vaultPutSoon("saved-profiles", all);
}

/** Pull the backup from the API and merge it with what's on this PC. */
async function syncDown() {
    try {
        const remote = await vaultGet<Saved[]>("saved-profiles");
        if (!remote?.data?.length) return;
        const local = await all();
        const key = (s: Saved) => `${s.id}:${s.savedAt}`;
        const seen = new Set(local.map(key));
        const merged = [...local, ...remote.data.filter(s => !seen.has(key(s)))].sort((a, b) => b.savedAt - a.savedAt).slice(0, 300);
        await DataStore.set(KEY, merged);
        if (merged.length !== remote.data.length) vaultPutSoon("saved-profiles", all);
    } catch { }
}

async function toDataUrl(url?: string) {
    if (!url) return undefined;
    try {
        const blob = await fetch(url).then(r => r.blob());
        return await new Promise<string>(res => { const fr = new FileReader(); fr.onload = () => res(fr.result as string); fr.readAsDataURL(blob); });
    } catch { return url; }
}

async function save(userId: string) {
    const u: any = UserStore.getUser(userId);
    if (!u) return toast("User not loaded", "error");
    const p: any = UserProfileStore.getUserProfile(userId);
    const bannerHash = p?.banner ?? u.banner;
    const entry: Saved = {
        id: u.id,
        username: u.username,
        globalName: u.globalName ?? undefined,
        avatar: await toDataUrl(IconUtils.getUserAvatarURL(u, true, 256)),
        banner: bannerHash ? await toDataUrl(`https://cdn.discordapp.com/banners/${u.id}/${bannerHash}.${bannerHash.startsWith("a_") ? "gif" : "png"}?size=600`) : undefined,
        bio: p?.bio || undefined,
        pronouns: p?.pronouns || undefined,
        accent: p?.accentColor ?? undefined,
        savedAt: Date.now()
    };
    const list = await all();
    await store([entry, ...list].slice(0, 300));
    toast(`Saved ${entry.globalName ?? entry.username}'s profile`, "success");
}

function Card({ s, onDelete }: { s: Saved; onDelete(): void; }) {
    const color = s.accent != null ? `#${s.accent.toString(16).padStart(6, "0")}` : "#5865f2";
    return (
        <div className="gc-sp-card">
            <div className="gc-sp-banner" style={s.banner ? { backgroundImage: `url(${s.banner})` } : { background: color }} />
            <img className="gc-sp-avatar" src={s.avatar} alt="" />
            <div className="gc-sp-body">
                <div className="gc-sp-name">{s.globalName ?? s.username}</div>
                <div className="gc-sp-tag">@{s.username}{s.pronouns ? ` · ${s.pronouns}` : ""}</div>
                {s.bio && <div className="gc-sp-bio">{s.bio}</div>}
                <div className="gc-sp-meta">Saved {new Date(s.savedAt).toLocaleString()}</div>
                <div className="gc-sp-actions">
                    <GcButton kind="ghost" onClick={() => { copyToClipboard(s.id); toast("ID copied", "success"); }}>Copy ID</GcButton>
                    {s.avatar && <GcButton kind="ghost" onClick={() => { const a = document.createElement("a"); a.href = s.avatar!; a.download = `${s.username}-avatar`; a.click(); }}>Download avatar</GcButton>}
                    <GcButton kind="ghost" onClick={onDelete}>Delete</GcButton>
                </div>
            </div>
        </div>
    );
}

function Browser({ close }: { close(): void; }) {
    const [list, setList] = useState<Saved[] | null>(null);
    const [q, setQ] = useState("");
    useEffect(() => { all().then(setList); syncDown().then(() => all().then(setList)); }, []);
    const s = q.toLowerCase();
    const shown = (list ?? []).filter(p => !s || p.username.toLowerCase().includes(s) || p.globalName?.toLowerCase().includes(s) || p.id.includes(s));
    const remove = async (i: Saved) => {
        const next = (list ?? []).filter(p => p !== i);
        await store(next);
        setList(next);
    };
    return (
        <GcModal title="Saved profiles" subtitle={list ? `${list.length} saved` : "Loading…"} wide onClose={close}
            footer={list?.length ? <GcButton kind="danger" onClick={async () => {
                if (await confirmGc("Delete all saved profiles?", "This deletes them here and from your Ghostcord backup.", "Delete all")) { await store([]); setList([]); }
            }}>Delete all</GcButton> : undefined}>
            <input className="gc-input" placeholder="Search saved profiles" value={q} onChange={e => setQ((e.target as HTMLInputElement).value)} />
            {list && !shown.length && <div className="gc-empty">No saved profiles yet. Right-click someone → Save Profile.</div>}
            <div className="gc-sp-grid">{shown.map(p => <Card key={p.id + p.savedAt} s={p} onDelete={() => remove(p)} />)}</div>
        </GcModal>
    );
}

export const openBrowser = () => openGc(close => <Browser close={close} />);

const userMenu: NavContextMenuPatchCallback = (children, { user }) => {
    if (!user) return;
    children.push(
        <Menu.MenuGroup>
            <Menu.MenuItem id="gc-save-profile" label="Save Profile" action={() => save(user.id)} />
            <Menu.MenuItem id="gc-saved-profiles" label="View Saved Profiles" action={openBrowser} />
        </Menu.MenuGroup>
    );
};

export default definePlugin({
    name: "SaveProfile",
    description: "Snapshot anyone's profile (name, avatar, banner, bio) and browse them later. Backed up to your Ghostcord account.",
    authors: [GC_AUTHOR],
    contextMenus: { "user-context": userMenu },
    toolboxActions: { "Saved profiles…": openBrowser },
    start() { syncDown(); }
});
