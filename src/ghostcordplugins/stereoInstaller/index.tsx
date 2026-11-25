/*
 * Ghostcord — StereoInstaller
 */

import "./styles.css";

import SettingsPlugin from "@plugins/_core/settings";
import { removeFromArray } from "@utils/misc";
import definePlugin, { OptionType, PluginNative, StartAt } from "@utils/types";
import { definePluginSettings } from "@api/Settings";
import { React, useEffect, useState } from "@webpack/common";

const Native = VencordNative.pluginHelpers.StereoInstaller as PluginNative<typeof import("./native")>;

const METHODS: Record<string, { label: string; sources: { label: string; url: string; }[]; }> = {
    "audio-collective": { label: "Discord Audio Collective Method", sources: [{ label: "Discord Audio Collective", url: "https://github.com/ProdHallow/Discord-Stereo-Windows-MacOS-Linux" }] },
    "voice-playground": { label: "Voice Playground Method", sources: [{ label: "Voice Playground", url: "https://discord-voice.xyz/" }] },
};

const settings = definePluginSettings({
    method: { type: OptionType.STRING, description: "Installer method", default: "audio-collective", hidden: true },
    discordPath: { type: OptionType.STRING, description: "Discord install folder", default: "", hidden: true },
    apiUrl: { type: OptionType.STRING, description: "Where stereo files are downloaded from (your Ghostcord API)", default: "https://194-238-31-149.sslip.io" },
});

const HeadphonesIcon = (props: any) => (
    <svg viewBox="0 0 24 24" width={props.width ?? 20} height={props.height ?? 20} className={props.className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 18v-6a9 9 0 0 1 18 0v6" />
        <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z" />
    </svg>
);

type Info = Awaited<ReturnType<typeof Native.getInfo>>;

function StereoTab() {
    const { method, discordPath } = settings.use(["method", "discordPath"]);
    const [info, setInfo] = useState<Info | null>(null);
    const [logs, setLogs] = useState<string[]>([]);
    const [busy, setBusy] = useState(false);

    const refresh = async (p = discordPath) => {
        if (p) setInfo(await Native.getInfo(p));
        setLogs(await Native.getLogs());
    };

    useEffect(() => {
        (async () => {
            if (!discordPath) {
                const p = await Native.autoDetect();
                if (p) settings.store.discordPath = p;
                refresh(p);
            } else refresh();
        })();
    }, []);

    const run = async (fn: () => Promise<any>) => { setBusy(true); try { await fn(); } finally { setBusy(false); refresh(); } };
    const lastPatch = info?.lastPatch?.[method];
    const methodLabel = METHODS[method]?.label ?? method;

    return (
        <div className="gc-stereo">
            <div className="gc-stereo-warning">
                <h3>StereoInstaller warning</h3>
                <p>This plugin replaces local Discord voice files to enable higher audio quality. It keeps a backup so you can restore the original files when needed.</p>
                <p>Keep one method installed at a time. Revert to the saved backup before switching methods or after a Discord update if voice stops working.</p>
            </div>

            <div className="gc-stereo-row">
                <div className="gc-stereo-label"><b>Installer method</b><span>Use only one method at a time.</span></div>
                <select className="gc-stereo-select" value={method} disabled={busy} onChange={e => (settings.store.method = e.currentTarget.value)}>
                    {Object.entries(METHODS).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}
                </select>
            </div>

            <div className="gc-stereo-row">
                <div className="gc-stereo-label"><b>Source code</b><span>Each method has its own upstream source.</span></div>
                <div className="gc-stereo-chips">
                    {Object.values(METHODS).flatMap(m => m.sources).map(s =>
                        <a key={s.label} className="gc-stereo-chip" href={s.url} target="_blank" rel="noreferrer">{s.label}</a>)}
                </div>
            </div>

            <input className="gc-stereo-input" value={discordPath} placeholder="C:\Users\you\AppData\Local\Discord"
                onChange={e => (settings.store.discordPath = e.currentTarget.value)} onBlur={() => refresh()} />

            <div className="gc-stereo-buttons">
                <button className="gc-btn" disabled={busy} onClick={async () => { const p = await Native.autoDetect(); settings.store.discordPath = p; refresh(p); }}>Auto-detect</button>
                <button className="gc-btn" disabled={busy} onClick={async () => { const p = await Native.browse(); if (p) { settings.store.discordPath = p; refresh(p); } }}>Browse</button>
                <button className="gc-btn gc-green" disabled={busy || !discordPath} onClick={() => run(() => Native.patch(discordPath, method, settings.store.apiUrl))}>{busy ? "Working..." : "Patch Discord voice"}</button>
                <button className="gc-btn gc-red" disabled={busy || !info?.hasBackup} onClick={() => run(() => Native.revert(discordPath))}>Revert to backup</button>
            </div>

            <div className="gc-stereo-status">
                <span className={"gc-stereo-dot " + (info?.installedMethod ? "on" : "")}>{info?.installedMethod ? "✓" : "⦸"}</span>
                <div>
                    <b>{info?.installedMethod ? "Stereo is installed" : "Stereo is not installed"}</b>
                    <span>{info?.installedMethod
                        ? `Using ${METHODS[info.installedMethod]?.label ?? info.installedMethod}. Restart Discord after patching.`
                        : "Choose a method and patch Discord voice to enable stereo audio."}</span>
                </div>
            </div>

            <div className="gc-stereo-table">
                <div><span>CLIENT</span><code>{info?.client || "—"}</code></div>
                <div><span>PLATFORM</span><code>{info?.platform || "—"}</code></div>
                <div><span>VOICE MODULE</span><code>{info?.voiceModule || info?.error || "—"}</code></div>
                <div><span>{methodLabel.toUpperCase()} LAST PATCH</span><code>{lastPatch ? new Date(lastPatch).toLocaleString() : "Never"}</code></div>
            </div>

            <p className="gc-stereo-detected">{info && !info.error ? "Discord install detected." : "No Discord install detected."}</p>

            <div className="gc-stereo-logs">
                <div className="gc-stereo-logs-head">
                    <b>Installer logs</b>
                    <button className="gc-btn gc-red gc-small" onClick={async () => { await Native.clearLogs(); refresh(); }}>Clear logs</button>
                </div>
                <pre>{logs.length ? logs.join("\n") : "No logs yet."}</pre>
            </div>
        </div>
    );
}

export default definePlugin({
    name: "StereoInstaller",
    description: "Patches Discord's voice module for true stereo audio, with automatic backup and restore.",
    authors: [{ name: "offxy", id: 1402331570525835275n }],
    dependencies: ["Settings"],
    required: true,
    enabledByDefault: true,
    startAt: StartAt.WebpackReady,
    settings,
    start() {
        SettingsPlugin.customEntries.push({
            key: "ghostcord_stereo_installer",
            title: "StereoInstaller",
            Component: StereoTab,
            Icon: HeadphonesIcon
        });
    },
    stop() {
        removeFromArray(SettingsPlugin.customEntries, e => e.key === "ghostcord_stereo_installer");
    },
});
