/*
 * Ghostcord — CloseGroup: right-click a group DM → "Leave Silently" (no "left the group" message).
 */

import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import definePlugin from "@utils/types";
import { Menu, RestAPI } from "@webpack/common";

import { confirmGc, toast } from "../_gc";
import { GC_AUTHOR } from "../_gc/voice";

const groupMenu: NavContextMenuPatchCallback = (children, { channel }) => {
    if (!channel || channel.type !== 3) return;
    children.push(
        <Menu.MenuGroup>
            <Menu.MenuItem
                id="gc-leave-silent"
                label="Leave Silently"
                color="danger"
                action={async () => {
                    if (!await confirmGc("Leave silently?", `You'll leave ${channel.name || "this group"} without a "left the group" message.`, "Leave")) return;
                    try {
                        await RestAPI.del({ url: `/channels/${channel.id}`, query: { silent: true } });
                        toast("Left the group silently", "success");
                    } catch { toast("Couldn't leave the group", "error"); }
                }}
            />
        </Menu.MenuGroup>
    );
};

export default definePlugin({
    name: "CloseGroup",
    description: "Adds 'Leave Silently' to group DMs so nobody sees a 'left the group' message.",
    authors: [GC_AUTHOR],
    contextMenus: { "gdm-context": groupMenu }
});
