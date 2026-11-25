/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings, Settings } from "@api/Settings";
import { Button } from "@components/Button";
import ErrorBoundary from "@components/ErrorBoundary";
import { OptionType } from "@utils/types";
import { showToast, useEffect, useState } from "@webpack/common";

import { Native } from ".";
import { ClearLogsButton } from "./components/ClearLogsButton";
import { ImageCacheDir, LogsDir } from "./components/FolderSelectInput";
import { openLogModal } from "./components/LogsModal";
import { countMessagesByStatusIDB, countMessagesIDB, DBMessageStatus, deleteMessagesBulkIDB, getOlderThanTimestampIDB } from "./db";
import { blockedExts } from "./list";
import { applyChatStyle } from "./utils/chatStyle";
import { DEFAULT_IMAGE_CACHE_DIR } from "./utils/constants";
import { exportLogs, importLogs } from "./utils/settingsUtils";

function ImportLogsButton() {
    const [loading, setLoading] = useState(false);

    return (
        <Button
            disabled={loading}
            onClick={async () => {
                setLoading(true);
                try {
                    await importLogs();
                } finally {
                    setLoading(false);
                }
            }}
        >
            {loading ? "Importing..." : "Import Logs"}
        </Button>
    );
}

function ExportLogsButton() {
    const [loading, setLoading] = useState(false);

    return (
        <Button
            disabled={loading}
            onClick={async () => {
                setLoading(true);
                try {
                    await exportLogs();
                } finally {
                    setLoading(false);
                }
            }}
        >
            {loading ? "Exporting..." : "Export Logs"}
        </Button>
    );
}


function LogStats() {
    const [stats, setStats] = useState<{ total: number; deleted: number; edited: number; ghost: number; } | null>(null);
    const [tick, setTick] = useState(0);

    useEffect(() => {
        Promise.all([
            countMessagesIDB(),
            countMessagesByStatusIDB(DBMessageStatus.DELETED),
            countMessagesByStatusIDB(DBMessageStatus.EDITED),
            countMessagesByStatusIDB(DBMessageStatus.GHOST_PINGED),
        ]).then(([total, deleted, edited, ghost]) => setStats({ total, deleted, edited, ghost }));
    }, [tick]);

    const limit = settings.store.messageLimit;

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div className="vc-msg-logger-enhanced-stats">
                <div className="vc-msg-logger-enhanced-stat"><b>{stats?.total ?? "…"}</b><span>total{limit > 0 ? ` / ${limit} limit` : ""}</span></div>
                <div className="vc-msg-logger-enhanced-stat"><b>{stats?.deleted ?? "…"}</b><span>deleted</span></div>
                <div className="vc-msg-logger-enhanced-stat"><b>{stats?.edited ?? "…"}</b><span>edited</span></div>
                <div className="vc-msg-logger-enhanced-stat"><b>{stats?.ghost ?? "…"}</b><span>ghost pings</span></div>
            </div>
            <Button size="small" variant="secondary" onClick={() => setTick(t => t + 1)}>Refresh</Button>
        </div>
    );
}

export async function runAgeCleanup(toast = false) {
    const days = settings.store.maxLogAgeDays;
    if (!days || days <= 0) return 0;
    const cutoff = new Date(Date.now() - days * 86400000).toISOString();
    const old = await getOlderThanTimestampIDB(cutoff);
    if (old.length) await deleteMessagesBulkIDB(old.map(m => m.message_id));
    if (toast) showToast({ text: `Removed ${old.length} logs older than ${days} days`, variant: "success" });
    return old.length;
}

export const settings = definePluginSettings({
    migratedFromOriginal: {
        type: OptionType.BOOLEAN,
        description: "internal",
        default: false,
        hidden: true
    },

    logStats: {
        type: OptionType.COMPONENT,
        description: "Log storage",
        component: ErrorBoundary.wrap(LogStats) as any
    },

    ghostPingNotify: {
        type: OptionType.BOOLEAN,
        description: "Show a notification when someone ghost pings you (click it to open the log)",
        default: true
    },

    ghostPingNotifyPermanent: {
        type: OptionType.BOOLEAN,
        description: "Keep ghost ping notifications on screen until dismissed",
        default: false
    },

    deletedStyle: {
        type: OptionType.SELECT,
        description: "How deleted messages look in chat",
        options: [
            { label: "Default (MessageLogger setting)", value: "default" },
            { label: "Faded (full opacity on hover)", value: "faded" },
            { label: "Card (soft red background + stripe)", value: "card", default: true },
            { label: "Collapsed (one line, expands on hover)", value: "collapsed" }
        ],
        onChange: () => applyChatStyle()
    },

    hideDeletedInChat: {
        type: OptionType.BOOLEAN,
        description: "Hide deleted messages in chat entirely (they're still logged). Also toggleable from the toolbox.",
        default: false,
        onChange: () => applyChatStyle()
    },

    expandEditHistory: {
        type: OptionType.BOOLEAN,
        description: "Open the edit history diff by default in the Edited tab",
        default: true
    },

    maxLogAgeDays: {
        type: OptionType.NUMBER,
        description: "Delete ANY log (DMs included) older than this many days. Runs on startup and every hour. 0 = never.",
        default: 0
    },

    runAgeCleanupNow: {
        type: OptionType.COMPONENT,
        description: "Run age cleanup now",
        component: () => (
            <Button size="small" variant="secondary" disabled={!settings.store.maxLogAgeDays} onClick={() => runAgeCleanup(true)}>
                Clean up old logs now
            </Button>
        )
    },

    saveMessages: {
        default: true,
        type: OptionType.BOOLEAN,
        description: "Whether to save the deleted and edited messages.",
    },

    saveImages: {
        type: OptionType.BOOLEAN,
        description: "Save deleted attachments.",
        default: false
    },

    sortNewest: {
        default: true,
        type: OptionType.BOOLEAN,
        description: "Sort logs by newest.",
    },

    cacheMessagesFromServers: {
        default: false,
        type: OptionType.BOOLEAN,
        description: "Usually message logger only logs from whitelisted ids and dms, enabling this would mean it would log messages from all servers as well. Note that this may cause the cache to exceed its limit, resulting in some messages being missed. If you are in a lot of servers, this may significantly increase the chances of messages being logged, which can result in a large message record and the inclusion of irrelevant messages.",
    },

    ignoreBots: {
        type: OptionType.BOOLEAN,
        description: "Whether to ignore messages by bots",
        default: false,
        onChange() {
            // we will be handling the ignoreBots now (enabled or not) so the original messageLogger shouldnt
            Settings.plugins.MessageLogger.ignoreBots = false;
        }
    },

    ignoreWebhooks: {
        type: OptionType.BOOLEAN,
        description: "Whether to ignore messages by webhooks",
        default: false,
    },

    ignoreSelf: {
        type: OptionType.BOOLEAN,
        description: "Whether to ignore messages by yourself",
        default: false,
        onChange() {
            Settings.plugins.MessageLogger.ignoreSelf = false;
        }
    },

    ignoreMutedGuilds: {
        default: false,
        type: OptionType.BOOLEAN,
        description: "Messages in muted guilds will not be logged. Whitelisted users/channels in muted guilds will still be logged."
    },

    ignoreMutedCategories: {
        default: false,
        type: OptionType.BOOLEAN,
        description: "Messages in channels belonging to muted categories will not be logged. Whitelisted users/channels in muted guilds will still be logged."
    },

    ignoreMutedChannels: {
        default: false,
        type: OptionType.BOOLEAN,
        description: "Messages in muted channels will not be logged. Whitelisted users/channels in muted guilds will still be logged."
    },

    alwaysLogDirectMessages: {
        default: true,
        type: OptionType.BOOLEAN,
        description: "Always log DMs",
    },

    alwaysLogCurrentChannel: {
        default: true,
        type: OptionType.BOOLEAN,
        description: "Always log current selected channel. Blacklisted channels/users will still be ignored.",
    },

    permanentlyRemoveLogByDefault: {
        default: false,
        type: OptionType.BOOLEAN,
        description: "Vencord's base MessageLogger remove log button wiil delete logs permanently",
    },

    hideMessageFromMessageLoggers: {
        default: false,
        type: OptionType.BOOLEAN,
        description: "When enabled, a context menu button will be added to messages to allow you to delete messages without them being logged by other loggers. Might not be safe, use at your own risk."
    },

    ShowLogsButton: {
        default: true,
        type: OptionType.BOOLEAN,
        description: "Toggle to whenever show the toolbox or not",
        restartNeeded: true,
    },

    ShowWhereMessageIsFrom: {
        default: false,
        type: OptionType.BOOLEAN,
        description: "Show message channel/author name and server name",
    },

    messagesToDisplayAtOnceInLogs: {
        default: 100,
        type: OptionType.NUMBER,
        description: "Number of messages to display at once in logs & number of messages to load when loading more messages in logs.",
    },

    hideMessageFromMessageLoggersDeletedMessage: {
        default: "redacted eh",
        type: OptionType.STRING,
        description: "The message content to replace the message with when using the hide message from message loggers feature.",
    },

    messageLimit: {
        default: 200,
        type: OptionType.NUMBER,
        description: "Maximum number of messages to save. Older messages are deleted when the limit is reached. 0 means there is no limit"
    },

    attachmentSizeLimitInMegabytes: {
        default: 12,
        type: OptionType.NUMBER,
        description: "Maximum size of an attachment in megabytes to save. Attachments larger than this size will not be saved."
    },

    attachmentFileExtensions: {
        default: "png,jpg,jpeg,gif,webp,mp4,webm,mp3,ogg,wav",
        type: OptionType.STRING,
        description: "Comma separated list of file extensions to save. Attachments with file extensions not in this list will not be saved.",
        onChange: (value: string) => {
            let processedValue = "";

            if (value) {
                const exts = value.split(",").map(ext => ext.trim().toLowerCase());
                const invalid = exts.filter(ext => blockedExts.includes(ext));

                if (invalid.length > 0) {
                    console.warn("Rejected invalid file extensions:", invalid);
                    processedValue = exts.filter(ext => !blockedExts.includes(ext)).join(",");
                } else {
                    processedValue = exts.join(",");
                }
            }

            Native.updateAllowedExtensions(processedValue).catch((err: any) => {
                console.error("Failed to sync attachment extensions natively:", err);
            });

            return processedValue;
        }
    },
    cacheLimit: {
        default: 1000,
        type: OptionType.NUMBER,
        description: "Maximum number of messages to store in the cache. Older messages are deleted when the limit is reached. This helps reduce memory usage and improve performance. 0 means there is no limit",
    },

    timeBasedCleanupMinutes: {
        default: 0,
        type: OptionType.NUMBER,
        description: "Automatically remove messages from servers that are older than this many minutes. Set to 0 to disable time-based cleanup.",
    },

    preserveCurrentChannel: {
        default: true,
        type: OptionType.BOOLEAN,
        description: "When enabled, messages in your currently selected channel are not affected by time-based cleanup.",
    },

    whitelistedIds: {
        default: "",
        type: OptionType.STRING,
        description: "Server, channel, or user IDs to always show in message log."
    },

    blacklistedIds: {
        default: "",
        type: OptionType.STRING,
        description: "Server, channel, or user IDs to never show in message log."
    },

    imageCacheDir: {
        type: OptionType.COMPONENT,
        description: "Select saved images directory",
        component: ErrorBoundary.wrap(ImageCacheDir) as any
    },

    logsDir: {
        type: OptionType.COMPONENT,
        description: "Select logs directory",
        component: ErrorBoundary.wrap(LogsDir) as any
    },

    importLogs: {
        type: OptionType.COMPONENT,
        description: "Import Logs From File",
        component: ImportLogsButton
    },

    exportLogs: {
        type: OptionType.COMPONENT,
        description: "Export Logs From IndexedDB",
        component: ExportLogsButton
    },

    clearLogsOnRestart: {
        type: OptionType.BOOLEAN,
        description: "Clear logs when Discord restarts.",
        default: false,
        restartNeeded: true,
    },

    openLogs: {
        type: OptionType.COMPONENT,
        description: "Open Logs",
        component: () =>
            <Button onClick={() => openLogModal()}>
                Open Logs
            </Button>
    },
    openImageCacheFolder: {
        type: OptionType.COMPONENT,
        description: "Opens the image cache directory",
        component: () =>
            <Button
                disabled={
                    IS_WEB
                    || settings.store.imageCacheDir == null
                    || settings.store.imageCacheDir === DEFAULT_IMAGE_CACHE_DIR
                }
                onClick={() => Native.showItemInFolder()}
            >
                Open Image Cache Folder
            </Button>
    },

    clearLogs: {
        type: OptionType.COMPONENT,
        description: "Clear Logs",
        component: () => <ClearLogsButton />
    },

});
