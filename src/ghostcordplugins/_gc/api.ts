/*
 * Ghostcord — signed requests to the Ghostcord API using your Ghostcord Cloud login.
 */

import { getAuthorization } from "@api/SettingsSync/cloudSetup";
import { UserStore } from "@webpack/common";

import { GC_API } from ".";

/** Authorization header (same format as Ghostcord Cloud), or null if you're not logged in to Cloud. */
export async function gcAuthHeader(): Promise<string | null> {
    const id = UserStore.getCurrentUser()?.id;
    const secret = await getAuthorization().catch(() => null);
    if (!id || !secret) return null;
    return btoa(`${secret}:${id}`);
}

export async function gcFetch(path: string, init: RequestInit = {}, needAuth = true) {
    const headers = new Headers(init.headers);
    if (needAuth) {
        const a = await gcAuthHeader();
        if (!a) throw Object.assign(new Error("Not logged in to Ghostcord Cloud"), { code: "NO_AUTH" });
        headers.set("Authorization", a);
    }
    const res = await fetch(GC_API + path, { ...init, headers, cache: "no-store" });
    if (!res.ok) throw Object.assign(new Error(`Ghostcord API ${res.status}`), { status: res.status });
    return res.status === 204 ? null : res.json();
}

// ---------- vault: per-account storage on your VPS ----------
export async function vaultGet<T>(key: string): Promise<{ data: T; updated: number; } | null> {
    try { return await gcFetch(`/vault/${key}`); } catch (e: any) { if (e?.status === 404) return null; throw e; }
}

export async function vaultPut(key: string, data: unknown) {
    return gcFetch(`/vault/${key}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ data }) });
}

/** Debounced upload so rapid changes become one request. */
const timers = new Map<string, ReturnType<typeof setTimeout>>();
export function vaultPutSoon(key: string, get: () => Promise<unknown>, delay = 4000) {
    clearTimeout(timers.get(key));
    timers.set(key, setTimeout(async () => {
        timers.delete(key);
        try { await vaultPut(key, await get()); } catch { /* offline or not logged in — local copy is still there */ }
    }, delay));
}
