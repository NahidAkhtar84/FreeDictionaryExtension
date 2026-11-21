/*
 * Free Dictionary Lookup — content script.
 * Shows word definitions in a Shadow DOM popup near the current selection.
 * The shadow root keeps page styles out; all critical host styles are set
 * inline with !important to survive aggressive page CSS.
 */
"use strict";

(function () {
  if (window.__fdLookupLoaded) return;
  window.__fdLookupLoaded = true;

  const POPUP_WIDTH = 360;
  const MOUSE_DEBOUNCE_MS = 120;
  const KEY_DEBOUNCE_MS = 350;
  const TOUCH_DEBOUNCE_MS = 450;

  let host = null;      // page-level element hosting the shadow root
  let shadow = null;    // closed shadow root
  let content = null;   // container inside the shadow the renderer fills
  let currentWord = null;
  let shownAt = 0;
  let debounceTimer = 0;

  const POPUP_CSS = `
    :host { all: initial; }
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    .fd-card {
      width: 100%;
      font: 14px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      color: #1f2430;
      background: #ffffff;
      border: 1px solid #e3e6ee;
      border-radius: 12px;
      box-shadow: 0 10px 32px rgba(15, 23, 42, 0.2);
      overflow: hidden;
      text-align: left;
    }
    .fd-head {
      display: flex; align-items: center; gap: 8px;
      padding: 10px 12px 6px;
    }
    .fd-word { font-weight: 700; font-size: 16px; overflow-wrap: anywhere; }
    .fd-phonetic { color: #6b7280; font-size: 12.5px; }
    .fd-audio {
      margin-left: auto; flex: none;
      width: 27px; height: 27px; border: 0; border-radius: 50%;
      background: #eef0fb; color: #4f46e5;
      display: grid; place-items: center; cursor: pointer;
    }
    .fd-audio:hover { background: #dfe2f6; }
    .fd-audio svg { width: 14px; height: 14px; }
    .fd-body { padding: 2px 12px 10px; max-height: 300px; overflow: auto; }
    .fd-pos { margin-top: 8px; }
    .fd-pos-name {
      display: inline-block;
      font-size: 10.5px; font-weight: 600; letter-spacing: 0.05em; text-transform: uppercase;
      color: #6d28d9; background: #f1ecfe; border-radius: 999px; padding: 2px 8px;
    }
    .fd-defs { padding-left: 18px; }
    .fd-def { margin-top: 6px; }
    .fd-def-text { overflow-wrap: anywhere; }
    .fd-example { color: #6b7280; font-style: italic; font-size: 12.5px; margin-top: 2px; overflow-wrap: anywhere; }
    .fd-foot { border-top: 1px solid #eceef4; padding: 6px 12px; display: flex; gap: 10px; }
    .fd-src { font-size: 11.5px; color: #6b7280; text-decoration: none; }
    .fd-src:hover { text-decoration: underline; }
    .fd-msg { padding: 16px 14px; text-align: center; }
    .fd-msg-title { font-weight: 600; margin-bottom: 4px; }
    .fd-muted { color: #6b7280; font-size: 13px; }
    .fd-alt { margin-top: 8px; }
    .fd-spinner {
      width: 16px; height: 16px; margin: 0 auto 8px;
      border: 2px solid #d7dbf0; border-top-color: #4f46e5; border-radius: 50%;
      animation: fd-spin 0.7s linear infinite;
    }
    @keyframes fd-spin { to { transform: rotate(360deg); } }
    @media (prefers-color-scheme: dark) {
      .fd-card { background: #1c1f2a; color: #e7e9f0; border-color: #2d3243; }
      .fd-phonetic, .fd-example, .fd-muted { color: #9aa1b5; }
      .fd-audio { background: #2b2f45; color: #a5b4fc; }
      .fd-audio:hover { background: #353a55; }
      .fd-pos-name { color: #c4b5fd; background: #2a2440; }
      .fd-foot { border-top-color: #2d3243; }
      .fd-src { color: #9aa1b5; }
      .fd-spinner { border-color: #3a4060; border-top-color: #a5b4fc; }
    }
  `;

  // True for text inputs and truly editable regions. A plain
  // [contenteditable] selector would also match contenteditable="false",
  // which many sites set on ordinary article text.
  function isEditable(node) {
    const el = node && (node.nodeType === 1 ? node : node.parentElement);
    if (!el) return false;
    if (el.closest && el.closest("input, textarea")) return true;
    return !!el.isContentEditable;
  }

  function isInsidePopup(event) {
    return !!host && event.composedPath().indexOf(host) !== -1;
  }

  function ensurePopup() {
    if (host) return;
    host = document.createElement("div");
    host.id = "fd-lookup-" + Math.random().toString(36).slice(2, 8);
    host.style.setProperty("position", "fixed", "important");
    host.style.setProperty("top", "0", "important");
    host.style.setProperty("left", "0", "important");
    host.style.setProperty("z-index", "2147483647", "important");
    host.style.setProperty("pointer-events", "auto", "important");
    host.style.setProperty("visibility", "hidden", "important");
    shadow = host.attachShadow({ mode: "closed" });
    const style = document.createElement("style");
    style.textContent = POPUP_CSS;
    shadow.append(style);
    content = document.createElement("div");
    shadow.append(content);
    (document.body || document.documentElement).append(host);
  }

  function positionHost(rect) {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const width = Math.min(POPUP_WIDTH, vw - 16);
    host.style.setProperty("width", width + "px", "important");
    host.style.setProperty("max-width", (vw - 16) + "px", "important");

    // Measure now that content is rendered; stay hidden until positioned.
    const height = host.offsetHeight || 120;
    let top = rect.bottom + 8;
    if (top + height > vh - 8) top = Math.max(8, rect.top - height - 8);
    let left = rect.left + rect.width / 2 - width / 2;
    left = Math.min(Math.max(8, left), vw - width - 8);
    host.style.setProperty("top", Math.round(top) + "px", "important");
    host.style.setProperty("left", Math.round(left) + "px", "important");
    host.style.setProperty("visibility", "visible", "important");
  }

  function closePopup() {
    if (host) host.remove();
    host = null;
    shadow = null;
    content = null;
    currentWord = null;
  }

  function show(state, rect) {
    if (!host) shownAt = Date.now();
    ensurePopup();
    FD.renderInto(document, content, state);
    positionHost(rect);
  }

  function selectionRect() {
    try {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return null;
      const rect = sel.getRangeAt(0).getBoundingClientRect();
      if (!rect || (rect.width === 0 && rect.height === 0)) return null;
      return rect;
    } catch (e) {
      return null;
    }
  }

  let lookupSeq = 0;

  async function handleSelection() {
    const raw = String(window.getSelection() || "");
    if (!raw.trim()) return; // empty selection: dismissal is handled on mousedown

    const word = FD.normalizeWord(raw);
    if (!word) { // paragraphs, numbers, code — not lookupable
      closePopup();
      return;
    }
    if (word === currentWord && host) return; // same word already shown

    const rect = selectionRect();
    if (!rect) return;
    currentWord = word;
    const seq = ++lookupSeq;

    show({ loading: true, word }, rect);

    let resp;
    try {
      resp = await browser.runtime.sendMessage({ type: "fd-lookup", word });
    } catch (e) {
      resp = { ok: false, error: "network" };
    }
    if (seq !== lookupSeq || currentWord !== word || !host) return; // stale

    if (!resp || !resp.ok) {
      show({ error: resp && resp.error }, rect);
    } else if (resp.notFound) {
      show({ word: resp.word, notFound: true }, rect);
    } else {
      show({ word: resp.word, entries: resp.entries }, rect);
    }
  }

  function schedule(fn, ms) {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(fn, ms);
  }

  let lastPointerAt = 0;

  // Registered on window (capture) so it still fires if a page stops
  // propagation at the document level.
  function onPointerEnd(event) {
    lastPointerAt = Date.now();
    if (isInsidePopup(event)) return;
    // Selections inside editable fields report inconsistently via
    // window.getSelection(); skip them rather than show misplaced popups.
    if (isEditable(event.target)) return;
    schedule(handleSelection, MOUSE_DEBOUNCE_MS);
  }
  window.addEventListener("mouseup", onPointerEnd, true);
  window.addEventListener("dblclick", onPointerEnd, true);

  // Touch devices (Firefox for Android): long-press selection and dragging the
  // selection handles don't reliably fire mouseup, so follow selectionchange
  // while the last pointer interaction was a touch.
  let touchMode = false;
  document.addEventListener(
    "pointerdown",
    function (event) {
      if (isInsidePopup(event)) return;
      lastPointerAt = Date.now();
      touchMode = event.pointerType === "touch" || event.pointerType === "pen";
    },
    true
  );
  document.addEventListener("selectionchange", function () {
    // Touch: mouseup is unreliable. Mouse: safety net for pages that swallow
    // mouseup — only within a moment of a real pointer interaction, so scripts
    // that change the selection programmatically don't trigger lookups.
    if (!touchMode && Date.now() - lastPointerAt > 700) return;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) return;
    if (isEditable(sel.anchorNode)) return;
    schedule(handleSelection, touchMode ? TOUCH_DEBOUNCE_MS : MOUSE_DEBOUNCE_MS + 150);
  });

  document.addEventListener(
    "keyup",
    function (event) {
      if (!event.shiftKey) return;
      if (isInsidePopup(event)) return;
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed) return;
      schedule(handleSelection, KEY_DEBOUNCE_MS);
    },
    true
  );

  document.addEventListener(
    "mousedown",
    function (event) {
      if (isInsidePopup(event)) return;
      if (host) {
        lookupSeq++;
        closePopup();
      }
    },
    true
  );

  document.addEventListener(
    "keydown",
    function (event) {
      if (event.key === "Escape" && host) {
        lookupSeq++;
        closePopup();
      }
    },
    true
  );

  // Scrolling moves the selection under the popup: keep the popup attached to
  // it, and close only if the selection is gone or off screen. Scroll events
  // right after showing (layout shifts, lazy content on busy sites) are ignored.
  window.addEventListener(
    "scroll",
    function () {
      if (!host) return;
      if (Date.now() - shownAt < 500) return;
      const rect = selectionRect();
      if (!rect || rect.bottom < 0 || rect.top > window.innerHeight) {
        closePopup();
        return;
      }
      positionHost(rect);
    },
    { capture: true, passive: true }
  );
})();
