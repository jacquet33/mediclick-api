/* TusRecetasMed — íconos duotono propios + animaciones de la web pública.
 * Uso: <svg class="ic"><use href="#i-cal"/></svg>  ·  data-reveal en cualquier bloque  ·  data-count="120" para contadores */
(function () {
  var S = '<svg xmlns="http://www.w3.org/2000/svg" style="position:absolute;width:0;height:0;overflow:hidden" aria-hidden="true"><defs>' +
    '<linearGradient id="trm-s" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#A3B283"/><stop offset="1" stop-color="#5E6E44"/></linearGradient>' +
    '<linearGradient id="trm-c" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#D29C64"/><stop offset="1" stop-color="#7E5230"/></linearGradient>' +
    '<linearGradient id="trm-l" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#E9F0DD"/><stop offset="1" stop-color="#D3DEC0"/></linearGradient>' +
    '<linearGradient id="trm-w" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FBEEDD"/><stop offset="1" stop-color="#F1DCC2"/></linearGradient>' +
    '</defs>' +
    // Calendario con check
    '<symbol id="i-cal" viewBox="0 0 48 48"><rect x="6" y="10" width="36" height="32" rx="9" fill="url(#trm-l)"/><rect x="6" y="10" width="36" height="11" rx="5.5" fill="url(#trm-s)"/><rect x="14" y="5" width="4" height="10" rx="2" fill="#5E6E44"/><rect x="30" y="5" width="4" height="10" rx="2" fill="#5E6E44"/><path d="M17 31.5l5 5 9.5-10" fill="none" stroke="url(#trm-c)" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"/></symbol>' +
    // Campana con onda
    '<symbol id="i-bell" viewBox="0 0 48 48"><circle cx="24" cy="24" r="19" fill="url(#trm-w)"/><path d="M15 31V22a9 9 0 0 1 18 0v9l3 3H12z" fill="url(#trm-c)"/><path d="M20.5 37.5a3.6 3.6 0 0 0 7 0" fill="none" stroke="#7E5230" stroke-width="3" stroke-linecap="round"/><path d="M37 12a12 12 0 0 1 3.5 7M11 12a12 12 0 0 0-3.5 7" fill="none" stroke="#A3B283" stroke-width="2.6" stroke-linecap="round"/></symbol>' +
    // Receta con cápsula
    '<symbol id="i-rx" viewBox="0 0 48 48"><rect x="8" y="5" width="26" height="36" rx="7" fill="url(#trm-l)"/><path d="M14 14h14M14 20h10" stroke="#7F8F5E" stroke-width="2.8" stroke-linecap="round"/><text x="13.5" y="33" font-family="Georgia,serif" font-size="11" font-weight="700" fill="#5E6E44">Rx</text><g transform="rotate(-38 33 33)"><rect x="23" y="28" width="20" height="10" rx="5" fill="url(#trm-c)"/><rect x="33" y="28" width="10" height="10" rx="5" fill="#F1DCC2"/><rect x="33" y="28" width="1.6" height="10" fill="#7E5230" opacity=".35"/></g></symbol>' +
    // Escudo con candado
    '<symbol id="i-shield" viewBox="0 0 48 48"><path d="M24 4l16 6v12c0 10-7 18-16 22C15 40 8 32 8 22V10z" fill="url(#trm-l)"/><path d="M24 9l11 4.2V22c0 7.4-4.8 13.4-11 16.3z" fill="url(#trm-s)" opacity=".9"/><rect x="17" y="22" width="14" height="11" rx="3" fill="url(#trm-c)"/><path d="M20 22v-3a4 4 0 0 1 8 0v3" fill="none" stroke="#7E5230" stroke-width="2.6"/></symbol>' +
    // Credencial obra social
    '<symbol id="i-card" viewBox="0 0 48 48"><rect x="4" y="11" width="40" height="27" rx="7" fill="url(#trm-w)"/><rect x="4" y="11" width="40" height="8" fill="url(#trm-c)" opacity=".85"/><circle cx="15" cy="28" r="5" fill="url(#trm-s)"/><path d="M24 26h13M24 31h9" stroke="#B88457" stroke-width="2.6" stroke-linecap="round"/><path d="M15 25.5v5M12.5 28h5" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/></symbol>' +
    // Chat WhatsApp
    '<symbol id="i-chat" viewBox="0 0 48 48"><path d="M24 6c10 0 18 7.4 18 16.5S34 39 24 39c-2.2 0-4.3-.3-6.2-1L9 41l2.6-7.4C8.6 30.5 6 26.7 6 22.5 6 13.4 14 6 24 6z" fill="url(#trm-l)"/><path d="M24 11c7.3 0 13 5.2 13 11.5S31.3 34 24 34c-1.8 0-3.4-.3-4.9-.8L13.6 35l1.6-4.6C13 28.2 11 25.5 11 22.5 11 16.2 16.7 11 24 11z" fill="url(#trm-s)"/><circle cx="18.5" cy="22.5" r="2" fill="#fff"/><circle cx="24" cy="22.5" r="2" fill="#fff"/><circle cx="29.5" cy="22.5" r="2" fill="#fff"/></symbol>' +
    // Lupa
    '<symbol id="i-search" viewBox="0 0 48 48"><circle cx="21" cy="21" r="14" fill="url(#trm-w)"/><circle cx="21" cy="21" r="9.5" fill="none" stroke="url(#trm-c)" stroke-width="4"/><path d="M29 29l10 10" stroke="#7E5230" stroke-width="5" stroke-linecap="round"/><path d="M16.5 18a5.5 5.5 0 0 1 4.5-3" stroke="#fff" stroke-width="2.4" stroke-linecap="round" fill="none"/></symbol>' +
    // Reloj
    '<symbol id="i-clock" viewBox="0 0 48 48"><circle cx="24" cy="24" r="19" fill="url(#trm-l)"/><circle cx="24" cy="24" r="13" fill="#fff"/><path d="M24 16v8.5l6 3.5" fill="none" stroke="url(#trm-c)" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/><circle cx="24" cy="24" r="2" fill="#5E6E44"/></symbol>' +
    // Celular
    '<symbol id="i-phone" viewBox="0 0 48 48"><rect x="12" y="4" width="24" height="40" rx="7" fill="url(#trm-c)"/><rect x="15" y="9" width="18" height="28" rx="3.5" fill="#FBF7EF"/><rect x="19" y="14" width="10" height="3" rx="1.5" fill="#A3B283"/><rect x="19" y="20" width="10" height="3" rx="1.5" fill="#D3DEC0"/><rect x="19" y="26" width="7" height="3" rx="1.5" fill="#D3DEC0"/><rect x="20" y="39.5" width="8" height="2" rx="1" fill="#F1DCC2"/></symbol>' +
    // Destello IA
    '<symbol id="i-spark" viewBox="0 0 48 48"><circle cx="24" cy="24" r="19" fill="url(#trm-w)"/><path d="M24 9c1.3 7.5 3.5 9.7 11 11-7.5 1.3-9.7 3.5-11 11-1.3-7.5-3.5-9.7-11-11 7.5-1.3 9.7-3.5 11-11z" fill="url(#trm-c)"/><path d="M35 29c.6 3.2 1.6 4.2 4.8 4.8-3.2.6-4.2 1.6-4.8 4.8-.6-3.2-1.6-4.2-4.8-4.8 3.2-.6 4.2-1.6 4.8-4.8z" fill="url(#trm-s)"/></symbol>' +
    // Historia clínica
    '<symbol id="i-doc" viewBox="0 0 48 48"><rect x="9" y="5" width="30" height="38" rx="7" fill="url(#trm-l)"/><rect x="17" y="2.5" width="14" height="7" rx="3.5" fill="url(#trm-s)"/><path d="M15 20h4l2.5-5 4 11 2.5-6h5" fill="none" stroke="url(#trm-c)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/><path d="M15 32h18M15 37h11" stroke="#A3B283" stroke-width="2.6" stroke-linecap="round"/></symbol>' +
    // Equipo
    '<symbol id="i-team" viewBox="0 0 48 48"><circle cx="32" cy="17" r="6.5" fill="url(#trm-s)" opacity=".75"/><path d="M22 38c0-6 4.5-10.5 10-10.5S42 32 42 38z" fill="url(#trm-l)"/><circle cx="18" cy="16" r="7.5" fill="url(#trm-c)"/><path d="M5 40c0-7 5.8-12 13-12s13 5 13 12z" fill="url(#trm-c)" opacity=".9"/></symbol>' +
    // QR
    '<symbol id="i-qr" viewBox="0 0 48 48"><rect x="4" y="4" width="40" height="40" rx="10" fill="url(#trm-w)"/><rect x="10" y="10" width="11" height="11" rx="3" fill="url(#trm-c)"/><rect x="27" y="10" width="11" height="11" rx="3" fill="url(#trm-c)"/><rect x="10" y="27" width="11" height="11" rx="3" fill="url(#trm-c)"/><rect x="13.5" y="13.5" width="4" height="4" rx="1" fill="#FBEEDD"/><rect x="30.5" y="13.5" width="4" height="4" rx="1" fill="#FBEEDD"/><rect x="13.5" y="30.5" width="4" height="4" rx="1" fill="#FBEEDD"/><rect x="27" y="27" width="5" height="5" rx="1.4" fill="#7F8F5E"/><rect x="33" y="33" width="5" height="5" rx="1.4" fill="#7F8F5E"/><rect x="33" y="27" width="5" height="3" rx="1.4" fill="#A3B283"/></symbol>' +
    // Gráfico
    '<symbol id="i-chart" viewBox="0 0 48 48"><rect x="5" y="5" width="38" height="38" rx="10" fill="url(#trm-l)"/><rect x="12" y="25" width="6" height="11" rx="3" fill="url(#trm-s)"/><rect x="21" y="18" width="6" height="18" rx="3" fill="url(#trm-c)"/><rect x="30" y="12" width="6" height="24" rx="3" fill="url(#trm-s)"/></symbol>' +
    '</svg>';
  function sprite() { if (!document.getElementById('trm-sprite')) { var d = document.createElement('div'); d.id = 'trm-sprite'; d.innerHTML = S; document.body.insertBefore(d, document.body.firstChild); } }

  var quieto = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function reveal() {
    var els = [].slice.call(document.querySelectorAll('[data-reveal]:not(.is-in)'));
    if (quieto || !('IntersectionObserver' in window)) { els.forEach(function (e) { e.classList.add('is-in'); }); return; }
    var io = new IntersectionObserver(function (ents) {
      ents.forEach(function (en) {
        if (!en.isIntersecting) return;
        en.target.classList.add('is-in'); io.unobserve(en.target);
        var n = en.target.querySelectorAll('[data-count]');
        [].forEach.call(n, contar);
      });
    }, { threshold: .14, rootMargin: '0px 0px -40px 0px' });
    els.forEach(function (e, i) { if (!e.style.getPropertyValue('--d')) e.style.setProperty('--d', (i % 4) * 70 + 'ms'); io.observe(e); });
  }
  function contar(el) {
    var fin = parseFloat(el.getAttribute('data-count')), suf = el.getAttribute('data-suf') || '', t0 = null;
    if (quieto) { el.textContent = fin + suf; return; }
    function paso(t) { if (!t0) t0 = t; var p = Math.min(1, (t - t0) / 1100), v = Math.round(fin * (1 - Math.pow(1 - p, 3))); el.textContent = v + suf; if (p < 1) requestAnimationFrame(paso); }
    requestAnimationFrame(paso);
  }
  // Nav con fondo al hacer scroll
  function nav() { var n = document.querySelector('.trm-nav'); if (!n) return; var f = function () { n.classList.toggle('scrolled', window.scrollY > 8); }; f(); window.addEventListener('scroll', f, { passive: true }); }
  // Brillo que sigue al mouse en las tarjetas
  function glow() {
    if (quieto) return;
    document.addEventListener('pointermove', function (e) {
      var c = e.target.closest && e.target.closest('.trm-card');
      if (!c) return; var r = c.getBoundingClientRect();
      c.style.setProperty('--mx', (e.clientX - r.left) + 'px'); c.style.setProperty('--my', (e.clientY - r.top) + 'px');
    }, { passive: true });
  }
  window.trmReveal = reveal;
  function init() { sprite(); reveal(); nav(); glow(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
