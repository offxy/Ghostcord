/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Button } from "@components/Button";
import { Text } from "@components/Text";
import { createWordDiff, DiffPart } from "@plugins/messageLogger/diffUtils";
import { copyWithToast, openUserProfile } from "@utils/discord";
import { LazyComponent } from "@utils/react";
import { Channel, RenderModalProps, type User } from "@vencord/discord-types";
import { find, findByCodeLazy } from "@webpack";
import { Alerts, ChannelStore, closeAllModals, ContextMenuApi, FluxDispatcher, GuildStore, Menu, Modal, NavigationRouter, openModal, React, TextInput, Tooltip, useEffect, useMemo, useRef, useState } from "@webpack/common";

import { countMessagesByStatusIDB, DBMessageRecord, DBMessageStatus, deleteMessageIDB, deleteMessagesBulkIDB } from "../db";
import { cl, clearLogs, settings } from "../index";
import { LoggedMessage, LoggedMessageJSON } from "../types";
import { messageJsonToMessageClass } from "../utils";
import { importLogs } from "../utils/settingsUtils";
import { useMessages } from "./hooks";

export interface MessagePreviewProps {
    className: string;
    author: User;
    message: LoggedMessage;
    channel: Channel,
    compact: boolean;
    isGroupStart: boolean;
    hideSimpleEmbedContent: boolean;
}

const PrivateChannelRecord = findByCodeLazy(".is_message_request_timestamp,");
const MessagePreview = LazyComponent<MessagePreviewProps>(() => find(m => m?.type?.toString().includes("previewLinkTarget:") && !m?.type?.toString().includes("HAS_THREAD")));

export enum LogTabs {
    DELETED = "Deleted",
    EDITED = "Edited",
    GHOST_PING = "Ghost Pinged"
}

const TAB_META: Record<LogTabs, { status: DBMessageStatus; icon: string; tone: string; }> = {
    [LogTabs.DELETED]: { status: DBMessageStatus.DELETED, icon: "🗑", tone: "deleted" },
    [LogTabs.EDITED]: { status: DBMessageStatus.EDITED, icon: "✎", tone: "edited" },
    [LogTabs.GHOST_PING]: { status: DBMessageStatus.GHOST_PINGED, icon: "👻", tone: "ghost" },
};

/* ---------------- helpers ---------------- */

function relativeTime(iso?: string) {
    if (!iso) return "";
    const diff = (Date.now() - new Date(iso).getTime()) / 1000;
    if (!isFinite(diff)) return "";
    if (diff < 60) return "just now";
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}d ago`;
    return new Date(iso).toLocaleDateString();
}

function fullTime(iso?: string) {
    return iso ? new Date(iso).toLocaleString() : "";
}

function getLocation(message: LoggedMessageJSON | LoggedMessage) {
    const channel = ChannelStore.getChannel(message.channel_id);
    if (!channel) return { label: "Unknown channel", guildIcon: null as string | null };
    if (channel.isDM()) return { label: `DM · ${message.author?.username ?? "unknown"}`, guildIcon: null };
    if (channel.isGroupDM()) return { label: `Group · ${channel.name || "Group DM"}`, guildIcon: null };
    const guild = GuildStore.getGuild(channel.guild_id);
    return {
        label: `#${channel.name}${guild ? ` · ${guild.name}` : ""}`,
        guildIcon: guild?.icon ? `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.webp?size=32` : null
    };
}

function jumpTo(message: { channel_id: string; id: string; }) {
    NavigationRouter.transitionTo(`/channels/${ChannelStore.getChannel(message.channel_id)?.guild_id ?? "@me"}/${message.channel_id}/${message.id}`);
    closeAllModals();
}

/* ---------------- modal ---------------- */

interface Props {
    modalProps: RenderModalProps;
    initalQuery?: string;
    initialTab?: LogTabs;
}

export function LogsModal({ modalProps, initalQuery, initialTab }: Props) {
    const [currentTab, setCurrentTab] = useState(initialTab ?? LogTabs.DELETED);
    const [queryEh, setQuery] = useState(initalQuery ?? "");
    const [sortNewest, setSortNewest] = useState(settings.store.sortNewest);
    const [numDisplayedMessages, setNumDisplayedMessages] = useState(settings.store.messagesToDisplayAtOnceInLogs);
    const [counts, setCounts] = useState<Record<string, number>>({});
    const contentRef = useRef<HTMLDivElement | null>(null);

    const { messages, total, statusTotal, pending, reset } = useMessages(queryEh, currentTab, sortNewest, numDisplayedMessages);

    useEffect(() => {
        let alive = true;
        Promise.all(Object.values(LogTabs).map(async t => [t, await countMessagesByStatusIDB(TAB_META[t].status)] as const))
            .then(r => alive && setCounts(Object.fromEntries(r)));
        return () => { alive = false; };
    }, [pending, total]);

    const switchTab = (t: LogTabs) => {
        setCurrentTab(t);
        setNumDisplayedMessages(settings.store.messagesToDisplayAtOnceInLogs);
        contentRef.current?.scrollIntoView({ block: "start" });
    };

    return (
        <Modal
            {...modalProps}
            size="lg"
            title={
                <div className={cl("modal")}>
                    <div className={cl("tabs")}>
                        {Object.values(LogTabs).map(t => (
                            <button
                                key={t}
                                className={cl("tab", `tab-${TAB_META[t].tone}`, currentTab === t && "tab-active")}
                                onClick={() => switchTab(t)}
                            >
                                <span className={cl("tab-icon")}>{TAB_META[t].icon}</span>
                                {t}
                                <span className={cl("tab-count")}>{counts[t] ?? "…"}</span>
                            </button>
                        ))}
                    </div>
                    <div className={cl("toolbar")}>
                        <div className={cl("search")}>
                            <TextInput value={queryEh} onChange={e => setQuery(e)} placeholder="Search content, or filter: from:ID in:ID server:ID has:image before:… after:…" />
                        </div>
                        <Tooltip text={sortNewest ? "Showing newest first" : "Showing oldest first"}>
                            {tp => (
                                <button {...tp} className={cl("icon-btn")} onClick={() => {
                                    setSortNewest(e => (settings.store.sortNewest = !e));
                                    contentRef.current?.scrollIntoView({ block: "start" });
                                }}>
                                    {sortNewest ? "↓ Newest" : "↑ Oldest"}
                                </button>
                            )}
                        </Tooltip>
                    </div>
                </div>
            }
            actions={[
                {
                    text: "Clear Visible",
                    variant: "critical-secondary",
                    disabled: messages?.length === 0,
                    onClick: () => Alerts.show({
                        title: "Clear visible logs",
                        body: `Delete the ${messages.length} logs currently shown?`,
                        confirmText: "Clear",
                        confirmVariant: "critical-primary",
                        cancelText: "Cancel",
                        onConfirm: async () => {
                            await deleteMessagesBulkIDB(messages.map(e => e.message_id));
                            reset();
                        }
                    })
                },
                {
                    text: "Clear All",
                    variant: "critical-primary",
                    onClick: () => Alerts.show({
                        title: "Clear all logs",
                        body: "This deletes every logged message. Export first if you want a backup.",
                        confirmText: "Clear everything",
                        confirmVariant: "critical-primary",
                        cancelText: "Cancel",
                        onConfirm: async () => {
                            await clearLogs();
                            reset();
                        }
                    })
                }
            ]}
        >
            <div
                style={{ opacity: modalProps.transitionState === 1 ? "1" : "0" }}
                className={`${cl("modal-content-container")} ${cl("modal-root")}`}
                ref={contentRef}
            >
                {modalProps.transitionState === 1 && (
                    <>
                        {pending && <StateBox title={`Loading ${currentTab.toLowerCase()} logs…`} />}

                        {!pending && total === 0 && (
                            <StateBox
                                title={queryEh ? "Nothing matches that search" : "No logs yet"}
                                subtitle={queryEh ? "Try a different filter." : "Deleted and edited messages will appear here. Upgrading from the old JSON logs? Import them."}
                            >
                                {!queryEh && <Button onClick={() => importLogs().then(() => reset())}>Import Logs</Button>}
                            </StateBox>
                        )}

                        {!pending && total !== 0 && messages.length === 0 && (
                            <StateBox title={`No ${currentTab.toLowerCase()} messages`} subtitle={queryEh ? "Nothing matches that search in this tab." : "Check the other tabs."} />
                        )}

                        {!pending && messages.length > 0 && (
                            <div className={cl("list")}>
                                <GroupedList messages={messages} tab={currentTab} reset={reset} />
                                {messages.length < statusTotal && (
                                    <Button
                                        className={cl("load-more")}
                                        variant="secondary"
                                        size="small"
                                        onClick={() => setNumDisplayedMessages(e => e + settings.store.messagesToDisplayAtOnceInLogs)}
                                    >
                                        Load more ({statusTotal - messages.length} left)
                                    </Button>
                                )}
                            </div>
                        )}
                    </>
                )}
            </div>
        </Modal>
    );
}

function StateBox({ title, subtitle, children }: React.PropsWithChildren<{ title: string; subtitle?: string; }>) {
    return (
        <div className={cl("state")}>
            <Text size="lg" weight="semibold">{title}</Text>
            {subtitle && <Text size="sm" color="text-muted">{subtitle}</Text>}
            {children}
        </div>
    );
}

/* ---------------- list ---------------- */

function dayKey(iso: string) {
    const d = new Date(iso);
    const today = new Date();
    const yesterday = new Date(Date.now() - 86400000);
    if (d.toDateString() === today.toDateString()) return "Today";
    if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
    return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: d.getFullYear() === today.getFullYear() ? undefined : "numeric" });
}

function GroupedList({ messages, tab, reset }: { messages: DBMessageRecord[]; tab: LogTabs; reset: () => void; }) {
    const items: React.ReactNode[] = [];
    let lastDay = "";

    messages.forEach(({ message }) => {
        const day = dayKey(message.timestamp);
        if (day !== lastDay) {
            items.push(<div key={`day-${day}-${message.id}`} className={cl("day")}><span>{day}</span></div>);
            lastDay = day;
        }
        items.push(<LogCard key={message.id} log={message} tab={tab} reset={reset} />);
    });

    return <>{items}</>;
}

/* ---------------- card ---------------- */

function LogCard({ log, tab, reset }: { log: LoggedMessageJSON; tab: LogTabs; reset: () => void; }) {
    const message = useMemo(() => messageJsonToMessageClass({ message: log }), [log]);
    const [showHistory, setShowHistory] = useState(tab === LogTabs.EDITED && settings.store.expandEditHistory);

    if (!message) return null;

    const tone = TAB_META[tab].tone;
    const location = getLocation(log);
    const edits = log.editHistory ?? [];
    const eventTime = log.deletedTimestamp ?? edits[edits.length - 1]?.timestamp ?? log.timestamp;
    const eventLabel = log.deleted ? (log.ghostPinged ? "Ghost ping" : "Deleted") : `Edited ${edits.length}×`;

    return (
        <div className={cl("card", `card-${tone}`)} onContextMenu={e => openLogContextMenu(e, log, message, reset)}>
            <div className={cl("card-head")}>
                <span className={cl("badge", `badge-${tone}`)}>{eventLabel}</span>
                <Tooltip text={fullTime(eventTime)}>
                    {tp => <span {...tp} className={cl("time")}>{relativeTime(eventTime)}</span>}
                </Tooltip>
                <span className={cl("loc")}>
                    {location.guildIcon && <img src={location.guildIcon} alt="" />}
                    {location.label}
                </span>
                <div className={cl("card-actions")}>
                    {edits.length > 0 && (
                        <button className={cl("chip", showHistory && "chip-on")} onClick={() => setShowHistory(v => !v)}>
                            {showHistory ? "Hide history" : "History"}
                        </button>
                    )}
                    <button className={cl("chip")} onClick={() => jumpTo(log)}>Jump</button>
                    <button className={cl("chip", "chip-danger")} onClick={() => deleteMessageIDB(log.id).then(reset)}>✕</button>
                </div>
            </div>

            <MessagePreview
                className={`${cl("modal-msg-preview")} ${message.deleted ? "messagelogger-deleted" : ""}`}
                author={message.author}
                message={message}
                channel={ChannelStore.getChannel(message.channel_id) || new PrivateChannelRecord({ id: "" })}
                compact={false}
                isGroupStart
                hideSimpleEmbedContent={false}
            />

            {showHistory && edits.length > 0 && <EditHistory edits={edits} current={log.content} />}
        </div>
    );
}

function DiffText({ parts }: { parts: DiffPart[]; }) {
    return (
        <span className={cl("diff")}>
            {parts.map((p, i) => <span key={i} className={cl(`diff-${p.type}`)}>{p.text}</span>)}
        </span>
    );
}

function EditHistory({ edits, current }: { edits: { content: string; timestamp: string; }[]; current: string; }) {
    // versions[0] = original … versions[n] = current
    const versions = [...edits.map(e => e.content), current];

    return (
        <div className={cl("history")}>
            <div className={cl("history-title")}>Edit history</div>
            <div className={cl("history-row")}>
                <span className={cl("history-label")}>Original</span>
                <span className={cl("history-text")}>{versions[0] || <i>(empty)</i>}</span>
            </div>
            {versions.slice(1).map((text, i) => (
                <div key={i} className={cl("history-row")}>
                    <Tooltip text={fullTime(edits[i]?.timestamp)}>
                        {tp => (
                            <span {...tp} className={cl("history-label")}>
                                {i === versions.length - 2 ? "Now" : `Edit ${i + 1}`}
                            </span>
                        )}
                    </Tooltip>
                    <DiffText parts={createWordDiff(versions[i] ?? "", text ?? "")} />
                </div>
            ))}
        </div>
    );
}

/* ---------------- context menu ---------------- */

function openLogContextMenu(e: React.MouseEvent, log: LoggedMessageJSON, message: LoggedMessage, reset: () => void) {
    ContextMenuApi.openContextMenu(e, () =>
        <Menu.Menu navId="message-logger" onClose={() => FluxDispatcher.dispatch({ type: "CONTEXT_MENU_CLOSE" })} aria-label="Message Logger">
            <Menu.MenuItem id="jump-to-message" label="Jump To Message" action={() => jumpTo(message)} />
            <Menu.MenuItem id="open-user-profile" label="Open User Profile" action={() => { closeAllModals(); openUserProfile(message.author.id); }} />
            <Menu.MenuSeparator />
            <Menu.MenuItem id="copy-content" label="Copy Content" action={() => copyWithToast(message.content)} />
            {(log.editHistory?.length ?? 0) > 0 && (
                <Menu.MenuItem id="copy-original" label="Copy Original Content" action={() => copyWithToast(log.editHistory![0].content)} />
            )}
            <Menu.MenuItem id="copy-user-id" label="Copy User ID" action={() => copyWithToast(message.author.id)} />
            <Menu.MenuItem id="copy-message-id" label="Copy Message ID" action={() => copyWithToast(message.id)} />
            <Menu.MenuItem id="copy-channel-id" label="Copy Channel ID" action={() => copyWithToast(message.channel_id)} />
            {log.guildId != null && <Menu.MenuItem id="copy-server-id" label="Copy Server ID" action={() => copyWithToast(log.guildId!)} />}
            <Menu.MenuSeparator />
            <Menu.MenuItem id="filter-user" label="Show Logs From This User" action={() => { closeAllModals(); openLogModal(`from:${message.author.id}`); }} />
            <Menu.MenuItem id="filter-channel" label="Show Logs From This Channel" action={() => { closeAllModals(); openLogModal(`in:${message.channel_id}`); }} />
            <Menu.MenuSeparator />
            <Menu.MenuItem id="delete-log" label="Delete Log" color="danger" action={() => deleteMessageIDB(log.id).then(() => reset())} />
        </Menu.Menu>
    );
}

export const openLogModal = (initalQuery?: string, initialTab?: LogTabs) =>
    openModal(modalProps => <LogsModal modalProps={modalProps} initalQuery={initalQuery} initialTab={initialTab} />);
