/*
 * Ghostcord — shared voice helpers.
 */

import { ChannelActions, FluxDispatcher, MediaEngineStore, SelectedChannelStore, UserStore, VoiceActions } from "@webpack/common";

export const GC_AUTHOR = { name: "offxy", id: 1402331570525835275n };

export const isMuted = () => !!(MediaEngineStore as any).isSelfMute?.();
export const isDeafened = () => !!(MediaEngineStore as any).isSelfDeaf?.();
export const currentVoice = () => SelectedChannelStore.getVoiceChannelId() ?? null;
export const joinVoice = (id: string) => (ChannelActions as any).selectVoiceChannel(id);

export function setMuted(v: boolean) { if (isMuted() !== v) VoiceActions.toggleSelfMute(); }
export function setDeafened(v: boolean) { if (isDeafened() !== v) VoiceActions.toggleSelfDeaf(); }

/** Fires `cb(channelId)` whenever *you* join a voice channel. Returns an unsubscribe fn. */
export function onSelfJoin(cb: (channelId: string) => void) {
    let last = currentVoice();
    const handler = ({ voiceStates }: { voiceStates: { userId: string; channelId?: string | null; }[]; }) => {
        const me = UserStore.getCurrentUser()?.id;
        for (const s of voiceStates ?? []) {
            if (s.userId !== me) continue;
            const ch = s.channelId ?? null;
            if (ch && ch !== last) setTimeout(() => cb(ch), 400);
            last = ch;
        }
    };
    FluxDispatcher.subscribe("VOICE_STATE_UPDATES", handler as any);
    return () => FluxDispatcher.unsubscribe("VOICE_STATE_UPDATES", handler as any);
}
