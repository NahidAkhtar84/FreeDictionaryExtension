/*
 * Free Dictionary Lookup — background script.
 * Handles lookup requests from content scripts and the toolbar popup:
 * fetches from dictionaryapi.dev with a timeout, caches results in memory and
 * (bounded) in storage.local so repeated lookups are instant and offline-ish.
 */
"use strict";

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

browser.runtime.onMessage.addListener(function (message) {
  if (message && message.type === "fd-lookup" && typeof message.word === "string") {
    return lookup(message.word);
  }
  return undefined;
});

loadPersistedCache();
