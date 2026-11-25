/*
 * Ghostcord — Status tab: live health of Ghostcord + Discord, 30-day history and the Graveyard.
 */

import "./styles.css";

import SettingsPlugin from "@plugins/_core/settings";
import { GHOSTCORD_LOGO } from "@shared/ghostcordLogo";
import { removeFromArray } from "@utils/misc";
import definePlugin from "@utils/types";
import { React, useEffect, useState } from "@webpack/common";

const API = "https://194-238-31-149.sslip.io/v1";
const REFRESH = 60_000;

type State = "up" | "degraded" | "down" | "unknown";
interface Service { group: string; name: string; state: State; ms: number | null; uptime: number | null; troubleToday: boolean; bars: ("up" | "degraded" | "down" | "none")[]; }
interface Incident { group: string; name: string; kind: "degraded" | "down"; started: number; ended: number | null; }
interface Status { overall: "operational" | "degraded" | "outage"; average: number | null; healthy: number; watched: number; sinceLastScare: number; updated: number; services: Service[]; incidents: Incident[]; }

// ---- ping history ("ectoplasm"), sampled every minute in the background ----
const PING_KEY = "ghostcord-ping-history";
let pings: { t: number; ms: number; }[] = (() => { try { return JSON.parse(localStorage.getItem(PING_KEY) ?? "[]"); } catch { return []; } })();
let pingTimer: ReturnType<typeof setInterval> | undefined;

async function samplePing() {
    const t = performance.now();
    try {
        await fetch(API, { cache: "no-store" });
        const ms = Math.round(performance.now() - t);
        pings = [...pings, { t: Date.now(), ms }].filter(p => Date.now() - p.t < 60 * 60_000).slice(-120);
        try { localStorage.setItem(PING_KEY, JSON.stringify(pings)); } catch { }
        return ms;
    } catch { return null; }
}

// ---- helpers ----
const MOODS = {
    operational: { label: "All systems operational", title: "All quiet in the graveyard", sub: "Nothing's haunting your Discord right now." },
    degraded: { label: "Partial disruption", title: "Something stirs in the dark…", sub: "A service is acting up. We're keeping an eye on it." },
    outage: { label: "Service outage", title: "The graveyard is restless", sub: "Something's down. It's pinned to the top below." },
} as const;

function ago(ms: number) {
    const m = Math.floor(ms / 60_000);
    if (m < 60) return `${m} min`;
    const h = Math.floor(m / 60);
    if (h < 48) return `${h} h`;
    return `${Math.floor(h / 24)} days`;
}
const shortDate = (t: number) => new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
const timeStr = (t: number) => new Date(t).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

function Ectoplasm() {
    const data = pings.slice(-60);
    if (data.length < 2) return <div className="gcs-ecto-empty">Gathering ectoplasm… the line fills in over the next hour.</div>;
    const max = Math.max(...data.map(p => p.ms)), min = Math.min(...data.map(p => p.ms));
    const span = Math.max(1, max - min);
    const pts = data.map((p, i) => [i / (data.length - 1) * 260, 44 - (p.ms - min) / span * 36]);
    const line = "M" + pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" L");
    return (
        <svg className="gcs-ecto" viewBox="0 0 260 52" preserveAspectRatio="none">
            <defs>
                <linearGradient id="gcs-ecto-fill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0" stopColor="var(--gcs-accent)" stopOpacity=".45" />
                    <stop offset="1" stopColor="var(--gcs-accent)" stopOpacity="0" />
                </linearGradient>
            </defs>
            <path d={`${line} L260,52 L0,52 Z`} fill="url(#gcs-ecto-fill)" />
            <path d={line} fill="none" stroke="var(--gcs-accent-2)" strokeWidth="1.6" strokeLinejoin="round" />
        </svg>
    );
}

function Row({ s }: { s: Service; }) {
    const pct = s.uptime === null ? "—" : s.uptime >= 99.995 ? "100%" : `${s.uptime.toFixed(1)}%`;
    return (
        <div className="gcs-row">
            <div className="gcs-name">
                <span className={`gcs-pulse gcs-${s.state}`} />
                <span>{s.name}</span>
                {s.state === "down" && <span className="gcs-tag gcs-tag-down">down</span>}
                {s.state === "degraded" && <span className="gcs-tag">slow</span>}
                {s.state === "up" && s.troubleToday && <span className="gcs-tag">flickered</span>}
            </div>
            <div className="gcs-bars">
                {s.bars.map((b, i) => <i key={i} className={`gcs-bar-${b}${i === 29 ? " gcs-today" : ""}`} title={`${shortDate(Date.now() - (29 - i) * 864e5)}: ${b === "none" ? "no data" : b}`} />)}
            </div>
            <span className="gcs-ms">{s.ms !== null ? `${s.ms}ms` : "—"}</span>
            <span className="gcs-pct">{pct}</span>
        </div>
    );
}

function Group({ title, icon, right, services }: { title: string; icon: React.ReactNode; right: string; services: Service[]; }) {
    const rank = { down: 0, degraded: 1, unknown: 2, up: 3 };
    const sorted = [...services].sort((a, b) => rank[a.state] - rank[b.state]);
    return (
        <>
            <div className="gcs-group">{icon}<span>{title}</span><span className="gcs-line" /><span className="gcs-right">{right}</span></div>
            <div className="gcs-card">{sorted.map(s => <Row key={s.name} s={s} />)}</div>
        </>
    );
}

function StatusTab() {
    const [status, setStatus] = useState<Status | null>(null);
    const [error, setError] = useState(false);
    const [ping, setPing] = useState<number | null>(pings.at(-1)?.ms ?? null);
    const [nextIn, setNextIn] = useState(REFRESH / 1000);

    const load = async () => {
        try {
            const res = await fetch(API + "/status", { cache: "no-store" });
            setStatus(await res.json()); setError(false);
        } catch { setError(true); }
        const ms = await samplePing();
        if (ms !== null) setPing(ms);
        setNextIn(REFRESH / 1000);
    };

    useEffect(() => {
        load();
        const refresh = setInterval(load, REFRESH);
        const tick = setInterval(() => setNextIn(n => Math.max(0, n - 1)), 1000);
        return () => { clearInterval(refresh); clearInterval(tick); };
    }, []);

    if (!status) {
        return (
            <div className="gcs gcs-loading">
                <img src={GHOSTCORD_LOGO} className="gcs-loading-ghost" />
                <span>{error ? "Couldn't reach the Ghostcord API. Retrying every minute…" : "Summoning status…"}</span>
            </div>
        );
    }

    const mood = MOODS[status.overall];
    const ghostcord = status.services.filter(s => s.group === "Ghostcord");
    const discord = status.services.filter(s => s.group === "Discord");
    const scare = status.sinceLastScare <= 0 ? "Right now" : ago(status.sinceLastScare);

    return (
        <div className={`gcs gcs-mood-${status.overall}`}>
            <div className="gcs-hero">
                <div className="gcs-fog" />
                <div className="gcs-top">
                    <div className="gcs-ghost"><img src={GHOSTCORD_LOGO} alt="" /></div>
                    <div className="gcs-mood">
                        <small>● {mood.label}</small>
                        <b>{mood.title}</b>
                        <span>{mood.sub}</span>
                    </div>
                    <div className="gcs-ping">
                        <div className="gcs-ping-v">{ping ?? "—"}<em>ms</em></div>
                        <div className="gcs-ping-l">YOUR PING</div>
                    </div>
                </div>
                <div className="gcs-ecto-row">
                    <Ectoplasm />
                    <span className="gcs-ecto-label">ectoplasm · last hour</span>
                </div>
            </div>

            <div className="gcs-chips">
                <div className="gcs-chip"><b>{status.average !== null ? `${status.average}%` : "—"}</b><span>avg uptime · 30 days</span></div>
                <div className="gcs-chip"><b>{status.healthy} / {status.watched}</b><span>services haunting fine</span></div>
                <div className="gcs-chip"><b>{scare}</b><span>{status.sinceLastScare <= 0 ? "a scare is happening" : "since the last scare"}</span></div>
            </div>

            <Group title="Ghostcord" icon={<img src={GHOSTCORD_LOGO} className="gcs-group-logo" />} right="30 days" services={ghostcord} />
            <Group title="Discord" icon={<span>🎮</span>} right="via discordstatus.com" services={discord} />

            <div className="gcs-group"><span>🪦</span><span>The graveyard</span><span className="gcs-line" /><span className="gcs-right">past incidents</span></div>
            {status.incidents.length ? (
                <div className="gcs-yard">
                    {status.incidents.slice(0, 3).map((i, n) => (
                        <div key={n} className={`gcs-stone${i.ended ? "" : " gcs-stone-open"}`}>
                            <div className="gcs-rip">{i.ended ? "R · I · P" : "HAUNTING NOW"}</div>
                            <b>{i.name} {i.kind === "down" ? "went down" : "flickered"}</b>
                            <span>{i.group} · {shortDate(i.started)}</span>
                            <span className="gcs-dur">{i.ended ? ago(i.ended - i.started).replace(/^0 min$/, "<1 min") : `for ${ago(Date.now() - i.started)}`}</span>
                        </div>
                    ))}
                </div>
            ) : (
                <div className="gcs-yard-empty">No graves yet. Nothing has gone wrong in the last 30 days. 👻</div>
            )}

            <div className="gcs-foot">
                <svg className="gcs-ring" viewBox="0 0 20 20">
                    <circle cx="10" cy="10" r="8" />
                    <circle cx="10" cy="10" r="8" className="gcs-ring-fill" strokeDasharray={`${(1 - nextIn / (REFRESH / 1000)) * 50.27} 50.27`} />
                </svg>
                {status.updated ? `Updated ${timeStr(status.updated)}` : "Waiting for first check"} · next check in {nextIn}s
            </div>
        </div>
    );
}

const StatusIcon = (props: any) => (
    <img src={GHOSTCORD_LOGO} width={props.width ?? 20} height={props.height ?? 20} className={props.className}
        style={{ imageRendering: "pixelated", objectFit: "contain" }} alt="" />
);

export default definePlugin({
    name: "GhostcordStatus",
    description: "Status tab showing the health of Ghostcord and Discord, with 30-day history and past incidents.",
    authors: [{ name: "offxy", id: 1402331570525835275n }],
    required: true,
    dependencies: ["Settings"],
    start() {
        SettingsPlugin.customEntries.push({ key: "ghostcord_status", title: "Status", Component: StatusTab, Icon: StatusIcon });
        samplePing();
        pingTimer = setInterval(samplePing, 60_000);
    },
    stop() {
        removeFromArray(SettingsPlugin.customEntries, e => e.key === "ghostcord_status");
        clearInterval(pingTimer);
    },
});
