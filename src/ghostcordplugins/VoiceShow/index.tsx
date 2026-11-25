/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * UserVoiceShowPlus — restyled fork of UserVoiceShow (Nuckyz, LordElias, omaw)
 * with a pill-style badge and a red LIVE state when the user is screensharing.
 */

import { definePluginSettings } from "@api/Settings";
import ErrorBoundary from "@components/ErrorBoundary";
import { Devs, EquicordDevs } from "@utils/constants";
import { classNameFactory } from "@utils/css";
import { classes } from "@utils/misc";
import definePlugin, { OptionType } from "@utils/types";
import { Channel } from "@vencord/discord-types";
import { findByPropsLazy } from "@webpack";
import { ChannelRouter, ChannelStore, GuildStore, PermissionsBits, PermissionStore, React, showToast, Tooltip, useMemo, UserStore, UserSummaryItem, useStateFromStores, VoiceStateStore } from "@webpack/common";

const cl = classNameFactory("vc-uvsp-");
const { selectVoiceChannel } = findByPropsLazy("selectVoiceChannel", "selectChannel");

const settings = definePluginSettings({
    showInUserProfileModal: { type: OptionType.BOOLEAN, description: "Show in profiles next to the name", default: true, restartNeeded: true },
    showInMemberList: { type: OptionType.BOOLEAN, description: "Show in the member, DM and friends list", default: true, restartNeeded: true },
    showInMessages: { type: OptionType.BOOLEAN, description: "Show in messages", default: true, restartNeeded: true },
    showLabel: { type: OptionType.BOOLEAN, description: "Show text (channel name / LIVE) inside the badge in messages & profiles", default: true },
    showStreamers: { type: OptionType.BOOLEAN, description: "List who is streaming in the tooltip", default: true }
});

/* ---------------- icons ---------------- */

const Svg = ({ size = 14, children }: React.PropsWithChildren<{ size?: number; }>) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>{children}</svg>
);

const SpeakerIcon = ({ size }: { size?: number; }) => (
    <Svg size={size}>
        <path d="M12 3a1 1 0 0 0-1-1h-.06a1 1 0 0 0-.74.32L5.92 7H3a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h2.92l4.28 4.68a1 1 0 0 0 .74.32H11a1 1 0 0 0 1-1V3ZM15.1 20.75c-.58.14-1.1-.33-1.1-.92v-.03c0-.5.37-.92.85-1.05a7 7 0 0 0 0-13.5A1.11 1.11 0 0 1 14 4.2v-.03c0-.6.52-1.06 1.1-.92a9 9 0 0 1 0 17.5Z" />
        <path d="M15.16 16.51c-.57.28-1.16-.2-1.16-.83v-.14c0-.43.28-.8.63-1.02a3 3 0 0 0 0-5.04c-.35-.23-.63-.6-.63-1.02v-.14c0-.63.59-1.1 1.16-.83a5 5 0 0 1 0 9.02Z" />
    </Svg>
);

const MutedIcon = ({ size }: { size?: number; }) => (
    <Svg size={size}>
        <path d="m2.7 22.7 20-20a1 1 0 0 0-1.4-1.4l-20 20a1 1 0 1 0 1.4 1.4ZM10.8 17.32c-.21.21-.1.58.2.62V20H9a1 1 0 1 0 0 2h6a1 1 0 1 0 0-2h-2v-2.06A8 8 0 0 0 20 10a1 1 0 0 0-2 0c0 1.45-.52 2.79-1.38 3.83l-.02.02A5.99 5.99 0 0 1 12.32 16a.52.52 0 0 0-.34.15l-1.18 1.18ZM15.36 4.52c.15-.15.19-.38.08-.56A4 4 0 0 0 8 6v4c0 .3.03.58.1.86.07.34.49.43.74.18l6.52-6.52ZM5.06 13.98c.16.28.53.31.75.09l.75-.75c.16-.16.19-.4.08-.61A5.97 5.97 0 0 1 6 10a1 1 0 0 0-2 0c0 1.45.39 2.81 1.06 3.98Z" />
    </Svg>
);

const DeafIcon = ({ size }: { size?: number; }) => (
    <Svg size={size}>
        <path d="M22.7 2.7a1 1 0 0 0-1.4-1.4l-20 20a1 1 0 1 0 1.4 1.4l20-20ZM17.06 2.94a.48.48 0 0 0-.11-.77A11 11 0 0 0 2.18 16.94c.14.3.53.35.76.12l3.2-3.2c.25-.25.15-.68-.2-.76a5 5 0 0 0-1.02-.1H3.05a9 9 0 0 1 12.66-9.2c.2.09.44.05.59-.1l.76-.76ZM20.2 8.28a.52.52 0 0 1 .1-.58l.76-.76a.48.48 0 0 1 .77.11 11 11 0 0 1-4.5 14.57c-1.27.71-2.73.23-3.55-.74a3.1 3.1 0 0 1-.17-3.78l1.38-1.97a5 5 0 0 1 4.1-2.13h1.86a9.1 9.1 0 0 0-.75-4.72ZM10.1 17.9c.25-.25.65-.18.74.14a3.1 3.1 0 0 1-.62 2.84 2.85 2.85 0 0 1-3.55.74.16.16 0 0 1-.04-.25l3.48-3.48Z" />
    </Svg>
);

const ScreenIcon = ({ size }: { size?: number; }) => (
    <Svg size={size}>
        <path d="M4 3a3 3 0 0 0-3 3v9a3 3 0 0 0 3 3h7v2H8a1 1 0 1 0 0 2h8a1 1 0 1 0 0-2h-3v-2h7a3 3 0 0 0 3-3V6a3 3 0 0 0-3-3H4Zm8.7 4.3 3 3a1 1 0 0 1-1.4 1.4L13 10.42V14a1 1 0 1 1-2 0v-3.58l-1.3 1.3a1 1 0 0 1-1.4-1.42l3-3a1 1 0 0 1 1.4 0Z" />
    </Svg>
);

const LockIcon = ({ size = 10 }: { size?: number; }) => (
    <Svg size={size}>
        <path fillRule="evenodd" d="M6 9V7a6 6 0 1 1 12 0v2h1a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2h1Zm2 0h8V7a4 4 0 0 0-8 0v2Z" />
    </Svg>
);

/* ---------------- styles ---------------- */

const CSS = `
.vc-uvsp-badge {
    --uvsp-accent: var(--status-positive, #23a55a);
    display: inline-flex; align-items: center; gap: 4px;
    height: 18px; padding: 0 6px; margin-left: 4px;
    border-radius: 999px; vertical-align: middle;
    font-size: 11px; font-weight: 600; line-height: 1; white-space: nowrap;
    color: var(--uvsp-accent);
    background: color-mix(in srgb, var(--uvsp-accent) 14%, transparent);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--uvsp-accent) 35%, transparent);
    cursor: pointer; user-select: none;
    transition: background .15s ease, transform .15s ease;
}
.vc-uvsp-badge:hover { background: color-mix(in srgb, var(--uvsp-accent) 24%, transparent); transform: translateY(-1px); }
.vc-uvsp-badge.vc-uvsp-muted { --uvsp-accent: var(--text-muted, #949ba4); }
.vc-uvsp-badge.vc-uvsp-live  { --uvsp-accent: var(--status-danger, #f23f43); }
.vc-uvsp-badge.vc-uvsp-compact { padding: 0; width: 20px; justify-content: center; }
.vc-uvsp-badge.vc-uvsp-action { height: 36px; width: 36px; padding: 0; justify-content: center; margin: 0; }
.vc-uvsp-label { max-width: 110px; overflow: hidden; text-overflow: ellipsis; }
.vc-uvsp-livetag { font-size: 9px; font-weight: 800; letter-spacing: .04em; }

.vc-uvsp-dot { position: relative; width: 6px; height: 6px; border-radius: 50%; background: currentColor; flex: none; }
.vc-uvsp-live .vc-uvsp-dot::after {
    content: ""; position: absolute; inset: 0; border-radius: 50%; background: currentColor;
    animation: vc-uvsp-ping 1.4s cubic-bezier(0, 0, .2, 1) infinite;
}
@keyframes vc-uvsp-ping { 75%, 100% { transform: scale(2.4); opacity: 0; } }

.vc-uvsp-tooltip { display: flex; flex-direction: column; gap: 8px; min-width: 180px; padding: 2px; }
.vc-uvsp-tt-head { display: flex; align-items: center; gap: 8px; }
.vc-uvsp-tt-icon {
    display: grid; place-items: center; width: 28px; height: 28px; border-radius: 8px; flex: none;
    color: var(--status-positive); background: color-mix(in srgb, var(--status-positive) 16%, transparent);
}
.vc-uvsp-tt-icon.vc-uvsp-live { color: var(--status-danger); background: color-mix(in srgb, var(--status-danger) 16%, transparent); }
.vc-uvsp-tt-title { font-weight: 700; font-size: 14px; color: var(--header-primary); display: flex; align-items: center; gap: 4px; }
.vc-uvsp-tt-sub { font-size: 12px; color: var(--text-muted); }
.vc-uvsp-tt-row { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--text-normal); }
.vc-uvsp-tt-streamers { display: flex; flex-direction: column; gap: 2px; padding: 6px 8px; border-radius: 6px;
    background: color-mix(in srgb, var(--status-danger) 10%, transparent); }
.vc-uvsp-tt-streamers .vc-uvsp-tt-row { color: var(--status-danger); font-weight: 600; }
.vc-uvsp-tt-hint { font-size: 11px; color: var(--text-muted); border-top: 1px solid var(--background-modifier-accent); padding-top: 6px; }
`;

let styleEl: HTMLStyleElement | null = null;

/* ---------------- tooltip ---------------- */

function VoiceTooltip({ channel, isLocked, userId }: { channel: Channel; isLocked: boolean; userId: string; }) {
    const voiceStates = useStateFromStores([VoiceStateStore], () => VoiceStateStore.getVoiceStatesForChannel(channel.id));

    const { users, streamers } = useMemo(() => {
        const states = Object.values(voiceStates) as any[];
        return {
            users: states.map(s => UserStore.getUser(s.userId)).filter(Boolean),
            streamers: states.filter(s => s.selfStream).map(s => UserStore.getUser(s.userId)).filter(Boolean)
        };
    }, [voiceStates]);

    const selfLive = streamers.some((u: any) => u.id === userId);
    const guild = channel.guild_id ? GuildStore.getGuild(channel.guild_id) : null;
    const isDM = channel.isDM() || channel.isMultiUserDM();
    const name = isDM ? (channel.isDM() ? "Direct Call" : channel.name || "Group Call") : channel.name;

    return (
        <div className={cl("tooltip")}>
            <div className={cl("tt-head")}>
                <div className={classes(cl("tt-icon"), selfLive && cl("live"))}>
                    {selfLive ? <ScreenIcon size={16} /> : <SpeakerIcon size={16} />}
                </div>
                <div>
                    <div className={cl("tt-title")}>{isLocked && <LockIcon />}{name}</div>
                    <div className={cl("tt-sub")}>
                        {selfLive ? "Streaming now" : "In voice"}{guild ? ` · ${guild.name}` : ""} · {users.length} connected
                    </div>
                </div>
            </div>

            {settings.store.showStreamers && streamers.length > 0 && (
                <div className={cl("tt-streamers")}>
                    {streamers.map((u: any) => (
                        <div key={u.id} className={cl("tt-row")}>
                            <ScreenIcon size={12} /> {u.globalName ?? u.username} is live
                        </div>
                    ))}
                </div>
            )}

            <UserSummaryItem users={users} renderIcon={false} max={12} size={20} />
            <div className={cl("tt-hint")}>Click to view · Double-click to join</div>
        </div>
    );
}

/* ---------------- indicator ---------------- */

type Props = {
    userId: string;
    isProfile?: boolean;
    isMessageIndicator?: boolean;
    isActionButton?: boolean;
    shouldHighlight?: boolean;
};

const clickTimers = new Map<string, any>();

export const VoiceChannelIndicator = ErrorBoundary.wrap(({ userId, isProfile, isMessageIndicator, isActionButton }: Props) => {
    const state = useStateFromStores([VoiceStateStore], () => {
        const vs: any = VoiceStateStore.getVoiceStateForUser(userId);
        return {
            channelId: vs?.channelId as string | undefined,
            isMuted: !!(vs?.mute || vs?.selfMute),
            isDeaf: !!(vs?.deaf || vs?.selfDeaf),
            isLive: !!vs?.selfStream
        };
    }, [userId], (a, b) => a.channelId === b.channelId && a.isMuted === b.isMuted && a.isDeaf === b.isDeaf && a.isLive === b.isLive);

    const { channelId, isMuted, isDeaf, isLive } = state;
    const channel = channelId ? ChannelStore.getChannel(channelId) : undefined;
    if (!channel) return null;

    const isDM = channel.isDM() || channel.isMultiUserDM();
    const canView = isDM || PermissionStore.can(PermissionsBits.VIEW_CHANNEL, channel);
    if (!canView && !Vencord.Plugins.isPluginEnabled("ShowHiddenChannels")) return null;
    const isLocked = !isDM && (!canView || !PermissionStore.can(PermissionsBits.CONNECT, channel));

    function onClick(e: React.MouseEvent) {
        e.preventDefault();
        e.stopPropagation();
        if (!channelId) return;

        clearTimeout(clickTimers.get(channelId));
        clickTimers.delete(channelId);

        if (e.detail > 1) {
            if (!isDM && !PermissionStore.can(PermissionsBits.CONNECT, channel!)) {
                showToast("You cannot join the user's Voice Channel", "failure" as any);
                return;
            }
            selectVoiceChannel(channelId);
        } else {
            clickTimers.set(channelId, setTimeout(() => {
                ChannelRouter.transitionToChannel(channelId);
                clickTimers.delete(channelId);
            }, 250));
        }
    }

    const showLabel = settings.store.showLabel && (isProfile || isMessageIndicator) && !isActionButton;
    const compact = !showLabel && !isActionButton;
    const iconSize = isActionButton ? 20 : 12;

    const StateIcon = isLive ? ScreenIcon : isDeaf ? DeafIcon : isMuted ? MutedIcon : SpeakerIcon;
    const channelName = isDM ? "Call" : channel.name;

    return (
        <Tooltip text={<VoiceTooltip channel={channel} isLocked={isLocked} userId={userId} />}>
            {(tp: any) => (
                <span
                    {...tp}
                    role="button"
                    onClick={onClick}
                    className={classes(
                        cl("badge"),
                        isLive && cl("live"),
                        !isLive && (isMuted || isDeaf) && cl("muted"),
                        compact && cl("compact"),
                        isActionButton && cl("action")
                    )}
                >
                    {isLive && showLabel ? <span className={cl("dot")} /> : <StateIcon size={iconSize} />}
                    {showLabel && (isLive
                        ? <><span className={cl("livetag")}>LIVE</span><span className={cl("label")}>{channelName}</span></>
                        : <span className={cl("label")}>{isLocked && <LockIcon size={9} />} {channelName}</span>
                    )}
                </span>
            )}
        </Tooltip>
    );
}, { noop: true });

/* ---------------- plugin ---------------- */

export default definePlugin({
    name: "UserVoiceShowPlus",
    description: "Restyled voice indicator badge that also shows a red LIVE state when the user is screensharing",
    tags: ["Voice", "Appearance", "Friends"],
    dependencies: ["MemberListDecoratorsAPI", "MessageDecorationsAPI", "NicknameIconsAPI"],
    authors: [Devs.Nuckyz, Devs.LordElias, EquicordDevs.omaw],
    settings,

    start() {
        styleEl = document.createElement("style");
        styleEl.id = "vc-uvsp-style";
        styleEl.textContent = CSS;
        document.head.appendChild(styleEl);
    },
    stop() {
        styleEl?.remove();
        styleEl = null;
    },

    renderNicknameIcon({ userId }) {
        if (!settings.store.showInUserProfileModal) return null;
        return <VoiceChannelIndicator userId={userId} isProfile />;
    },
    renderMemberListDecorator({ user }) {
        if (!settings.store.showInMemberList || user == null) return null;
        return <VoiceChannelIndicator userId={user.id} />;
    },
    renderMessageDecoration({ message }) {
        if (!settings.store.showInMessages || message?.author == null) return null;
        return <VoiceChannelIndicator userId={message.author.id} isMessageIndicator />;
    },

    patches: [
        // Friends List
        {
            find: "null!=this.peopleListItemRef.current",
            replacement: {
                match: /\.isProvisional.{0,50}?className:\i\.\i,children:\[(?<=isFocused:(\i).+?)/,
                replace: "$&$self.VoiceChannelIndicator({userId:this?.props?.user?.id,isActionButton:true,shouldHighlight:$1}),"
            },
            predicate: () => settings.store.showInMemberList
        }
    ],

    VoiceChannelIndicator
});
