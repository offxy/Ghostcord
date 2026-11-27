/*
 * Ghostcord — Backpack
 * Tucks the chat bar buttons (gift, GIF, stickers, emoji, apps, and every
 * plugin button) into one backpack button. Drag buttons in and out of it.
 */

import { addChatBarButton, ChatBarButton, removeChatBarButton } from "@api/ChatButtons";
import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType } from "@utils/types";
import { React } from "@webpack/common";

import { GC_AUTHOR } from "../_gc/voice";


const OPEN_CLASS = "vc-backpack-open";
const DRAG_CLASS = "vc-backpack-dragging";
const STYLE_ID = "vc-backpack-dynamic";
const CONTAINER = ':is([class^="buttons_"], [class*=" buttons_"]):has(.vc-backpack-btn)';

const settings = definePluginSettings({
    // tooltip texts (or parts of them) of buttons that stay out of the backpack
    kept: { type: OptionType.CUSTOM, default: [] as string[], description: "Buttons kept out of the backpack" },
    keptList: {
        type: OptionType.COMPONENT,
        component: () => <KeptListSetting />
    },
    closeAfterClick: {
        type: OptionType.BOOLEAN,
        description: "Close the backpack after you click a button inside it",
        default: true
    },
    rememberOpen: {
        type: OptionType.BOOLEAN,
        description: "Remember whether the backpack was open after restarting",
        default: false
    },
    wasOpen: { type: OptionType.CUSTOM, default: false, description: "Whether the backpack was open" }
});

// ---------------------------------------------------------------------------
// Kept list
// ---------------------------------------------------------------------------

const lower = (s: string) => s.toLowerCase();

function isKept(label: string) {
    return settings.store.kept.some(k => lower(label).includes(lower(k)));
}

function keep(label: string) {
    if (!isKept(label)) settings.store.kept = [...settings.store.kept, label];
    updateStyle();
}

function tuck(label: string) {
    settings.store.kept = settings.store.kept.filter(k => !lower(label).includes(lower(k)));
    updateStyle();
}

function KeptListSetting() {
    const { kept } = settings.use(["kept"]);
    return (
        <div className="vc-backpack-setting">
            <div className="vc-backpack-setting-title">Buttons kept out of the backpack</div>
            <div className="vc-backpack-setting-hint">
                Open the backpack (Esc closes it) and drag a button onto "Keep in chat bar" or "Put in backpack". You can also remove one here.
            </div>
            <div className="vc-backpack-chips">
                {kept.length === 0 && <span className="vc-backpack-setting-hint">None, everything is in the backpack.</span>}
                {kept.map(k => (
                    <span key={k} className="vc-backpack-chip">
                        {k}
                        <button aria-label={`Put ${k} in the backpack`} onClick={() => tuck(k)}>×</button>
                    </span>
                ))}
            </div>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Open / closed state
// ---------------------------------------------------------------------------

const listeners = new Set<() => void>();
const countListeners = new Set<() => void>();
const isOpen = () => document.body.classList.contains(OPEN_CLASS);

function setOpen(open: boolean) {
    document.body.classList.toggle(OPEN_CLASS, open);
    settings.store.wasOpen = open;
    listeners.forEach(l => l());
}

function useOpen() {
    const [open, set] = React.useState(isOpen);
    React.useEffect(() => {
        const l = () => set(isOpen());
        listeners.add(l);
        return () => void listeners.delete(l);
    }, []);
    return open;
}

// ---------------------------------------------------------------------------
// CSS + tagging the chat bar items
// ---------------------------------------------------------------------------

const cssEscape = (s: string) => s.replace(/["\\]/g, "\\$&");

function tuckedSelector() {
    const notKept = settings.store.kept
        .map(k => `:not(:has([aria-label*="${cssEscape(k)}" i]))`)
        .join("");
    return `${CONTAINER} > :not(:has(.vc-backpack-btn))${notKept}`;
}

function updateStyle() {
    let el = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
    if (!el) {
        el = document.createElement("style");
        el.id = STYLE_ID;
        document.head.appendChild(el);
    }
    const tucked = tuckedSelector();
    el.textContent = `
body:not(.${OPEN_CLASS}) ${tucked} { display: none !important; }
body.${OPEN_CLASS}:not(.${DRAG_CLASS}) ${tucked} { animation: vc-backpack-pop 0.16s ease-out both; }
body.${OPEN_CLASS} ${tucked} { box-shadow: inset 0 -2px 0 var(--vc-backpack-accent); border-radius: 4px; }
`;
    tagItems();
}

function labelOf(item: Element) {
    return item.querySelector("[aria-label]")?.getAttribute("aria-label")?.trim() ?? "";
}

function tagItems() {
    let tucked: Set<Element>;
    try {
        tucked = new Set(document.querySelectorAll(tuckedSelector()));
    } catch {
        tucked = new Set();
    }
    for (const container of document.querySelectorAll(CONTAINER)) {
        for (const item of container.children) {
            if (item.querySelector(".vc-backpack-btn")) continue;
            if (!labelOf(item)) continue;
            item.classList.add("vc-backpack-item");
            item.classList.toggle("vc-backpack-tucked", tucked.has(item));
            if (item.getAttribute("draggable") !== "true") item.setAttribute("draggable", "true");
        }
    }
    countListeners.forEach(l => l());
}

// ---------------------------------------------------------------------------
// Drag and drop
// ---------------------------------------------------------------------------

let dragLabel: string | null = null;
let overlay: HTMLDivElement | null = null;

function zone(kind: "keep" | "tuck", current: boolean) {
    const z = document.createElement("div");
    z.className = `vc-backpack-zone vc-backpack-zone-${kind}${current ? " vc-backpack-zone-current" : ""}`;
    z.dataset.zone = kind;
    z.innerHTML = `
        <span class="vc-backpack-zone-icon">${kind === "tuck"
            ? '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 9a7 7 0 0 1 14 0v10a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2z"/><path d="M9 4.5V4a3 3 0 0 1 6 0v.5M8 14h8"/></svg>'
            : '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 17v5M5 17h14l-2-4V4H7v9z"/></svg>'}</span>
        <span class="vc-backpack-zone-text">
            <strong>${kind === "tuck" ? "Put in backpack" : "Keep in chat bar"}</strong>
            <small>${current ? "it's here now" : "drop here"}</small>
        </span>`;
    return z;
}

function showOverlay(anchor: Element, label: string) {
    hideOverlay();
    const rect = anchor.getBoundingClientRect();
    const kept = isKept(label);

    overlay = document.createElement("div");
    overlay.className = "vc-backpack-overlay";
    overlay.append(zone("keep", kept), zone("tuck", !kept));

    const title = document.createElement("div");
    title.className = "vc-backpack-overlay-title";
    title.textContent = `Moving "${label}"`;
    overlay.prepend(title);

    document.body.appendChild(overlay);

    // sit just above the chat bar buttons, right-aligned to them, kept on screen
    const w = overlay.offsetWidth;
    const h = overlay.offsetHeight;
    const left = Math.max(8, Math.min(rect.right - w, window.innerWidth - w - 8));
    const top = Math.max(8, rect.top - h - 12);
    overlay.style.left = `${left}px`;
    overlay.style.top = `${top}px`;
}

function hideOverlay() {
    overlay?.remove();
    overlay = null;
}

function onDragStart(e: DragEvent) {
    const item = (e.target as HTMLElement | null)?.closest?.(".vc-backpack-item");
    if (!item) return;
    const label = labelOf(item);
    if (!label) return;

    dragLabel = label;
    e.dataTransfer?.setData("text/x-vc-backpack", label);
    if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";

    document.body.classList.add(DRAG_CLASS);
    item.classList.add("vc-backpack-dragged");
    const container = item.parentElement!;
    // wait a frame so the browser grabs its drag image before we add the overlay
    requestAnimationFrame(() => dragLabel && showOverlay(container, label));
}

function dropTargetFrom(e: DragEvent): "keep" | "tuck" | null {
    const t = e.target as HTMLElement | null;
    const z = t?.closest?.("[data-zone]") as HTMLElement | null;
    if (z) return z.dataset.zone as "keep" | "tuck";
    if (t?.closest?.(".vc-backpack-btn")) return "tuck";
    return null;
}

function onDragOver(e: DragEvent) {
    if (!dragLabel) return;
    const target = dropTargetFrom(e);
    overlay?.querySelectorAll(".vc-backpack-zone").forEach(z =>
        z.classList.toggle("vc-backpack-zone-hover", (z as HTMLElement).dataset.zone === target));
    document.body.classList.toggle("vc-backpack-over-bag", target === "tuck");
    if (target) {
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
    }
}

function onDrop(e: DragEvent) {
    if (!dragLabel) return;
    const target = dropTargetFrom(e);
    if (!target) return;
    e.preventDefault();
    if (target === "keep") keep(dragLabel);
    else tuck(dragLabel);
    endDrag();
}

function endDrag() {
    dragLabel = null;
    hideOverlay();
    document.body.classList.remove(DRAG_CLASS, "vc-backpack-over-bag");
    document.querySelectorAll(".vc-backpack-dragged").forEach(n => n.classList.remove("vc-backpack-dragged"));
    tagItems();
}

function onKeyDown(e: KeyboardEvent) {
    if (e.key === "Escape" && isOpen() && !dragLabel) setOpen(false);
}

// Close after clicking a tucked button
function onClick(e: MouseEvent) {
    if (!isOpen() || !settings.store.closeAfterClick) return;
    const target = e.target as HTMLElement | null;
    if (target?.closest(".vc-backpack-tucked")) setTimeout(() => setOpen(false), 0);
}

// ---------------------------------------------------------------------------
// The backpack button
// ---------------------------------------------------------------------------

const BackpackIcon = ({ open }: { open?: boolean; }) => (
    <svg width={20} height={20} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
        <path d="M9 2a3 3 0 0 0-3 3v.3A6 6 0 0 0 2 11v8a3 3 0 0 0 3 3h14a3 3 0 0 0 3-3v-8a6 6 0 0 0-4-5.7V5a3 3 0 0 0-3-3H9Zm7 3.08V5a1 1 0 0 0-1-1H9a1 1 0 0 0-1 1v.08A6 6 0 0 1 8 5h8v.08ZM7 13a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-3v-1a1 1 0 1 0-2 0v1H8a1 1 0 0 1-1-1v-3Z" />
        {open && <circle cx={19} cy={5} r={4} fill="var(--status-positive, #23a55a)" stroke="var(--channeltextarea-background, #383a40)" strokeWidth={2} />}
    </svg>
);

function useTuckedCount() {
    const [n, set] = React.useState(0);
    React.useEffect(() => {
        const l = () => set(document.querySelectorAll(".vc-backpack-tucked").length);
        l();
        countListeners.add(l);
        return () => void countListeners.delete(l);
    }, []);
    return n;
}

const BackpackButton = () => {
    const open = useOpen();
    const count = useTuckedCount();
    return (
        <ChatBarButton
            tooltip={open ? "Close backpack · drag buttons in or out" : "Open backpack"}
            onClick={() => setOpen(!open)}
        >
            <span className="vc-backpack-btn" aria-expanded={open}>
                <BackpackIcon open={open} />
                {!open && count > 0 && <span className="vc-backpack-count">{count}</span>}
            </span>
        </ChatBarButton>
    );
};

// shows in every chat box that has buttons: main chat, threads, DMs, forum posts, the edit box
const renderButton = (() => <BackpackButton />) as any;

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

let observer: MutationObserver | null = null;
let tagQueued = false;


// ---- styles (built into this file so the plugin is a single file) ----
const PLUGIN_CSS = String.raw`
:root {
    --vc-backpack-accent: var(--brand-500, #5865f2);
}

@keyframes vc-backpack-pop {
    from { opacity: 0; transform: translateX(10px) scale(0.85); }
    to { opacity: 1; transform: none; }
}

.vc-backpack-btn {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 6px;
    transition: transform 0.12s ease, color 0.12s ease, box-shadow 0.12s ease;
}

/* ---------- always last (rightmost) in the button row ---------- */
:is([class^="buttons_"], [class*=" buttons_"]) > :has(.vc-backpack-btn) {
    order: 9999;
}

/* ---------- divider after the backpack while open ---------- */
body.vc-backpack-open :is([class^="buttons_"], [class*=" buttons_"]) > :has(.vc-backpack-btn) {
    position: relative;
    margin-left: 4px;
}

body.vc-backpack-open :is([class^="buttons_"], [class*=" buttons_"]) > :has(.vc-backpack-btn)::after {
    content: "";
    position: absolute;
    top: 25%;
    left: -3px;
    width: 1px;
    height: 50%;
    background: var(--border-subtle, var(--background-modifier-accent, #4e5058));
}

/* ---------- dragging ---------- */
.vc-backpack-item[draggable="true"] {
    cursor: grab;
}

.vc-backpack-dragged {
    opacity: 0.35;
}

/* the backpack itself is a drop target too */
body.vc-backpack-dragging .vc-backpack-btn {
    box-shadow: 0 0 0 2px var(--vc-backpack-accent);
    animation: vc-backpack-wiggle 0.9s ease-in-out infinite;
}

body.vc-backpack-over-bag .vc-backpack-btn {
    transform: scale(1.2);
    color: var(--vc-backpack-accent);
    animation: none;
}

@keyframes vc-backpack-wiggle {
    0%, 100% { transform: rotate(0); }
    25% { transform: rotate(-8deg); }
    75% { transform: rotate(8deg); }
}

/* ---------- drop overlay ---------- */
.vc-backpack-overlay {
    position: fixed;
    z-index: 1000;
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
    padding: 10px;
    border: 1px solid var(--border-subtle, #3f4147);
    border-radius: 10px;
    background: var(--background-floating, var(--background-base-lowest, #111214));
    box-shadow: 0 8px 24px rgb(0 0 0 / 40%);
    color: var(--text-default, var(--text-normal, #dbdee1));
    animation: vc-backpack-rise 0.14s ease-out;
}

@keyframes vc-backpack-rise {
    from { opacity: 0; transform: translateY(6px); }
    to { opacity: 1; transform: none; }
}

.vc-backpack-overlay-title {
    grid-column: 1 / -1;
    max-width: 320px;
    overflow: hidden;
    color: var(--text-muted, #949ba4);
    font-size: 12px;
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.vc-backpack-zone {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 150px;
    padding: 14px 12px;
    border: 2px dashed var(--border-strong, #4e5058);
    border-radius: 8px;
    transition: border-color 0.1s ease, background-color 0.1s ease, transform 0.1s ease;
}

.vc-backpack-zone-icon {
    font-size: 22px;
    line-height: 1;
}

.vc-backpack-zone-text {
    display: flex;
    flex-direction: column;
    pointer-events: none;
}

.vc-backpack-zone-icon {
    pointer-events: none;
}

.vc-backpack-zone strong {
    color: var(--text-strong, var(--header-primary, #f2f3f5));
    font-size: 14px;
}

.vc-backpack-zone small {
    color: var(--text-muted, #949ba4);
    font-size: 12px;
}

.vc-backpack-zone-current {
    opacity: 0.55;
}

.vc-backpack-zone-hover {
    border-style: solid;
    border-color: var(--vc-backpack-accent);
    background: color-mix(in srgb, var(--vc-backpack-accent) 18%, transparent);
    opacity: 1;
    transform: scale(1.03);
}

@media (prefers-reduced-motion: reduce) {
    body.vc-backpack-open .vc-backpack-tucked,
    body.vc-backpack-dragging .vc-backpack-btn,
    .vc-backpack-overlay {
        animation: none !important;
    }
}

/* ---------- settings ---------- */
.vc-backpack-setting {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-bottom: 8px;
}

.vc-backpack-setting-title {
    color: var(--text-strong, var(--header-primary, #f2f3f5));
    font-size: 16px;
    font-weight: 600;
}

.vc-backpack-setting-hint {
    color: var(--text-muted, #949ba4);
    font-size: 13px;
}

.vc-backpack-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
}

.vc-backpack-chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 4px 2px 10px;
    border-radius: 12px;
    background: var(--background-surface-high, var(--background-secondary, #2b2d31));
    color: var(--text-default, var(--text-normal, #dbdee1));
    font-size: 13px;
}

.vc-backpack-chip button {
    width: 20px;
    height: 20px;
    border: none;
    border-radius: 50%;
    background: none;
    color: var(--text-muted, #949ba4);
    font-size: 15px;
    line-height: 1;
    cursor: pointer;
}

.vc-backpack-chip button:hover {
    background: var(--background-modifier-hover);
    color: var(--text-strong, #f2f3f5);
}

.vc-backpack-count {
    position: absolute;
    right: -6px;
    bottom: -4px;
    min-width: 14px;
    height: 14px;
    padding: 0 3px;
    box-sizing: border-box;
    border: 2px solid var(--channeltextarea-background, #383a40);
    border-radius: 999px;
    background: var(--vc-backpack-accent);
    color: #fff;
    font-size: 9px;
    font-weight: 800;
    line-height: 10px;
    text-align: center;
    pointer-events: none;
}

.vc-backpack-overlay { border-radius: 12px; backdrop-filter: blur(8px); }
.vc-backpack-zone { border-radius: 10px; }
.vc-backpack-zone-icon { display: flex; color: var(--vc-backpack-accent); }

/* motion */
.vc-backpack-item {
    transition: opacity 0.15s ease, transform 0.15s ease;
}

.vc-backpack-btn svg {
    transition: transform 0.18s cubic-bezier(.2,.8,.2,1);
}

body.vc-backpack-open .vc-backpack-btn svg {
    transform: rotate(-8deg) scale(1.05);
}
`;

function injectPluginCss() {
    if (document.getElementById("vc-chatbackpack-style")) return;
    const el = document.createElement("style");
    el.id = "vc-chatbackpack-style";
    el.textContent = PLUGIN_CSS;
    document.head.appendChild(el);
}

function removePluginCss() {
    document.getElementById("vc-chatbackpack-style")?.remove();
}

export default definePlugin({
    name: "Backpack",
    description: "Tucks all the chat bar buttons into a single backpack button. Open it and drag buttons in or out.",
    authors: [GC_AUTHOR],
    dependencies: ["ChatInputButtonAPI"],
    settings,

    start() {
        injectPluginCss();
        // migrate from the old per-button toggles if they exist
        const s = settings.store as any;
        if (s.keepCustom) {
            const extra = String(s.keepCustom).split(",").map((x: string) => x.trim()).filter(Boolean);
            settings.store.kept = [...new Set([...settings.store.kept, ...extra])];
            s.keepCustom = "";
        }

        (addChatBarButton as any)("Backpack", renderButton, BackpackIcon);
        document.body.classList.toggle(OPEN_CLASS, settings.store.rememberOpen && settings.store.wasOpen);
        updateStyle();

        // Discord's DOM changes constantly (messages, typing); re-tag at most ~6x a second
        observer = new MutationObserver(() => {
            if (tagQueued || dragLabel) return;
            tagQueued = true;
            setTimeout(() => {
                tagQueued = false;
                tagItems();
            }, 160);
        });
        observer.observe(document.body, { childList: true, subtree: true });

        document.addEventListener("click", onClick, true);
        document.addEventListener("keydown", onKeyDown);
        document.addEventListener("dragstart", onDragStart, true);
        document.addEventListener("dragover", onDragOver, true);
        document.addEventListener("drop", onDrop, true);
        document.addEventListener("dragend", endDrag, true);
    },

    stop() {
        removePluginCss();
        removeChatBarButton("Backpack");
        observer?.disconnect();
        observer = null;
        endDrag();
        document.removeEventListener("click", onClick, true);
        document.removeEventListener("keydown", onKeyDown);
        document.removeEventListener("dragstart", onDragStart, true);
        document.removeEventListener("dragover", onDragOver, true);
        document.removeEventListener("drop", onDrop, true);
        document.removeEventListener("dragend", endDrag, true);
        document.body.classList.remove(OPEN_CLASS);
        document.getElementById(STYLE_ID)?.remove();
        document.querySelectorAll(".vc-backpack-item").forEach(n => {
            n.classList.remove("vc-backpack-item", "vc-backpack-tucked");
            n.removeAttribute("draggable");
        });
    }
});
