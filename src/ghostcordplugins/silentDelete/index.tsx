/*
 * Ghostcord — SilentDelete: blanks your message before deleting it, so message loggers only see an empty edit.
 */

import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType } from "@utils/types";
import { Menu, MessageActions, UserStore } from "@webpack/common";

import { sleep, toast } from "../_gc";
import { GC_AUTHOR } from "../_gc/voice";

export const BLANK = "​";

const settings = definePluginSettings({
    blankText: { type: OptionType.STRING, description: "What the message is edited to before deleting", default: "." }
});

export async function silentDelete(channelId: string, messageId: string) {
    await MessageActions.editMessage(channelId, messageId, { content: settings.store.blankText || BLANK });
    await sleep(700);
    await MessageActions.deleteMessage(channelId, messageId);
}

const messageMenu: NavContextMenuPatchCallback = (children, { message }) => {
    if (!message || message.author?.id !== UserStore.getCurrentUser()?.id) return;
    children.push(
        <Menu.MenuItem
            id="gc-silent-delete"
            label="Silent Delete"
            color="danger"
            action={async () => {
                try { await silentDelete(message.channel_id, message.id); toast("Silently deleted", "success"); } catch { toast("Couldn't delete that message", "error"); }
            }}
        />
    );
};

export default definePlugin({
    name: "SilentDelete",
    description: "Adds 'Silent Delete' to your messages: edits them to blank first so loggers don't keep the original.",
    authors: [GC_AUTHOR],
    settings,
    contextMenus: { "message": messageMenu }
});
