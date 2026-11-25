/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { definePluginSettings } from "@api/Settings";
import { classNameFactory } from "@api/Styles";
import ErrorBoundary from "@components/ErrorBoundary";
import { ModalCloseButton, ModalContent, ModalFooter, ModalHeader, ModalRoot, ModalSize, openModal } from "@utils/modal";
import definePlugin, { OptionType } from "@utils/types";
import { ChannelStore, Menu, React, RestAPI, UserStore } from "@webpack/common";

// ---------------------------------------------------------------------------
// Tiny built-in toast. Equicord removed Toasts from @webpack/common, so this
// plugin draws its own instead of depending on that export.
// ---------------------------------------------------------------------------
type ToastKind = "message" | "success" | "failure";
function toast(message: string, kind: ToastKind = "message", duration = 2600) {
    let host = document.getElementById("vc-mini-toasts");
    if (!host) {
        host = document.createElement("div");
        host.id = "vc-mini-toasts";
        host.style.cssText = "position:fixed;left:50%;bottom:84px;transform:translateX(-50%);z-index:10000;display:flex;flex-direction:column;align-items:center;gap:6px;pointer-events:none";
        document.body.appendChild(host);
    }
    const color = kind === "success" ? "var(--status-positive,#23a55a)" : kind === "failure" ? "var(--status-danger,#f23f43)" : "var(--text-muted,#949ba4)";
    const el = document.createElement("div");
    el.style.cssText = `display:flex;align-items:center;gap:8px;max-width:420px;padding:9px 14px;border:1px solid var(--border-subtle,rgb(255 255 255/8%));border-radius:10px;background:var(--background-floating,#111214);color:var(--text-default,var(--text-normal,#dbdee1));font-size:14px;font-weight:500;box-shadow:0 8px 24px rgb(0 0 0/40%);opacity:0;transform:translateY(6px);transition:opacity .15s ease,transform .15s ease`;
    const dot = document.createElement("span");
    dot.style.cssText = `flex:0 0 8px;height:8px;border-radius:50%;background:${color}`;
    const text = document.createElement("span");
    text.textContent = message;
    el.append(dot, text);
    host.appendChild(el);
    requestAnimationFrame(() => { el.style.opacity = "1"; el.style.transform = "none"; });
    setTimeout(() => {
        el.style.opacity = "0";
        el.style.transform = "translateY(6px)";
        setTimeout(() => { el.remove(); if (!host!.childElementCount) host!.remove(); }, 200);
    }, duration);
}



const cl = classNameFactory("vc-cleardms-");

export const settings = definePluginSettings({
    deleteDelay: {
        type: OptionType.SLIDER,
        description: "Delay between each deletion (ms). Lower is faster but hits Discord's rate limit more often.",
        markers: [500, 1000, 1500, 2000, 3000, 5000],
        stickToMarkers: false,
        default: 1500
    },
    skipPinned: {
        type: OptionType.BOOLEAN,
        description: "Leave pinned messages alone",
        default: true
    },
    keepRecent: {
        type: OptionType.NUMBER,
        description: "Keep your newest N messages (0 = delete all)",
        default: 0
    }
});


// ---------------------------------------------------------------------------
// Discord API
// ---------------------------------------------------------------------------

// Only normal messages, replies, and slash/context command messages can be deleted
// by their author. Call notices, pins, "X added Y", etc. can't, so skip them.
const DELETABLE_TYPES = new Set([0, 19, 20, 23]);

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

interface Job {
    cancelled: boolean;
}

async function withRateLimit<T>(fn: () => Promise<T>, job: Job): Promise<T> {
    while (true) {
        try {
            return await fn();
        } catch (e: any) {
            if (e?.status === 429 && !job.cancelled) {
                await sleep((Number(e?.body?.retry_after) || 2) * 1000 + 250);
                continue;
            }
            throw e;
        }
    }
}

async function scanMessages(channelId: string, userId: string, job: Job, onProgress: (scanned: number, found: number) => void) {
    const mine: string[] = [];
    let before: string | undefined;
    let scanned = 0;

    while (!job.cancelled) {
        const query: Record<string, string> = { limit: "100" };
        if (before) query.before = before;

        const res = await withRateLimit(() => RestAPI.get({ url: `/channels/${channelId}/messages`, query }), job);
        const batch: any[] = res?.body ?? [];
        if (!batch.length) break;

        scanned += batch.length;
        for (const m of batch) {
            if (m.author?.id !== userId || !DELETABLE_TYPES.has(m.type)) continue;
            if (settings.store.skipPinned && m.pinned) continue;
            mine.push(m.id);
        }
        onProgress(scanned, mine.length);

        before = batch[batch.length - 1].id;
        if (batch.length < 100) break;
        await sleep(300);
    }

    // newest first from the API, so the first N are the most recent
    const keep = Math.max(0, Math.floor(settings.store.keepRecent || 0));
    return keep ? mine.slice(keep) : mine;
}

async function deleteMessage(channelId: string, messageId: string, job: Job) {
    try {
        await withRateLimit(() => RestAPI.del({ url: `/channels/${channelId}/messages/${messageId}` }), job);
        return true;
    } catch (e: any) {
        // already gone counts as done
        return e?.status === 404;
    }
}

// ---------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------

const running = new Set<string>();

type Phase = "scanning" | "confirm" | "deleting" | "done" | "cancelled" | "error";

function channelTitle(channel: any) {
    if (channel.type === 1) {
        const u = UserStore.getUser(channel.recipients?.[0]);
        return u ? `@${(u as any).globalName ?? u.username}` : "this DM";
    }
    return channel.name || "this group DM";
}

function formatDuration(ms: number) {
    const s = Math.ceil(ms / 1000);
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ${s % 60}s`;
    return `${Math.floor(m / 60)}h ${m % 60}m`;
}

function ClearModal({ channel, modalProps }: { channel: any; modalProps: any; }) {
    const job = React.useRef<Job>({ cancelled: false }).current;
    const [phase, setPhase] = React.useState<Phase>("scanning");
    const [scanned, setScanned] = React.useState(0);
    const [ids, setIds] = React.useState<string[]>([]);
    const [found, setFound] = React.useState(0);
    const phaseRef = React.useRef<Phase>("scanning");
    const [deleted, setDeleted] = React.useState(0);
    const [failed, setFailed] = React.useState(0);
    const [error, setError] = React.useState("");

    const me = UserStore.getCurrentUser();
    const title = channelTitle(channel);

    // 1. scan
    React.useEffect(() => {
        running.add(channel.id);
        scanMessages(channel.id, me.id, job, (s, f) => {
            setScanned(s);
            setFound(f);
        })
            .then(found => {
                if (job.cancelled) return;
                setIds(found);
                setPhase("confirm");
            })
            .catch(e => {
                setError(e?.body?.message ?? e?.message ?? "Couldn't load messages");
                setPhase("error");
            })
            .finally(() => running.delete(channel.id));

        return () => {
            // closing the modal while scanning/confirming stops; while deleting it keeps going
            if (phaseRef.current !== "deleting") {
                job.cancelled = true;
                running.delete(channel.id);
            }
        };
    }, []);

    phaseRef.current = phase;

    // 2. delete
    const start = async () => {
        setPhase("deleting");
        running.add(channel.id);
        let ok = 0, bad = 0;

        for (const id of ids) {
            if (job.cancelled) break;
            if (await deleteMessage(channel.id, id, job)) ok++;
            else bad++;
            setDeleted(ok);
            setFailed(bad);
            await sleep(settings.store.deleteDelay);
        }

        running.delete(channel.id);
        setPhase(job.cancelled ? "cancelled" : "done");
        toast(
            job.cancelled
                ? `Stopped. Deleted ${ok} message${ok === 1 ? "" : "s"} in ${title}.`
                : `Deleted ${ok} message${ok === 1 ? "" : "s"} in ${title}${bad ? ` (${bad} failed)` : ""}.`,
            bad && !job.cancelled ? "failure" : "success"
        );
    };

    const cancel = () => {
        job.cancelled = true;
        if (phase !== "deleting") modalProps.onClose();
    };

    const total = ids.length;
    const done = deleted + failed;
    const pct = total ? Math.round((done / total) * 100) : 0;
    const eta = (total - done) * settings.store.deleteDelay;

    return (
        <ModalRoot {...modalProps} size={ModalSize.SMALL} className={cl("modal")}>
            <ModalHeader className={cl("header")}>
                <div className={cl("title")}>
                    <span className={cl("title-main")}>Clear DM</span>
                    <span className={cl("title-sub")}>{title}</span>
                </div>
                <ModalCloseButton onClick={modalProps.onClose} />
            </ModalHeader>

            <ModalContent className={cl("content")}>
                {phase === "scanning" && (
                    <div className={cl("state")}>
                        <div className={cl("spinner")} aria-hidden />
                        <div className={cl("big")}>Looking for your messages…</div>
                        <div className={cl("muted")}>
                            Scanned {scanned.toLocaleString()} · found {found.toLocaleString()} of yours
                        </div>
                    </div>
                )}

                {phase === "confirm" && (total === 0 ? (
                    <div className={cl("state")}>
                        <div className={cl("big")}>Nothing to delete</div>
                        <div className={cl("muted")}>You haven't sent any deletable messages here.</div>
                    </div>
                ) : (
                    <div className={cl("state")}>
                        <div className={cl("count")}>{total.toLocaleString()}</div>
                        <div className={cl("big")}>message{total === 1 ? "" : "s"} from you</div>
                        <div className={cl("muted")}>
                            Scanned {scanned.toLocaleString()} total · takes about {formatDuration(total * settings.store.deleteDelay)}
                        </div>
                        {(settings.store.skipPinned || settings.store.keepRecent > 0) && (
                            <div className={cl("muted", "small")}>
                                {[settings.store.skipPinned && "pinned messages skipped", settings.store.keepRecent > 0 && `newest ${settings.store.keepRecent} kept`].filter(Boolean).join(" · ")}
                            </div>
                        )}
                        <div className={cl("warning")}>
                            This can't be undone. Only your messages are deleted; the other person's stay.
                        </div>
                    </div>
                ))}

                {(phase === "deleting" || phase === "done" || phase === "cancelled") && (
                    <div className={cl("state")}>
                        <div className={cl("big")}>
                            {phase === "deleting" ? "Deleting…" : phase === "done" ? "Done" : "Stopped"}
                        </div>
                        <div
                            className={cl("bar")}
                            role="progressbar"
                            aria-valuemin={0}
                            aria-valuemax={total}
                            aria-valuenow={done}
                        >
                            <div className={cl("bar-fill", phase === "done" && "bar-done")} style={{ width: `${pct}%` }} />
                        </div>
                        <div className={cl("stats")}>
                            <span>{deleted.toLocaleString()} / {total.toLocaleString()} deleted</span>
                            {failed > 0 && <span className={cl("failed")}>{failed} failed</span>}
                            {phase === "deleting" && <span className={cl("muted")}>~{formatDuration(eta)} left</span>}
                        </div>
                        {phase === "deleting" && (
                            <div className={cl("muted", "small")}>You can close this window; it keeps going in the background.</div>
                        )}
                    </div>
                )}

                {phase === "error" && (
                    <div className={cl("state")}>
                        <div className={cl("big")}>Something went wrong</div>
                        <div className={cl("failed")}>{error}</div>
                    </div>
                )}
            </ModalContent>

            <ModalFooter className={cl("footer")}>
                {phase === "confirm" && total > 0 && (
                    <button className={cl("btn", "btn-danger")} onClick={start}>
                        Delete {total.toLocaleString()} message{total === 1 ? "" : "s"}
                    </button>
                )}
                {(phase === "scanning" || phase === "deleting") && (
                    <button className={cl("btn", "btn-secondary")} onClick={cancel}>
                        {phase === "deleting" ? "Stop" : "Cancel"}
                    </button>
                )}
                {(phase === "confirm" || phase === "done" || phase === "cancelled" || phase === "error") && (
                    <button className={cl("btn", "btn-secondary")} onClick={modalProps.onClose}>
                        {phase === "confirm" && total > 0 ? "Cancel" : "Close"}
                    </button>
                )}
            </ModalFooter>
        </ModalRoot>
    );
}

function openClearModal(channel: any) {
    if (running.has(channel.id)) {
        toast("Already clearing this DM.", "failure");
        return;
    }
    openModal(props => (
        <ErrorBoundary>
            <ClearModal channel={channel} modalProps={props} />
        </ErrorBoundary>
    ));
}

// ---------------------------------------------------------------------------
// Context menus
// ---------------------------------------------------------------------------

function menuItem(channel: any) {
    return (
        <Menu.MenuGroup>
            <Menu.MenuItem
                id="vc-clear-dm"
                label="Clear DM"
                color="danger"
                action={() => openClearModal(channel)}
            />
        </Menu.MenuGroup>
    );
}

const UserContext: NavContextMenuPatchCallback = (children, { user, channel }) => {
    const me = UserStore.getCurrentUser();
    if (!user || user.id === me?.id) return;

    const dm = channel?.type === 1 || channel?.type === 3
        ? channel
        : ChannelStore.getChannel(ChannelStore.getDMFromUserId?.(user.id));
    if (!dm || (dm.type !== 1 && dm.type !== 3)) return;

    children.splice(-1, 0, menuItem(dm));
};

// right-clicking a group DM in the DM list
const GroupDMContext: NavContextMenuPatchCallback = (children, { channel }) => {
    if (channel?.type !== 3) return;
    children.splice(-1, 0, menuItem(channel));
};


// ---- styles (built into this file so the plugin is a single file) ----
const PLUGIN_CSS = String.raw`
.vc-cleardms-modal {
    --cd-text: var(--text-default, var(--text-normal, #dbdee1));
    --cd-strong: var(--text-strong, var(--header-primary, #f2f3f5));
    --cd-muted: var(--text-muted, #949ba4);
    --cd-surface: var(--background-surface-high, var(--background-secondary, #2b2d31));
    --cd-danger: var(--status-danger, #da373c);
    --cd-success: var(--status-positive, #23a55a);
    color: var(--cd-text);
}

.vc-cleardms-header {
    justify-content: space-between;
}

.vc-cleardms-title {
    display: flex;
    flex-direction: column;
    min-width: 0;
}

.vc-cleardms-title-main {
    color: var(--cd-strong);
    font-size: 20px;
    font-weight: 700;
}

.vc-cleardms-title-sub {
    overflow: hidden;
    color: var(--cd-muted);
    font-size: 14px;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.vc-cleardms-content {
    padding-bottom: 20px;
}

.vc-cleardms-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    padding: 20px 0 8px;
    text-align: center;
}

.vc-cleardms-count {
    color: var(--cd-strong);
    font-size: 44px;
    font-weight: 800;
    line-height: 1;
    font-variant-numeric: tabular-nums;
}

.vc-cleardms-big {
    color: var(--cd-strong);
    font-size: 16px;
    font-weight: 600;
}

.vc-cleardms-muted {
    color: var(--cd-muted);
    font-size: 13px;
    font-variant-numeric: tabular-nums;
}

.vc-cleardms-small {
    font-size: 12px;
}

.vc-cleardms-warning {
    margin-top: 8px;
    padding: 10px 12px;
    border: 1px solid color-mix(in srgb, var(--cd-danger) 35%, transparent);
    border-radius: 10px;
    background: color-mix(in srgb, var(--cd-danger) 12%, transparent);
    color: var(--cd-text);
    font-size: 13px;
    text-align: left;
}

.vc-cleardms-failed {
    color: var(--cd-danger);
    font-size: 13px;
}

/* ---------- progress ---------- */
.vc-cleardms-bar {
    width: 100%;
    height: 10px;
    border: 1px solid var(--border-subtle, rgb(255 255 255 / 7%));
    margin-top: 4px;
    overflow: hidden;
    border-radius: 4px;
    background: var(--cd-surface);
}

.vc-cleardms-bar-fill {
    height: 100%;
    border-radius: 4px;
    background: linear-gradient(90deg, var(--cd-danger), color-mix(in srgb, var(--cd-danger) 60%, #ff9a9a));
    transition: width 0.3s ease;
}

.vc-cleardms-bar-done {
    background: var(--cd-success);
}

.vc-cleardms-stats {
    display: flex;
    gap: 12px;
    font-size: 13px;
    font-variant-numeric: tabular-nums;
}

/* ---------- spinner ---------- */
.vc-cleardms-spinner {
    width: 32px;
    height: 32px;
    border: 3px solid var(--cd-surface);
    border-top-color: var(--cd-strong);
    border-radius: 50%;
    animation: vc-cleardms-spin 0.8s linear infinite;
}

@keyframes vc-cleardms-spin {
    to { transform: rotate(360deg); }
}

@media (prefers-reduced-motion: reduce) {
    .vc-cleardms-spinner { animation-duration: 2.5s; }
    .vc-cleardms-bar-fill { transition: none; }
}

/* ---------- footer buttons ---------- */
.vc-cleardms-footer {
    gap: 8px;
}

.vc-cleardms-btn {
    min-width: 96px;
    height: 38px;
    padding: 0 16px;
    border: none;
    border-radius: 8px;
    color: #fff;
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
    transition: filter 0.15s ease;
}

.vc-cleardms-btn:hover {
    filter: brightness(1.1);
}

.vc-cleardms-btn:focus-visible {
    outline: 2px solid var(--focus-primary, #00b0f4);
    outline-offset: 2px;
}

.vc-cleardms-btn-danger {
    background: var(--cd-danger);
}

.vc-cleardms-btn-secondary {
    background: var(--cd-surface);
    color: var(--cd-text);
}

.vc-cleardms-btn-secondary:hover {
    filter: brightness(1.15);
}

/* motion */
.vc-cleardms-state {
    animation: vc-cleardms-in 0.2s ease-out both;
}

@keyframes vc-cleardms-in {
    from { opacity: 0; transform: translateY(4px); }
    to { opacity: 1; transform: none; }
}

.vc-cleardms-count {
    animation: vc-cleardms-pop 0.3s cubic-bezier(.2,1.4,.4,1) both;
}

@keyframes vc-cleardms-pop {
    from { opacity: 0; transform: scale(0.6); }
    to { opacity: 1; transform: none; }
}

@media (prefers-reduced-motion: reduce) {
    .vc-cleardms-state, .vc-cleardms-count { animation: none; }
}
`;

function injectPluginCss() {
    if (document.getElementById("vc-cleardms-style")) return;
    const el = document.createElement("style");
    el.id = "vc-cleardms-style";
    el.textContent = PLUGIN_CSS;
    document.head.appendChild(el);
}

function removePluginCss() {
    document.getElementById("vc-cleardms-style")?.remove();
}

export default definePlugin({
    name: "ClearDMs",
    description: "Adds a 'Clear DM' option to user and group DM right-click menus to delete all your sent messages in that conversation",
    authors: [{ name: "cuteskid", id: 1471344839596576799n }],
    settings,

    start() {
        injectPluginCss();
    },

    stop() {
        removePluginCss();
    },

    contextMenus: {
        "user-context": UserContext,
        "gdm-context": GroupDMContext
    }
});
