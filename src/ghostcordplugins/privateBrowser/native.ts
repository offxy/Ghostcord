/*
 * Ghostcord — PrivateBrowser (main process): opens links in a throwaway window with its own in-memory session.
 */

import { BrowserWindow, IpcMainInvokeEvent, shell } from "electron";

let counter = 0;

export async function openPrivate(_: IpcMainInvokeEvent, url: string) {
    if (!/^https?:\/\//i.test(url)) return false;
    // no "persist:" prefix = in-memory only; a new partition per window = nothing shared between windows
    const partition = `gc-private-${Date.now()}-${counter++}`;
    const win = new BrowserWindow({
        width: 1100,
        height: 760,
        title: "Ghostcord Private Browser",
        backgroundColor: "#1e1f22",
        autoHideMenuBar: true,
        webPreferences: { partition, contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false }
    });
    win.webContents.session.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
    win.webContents.setWindowOpenHandler(({ url: next }) => { win.loadURL(next); return { action: "deny" }; });
    win.webContents.on("page-title-updated", (e, title) => { e.preventDefault(); win.setTitle(`🕶 ${title} — Private`); });
    win.on("closed", () => { win.webContents?.session?.clearStorageData?.().catch(() => { }); });
    await win.loadURL(url).catch(() => { });
    return true;
}

export async function openExternal(_: IpcMainInvokeEvent, url: string) {
    if (/^https?:\/\//i.test(url)) await shell.openExternal(url);
}
