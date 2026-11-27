/*
 * Ghostcord — ClientDiagnostics: one screen with everything about your client (versions, plugins, memory, API/gateway health). Copy it for support.
 */

import "./styles.css";

import { isPluginEnabled, plugins } from "@api/PluginManager";
import { copyToClipboard } from "@utils/clipboard";
import definePlugin from "@utils/types";
import { GuildStore, React, RelationshipStore, useEffect, UserStore, useState } from "@webpack/common";

import { GC_API, GcButton, GcModal, openGc, toast } from "../_gc";
import { GC_AUTHOR } from "../_gc/voice";

declare const gitHash: string;

async function ms(url: string) {
    const t = performance.now();
    try { await fetch(url, { cache: "no-store" }); return Math.round(performance.now() - t); } catch { return null; }
}

function collect() {
    const nav: any = navigator;
    const mem: any = (performance as any).memory;
    const all = Object.values(plugins);
    const w: any = window;
    return {
        "Ghostcord": typeof gitHash !== "undefined" ? gitHash : "unknown",
        "Discord": `${w.GLOBAL_ENV?.RELEASE_CHANNEL ?? "?"} · build ${w.GLOBAL_ENV?.BUILD_NUMBER ?? w.__SENTRY__?.hub?._stack?.[0]?.scope?._tags?.buildNumber ?? "?"}`,
        "Electron": nav.userAgent.match(/Electron\/([\d.]+)/)?.[1] ?? "—",
        "Chromium": nav.userAgent.match(/Chrome\/([\d.]+)/)?.[1] ?? "—",
        "OS": nav.userAgentData?.platform ?? nav.platform ?? "?",
        "Plugins": `${all.filter(p => isPluginEnabled(p.name)).length} on / ${all.length} total`,
        "Memory": mem ? `${Math.round(mem.usedJSHeapSize / 1048576)} MB used / ${Math.round(mem.jsHeapSizeLimit / 1048576)} MB` : "—",
        "CPU threads": String(nav.hardwareConcurrency ?? "?"),
        "Account": UserStore.getCurrentUser()?.username ?? "?",
        "Servers": String(GuildStore.getGuildCount?.() ?? Object.keys(GuildStore.getGuilds()).length),
        "Friends": String(RelationshipStore.getFriendIDs().length),
        "Uptime": `${Math.round(performance.now() / 60000)} min`
    } as Record<string, string>;
}

function Diag({ close }: { close(): void; }) {
    const [info] = useState(collect);
    const [net, setNet] = useState<{ api: number | null; discord: number | null; } | null>(null);
    useEffect(() => {
        Promise.all([ms(GC_API), ms("https://discord.com/api/v9/gateway")]).then(([api, discord]) => setNet({ api, discord }));
    }, []);
    const badge = (v: number | null | undefined) => v == null ? <span className="gc-dg-bad">offline</span>
        : <span className={v < 150 ? "gc-dg-good" : v < 400 ? "gc-dg-mid" : "gc-dg-bad"}>{v} ms</span>;
    const text = () => [...Object.entries(info).map(([k, v]) => `${k}: ${v}`),
        `Ghostcord API: ${net?.api ?? "?"} ms`, `Discord API: ${net?.discord ?? "?"} ms`].join("\n");

    return (
        <GcModal title="Client diagnostics" subtitle="Everything about your Ghostcord setup" onClose={close}
            footer={<GcButton onClick={() => { copyToClipboard("```\n" + text() + "\n```"); toast("Diagnostics copied", "success"); }}>Copy report</GcButton>}>
            <div className="gc-dg-net">
                <div className="gc-dg-tile"><div className="gc-dg-label">Ghostcord API</div>{net ? badge(net.api) : "…"}</div>
                <div className="gc-dg-tile"><div className="gc-dg-label">Discord API</div>{net ? badge(net.discord) : "…"}</div>
            </div>
            <div className="gc-dg-table">
                {Object.entries(info).map(([k, v]) => (
                    <div key={k} className="gc-dg-row"><span>{k}</span><b>{v}</b></div>
                ))}
            </div>
        </GcModal>
    );
}

export const openDiag = () => openGc(close => <Diag close={close} />);

export default definePlugin({
    name: "ClientDiagnostics",
    description: "Shows versions, plugin count, memory and API health in one screen, with a one-click copy for support.",
    authors: [GC_AUTHOR],
    toolboxActions: { "Client diagnostics": openDiag }
});
