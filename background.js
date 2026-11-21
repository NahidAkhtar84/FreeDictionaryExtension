/*
 * Free Dictionary Lookup — background script.
 * Handles lookup requests from content scripts and the toolbar popup:
 * fetches from dictionaryapi.dev with a timeout, caches results in memory and
 * (bounded) in storage.local so repeated lookups are instant and offline-ish.
 */
"use strict";

// Chrome runs this as a service worker: load the shared helpers and map the
// `browser` namespace onto `chrome` (MV3 chrome.* APIs return promises).
if (typeof importScripts === "function" && typeof FD === "undefined") importScripts("shared.js");

const API_BASE = "https://api.dictionaryapi.dev/api/v2/entries/en/";
const CACHE_KEY = "fd_lookup_cache";
const CACHE_MAX_ENTRIES = 150;
const MAX_ENTRY_BYTES = 60000; // skip persisting absurdly large entries
const FETCH_TIMEOUT_MS = 10000;

/** @type {Map<string, {t: number, d: object}>} */
const memCache = new Map();

async function loadPersistedCache() {
  try {
    const stored = await browser.storage.local.get(CACHE_KEY);
    const cache = stored && stored[CACHE_KEY];
    if (cache && typeof cache === "object") {
      for (const [word, item] of Object.entries(cache)) {
        if (item && item.d && typeof item.t === "number") memCache.set(word, item);
      }
    }
  } catch (e) {
    /* storage unavailable — memory cache still works */
  }
}

function pruneOldest() {
  while (memCache.size > CACHE_MAX_ENTRIES) {
    let oldestKey = null;
    let oldestTime = Infinity;
    for (const [key, item] of memCache) {
      if (item.t < oldestTime) {
        oldestTime = item.t;
        oldestKey = key;
      }
    }
    memCache.delete(oldestKey);
  }
}

function persistCache() {
  const obj = {};
  for (const [key, item] of memCache) {
    try {
      if (JSON.stringify(item.d).length <= MAX_ENTRY_BYTES) obj[key] = item;
    } catch (e) {
      /* skip unserializable entry */
    }
  }
  browser.storage.local.set({ [CACHE_KEY]: obj }).catch(function () {});
}

async function fetchDefinition(word) {
  const controller = new AbortController();
  const timer = setTimeout(function () { controller.abort(); }, FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(API_BASE + encodeURIComponent(word), {
      signal: controller.signal,
      credentials: "omit",
      referrerPolicy: "no-referrer",
    });
    if (res.status === 404) return { notFound: true };
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();
    if (!Array.isArray(data) || !data.length) return { notFound: true };
    return { entries: data };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * @returns {Promise<{ok: true, word: string, entries?: array, notFound?: boolean}|
 *                  {ok: false, error: "network"|"invalid"}>}
 */
async function lookup(rawWord) {
  const word = FD.normalizeWord(rawWord);
  if (!word) return { ok: false, error: "invalid" };

  const cached = memCache.get(word);
  if (cached) return Object.assign({ ok: true, word }, cached.d);

  let data;
  try {
    data = await fetchDefinition(word);
  } catch (e) {
    return { ok: false, error: "network" };
  }

  memCache.set(word, { t: Date.now(), d: data });
  pruneOldest();
  persistCache();
  return Object.assign({ ok: true, word }, data);
}

// Lookups must wait for the persisted cache, otherwise a freshly started
// background (Chrome's service worker restarts often) would overwrite the
// stored cache with a near-empty one.
const cacheReady = loadPersistedCache();

/*
 * Right-click "Look up" menu. Content scripts can't run inside the browser's
 * built-in PDF viewer (or other privileged pages), so selection popups never
 * appear there. The context menu still receives the selected text, so we
 * hand the word to the toolbar popup and open it.
 * Not available on Firefox for Android (no context menus API there).
 */
const MENU_ID = "fd-lookup-selection";
const menus = browser.menus || browser.contextMenus;
const action = browser.action || browser.browserAction;
let pendingWord = null;

function openLookupWindow(word) {
  // Fallback when the toolbar popup can't be opened programmatically.
  const url = browser.runtime.getURL("popup/popup.html") + "?word=" + encodeURIComponent(word);
  if (browser.windows && browser.windows.create) {
    return browser.windows.create({ url, type: "popup", width: 400, height: 560 });
  }
  return browser.tabs.create({ url });
}

if (menus) {
  // removeAll first: re-running create() on every background start (Chrome
  // service worker) would otherwise fail with a duplicate-id error.
  Promise.resolve(menus.removeAll()).then(function () {
    menus.create({ id: MENU_ID, title: "Look up “%s”", contexts: ["selection"] });
  }).catch(function () {});

  menus.onClicked.addListener(function (info) {
    if (info.menuItemId !== MENU_ID) return;
    const word = String(info.selectionText || "").trim();
    if (!word) return;
    pendingWord = word;
    let opened;
    try {
      // Must be called synchronously inside the user-action handler.
      opened = action && action.openPopup ? action.openPopup() : Promise.reject(new Error("no openPopup"));
    } catch (e) {
      opened = Promise.reject(e);
    }
    Promise.resolve(opened).catch(function () {
      pendingWord = null;
      openLookupWindow(word).catch(function () {});
    });
  });
}

// sendResponse style (not returned promises) so the same code works in
// Firefox and Chrome.
browser.runtime.onMessage.addListener(function (message, sender, sendResponse) {
  if (!message) return false;
  if (message.type === "fd-lookup" && typeof message.word === "string") {
    cacheReady
      .then(function () { return lookup(message.word); })
      .then(sendResponse, function () { sendResponse({ ok: false, error: "network" }); });
    return true; // keep the channel open for the async response
  }
  if (message.type === "fd-take-pending") {
    const word = pendingWord;
    pendingWord = null;
    sendResponse(word);
    return false;
  }
  return false;
});
