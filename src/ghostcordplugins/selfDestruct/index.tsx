/*
 * Ghostcord — SelfDestruct: messages you send while it's armed delete themselves after a timer.
 * Toggle with the timer button in the chat bar.
 */

import { ChatBarButton, ChatBarButtonFactory } from "@api/ChatButtons";
import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType } from "@utils/types";
import { MessageActions, React, UserStore, useState } from "@webpack/common";

import { toast } from "../_gc";
import { GC_AUTHOR } from "../_gc/voice";

const settings = definePluginSettings({
    seconds: { type: OptionType.SLIDER, description: "Seconds before a message destroys itself", markers: [5, 10, 30, 60, 300, 600], default: 30, stickToMarkers: false },
    silent: { type: OptionType.BOOLEAN, description: "Blank the message before deleting (hides it from loggers)", default: true }
});

let armed = false;
const pending = new Set<string>(); // nonces of armed sends
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const listeners = new Set<() => void>();

function destroyLater(channelId: string, id: string) {
    const t = setTimeout(async () => {
        timers.delete(id);
        try {
            if (settings.store.silent) {
                await MessageActions.editMessage(channelId, id, { content: "." });
                await new Promise(r => setTimeout(r, 500));
            }
            await MessageActions.deleteMessage(channelId, id);
        } catch { }
    }, settings.store.seconds * 1000);
    timers.set(id, t);
}

const TimerIcon = ({ className, on }: { className?: string; on?: boolean; }) => (
    <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill={on ? "#f23f43" : "currentColor"}>
        <path d="M9 1h6v2H9V1Zm10.03 6.39 1.42-1.42-1.41-1.41-1.42 1.42A8.96 8.96 0 0 0 12 4a9 9 0 1 0 9 9c0-2.12-.74-4.07-1.97-5.61ZM13 14h-2V8h2v6Z" />
    </svg>
);

const DestructButton: ChatBarButtonFactory = ({ isMainChat }) => {
    const [, rerender] = useState(0);
    React.useEffect(() => {
        const l = () => rerender(n => n + 1);
        listeners.add(l);
        return () => void listeners.delete(l);
    }, []);
    if (!isMainChat) return null;
    return (
        <ChatBarButton
            tooltip={armed ? `Self-destruct ON (${settings.store.seconds}s)` : "Self-destruct"}
            onClick={() => {
                armed = !armed;
                listeners.forEach(l => l());
                toast(armed ? `Self-destruct armed — messages vanish after ${settings.store.seconds}s` : "Self-destruct off", armed ? "success" : "info");
            }}
        >
            <TimerIcon on={armed} />
        </ChatBarButton>
    );
};

export default definePlugin({
    name: "SelfDestruct",
    description: "Arm the timer in the chat bar and your messages delete themselves after the time you set.",
    authors: [GC_AUTHOR],
    settings,
    chatBarButton: { icon: TimerIcon, render: DestructButton },
    onBeforeMessageSend(_, __, options: any) {
        if (!armed) return;
        const nonce = options?.nonce;
        if (nonce) pending.add(String(nonce));
        else pending.add("*");
    },
    flux: {
        MESSAGE_CREATE({ message, optimistic }: any) {
            if (optimistic || !message || message.author?.id !== UserStore.getCurrentUser()?.id) return;
            const key = message.nonce && pending.has(String(message.nonce)) ? String(message.nonce) : pending.has("*") ? "*" : null;
            if (!key) return;
            pending.delete(key);
            destroyLater(message.channel_id, message.id);
        }
    },
    stop() {
        armed = false;
        pending.clear();
        timers.forEach(clearTimeout);
        timers.clear();
    }
});
