/*
 * Free Dictionary Lookup — shared helpers.
 * Loaded before content.js, background.js and popup.js. Attaches a `FD`
 * namespace to globalThis. All rendering uses DOM APIs with textContent only;
 * API responses are never inserted as HTML.
 */
"use strict";

(function (global) {
  const MAX_WORDS = 5;
  const MAX_CHARS = 48;

  /**
   * Normalize a raw selection/query into a lookup word, or null if it is not
   * something we can look up (empty, too long, no letters, digits, code...).
   */
  function normalizeWord(raw) {
    let t = String(raw == null ? "" : raw).replace(/\s+/g, " ").trim();
    // Strip surrounding punctuation and quotes, keep inner apostrophes/hyphens.
    t = t.replace(/^[\s'`"“”‘’(\[{\-–—.,;:!?]+/, "").replace(/[\s'`"“”‘’)\]}.,;:!?–—-]+$/, "");
    if (!t) return null;
    if (t.length > MAX_CHARS) return null;
    if (!/^[A-Za-z][A-Za-z' -]*$/.test(t)) return null;
    const words = t.split(" ");
    if (words.length > MAX_WORDS) return null;
    return t.toLowerCase();
  }

  function el(doc, tag, cls, text) {
    const node = doc.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  }

  function svgIcon(doc, paths, viewBox) {
    const NS = "http://www.w3.org/2000/svg";
    const svg = doc.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", viewBox || "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    for (const p of paths) {
      const path = doc.createElementNS(NS, "path");
      path.setAttribute("d", p.d);
      if (p.stroke) {
        path.setAttribute("fill", "none");
        path.setAttribute("stroke", "currentColor");
        path.setAttribute("stroke-width", p.strokeWidth || "1.8");
        path.setAttribute("stroke-linecap", "round");
        path.setAttribute("stroke-linejoin", "round");
      } else {
        path.setAttribute("fill", "currentColor");
      }
      svg.appendChild(path);
    }
    return svg;
  }

  function speakerIcon(doc) {
    return svgIcon(doc, [
      { d: "M3 9v6h4l5 4V5L7 9H3z" },
      { d: "M16.5 8.5a5 5 0 0 1 0 7", stroke: true },
    ]);
  }

  function searchIcon(doc) {
    return svgIcon(doc, [
      { d: "M10.5 4a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13z", stroke: true },
      { d: "M15.5 15.5 20 20", stroke: true },
    ]);
  }

  function link(doc, cls, href, text) {
    const a = doc.createElement("a");
    a.className = cls;
    a.href = href;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.textContent = text;
    return a;
  }

  /**
   * Render a lookup state into `container` (an element in `doc`).
   * state: {loading:true} | {word, entries} | {word, notFound:true} | {error}
   */
  function renderInto(doc, container, state) {
    container.replaceChildren();

    const card = el(doc, "div", "fd-card");

    if (state.loading) {
      const msg = el(doc, "div", "fd-msg");
      const spin = el(doc, "div", "fd-spinner");
      msg.append(spin, el(doc, "span", null, "Looking up…"));
      card.append(msg);
      container.append(card);
      return;
    }

    if (state.error === "network") {
      const msg = el(doc, "div", "fd-msg");
      msg.append(
        el(doc, "div", "fd-msg-title", "Connection problem"),
        el(doc, "div", "fd-muted", "Couldn’t reach dictionaryapi.dev. Check your connection and try again.")
      );
      card.append(msg);
      container.append(card);
      return;
    }

    if (state.error) {
      const msg = el(doc, "div", "fd-msg");
      msg.append(el(doc, "div", "fd-muted", "Couldn’t look up this selection."));
      card.append(msg);
      container.append(card);
      return;
    }

    // Header: word, phonetic, pronounce button.
    const head = el(doc, "div", "fd-head");
    head.append(el(doc, "span", "fd-word", state.word));
    const entries = Array.isArray(state.entries) ? state.entries : [];
    const first = entries[0] || {};
    const phonetic =
      first.phonetic ||
      (first.phonetics || []).map(function (p) { return p && p.text; }).filter(Boolean)[0] ||
      "";
    if (phonetic) head.append(el(doc, "span", "fd-phonetic", phonetic));

    let audioUrl = entries
      .flatMap(function (e) { return (e && e.phonetics) || []; })
      .map(function (p) { return p && p.audio; })
      .filter(Boolean)[0];
    if (audioUrl && audioUrl.startsWith("//")) audioUrl = "https:" + audioUrl; // protocol-relative URLs break on moz-extension:// pages
    if (audioUrl) {
      const btn = el(doc, "button", "fd-audio");
      btn.type = "button";
      btn.title = "Play pronunciation";
      btn.setAttribute("aria-label", "Play pronunciation for " + state.word);
      btn.append(speakerIcon(doc));
      btn.addEventListener("click", function () {
        try {
          const audio = new Audio(audioUrl);
          const playPromise = audio.play();
          if (playPromise && playPromise.catch) playPromise.catch(function () {});
        } catch (e) {
          /* media blocked or unavailable — ignore */
        }
      });
      head.append(btn);
    }
    card.append(head);

    if (state.notFound) {
      const msg = el(doc, "div", "fd-msg");
      msg.append(
        el(doc, "div", "fd-msg-title", "No definitions found"),
        el(doc, "div", "fd-muted", "“" + state.word + "” isn’t in the dictionary.")
      );
      const alt = el(doc, "div", "fd-alt");
      alt.append(link(doc, "fd-src", "https://www.google.com/search?q=define+" + encodeURIComponent(state.word), "Search the web →"));
      msg.append(alt);
      card.append(msg);
      container.append(card);
      return;
    }

    // Meanings merged across entries, grouped by part of speech.
    const byPos = new Map();
    for (const entry of entries) {
      for (const meaning of (entry && entry.meanings) || []) {
        if (!meaning || !meaning.partOfSpeech) continue;
        if (!byPos.has(meaning.partOfSpeech)) byPos.set(meaning.partOfSpeech, []);
        byPos.get(meaning.partOfSpeech).push(...(meaning.definitions || []));
      }
    }

    const body = el(doc, "div", "fd-body");
    let posCount = 0;
    for (const [pos, defs] of byPos) {
      if (++posCount > 4) break;
      const section = el(doc, "div", "fd-pos");
      section.append(el(doc, "span", "fd-pos-name", pos));
      const list = el(doc, "ol", "fd-defs");
      for (const d of defs.slice(0, 3)) {
        if (!d || !d.definition) continue;
        const li = el(doc, "li", "fd-def");
        li.append(el(doc, "div", "fd-def-text", d.definition));
        if (d.example) li.append(el(doc, "div", "fd-example", "“" + d.example + "”"));
        list.append(li);
      }
      if (list.childNodes.length) {
        section.append(list);
        body.append(section);
      }
    }
    if (!body.childNodes.length) body.append(el(doc, "div", "fd-muted", "No definitions returned."));
    card.append(body);

    const foot = el(doc, "div", "fd-foot");
    foot.append(link(doc, "fd-src", "https://dictionaryapi.dev", "Free Dictionary API ↗"));
    card.append(foot);

    container.append(card);
  }

  const FD = { normalizeWord, renderInto, icons: { speaker: speakerIcon, search: searchIcon } };
  global.FD = FD;
})(globalThis);
