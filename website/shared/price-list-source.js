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
      return doc && doc.groups ? doc : null;
    } catch (err) {
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
    var cached = readCache(storage, key);

    if (cached) options.onDocument(cached);

    return options.fetch(options.url, {
      headers: { apikey: options.key, accept: 'application/json' }
    })
      .then(function (response) {
        if (!response.ok) throw new Error('HTTP ' + response.status);
        return response.json();
      })
      .then(function (rows) {
        var doc = rows && rows[0] && rows[0].document;
        if (!doc || !doc.groups) throw new Error('No current price list');
        if (!cached || JSON.stringify(cached) !== JSON.stringify(doc)) options.onDocument(doc);
        writeCache(storage, key, doc);
        return doc;
      })
      .catch(function (err) {
        if (!cached) options.onUnavailable(err);
        return cached || null;
      });
  }

  var api = { loadPriceList: loadPriceList, CACHE_KEY: DEFAULT_CACHE_KEY };
  root.PriceListSource = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
