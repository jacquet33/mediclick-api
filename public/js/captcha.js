/* Captcha (Cloudflare Turnstile) para formularios públicos.
 * No hace nada si el servidor no tiene captcha configurado. Agrega la cabecera x-captcha-token
 * solo a los POST que lo necesitan; en la mayoría de los casos es invisible para la persona. */
(function () {
  var PROTEGIDOS = [
    /\/api\/v1\/auth\/register(\/patient)?$/,
    /\/api\/v1\/public\/booking\/[^/]+(\/register-patient)?$/,
    /\/api\/v1\/farmacia\/registro$/,
    /\/api\/v1\/public\/data-requests$/,
  ];
  var siteKey = null, cargando = null, widget = null, caja = null;

  function config() {
    if (siteKey !== null) return Promise.resolve(siteKey);
    return window.__fetchOriginal('/api/v1/public/config').then(function (r) { return r.json(); })
      .then(function (c) { siteKey = (c && c.turnstileSiteKey) || ''; return siteKey; })
      .catch(function () { siteKey = ''; return ''; });
  }
  function cargar() {
    if (cargando) return cargando;
    cargando = new Promise(function (ok, mal) {
      var s = document.createElement('script');
      s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      s.async = true; s.onload = function () { ok(); }; s.onerror = mal;
      document.head.appendChild(s);
    });
    return cargando;
  }
  function token(key) {
    return cargar().then(function () {
      return new Promise(function (ok, mal) {
        if (!caja) {
          caja = document.createElement('div');
          caja.style.cssText = 'position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:99999';
          document.body.appendChild(caja);
        }
        var listo = function (t) { ok(t); };
        if (widget !== null) { try { window.turnstile.remove(widget); } catch (e) {} }
        widget = window.turnstile.render(caja, {
          sitekey: key, appearance: 'interaction-only', language: 'es',
          callback: listo, 'error-callback': function () { mal(new Error('captcha')); },
        });
        setTimeout(function () { mal(new Error('captcha-timeout')); }, 60000);
      });
    });
  }

  window.__fetchOriginal = window.__fetchOriginal || window.fetch.bind(window);
  window.fetch = function (url, opts) {
    opts = opts || {};
    var metodo = String(opts.method || 'GET').toUpperCase();
    var ruta = String(url && url.url ? url.url : url).split('?')[0];
    if (metodo !== 'POST' || !PROTEGIDOS.some(function (re) { return re.test(ruta); })) return window.__fetchOriginal(url, opts);
    return config().then(function (key) {
      if (!key) return window.__fetchOriginal(url, opts);
      return token(key).then(function (t) {
        var h = new Headers(opts.headers || {});
        h.set('x-captcha-token', t);
        return window.__fetchOriginal(url, Object.assign({}, opts, { headers: h }));
      }, function () {
        // Si el captcha no carga (bloqueador, red), igual se intenta: el servidor decide
        return window.__fetchOriginal(url, opts);
      });
    });
  };
})();
