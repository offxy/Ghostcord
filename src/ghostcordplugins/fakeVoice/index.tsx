/*
 * Ghostcord — FakeVoice: look muted / deafened to everyone else while you can still talk and hear.
 * Toggle it with the ghost button next to your mic/deafen buttons.
 */

import { definePluginSettings } from "@api/Settings";
import { UserAreaButton, UserAreaButtonFactory } from "@api/UserArea";
import definePlugin, { OptionType } from "@utils/types";
import { findStoreLazy } from "@webpack";
import { React, useState } from "@webpack/common";

import { toast } from "../_gc";
import { currentVoice, GC_AUTHOR } from "../_gc/voice";
import { VoiceActions } from "@webpack/common";

const GatewayStore = findStoreLazy("GatewayConnectionStore");

const settings = definePluginSettings({
    fakeMute: { type: OptionType.BOOLEAN, description: "Show as muted while FakeVoice is on", default: true },
    fakeDeafen: { type: OptionType.BOOLEAN, description: "Show as deafened while FakeVoice is on", default: true }
});

let active = false;
let socket: any;
let original: ((args: any) => any) | undefined;
const listeners = new Set<() => void>();

function hook() {
    socket = GatewayStore.getSocket?.();
    if (!socket || original) return;
    original = socket.voiceStateUpdate;
    socket.voiceStateUpdate = function (args: any) {
        if (active && args) {
            args = {
                ...args,
                selfMute: settings.store.fakeMute ? true : args.selfMute,
                selfDeaf: settings.store.fakeDeafen ? true : args.selfDeaf
            };
        }
        return original!.call(this, args);
    };
}

function unhook() {
    if (socket && original) socket.voiceStateUpdate = original;
    original = undefined;
}

/** Push our voice state again so the change shows up right away. */
function resend() {
    if (!currentVoice()) return;
    VoiceActions.toggleSelfMute();
    setTimeout(() => VoiceActions.toggleSelfMute(), 150);
}

function setActive(v: boolean) {
    hook();
    active = v;
    resend();
    listeners.forEach(l => l());
    toast(v ? "FakeVoice on — you look muted/deafened" : "FakeVoice off", v ? "success" : "info");
}

const GhostIcon = ({ className, on }: { className?: string; on?: boolean; }) => (
    <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 2a8 8 0 0 0-8 8v11.2c0 .5.6.8 1 .4l1.8-1.6 1.8 1.6c.3.3.7.3 1 0L12 20l2.4 1.6c.3.3.7.3 1 0l1.8-1.6 1.8 1.6c.4.4 1 .1 1-.4V10a8 8 0 0 0-8-8Zm-3 10a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3Zm6 0a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3Z" />
        {on && <path d="M3 3l18 18" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />}
    </svg>
);

function FakeButton({ iconForeground, hideTooltips, nameplate }: any) {
    const [, rerender] = useState(0);
    React.useEffect(() => {
        const l = () => rerender(n => n + 1);
        listeners.add(l);
        return () => void listeners.delete(l);
    }, []);
    return (
        <UserAreaButton
            tooltipText={hideTooltips ? void 0 : active ? "FakeVoice: ON" : "FakeVoice"}
            icon={<GhostIcon className={iconForeground} on={active} />}
            role="switch"
            aria-checked={active}
            redGlow={active}
            plated={nameplate != null}
            onClick={() => setActive(!active)}
        />
    );
}

const FakeVoiceButton: UserAreaButtonFactory = props => <FakeButton {...props} />;

export default definePlugin({
    name: "FakeVoice",
    description: "Look muted/deafened to others while you can still talk and hear. Toggle with the ghost button by your mic.",
    authors: [GC_AUTHOR],
    dependencies: ["UserAreaAPI"],
    settings,
    userAreaButton: { icon: GhostIcon, render: FakeVoiceButton },
    flux: {
        CONNECTION_OPEN() { unhook(); hook(); }
    },
    start() { hook(); },
    stop() {
        const was = active;
        active = false;
        unhook();
        if (was) resend();
    }
});
