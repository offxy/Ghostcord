/*
 * Nightcord, a Discord client mod
 * Copyright (c) 2026 Nightcord contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import * as DataStore from "@api/DataStore";
import { findGroupChildrenByChildId, NavContextMenuPatchCallback } from "@api/ContextMenu";
import definePlugin from "@utils/types";
import { Avatar, Constants, GuildStore, Menu, PermissionsBits, PermissionStore, React, RestAPI, ScrollerThin, SelectedGuildStore, UserStore, VoiceStateStore } from "@webpack/common";
import { Card } from "@components/Card";
import { Flex } from "@components/Flex";
import { Switch } from "@components/Switch";

import { findByPropsLazy } from "@webpack";
const GuildVoiceActions = findByPropsLazy("setServerMute", "setChannel") ?? findByPropsLazy("setServerMute");

// Key format: `${guildId}:${userId}`
const autoDecoedUsers = new Set<string>();
const listeners = new Set<() => void>();
let radarInterval: ReturnType<typeof setInterval> | null = null;
const pendingDecos = new Set<string>();
const decoCooldowns = new Map<string, number>();

function notifyChange() {
    listeners.forEach(l => l());
}

async function loadAutoDecoed() {
    try {
        const saved = await DataStore.get<string[]>("AutoDeco_users");
        if (Array.isArray(saved)) {
            autoDecoedUsers.clear();
            saved.forEach(k => autoDecoedUsers.add(k));
            notifyChange();
            radarSweepDecos();
        }
    } catch { }
}

async function saveAutoDecoed() {
    try {
        await DataStore.set("AutoDeco_users", Array.from(autoDecoedUsers));
        notifyChange();
    } catch { }
}

async function setServerDisconnect(guildId: string, userId: string): Promise<boolean> {
    const key = `${guildId}:${userId}`;
    const now = Date.now();

    // Cooldown check (prevent spam on 403 Forbidden or 429 Rate-Limit)
    const cooldownUntil = decoCooldowns.get(key) || 0;
    if (now < cooldownUntil) {
        return false;
    }

    // In-flight request lock
    if (pendingDecos.has(key)) {
        return false;
    }
    pendingDecos.add(key);

    // 1. Instant native Discord voice action
    try {
        if (typeof GuildVoiceActions?.setChannel === "function") {
            GuildVoiceActions.setChannel(guildId, userId, null);
        }
    } catch { }

    // 2. Dual-layer REST API patch
    try {
        await RestAPI.patch({
            url: `/guilds/${guildId}/members/${userId}`,
            body: { channel_id: null }
        });
        decoCooldowns.delete(key);
        return true;
    } catch (e: any) {
        const status = e?.status || e?.statusCode || e?.body?.code;
        if (status === 403 || String(e?.message).includes("403")) {
            // Missing permission or target user has higher role hierarchy -> cooldown 10s
            decoCooldowns.set(key, Date.now() + 10_000);
        } else if (status === 429 || String(e?.message).includes("429")) {
            const retryAfter = e?.body?.retry_after ? Number(e.body.retry_after) * 1000 : 3000;
            decoCooldowns.set(key, Date.now() + Math.max(retryAfter, 3000));
        } else {
            decoCooldowns.set(key, Date.now() + 3000);
        }
        return false;
    } finally {
        pendingDecos.delete(key);
    }
}

function radarSweepDecos() {
    if (autoDecoedUsers.size === 0) return;

    for (const key of autoDecoedUsers) {
        const [guildId, userId] = key.split(":");
        if (!guildId || !userId) continue;

        const vs = VoiceStateStore?.getVoiceStateForUser?.(userId)
            ?? VoiceStateStore?.getVoiceState?.(guildId, userId);

        // ONLY trigger if user is actively connected in a voice channel
        if (vs?.channelId) {
            setServerDisconnect(guildId, userId).catch(() => { });
        }
    }
}

function processVoiceState(state: any) {
    if (!state) return;
    const userId = state.userId || state.user_id;
    if (!userId) return;

    for (const key of autoDecoedUsers) {
        if (key.endsWith(`:${userId}`)) {
            const [guildId] = key.split(":");
            const stateGuildId = state.guildId || state.guild_id;
            if (stateGuildId && stateGuildId !== guildId) continue;

            const vs = VoiceStateStore?.getVoiceStateForUser?.(userId)
                ?? VoiceStateStore?.getVoiceState?.(guildId, userId);

            const rawChannelId = state.channelId !== undefined ? state.channelId : state.channel_id;
            const channelId = rawChannelId !== undefined ? rawChannelId : vs?.channelId;

            // If target is connected to a voice channel, immediately disconnect them
            if (channelId) {
                setServerDisconnect(guildId, userId).catch(() => { });
            }
        }
    }
}

const UserContextMenuPatch: NavContextMenuPatchCallback = (children, ctx: { user?: any; guildId?: string; channel?: any; } = {}) => {
    const { user, channel } = ctx;

    if (!user || !Array.isArray(children)) return;

    const guildId =
        ctx.guildId
        ?? channel?.guild_id
        ?? channel?.guildId
        ?? (SelectedGuildStore as any)?.getGuildId?.();

    if (!guildId) return;

    const key = `${guildId}:${user.id}`;
    const isAutoDecoed = autoDecoedUsers.has(key);

    const toggleAutoDeco = () => {
        if (autoDecoedUsers.has(key)) {
            autoDecoedUsers.delete(key);
            void saveAutoDecoed();
            return;
        }

        autoDecoedUsers.add(key);
        void saveAutoDecoed();

        // Disconnect immediately when enabled.
        void setServerDisconnect(guildId, user.id);
    };

    // Add directly to the user context menu. Do not depend on Discord's
    // internal menu item IDs, since those can change between Discord builds.
    if (children.some(child => child?.props?.id === "auto-deco")) return;

    children.push(
        <Menu.MenuSeparator key={`auto-deco-separator-${guildId}-${user.id}`} />,
        <Menu.MenuCheckboxItem
            key={`auto-deco-${guildId}-${user.id}`}
            id="auto-deco"
            label="Auto Deco"
            color="danger"
            checked={isAutoDecoed}
            action={toggleAutoDeco}
        />
    );
};

interface TargetUserInfo {
    name: string;
    username: string;
    avatarUrl: string;
}

const userCache = new Map<string, TargetUserInfo>();

function useTargetUser(userId: string): TargetUserInfo {
    const cachedStore = UserStore.getUser(userId);
    const initial: TargetUserInfo = userCache.get(userId) || {
        name: (cachedStore as any)?.globalName || (cachedStore as any)?.global_name || cachedStore?.username || userId,
        username: cachedStore?.username ? `@${cachedStore.username}` : "",
        avatarUrl: cachedStore?.avatar
            ? `https://cdn.discordapp.com/avatars/${userId}/${cachedStore.avatar}.webp?size=64`
            : `https://cdn.discordapp.com/embed/avatars/${Number(BigInt(userId) >> 22n) % 6}.png`
    };

    const [info, setInfo] = React.useState<TargetUserInfo>(initial);

    React.useEffect(() => {
        const u = UserStore.getUser(userId);
        if (u) {
            const data: TargetUserInfo = {
                name: (u as any).globalName || (u as any).global_name || u.username,
                username: u.username ? `@${u.username}` : "",
                avatarUrl: u.avatar
                    ? `https://cdn.discordapp.com/avatars/${userId}/${u.avatar}.webp?size=64`
                    : `https://cdn.discordapp.com/embed/avatars/${Number(BigInt(userId) >> 22n) % 6}.png`
            };
            userCache.set(userId, data);
            setInfo(data);
            return;
        }

        if (userCache.has(userId)) {
            setInfo(userCache.get(userId)!);
            return;
        }

        RestAPI.get({ url: Constants.Endpoints.USER(userId) })
            .then((res: any) => {
                const b = res?.body;
                if (b) {
                    const data: TargetUserInfo = {
                        name: b.global_name || b.username || userId,
                        username: b.username ? `@${b.username}` : "",
                        avatarUrl: b.avatar
                            ? `https://cdn.discordapp.com/avatars/${userId}/${b.avatar}.webp?size=64`
                            : `https://cdn.discordapp.com/embed/avatars/${Number(BigInt(userId) >> 22n) % 6}.png`
                    };
                    userCache.set(userId, data);
                    setInfo(data);
                }
            })
            .catch(() => { });
    }, [userId]);

    return info;
}

function TargetRow({
    guildId,
    userId,
    onRemove,
}: {
    guildId: string;
    userId: string;
    onRemove: () => void;
}) {
    const userInfo = useTargetUser(userId);
    const guild = GuildStore.getGuild(guildId);
    const serverName = guild?.name || guildId;

    return (
        <div className="vc-autodeco-target">
            <div className="vc-autodeco-target-main">
                <Avatar src={userInfo.avatarUrl} size="SIZE_40" />
                <div className="vc-autodeco-target-info">
                    <div className="vc-autodeco-target-name-row">
                        <span className="vc-autodeco-target-name">{userInfo.name}</span>
                        {userInfo.username && (
                            <span className="vc-autodeco-target-username">{userInfo.username}</span>
                        )}
                    </div>
                    <div className="vc-autodeco-target-server">
                        <span className="vc-autodeco-server-dot" />
                        {serverName}
                    </div>
                </div>
            </div>

            <div className="vc-autodeco-target-actions">
                <span className="vc-autodeco-active">ACTIVE</span>
                <Switch checked={true} onChange={onRemove} />
            </div>
        </div>
    );
}

function AutoDecoSettingsComponent() {
    const [, forceUpdate] = React.useReducer(x => x + 1, 0);
    const [query, setQuery] = React.useState("");

    React.useEffect(() => {
        const listener = () => forceUpdate();
        listeners.add(listener);
        return () => {
            listeners.delete(listener);
        };
    }, []);

    const entries = Array.from(autoDecoedUsers)
        .map(key => {
            const [guildId, userId] = key.split(":");
            return { key, guildId, userId };
        })
        .filter(({ guildId, userId }) => {
            if (!query.trim()) return true;

            const user = UserStore.getUser(userId);
            const guild = GuildStore.getGuild(guildId);
            const q = query.trim().toLowerCase();

            return (
                user?.username?.toLowerCase().includes(q) ||
                (user as any)?.globalName?.toLowerCase().includes(q) ||
                guild?.name?.toLowerCase().includes(q)
            );
        });

    const totalTargets = autoDecoedUsers.size;

    return (
        <div className="vc-autodeco-settings">
            <div className="vc-autodeco-hero">
                <div className="vc-autodeco-hero-icon">⚡</div>
                <div className="vc-autodeco-hero-copy">
                    <div className="vc-autodeco-title">Auto Deco</div>
                    <div className="vc-autodeco-subtitle">
                        Automatically disconnect selected users when they join a voice channel.
                    </div>
                </div>
                <div className="vc-autodeco-badge">
                    <span className="vc-autodeco-badge-dot" />
                    {totalTargets > 0 ? "ACTIVE" : "READY"}
                </div>
            </div>

            <div className="vc-autodeco-stats">
                <div className="vc-autodeco-stat">
                    <span className="vc-autodeco-stat-value">{totalTargets}</span>
                    <span className="vc-autodeco-stat-label">Targets</span>
                </div>
                <div className="vc-autodeco-stat-divider" />
                <div className="vc-autodeco-stat">
                    <span className="vc-autodeco-stat-value">24/7</span>
                    <span className="vc-autodeco-stat-label">Monitoring</span>
                </div>
                <div className="vc-autodeco-stat-divider" />
                <div className="vc-autodeco-stat">
                    <span className="vc-autodeco-stat-value">Auto</span>
                    <span className="vc-autodeco-stat-label">Disconnect</span>
                </div>
            </div>

            {totalTargets > 0 && (
                <div className="vc-autodeco-search">
                    <span className="vc-autodeco-search-icon">⌕</span>
                    <input
                        value={query}
                        onChange={e => setQuery(e.currentTarget.value)}
                        placeholder="Search targets or servers..."
                        aria-label="Search Auto Deco targets"
                    />
                    {query && (
                        <button
                            className="vc-autodeco-search-clear"
                            onClick={() => setQuery("")}
                            aria-label="Clear search"
                        >
                            ×
                        </button>
                    )}
                </div>
            )}

            <div className="vc-autodeco-section-header">
                <div>
                    <div className="vc-autodeco-section-title">Protected Users</div>
                    <div className="vc-autodeco-section-description">
                        These users will be disconnected automatically.
                    </div>
                </div>
                <span className="vc-autodeco-count">
                    {query ? `${entries.length} / ${totalTargets}` : totalTargets}
                </span>
            </div>

            {totalTargets === 0 ? (
                <div className="vc-autodeco-empty">
                    <div className="vc-autodeco-empty-icon">✓</div>
                    <div className="vc-autodeco-empty-title">No targets yet</div>
                    <div className="vc-autodeco-empty-text">
                        Right-click a user in a server and choose <strong>Auto Deco</strong> to add them here.
                    </div>
                </div>
            ) : entries.length === 0 ? (
                <div className="vc-autodeco-empty vc-autodeco-empty-small">
                    <div className="vc-autodeco-empty-title">No matches</div>
                    <div className="vc-autodeco-empty-text">
                        Try a different username or server name.
                    </div>
                </div>
            ) : (
                <ScrollerThin
                    fade
                    className="vc-autodeco-list"
                >
                    <div className="vc-autodeco-list-inner">
                        {entries.map(({ key, guildId, userId }) => (
                            <TargetRow
                                key={key}
                                guildId={guildId}
                                userId={userId}
                                onRemove={() => {
                                    autoDecoedUsers.delete(key);
                                    void saveAutoDecoed();
                                }}
                            />
                        ))}
                    </div>
                </ScrollerThin>
            )}

            <div className="vc-autodeco-footer-note">
                <span className="vc-autodeco-footer-dot" />
                Auto Deco runs in the background while the plugin is enabled.
            </div>
        </div>
    );
}

const AUTO_DECO_CSS = String.raw`
.vc-autodeco-settings {
    --ad-text: var(--text-default, var(--text-normal, #dbdee1));
    --ad-strong: var(--text-strong, var(--header-primary, #f2f3f5));
    --ad-muted: var(--text-muted, #949ba4);
    --ad-surface: var(--background-surface-high, var(--background-secondary, #2b2d31));
    --ad-surface-low: var(--background-secondary, #2b2d31);
    --ad-accent: var(--brand-500, #5865f2);
    --ad-success: var(--status-positive, #23a55a);
    width: 100%;
    color: var(--ad-text);
}

.vc-autodeco-hero {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 16px;
    border: 1px solid color-mix(in srgb, var(--ad-strong) 8%, transparent);
    border-radius: 10px;
    background:
        linear-gradient(
            135deg,
            color-mix(in srgb, var(--ad-accent) 14%, transparent),
            transparent 55%
        ),
        var(--ad-surface-low);
}

.vc-autodeco-hero-icon {
    display: flex;
    flex: 0 0 42px;
    width: 42px;
    height: 42px;
    align-items: center;
    justify-content: center;
    border-radius: 10px;
    background: color-mix(in srgb, var(--ad-accent) 18%, transparent);
    font-size: 21px;
}

.vc-autodeco-hero-copy {
    min-width: 0;
    flex: 1;
}

.vc-autodeco-title {
    color: var(--ad-strong);
    font-size: 18px;
    font-weight: 700;
    line-height: 1.25;
}

.vc-autodeco-subtitle {
    margin-top: 3px;
    color: var(--ad-muted);
    font-size: 12px;
    line-height: 1.45;
}

.vc-autodeco-badge {
    display: flex;
    flex: 0 0 auto;
    align-items: center;
    gap: 6px;
    padding: 5px 8px;
    border-radius: 5px;
    background: color-mix(in srgb, var(--ad-success) 12%, transparent);
    color: var(--ad-success);
    font-size: 10px;
    font-weight: 700;
    letter-spacing: .4px;
}

.vc-autodeco-badge-dot,
.vc-autodeco-footer-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--ad-success);
}

.vc-autodeco-stats {
    display: flex;
    align-items: stretch;
    margin-top: 10px;
    padding: 12px 0;
    border: 1px solid color-mix(in srgb, var(--ad-strong) 6%, transparent);
    border-radius: 8px;
    background: color-mix(in srgb, var(--ad-surface) 70%, transparent);
}

.vc-autodeco-stat {
    display: flex;
    flex: 1;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 2px;
}

.vc-autodeco-stat-value {
    color: var(--ad-strong);
    font-size: 15px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
}

.vc-autodeco-stat-label {
    color: var(--ad-muted);
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: .45px;
}

.vc-autodeco-stat-divider {
    width: 1px;
    background: color-mix(in srgb, var(--ad-strong) 8%, transparent);
}

.vc-autodeco-search {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 36px;
    margin-top: 12px;
    padding: 0 10px;
    border: 1px solid color-mix(in srgb, var(--ad-strong) 9%, transparent);
    border-radius: 6px;
    background: var(--ad-surface);
    transition: border-color .15s ease, box-shadow .15s ease;
}

.vc-autodeco-search:focus-within {
    border-color: color-mix(in srgb, var(--ad-accent) 65%, transparent);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--ad-accent) 12%, transparent);
}

.vc-autodeco-search-icon {
    color: var(--ad-muted);
    font-size: 20px;
    line-height: 1;
}

.vc-autodeco-search input {
    min-width: 0;
    flex: 1;
    border: 0;
    outline: 0;
    background: transparent;
    color: var(--ad-text);
    font-size: 13px;
}

.vc-autodeco-search input::placeholder {
    color: var(--ad-muted);
}

.vc-autodeco-search-clear {
    display: flex;
    width: 22px;
    height: 22px;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: 0;
    border-radius: 4px;
    background: transparent;
    color: var(--ad-muted);
    font-size: 18px;
    cursor: pointer;
}

.vc-autodeco-search-clear:hover {
    background: color-mix(in srgb, var(--ad-strong) 8%, transparent);
    color: var(--ad-strong);
}

.vc-autodeco-section-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin: 18px 2px 8px;
}

.vc-autodeco-section-title {
    color: var(--ad-strong);
    font-size: 13px;
    font-weight: 700;
}

.vc-autodeco-section-description {
    margin-top: 2px;
    color: var(--ad-muted);
    font-size: 11px;
}

.vc-autodeco-count {
    min-width: 25px;
    padding: 3px 7px;
    border-radius: 10px;
    background: var(--ad-surface);
    color: var(--ad-muted);
    font-size: 11px;
    font-weight: 600;
    text-align: center;
    font-variant-numeric: tabular-nums;
}

.vc-autodeco-list {
    max-height: 300px;
    padding-right: 4px;
}

.vc-autodeco-list-inner {
    display: flex;
    flex-direction: column;
    gap: 6px;
}

.vc-autodeco-target {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    min-height: 58px;
    padding: 8px 10px;
    border: 1px solid color-mix(in srgb, var(--ad-strong) 6%, transparent);
    border-radius: 8px;
    background: var(--ad-surface);
    transition: background .15s ease, border-color .15s ease, transform .15s ease;
}

.vc-autodeco-target:hover {
    border-color: color-mix(in srgb, var(--ad-strong) 11%, transparent);
    background: color-mix(in srgb, var(--ad-surface) 85%, var(--ad-strong));
    transform: translateY(-1px);
}

.vc-autodeco-target-main {
    display: flex;
    min-width: 0;
    align-items: center;
    gap: 10px;
}

.vc-autodeco-target-info {
    min-width: 0;
}

.vc-autodeco-target-name-row {
    display: flex;
    min-width: 0;
    align-items: baseline;
    gap: 7px;
}

.vc-autodeco-target-name {
    overflow: hidden;
    color: var(--ad-strong);
    font-size: 13px;
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.vc-autodeco-target-username {
    overflow: hidden;
    color: var(--ad-muted);
    font-size: 11px;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.vc-autodeco-target-server {
    display: flex;
    align-items: center;
    gap: 5px;
    margin-top: 3px;
    overflow: hidden;
    color: var(--ad-muted);
    font-size: 10px;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.vc-autodeco-server-dot {
    width: 5px;
    height: 5px;
    flex: 0 0 auto;
    border-radius: 50%;
    background: var(--ad-muted);
}

.vc-autodeco-target-actions {
    display: flex;
    flex: 0 0 auto;
    align-items: center;
    gap: 8px;
}

.vc-autodeco-active {
    padding: 3px 5px;
    border-radius: 4px;
    background: color-mix(in srgb, var(--ad-success) 10%, transparent);
    color: var(--ad-success);
    font-size: 9px;
    font-weight: 700;
    letter-spacing: .35px;
}

.vc-autodeco-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 28px 18px;
    border: 1px dashed color-mix(in srgb, var(--ad-strong) 10%, transparent);
    border-radius: 8px;
    background: color-mix(in srgb, var(--ad-surface) 55%, transparent);
    text-align: center;
    animation: vc-autodeco-in .2s ease-out both;
}

.vc-autodeco-empty-small {
    padding: 20px;
}

.vc-autodeco-empty-icon {
    display: flex;
    width: 36px;
    height: 36px;
    align-items: center;
    justify-content: center;
    margin-bottom: 9px;
    border-radius: 50%;
    background: color-mix(in srgb, var(--ad-success) 12%, transparent);
    color: var(--ad-success);
    font-size: 17px;
    font-weight: 700;
}

.vc-autodeco-empty-title {
    color: var(--ad-strong);
    font-size: 13px;
    font-weight: 650;
}

.vc-autodeco-empty-text {
    max-width: 390px;
    margin-top: 5px;
    color: var(--ad-muted);
    font-size: 11px;
    line-height: 1.5;
}

.vc-autodeco-footer-note {
    display: flex;
    align-items: center;
    gap: 7px;
    margin-top: 12px;
    color: var(--ad-muted);
    font-size: 10px;
}

@keyframes vc-autodeco-in {
    from {
        opacity: 0;
        transform: translateY(4px);
    }
    to {
        opacity: 1;
        transform: none;
    }
}

@media (prefers-reduced-motion: reduce) {
    .vc-autodeco-target,
    .vc-autodeco-empty {
        transition: none;
        animation: none;
    }
}
`;

function injectAutoDecoCss() {
    if (document.getElementById("vc-autodeco-style")) return;
    const el = document.createElement("style");
    el.id = "vc-autodeco-style";
    el.textContent = AUTO_DECO_CSS;
    document.head.appendChild(el);
}

function removeAutoDecoCss() {
    document.getElementById("vc-autodeco-style")?.remove();
}

export default definePlugin({
    name: "AutoDeco",
    description: "Automatically disconnects selected users whenever they join a voice channel.",
    authors: [
        { name: "Nightcord", id: 0n }
    ],
    enabledByDefault: false,

    settingsAboutComponent: AutoDecoSettingsComponent,

    contextMenus: {
        "user-context": UserContextMenuPatch
    },

    flux: {
        VOICE_STATE_UPDATES({ voiceStates }: { voiceStates: any[]; }) {
            radarSweepDecos();
            if (Array.isArray(voiceStates)) {
                for (const state of voiceStates) {
                    processVoiceState(state);
                }
            }
        },
        VOICE_STATE_UPDATE(state: any) {
            radarSweepDecos();
            processVoiceState(state);
        },
        PASSIVE_UPDATE_V2() {
            radarSweepDecos();
        },
        CHANNEL_UPDATES() {
            radarSweepDecos();
        },
        AUDIO_SET_LOCAL_MUTE() {
            radarSweepDecos();
        },
        RTC_CONNECTION_STATE() {
            radarSweepDecos();
        },
        GUILD_MEMBER_UPDATE() {
            radarSweepDecos();
        }
    },

    start() {
        injectAutoDecoCss();
        loadAutoDecoed();
        try {
            VoiceStateStore?.addChangeListener?.(radarSweepDecos);
        } catch { }

        if (!radarInterval) {
            radarInterval = setInterval(() => {
                radarSweepDecos();
            }, 3000);
        }
    },

    stop() {
        removeAutoDecoCss();
        if (radarInterval) {
            clearInterval(radarInterval);
            radarInterval = null;
        }
        try {
            VoiceStateStore?.removeChangeListener?.(radarSweepDecos);
        } catch { }
        autoDecoedUsers.clear();
        pendingDecos.clear();
        decoCooldowns.clear();
        notifyChange();
    }
});
