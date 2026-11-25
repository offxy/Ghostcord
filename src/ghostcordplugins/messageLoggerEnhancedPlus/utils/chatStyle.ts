/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { settings } from "../settings";

const STYLES = ["faded", "card", "collapsed"] as const;

export function applyChatStyle() {
    const body = document.body.classList;
    for (const s of STYLES) body.remove(`vc-mle-style-${s}`);
    const style = settings.store.deletedStyle;
    if (style && style !== "default") body.add(`vc-mle-style-${style}`);
    body.toggle("vc-mle-hide-deleted", !!settings.store.hideDeletedInChat);
}

export function removeChatStyle() {
    const body = document.body.classList;
    for (const s of STYLES) body.remove(`vc-mle-style-${s}`);
    body.remove("vc-mle-hide-deleted");
}
