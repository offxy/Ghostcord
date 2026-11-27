/*
 * Ghostcord — ShowID: shows a user's ID and account age on every profile. Click to copy.
 */

import "./styles.css";

import { copyToClipboard } from "@utils/clipboard";
import definePlugin from "@utils/types";
import { React, SnowflakeUtils, useState } from "@webpack/common";

import { toast } from "../_gc";
import { GC_AUTHOR } from "../_gc/voice";

function age(id: string) {
    const created = SnowflakeUtils.extractTimestamp(id);
    const days = Math.floor((Date.now() - created) / 86_400_000);
    const date = new Date(created).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
    const y = Math.floor(days / 365), m = Math.floor(days % 365 / 30);
    return { date, rel: y ? `${y}y ${m}mo` : m ? `${m}mo` : `${days}d` };
}

function IdLine({ userId }: { userId?: string; }) {
    const [copied, setCopied] = useState(false);
    if (!userId) return null;
    const a = age(userId);
    const copy = () => {
        copyToClipboard(userId);
        toast("User ID copied", "success", 1600);
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
    };
    return (
        <div className="gc-id-wrap">
            <div className={`gc-id${copied ? " gc-id-copied" : ""}`} onClick={copy} title="Click to copy ID">
                <svg className="gc-id-icon" viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
                    <path d="M15.3 14.48c-.46.45-1.08.67-1.86.67h-1.39V9.2h1.39c.78 0 1.4.22 1.86.67.46.45.68 1.22.68 2.31 0 1.1-.22 1.86-.68 2.31ZM3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5Zm4 2.7V17h2V7.7H7Zm4.05 0V17h2.5c1.45 0 2.56-.39 3.32-1.17.76-.78 1.14-1.94 1.14-3.48s-.38-2.7-1.14-3.48c-.76-.78-1.87-1.17-3.32-1.17h-2.5Z" />
                </svg>
                <span className="gc-id-text">{copied ? "Copied!" : userId}</span>
            </div>
            <span className="gc-id-age" title={`Account created ${a.date}`}>joined {a.rel} ago</span>
        </div>
    );
}

export default definePlugin({
    name: "ShowID",
    description: "Shows a user's ID and account age on their profile. Click the ID to copy it.",
    authors: [GC_AUTHOR],
    dependencies: ["ProfileCollectionsAPI", "ProfileSectionsAPI"],
    renderProfileCollection: {
        render: (props: any) => <IdLine userId={props?.user?.id ?? props?.userId} />,
        priority: 90,
    },
    renderProfileSection: {
        render: ({ userId, isSideBar }) => isSideBar ? null : <IdLine userId={userId} />,
        priority: 90,
    }
});
