/*
 * CancelFriendRequest — Equicord userplugin
 * Cancel outgoing friend requests from profiles, the right-click menu,
 * and the Pending tab.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { EquicordDevs } from "@utils/constants";
import definePlugin from "@utils/types";
import { RelationshipType } from "@vencord/discord-types/enums";
import { findByPropsLazy } from "@webpack";
import { Menu, RelationshipStore, UserStore } from "@webpack/common";

// ---------------------------------------------------------------------------
// Tiny built-in toast. Equicord removed Toasts from @webpack/common, so this
// plugin draws its own instead of depending on that export.
// ---------------------------------------------------------------------------
type ToastKind = "message" | "success" | "failure";
function showToast(message: string, kind: ToastKind = "message", duration = 2600) {
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


const RelationshipActions = findByPropsLazy("cancelFriendRequest", "addRelationship");

const isOutgoing = (userId?: string) =>
    !!userId && RelationshipStore.getRelationshipType(userId) === RelationshipType.OUTGOING_REQUEST;

function nameOf(userId: string) {
    const u: any = UserStore.getUser(userId);
    return u?.globalName ?? u?.username ?? "this user";
}

async function cancelRequest(userId?: string) {
    if (!userId || !isOutgoing(userId)) return;
    const name = nameOf(userId);
    try {
        await RelationshipActions.cancelFriendRequest(userId);
        showToast(`Cancelled friend request to ${name}`, "success");
    } catch {
        showToast(`Couldn't cancel the request to ${name}`, "failure");
    }
}

const CancelIcon = (props: any) => (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" {...props}>
        <circle cx="9" cy="8" r="4" />
        <path d="M2 21a7 7 0 0 1 12.5-4.3" />
        <path d="M17 15l5 5M22 15l-5 5" />
    </svg>
);

const userContextPatch: NavContextMenuPatchCallback = (children, { user }) => {
    if (!user || !isOutgoing(user.id)) return;
    children.push(
        <Menu.MenuSeparator />,
        <Menu.MenuItem
            id="vc-cancel-friend-request"
            label="Cancel Friend Request"
            color="danger"
            icon={CancelIcon}
            action={() => cancelRequest(user.id)}
        />
    );
};

export default definePlugin({
    name: "CancelFriendRequestPlus",
    description: "Cancel outgoing friend requests from user profiles, the right-click menu, and the Pending tab.",
    authors: [EquicordDevs.omaw],

    contextMenus: {
        "user-context": userContextPatch,
        "user-profile-overflow-menu": userContextPatch
    },

    patches: [
        {
            find: "#{intl::rQSndv::raw}",
            replacement: {
                match: /variant:"primary",.{0,50}#{intl::ADD_FRIEND_BUTTON_AFTER}\)/,
                replace: "...$self.textButtonProps(arguments[0].user.id)"
            }
        },
        {
            find: "#{intl::FRIENDS_REQUEST_STATUS_OUTGOING}",
            group: true,
            replacement: [
                {
                    match: /(?<=\i=\{icon:(\i),.{0,100}\.\.\.\i)(?=\};return 0===)/g,
                    replace: ",...$self.iconButtonProps(arguments[0],$1)"
                },
                {
                    match: /disabled:!0(?=.{0,25}targetElementRef:)/g,
                    replace: "disabled:!$self.isOutgoingButton(arguments[0])"
                }
            ]
        }
    ],

    isOutgoingButton({ relationshipType, hasOutgoingPendingGameFriends }: { relationshipType?: number; hasOutgoingPendingGameFriends?: boolean; }) {
        return relationshipType === RelationshipType.OUTGOING_REQUEST || hasOutgoingPendingGameFriends === true;
    },

    textButtonProps(userId: string) {
        return {
            variant: "critical-secondary",
            onClick: () => cancelRequest(userId),
            text: "Cancel Request"
        };
    },

    iconButtonProps(context: any, Icon: any) {
        if (!this.isOutgoingButton(context)) return {};
        return {
            "aria-label": "Cancel Friend Request",
            disabled: false,
            icon: Icon ? (p: Record<string, unknown>) => <Icon {...p} color="var(--status-danger)" /> : undefined,
            tooltipText: "Cancel Friend Request",
            variant: "critical-secondary",
            onClick: () => cancelRequest(context?.user?.id)
        };
    }
});
