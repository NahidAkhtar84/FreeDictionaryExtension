/* Free Dictionary Lookup — toolbar popup logic. */
"use strict";

(function () {
  const form = document.getElementById("fd-form");
  const input = document.getElementById("fd-input");
  const results = document.getElementById("fd-results");
  const searchIconHost = document.getElementById("fd-search-icon");

  searchIconHost.append(FD.icons.search(document));

  let seq = 0;

  async function runLookup() {
    const raw = input.value;
    const word = FD.normalizeWord(raw);

    if (!word) {
      FD.renderInto(document, results, { error: "invalid" });
      const muted = results.querySelector(".fd-muted");
      if (muted) muted.textContent = "Type a single word or a short phrase (up to 5 words).";
      return;
    }

    const current = ++seq;
    FD.renderInto(document, results, { loading: true, word });

    let resp;
    try {
      resp = await browser.runtime.sendMessage({ type: "fd-lookup", word });
    } catch (e) {
      resp = { ok: false, error: "network" };
    }
    if (current !== seq) return; // a newer lookup superseded this one

    if (!resp || !resp.ok) {
      FD.renderInto(document, results, { error: resp && resp.error });
    } else if (resp.notFound) {
      FD.renderInto(document, results, { word: resp.word, notFound: true });
    } else {
      FD.renderInto(document, results, { word: resp.word, entries: resp.entries });
    }
  }

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    runLookup();
  });

  input.focus();

  // Opened from the right-click "Look up" menu: prefill and look up.
  browser.runtime.sendMessage({ type: "fd-take-pending" }).then(function (word) {
    if (typeof word === "string" && word) {
      input.value = word.slice(0, Number(input.maxLength) > 0 ? input.maxLength : 48);
      runLookup();
    }
  }).catch(function () {});
})();
