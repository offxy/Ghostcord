/*
 * Ghostcord — SilentEdit: "edit" a message with no "(edited)" tag by deleting it and reposting the new text.
 */

import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import definePlugin from "@utils/types";
import { Menu, MessageActions, RestAPI, UserStore } from "@webpack/common";

import { promptGc, sleep, toast } from "../_gc";
import { GC_AUTHOR } from "../_gc/voice";

const messageMenu: NavContextMenuPatchCallback = (children, { message }) => {
    if (!message || message.author?.id !== UserStore.getCurrentUser()?.id) return;
    children.push(
        <Menu.MenuItem
            id="gc-silent-edit"
            label="Silent Edit"
            action={async () => {
                const text = await promptGc("Silent Edit", message.content, "New message");
                if (text == null || !text.trim() || text === message.content) return;
                try {
                    await MessageActions.editMessage(message.channel_id, message.id, { content: "." });
                    await sleep(500);
                    await MessageActions.deleteMessage(message.channel_id, message.id);
                    await RestAPI.post({
                        url: `/channels/${message.channel_id}/messages`,
                        body: {
                            content: text,
                            ...(message.messageReference ? { message_reference: { message_id: message.messageReference.message_id }, allowed_mentions: { replied_user: false } } : {})
                        }
                    });
                    toast("Edited without the (edited) tag", "success");
                } catch { toast("Silent edit failed", "error"); }
            }}
        />
    );
};

export default definePlugin({
    name: "SilentEdit",
    description: "Adds 'Silent Edit' to your messages: reposts the new text so there's no (edited) tag. The message moves to the bottom.",
    authors: [GC_AUTHOR],
    contextMenus: { "message": messageMenu }
});
