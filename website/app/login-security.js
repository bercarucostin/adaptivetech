(function () {
  'use strict';
  let loader;
  function loadTurnstile() {
    if (window.turnstile) return Promise.resolve(window.turnstile);
    if (!loader) {
      loader = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        let settled = false;
        const finish = (error) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          if (error) reject(error); else resolve(window.turnstile);
        };
        const timer = setTimeout(() => finish(new Error('timeout')), 15000);
        script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
        script.async = true;
        script.defer = true;
        script.onload = () => finish(window.turnstile ? null : new Error('unavailable'));
        script.onerror = () => finish(new Error('unavailable'));
        document.head.appendChild(script);
      });
    }
    return loader;
  }
  window.LoginSecurity = {
    create({ siteKey, container, onStateChange = () => {} }) {
      let token = '', widget, api, loading;
      const state = { ready: false, error: '' };
      const publish = (ready, error = '') => { state.ready = ready; state.error = error; onStateChange({ ...state }); };
      const fail = () => { token = ''; publish(false, 'Verificarea de securitate nu este disponibilă. Reîncarcă pagina și verifică blocarea scripturilor.'); };
      const controller = {
        state,
        getToken: () => token,
        reset() {
          token = '';
          if (api && widget !== undefined) {
            try { api.reset(widget); publish(false); } catch { fail(); }
          }
        },
        load() {
          if (loading) return loading;
          loading = (async () => {
            if (!siteKey || !container) { publish(false, 'Verificarea de securitate nu este configurată. Contactează administratorul.'); return; }
            try {
              api = await loadTurnstile();
              widget = api.render(container, {
                sitekey: siteKey,
                callback(value) { token = value || ''; publish(Boolean(token)); },
                'expired-callback'() { token = ''; publish(false); },
                'timeout-callback'() { token = ''; publish(false); },
                'error-callback'() { fail(); return true; },
              });
            } catch { fail(); }
          })();
          return loading;
        },
      };
      return controller;
    },
  };
})();
