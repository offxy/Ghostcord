/*
 * Ghostcord — StereoInstaller (main process)
 */

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { DATA_DIR } from "@main/utils/constants";
import { dialog, IpcMainInvokeEvent } from "electron";

const STATE_DIR = path.join(DATA_DIR, "stereo");
const STATE_FILE = path.join(STATE_DIR, "state.json");
const logs: string[] = [];
const log = (m: string) => { logs.push(`[${new Date().toLocaleTimeString()}] ${m}`); if (logs.length > 300) logs.shift(); };

type State = Record<string, { method?: string; lastPatch?: Record<string, number>; backup?: string; }>;
async function readState(): Promise<State> {
    try { return JSON.parse(await readFile(STATE_FILE, "utf8")); } catch { return {}; }
}
async function writeState(s: State) {
    await mkdir(STATE_DIR, { recursive: true });
    await writeFile(STATE_FILE, JSON.stringify(s, null, 2));
}

const verNum = (s: string) => s.replace(/^\D+/, "").split(/[.-]/).map(n => parseInt(n, 10) || 0);
function newest(names: string[]) {
    return names.sort((a, b) => {
        const x = verNum(a), y = verNum(b);
        for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0);
        return 0;
    }).at(-1);
}

async function findVoiceDir(root: string) {
    const apps = (await readdir(root).catch(() => [])).filter(n => n.startsWith("app-"));
    const app = newest(apps);
    if (!app) throw new Error("No app-* folder found in " + root);
    const modules = path.join(root, app, "modules");
    const voice = newest((await readdir(modules).catch(() => [])).filter(n => n.startsWith("discord_voice")));
    if (!voice) throw new Error("No discord_voice module found (join a voice channel once so Discord downloads it).");
    let dir = path.join(modules, voice);
    if (existsSync(path.join(dir, "discord_voice"))) dir = path.join(dir, "discord_voice");
    return { app, dir };
}

function clientName(root: string) {
    const b = path.basename(root).toLowerCase();
    return b.includes("canary") ? "Canary" : b.includes("ptb") ? "PTB" : b.includes("development") ? "Development" : "Stable";
}

export function autoDetect(_: IpcMainInvokeEvent) {
    const local = process.env.LOCALAPPDATA ?? "";
    // Prefer the client we are running inside
    const exeRoot = path.resolve(process.execPath, "..", "..");
    if (existsSync(path.join(exeRoot, "Update.exe"))) return exeRoot;
    for (const d of ["Discord", "DiscordPTB", "DiscordCanary", "DiscordDevelopment"]) {
        const p = path.join(local, d);
        if (existsSync(p)) return p;
    }
    return "";
}

export async function browse(_: IpcMainInvokeEvent) {
    const r = await dialog.showOpenDialog({ properties: ["openDirectory"], title: "Select your Discord folder (e.g. %LOCALAPPDATA%\\Discord)" });
    return r.canceled ? "" : r.filePaths[0];
}

export async function getInfo(_: IpcMainInvokeEvent, root: string) {
    const st = (await readState())[root] ?? {};
    let app = "", voiceModule = "", error = "";
    try { const v = await findVoiceDir(root); app = v.app; voiceModule = v.dir; } catch (e: any) { error = e.message; }
    return {
        client: `${clientName(root)} ${app.replace("app-1.0.", "")}`.trim(),
        platform: `${os.type() === "Windows_NT" ? "Windows" : os.type()} ${process.platform} ${os.release()} (${process.arch})`,
        voiceModule,
        installedMethod: st.method ?? null,
        lastPatch: st.lastPatch ?? {},
        hasBackup: !!st.backup && existsSync(st.backup),
        error
    };
}

export const getLogs = () => logs;
export const clearLogs = () => { logs.length = 0; };

const sha256 = (b: Buffer) => createHash("sha256").update(b).digest("hex");

// Windows can't overwrite a loaded .node, but it can rename it.
async function replaceFile(dest: string, data: Buffer) {
    if (existsSync(dest)) {
        const old = `${dest}.old-${Date.now()}`;
        await rename(dest, old);
        rm(old, { force: true }).catch(() => { });
    }
    await writeFile(dest, data);
}

async function cleanupOld(dir: string) {
    for (const f of await readdir(dir).catch(() => []))
        if (/\.old-\d+$/.test(f)) await rm(path.join(dir, f), { force: true }).catch(() => { });
}

export async function patch(_: IpcMainInvokeEvent, root: string, method: string, apiUrl: string) {
    try {
        if (!/^[\w-]+$/.test(method)) throw new Error("Invalid method");
        const state = await readState();
        const cur = state[root] ?? {};
        if (cur.method && cur.method !== method) throw new Error(`"${cur.method}" is installed. Revert to backup before switching methods.`);

        const { dir } = await findVoiceDir(root);
        await cleanupOld(dir);
        log(`Voice module: ${dir}`);

        const base = apiUrl.replace(/\/+$/, "");
        const manifest = await fetch(`${base}/v1/stereo/${method}/manifest`).then(r => {
            if (!r.ok) throw new Error(`API has no files for this method yet (HTTP ${r.status})`);
            return r.json();
        }) as { version?: string; files: { name: string; sha256: string; target?: "module" | "root"; }[]; };
        log(`Manifest: ${manifest.files.length} file(s)${manifest.version ? `, version ${manifest.version}` : ""}`);

        // Backup the vanilla module once
        if (!cur.backup || !existsSync(cur.backup)) {
            const backup = path.join(STATE_DIR, "backups", `${clientName(root)}-${Date.now()}`);
            await mkdir(backup, { recursive: true });
            for (const f of await readdir(dir)) {
                const p = path.join(dir, f);
                if ((await stat(p)).isFile()) await copyFile(p, path.join(backup, f));
            }
            cur.backup = backup;
            log(`Backup saved to ${backup}`);
        }

        for (const f of manifest.files) {
            if (!/^[\w.-]+$/.test(f.name)) throw new Error(`Bad file name in manifest: ${f.name}`);
            const res = await fetch(`${base}/v1/stereo/${method}/files/${encodeURIComponent(f.name)}`);
            if (!res.ok) throw new Error(`Download failed for ${f.name} (HTTP ${res.status})`);
            const data = Buffer.from(await res.arrayBuffer());
            if (sha256(data) !== f.sha256.toLowerCase()) throw new Error(`Checksum mismatch for ${f.name}, aborting.`);
            const dest = f.target === "root" ? path.join(root, f.name) : path.join(dir, f.name);
            await replaceFile(dest, data);
            log(`Installed ${f.name} → ${dest}`);
        }

        cur.method = method;
        cur.lastPatch = { ...cur.lastPatch, [method]: Date.now() };
        state[root] = cur;
        await writeState(state);
        log("Done. Fully restart Discord to load stereo voice.");
        return { ok: true };
    } catch (e: any) {
        log(`Error: ${e.message}`);
        return { ok: false, error: e.message };
    }
}

export async function revert(_: IpcMainInvokeEvent, root: string) {
    try {
        const state = await readState();
        const cur = state[root];
        if (!cur?.backup || !existsSync(cur.backup)) throw new Error("No backup found for this install.");
        const { dir } = await findVoiceDir(root);
        for (const f of await readdir(cur.backup))
            await replaceFile(path.join(dir, f), await readFile(path.join(cur.backup, f)));
        log(`Restored original voice files from ${cur.backup}`);
        await rm(cur.backup, { recursive: true, force: true });
        delete state[root];
        await writeState(state);
        log("Done. Fully restart Discord.");
        return { ok: true };
    } catch (e: any) {
        log(`Error: ${e.message}`);
        return { ok: false, error: e.message };
    }
}
