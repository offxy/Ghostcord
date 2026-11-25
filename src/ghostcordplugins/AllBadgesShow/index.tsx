/*
 * AllBadgesInChat — Equicord userplugin
 * Shows every badge a user has next to their name in chat:
 *  - Discord profile badges (Staff, Partner, HypeSquad, Nitro, Boost, Quests,
 *    Orbs, Legacy Username, Active Developer, and anything Discord adds later)
 *  - Client badges from the Badge API (Vencord / Equicord donors and
 *    contributors, and any plugin that registers badges)
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { _getBadges, ProfileBadge } from "@api/Badges";
import { definePluginSettings } from "@api/Settings";
import ErrorBoundary from "@components/ErrorBoundary";
import definePlugin, { OptionType } from "@utils/types";
import { findByCodeLazy } from "@webpack";
import { React, Tooltip, UserProfileStore, UserStore, useStateFromStores } from "@webpack/common";

const fetchUserProfile = findByCodeLazy("USER_PROFILE_FETCH_START");

const settings = definePluginSettings({
    showDiscordBadges: { type: OptionType.BOOLEAN, description: "Show Discord badges (Nitro, Boost, Quests, Orbs, …)", default: true },
    showClientBadges: { type: OptionType.BOOLEAN, description: "Show Vencord / Equicord / plugin badges", default: true },
    fetchProfiles: { type: OptionType.BOOLEAN, description: "Load profiles you haven't opened yet so their Discord badges show (slow, rate-limited)", default: true },
    showOnBots: { type: OptionType.BOOLEAN, description: "Show badges on bots too", default: false },
    showOnSelf: { type: OptionType.BOOLEAN, description: "Show badges on your own messages", default: true },
    style: {
        type: OptionType.SELECT,
        description: "How the badges look",
        options: [
            { label: "Pill (grouped in a soft pill)", value: "pill", default: true },
            { label: "Plain (just the icons)", value: "plain" }
        ]
    },
    badgeSize: { type: OptionType.SLIDER, description: "Badge size (px)", markers: [12, 14, 16, 18, 20, 24], default: 16, stickToMarkers: true },
    maxBadges: { type: OptionType.NUMBER, description: "Most badges to show per message, the rest go into +N (0 = no limit)", default: 0 },
});

// ---------------------------------------------------------------------------
// Rate-limited profile fetching
// ---------------------------------------------------------------------------

const requested = new Set<string>();
const queue: string[] = [];
let running = false;
let stopped = false;

function queueFetch(userId: string) {
    if (requested.has(userId)) return;
    requested.add(userId);
    queue.push(userId);
    if (!running) void runQueue();
}

async function runQueue() {
    running = true;
    while (queue.length && !stopped) {
        const id = queue.shift()!;
        if (UserProfileStore.getUserProfile(id)) continue;
        try { await fetchUserProfile(id, { withMutualGuilds: false, withMutualFriends: false }); } catch { /* 404 / private */ }
        await new Promise(r => setTimeout(r, 1500));
    }
    running = false;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

interface ShownBadge {
    key: string;
    label: string;
    src?: string;
    link?: string;
    custom?: React.ReactNode;
}

function openLink(link?: string) {
    if (!link) return;
    try { window.open(link, "_blank", "noopener"); } catch { /* ignore */ }
}

function BadgeIcon({ b, size }: { b: ShownBadge; size: number; }) {
    return (
        <Tooltip text={b.label}>
            {(props: any) => (
                <span
                    {...props}
                    className={"vc-abic-badge" + (b.link ? " vc-abic-link" : "")}
                    role={b.link ? "link" : "img"}
                    aria-label={b.label}
                    onClick={() => openLink(b.link)}
                >
                    {b.custom ?? <img src={b.src} alt="" width={size} height={size} draggable={false} />}
                </span>
            )}
        </Tooltip>
    );
}

function useBadges(userId: string, guildId?: string): ShownBadge[] {
    const { showDiscordBadges, showClientBadges, fetchProfiles } = settings.use(["showDiscordBadges", "showClientBadges", "fetchProfiles"]);
    const profile = useStateFromStores([UserProfileStore], () => UserProfileStore.getUserProfile(userId), [userId]);

    React.useEffect(() => {
        if (showDiscordBadges && fetchProfiles && !profile) queueFetch(userId);
    }, [userId, !!profile, showDiscordBadges, fetchProfiles]);

    return React.useMemo(() => {
        const out: ShownBadge[] = [];
        const seen = new Set<string>();
        const add = (b: ShownBadge) => {
            const id = b.src ?? b.label;
            if (seen.has(id)) return;
            seen.add(id);
            out.push(b);
        };

        if (showDiscordBadges) {
            for (const b of (profile as any)?.badges ?? []) {
                add({
                    key: "d-" + b.id,
                    src: `https://cdn.discordapp.com/badge-icons/${b.icon}.png`,
                    label: b.description,
                    link: b.link
                });
            }
        }

        if (showClientBadges) {
            let client: ProfileBadge[] = [];
            try { client = _getBadges({ userId, guildId } as any); } catch { /* ignore */ }
            client.forEach((b: any, i) => {
                const Comp = b.component;
                add({
                    key: `c-${i}-${b.description ?? b.key ?? ""}`,
                    src: b.image ?? b.iconSrc,
                    label: b.description ?? "Badge",
                    link: b.link,
                    custom: Comp ? <Comp userId={userId} guildId={guildId} /> : undefined
                });
            });
        }
        return out;
    }, [profile, userId, guildId, showDiscordBadges, showClientBadges]);
}

function ChatBadges({ userId, guildId }: { userId: string; guildId?: string; }) {
    const { badgeSize, maxBadges, style } = settings.use(["badgeSize", "maxBadges", "style"]);
    const badges = useBadges(userId, guildId);
    if (!badges.length) return null;

    const limit = maxBadges > 0 ? maxBadges : badges.length;
    const shown = badges.slice(0, limit);
    const hidden = badges.slice(limit);

    return (
        <span
            className={`vc-abic-row vc-abic-${style}`}
            style={{ "--abic-size": `${badgeSize}px` } as React.CSSProperties}
        >
            {shown.map(b => <BadgeIcon key={b.key} b={b} size={badgeSize} />)}
            {hidden.length > 0 && (
                <Tooltip text={hidden.map(b => b.label).join("\n")}>
                    {(props: any) => <span {...props} className="vc-abic-more">+{hidden.length}</span>}
                </Tooltip>
            )}
        </span>
    );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const CSS = String.raw`
.vc-abic-row {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    margin-left: 6px;
    vertical-align: middle;
    line-height: 0;
}
.vc-abic-pill {
    padding: 2px 5px;
    border: 1px solid var(--border-subtle, rgb(255 255 255 / 7%));
    border-radius: 999px;
    background: color-mix(in srgb, var(--background-base-lowest, #1e1f22) 55%, transparent);
}
.vc-abic-badge {
    display: inline-flex;
    width: var(--abic-size);
    height: var(--abic-size);
    align-items: center;
    justify-content: center;
    border-radius: 4px;
    transition: transform .12s ease, filter .12s ease;
}
.vc-abic-badge img,
.vc-abic-badge > * {
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
}
.vc-abic-badge:hover { transform: translateY(-1px) scale(1.15); filter: drop-shadow(0 2px 4px rgb(0 0 0 / 35%)); }
.vc-abic-link { cursor: pointer; }
.vc-abic-more {
    padding: 0 4px;
    border-radius: 999px;
    background: var(--background-modifier-accent, rgb(255 255 255 / 8%));
    color: var(--text-muted, #949ba4);
    font-size: 10px;
    font-weight: 700;
    line-height: var(--abic-size);
    cursor: default;
}
@media (prefers-reduced-motion: reduce) { .vc-abic-badge { transition: none; } }
`;

export default definePlugin({
    name: "AllBadgesInChat",
    description: "Shows every Discord, Vencord, Equicord and plugin badge next to usernames in chat.",
    authors: [{ name: "you", id: 0n }], // put your EquicordDevs entry here before submitting
    dependencies: ["MessageDecorationsAPI"],
    settings,

    renderMessageDecoration: ErrorBoundary.wrap(({ message, channel }: any) => {
        const author = message?.author;
        if (!author) return null;
        if (author.bot && !settings.store.showOnBots) return null;
        if (!settings.store.showOnSelf && author.id === UserStore.getCurrentUser()?.id) return null;
        return <ChatBadges userId={author.id} guildId={channel?.guild_id} />;
    }, { noop: true }),

    start() {
        stopped = false;
        if (document.getElementById("vc-abic-style")) return;
        const el = document.createElement("style");
        el.id = "vc-abic-style";
        el.textContent = CSS;
        document.head.appendChild(el);
    },

    stop() {
        stopped = true;
        queue.length = 0;
        requested.clear();
        document.getElementById("vc-abic-style")?.remove();
    }
});
