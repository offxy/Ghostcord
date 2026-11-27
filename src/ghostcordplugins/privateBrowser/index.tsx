/*
 * Ghostcord — PrivateBrowser: open any link in a private window (no cookies, no history, wiped on close).
 * Right-click a link → "Open in Private Window". Or open a blank one from the toolbox.
 */

import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType, PluginNative } from "@utils/types";
import { Menu } from "@webpack/common";

import { promptGc, toast } from "../_gc";
import { GC_AUTHOR } from "../_gc/voice";

const Native = VencordNative.pluginHelpers.PrivateBrowser as PluginNative<typeof import("./native")>;

const settings = definePluginSettings({
    alwaysPrivate: { type: OptionType.BOOLEAN, description: "Open every link you click in a private window", default: false }
});

async function open(url: string) {
    if (!Native) return toast("Private windows only work in the desktop app", "error");
    const ok = await Native.openPrivate(url);
    if (!ok) toast("That link can't be opened privately", "error");
}

const linkMenu: NavContextMenuPatchCallback = (children, props) => {
    const url: string | undefined = props?.href ?? props?.itemHref ?? props?.itemSrc;
    if (!url || !/^https?:\/\//i.test(url)) return;
    children.push(
        <Menu.MenuGroup>
            <Menu.MenuItem id="gc-private-open" label="Open in Private Window" action={() => open(url)} />
        </Menu.MenuGroup>
    );
};

function onClick(e: MouseEvent) {
    if (!settings.store.alwaysPrivate || e.button !== 0) return;
    const a = (e.target as HTMLElement)?.closest?.("a[href]") as HTMLAnchorElement | null;
    if (!a || !/^https?:\/\//i.test(a.href) || /discord(app)?\.com\/(channels|invite)|discord\.gg/i.test(a.href)) return;
    e.preventDefault();
    e.stopPropagation();
    open(a.href);
}

export default definePlugin({
    name: "PrivateBrowser",
    description: "Open links in a private window with no cookies or history — everything's wiped when you close it.",
    authors: [GC_AUTHOR],
    settings,
    contextMenus: { "message": linkMenu, "image-context": linkMenu },
    toolboxActions: {
        async "Private window…"() {
            const url = await promptGc("Open private window", "https://", "https://example.com");
            if (url) open(/^https?:\/\//i.test(url) ? url : `https://${url}`);
        }
    },
    start() { document.addEventListener("click", onClick, true); },
    stop() { document.removeEventListener("click", onClick, true); }
});
