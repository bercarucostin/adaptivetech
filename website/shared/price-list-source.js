// Fetches the current public price list, cache first.
//
// Everything here is injected -- fetch, storage, the callbacks -- because this is
// the one piece of the landing page that can fail in ways a visitor notices, and
// injected collaborators are what make those failures testable without a browser.
(function (root) {
  'use strict';

  var DEFAULT_CACHE_KEY = 'flowrise_public_prices_v1';

  // localStorage throws in a private window and can hold whatever a previous
  // version wrote, so every access is guarded and a bad value is simply absent.
  function readCache(storage, key) {
    try {
      var raw = storage.getItem(key);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      var doc = parsed && parsed.document;
      if (doc && Array.isArray(doc.groups)) return doc;
      // Unusable: drop it so the next visit does not repeat this.
      storage.removeItem(key);
      return null;
    } catch (err) {
      try { storage.removeItem(key); } catch (e) { /* nothing to do */ }
      return null;
    }
  }

  function writeCache(storage, key, doc) {
    try {
      storage.setItem(key, JSON.stringify({ document: doc, fetched_at: new Date().toISOString() }));
    } catch (err) {
      // A visitor who blocks site data still gets prices; they just pay for them
      // on every visit.
    }
  }

  function loadPriceList(options) {
    var key = options.cacheKey || DEFAULT_CACHE_KEY;
    var storage = options.storage;
    var rendered = false;
    var signalled = false;

    // A renderer that throws must not take the page down, and must not be
    // mistaken for a network failure -- those are different problems with
    // different fallbacks.
    function render(doc) {
      try {
        options.onDocument(doc);
        rendered = true;
        return true;
      } catch (err) {
        return false;
      }
    }

    // Exactly one of render() or unavailable() reaches the visitor: prices
    // already on screen from cache outrank a later failure, and a failed
    // render with nothing on screen still earns the phone-number line.
    function unavailable(err) {
      if (rendered || signalled) return;
      signalled = true;
      try {
        options.onUnavailable(err);
      } catch (e) {
        // The fallback renderer is broken too. There is nothing further to
        // try, and throwing from here would reject a promise the contract
        // says only ever resolves.
      }
    }

    var cached = readCache(storage, key);
    if (cached) render(cached);

    return options.fetch(options.url, {
      headers: { apikey: options.key, accept: 'application/json' }
    })
      .then(function (response) {
        if (!response.ok) throw new Error('HTTP ' + response.status);
        return response.json();
      })
      .then(function (rows) {
        var doc = rows && rows[0] && rows[0].document;
        if (!doc || !Array.isArray(doc.groups)) throw new Error('No current price list');
        // Render when the document changed, and also whenever nothing has
        // reached the visitor yet -- a cache render that threw must not be able
        // to skip the network render just because the document is identical.
        if (!rendered || !cached || JSON.stringify(cached) !== JSON.stringify(doc)) {
          if (!render(doc)) unavailable(new Error('The price list could not be rendered'));
        }
        writeCache(storage, key, doc);
        return doc;
      })
      .catch(function (err) {
        unavailable(err);
        return cached || null;
      });
  }

  var api = { loadPriceList: loadPriceList, CACHE_KEY: DEFAULT_CACHE_KEY };
  root.PriceListSource = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
