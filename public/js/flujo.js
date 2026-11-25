/* TusRecetasMed — demo interactiva "Cómo funciona".
 * Uso: <div data-flujo="paciente|medico"></div> + /css/flujo.css. Datos ficticios. */
(function () {
  'use strict';
  var root = document.querySelector('[data-flujo]');
  if (!root) return;
  var modo = root.getAttribute('data-flujo') || 'paciente';
  var med = modo === 'medico';
  var quieto = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var I = {
    lupa: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
    tk: '<svg class="tk" viewBox="0 0 16 11" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M1 6l3 3 6-7M6 9l1 1 6-8"/></svg>',
    ver: '<svg viewBox="0 0 24 24"><path fill="#25D366" d="M12 1l2.6 2.2 3.4-.4.9 3.3 3 1.7-1 3.2 1 3.2-3 1.7-.9 3.3-3.4-.4L12 23l-2.6-2.2-3.4.4-.9-3.3-3-1.7 1-3.2-1-3.2 3-1.7.9-3.3 3.4.4z"/><path d="m7.5 12 3 3 6-6" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg>',
    okc: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="m7.5 12 3 3 6-6"/></svg>',
    waI: '<svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm5.4 14.2c-.2.6-1.3 1.2-1.8 1.2-.5.1-1 .2-3.3-.7-2.8-1.1-4.6-4-4.7-4.2-.1-.2-1.1-1.5-1.1-2.9s.7-2 1-2.3c.2-.3.5-.3.7-.3h.5c.2 0 .4 0 .6.5l.9 2.1c.1.2.1.4 0 .5l-.3.5-.4.4c-.1.1-.3.3-.1.6.2.3.8 1.3 1.7 2.1 1.2 1 2.1 1.3 2.4 1.5.3.1.5.1.6-.1l.9-1c.2-.3.4-.2.6-.1l2 .9c.3.1.5.2.5.3.1.2.1.7-.1 1.4Z"/></svg>'
  };

  var TABS = [
    { k: 'turnos', ic: 'i-cal', n: 'Turnos online',
      b: med ? 'Tus pacientes reservan solos' : 'Reservá en 30 segundos',
      p: med ? 'Buscan por especialidad u obra social, ven solo tus horarios libres y reservan las 24 horas. El turno entra directo a tu agenda.'
             : 'Buscás por especialidad u obra social, tocás un horario libre y confirmás. Sin llamar y sin crear cuenta.' },
    { k: 'wa', ic: 'i-chat', n: 'Avisos por WhatsApp',
      b: med ? 'Confirmación y recordatorio automáticos' : 'Te avisamos por WhatsApp',
      p: med ? 'Salen desde tu número, el del consultorio o el de la secretaría. El paciente confirma o cancela con un toque y tu agenda se actualiza sola.'
             : 'Confirmación al instante y recordatorio el día anterior. Confirmás o cancelás con un toque, sin llamar.' },
    { k: 'rx', ic: 'i-rx', n: 'Receta electrónica',
      b: med ? 'Recetá en segundos, con QR' : 'Tu receta en el celular',
      p: med ? 'Buscás el medicamento en el listado oficial, firmás y el paciente la recibe al instante. La farmacia la valida escaneando el QR.'
             : 'Tu médico la emite y te llega al celular con un código QR. En la farmacia la escanean y la validan al momento.' }
  ];

  root.innerHTML =
    '<div class="fx">' +
      '<div class="fx-nav" role="tablist" aria-label="Cómo funciona">' + TABS.map(function (t, i) {
        return '<button class="fx-tab' + (t.k === 'wa' ? ' wa' : '') + '" role="tab" aria-selected="false" data-i="' + i + '">' +
          '<span class="fx-ico"><svg><use href="#' + t.ic + '"/></svg></span>' +
          '<span><small>0' + (i + 1) + ' · ' + t.n + '</small><b>' + t.b + '</b><p>' + t.p + '</p><span class="fx-bar"><i></i></span></span></button>';
      }).join('') + '</div>' +
      '<div class="fx-stage" aria-label="Demostración animada">' +
        '<div class="fx-phone"><div class="fx-screen"><div class="fx-sb"><span>9:41</span><span>●●● ▮</span></div></div><div class="fx-tap"></div></div>' +
        '<div class="fx-side"></div>' +
        '<div class="fx-note">Demostración con datos ficticios · <b>Tocá la pantalla</b> para avanzar</div>' +
      '</div>' +
    '</div>';

  var tabs = [].slice.call(root.querySelectorAll('.fx-tab'));
  var phone = root.querySelector('.fx-phone');
  var screen = root.querySelector('.fx-screen');
  var sb = root.querySelector('.fx-sb');
  var tapEl = root.querySelector('.fx-tap');
  var side = root.querySelector('.fx-side');

  var run = 0, cur = 0, visible = false, iniciado = false;

  function Stop() {}
  function guard(my) { if (my !== run) throw new Stop(); }
  function sleep(ms) {
    var my = run;
    return new Promise(function (res, rej) {
      setTimeout(function () { my === run ? res() : rej(new Stop()); }, quieto ? Math.min(ms, 250) : ms);
    });
  }
  function q(s, el) { return (el || screen).querySelector(s); }

  function view(html, opts) {
    var old = [].slice.call(screen.querySelectorAll('.fx-view'));
    old.forEach(function (o) { o.classList.add('out'); setTimeout(function () { o.remove(); }, 320); });
    var v = document.createElement('div');
    v.className = 'fx-view';
    v.innerHTML = html;
    screen.appendChild(v);
    sb.classList.toggle('lt', !!(opts && opts.lt));
    return v;
  }
  function sideSet(html) {
    side.style.opacity = 0;
    setTimeout(function () { side.innerHTML = html; side.style.opacity = 1; }, 220);
    return sleep(260);
  }
  function prog(f) {
    var b = tabs[cur] && tabs[cur].querySelector('.fx-bar i');
    if (b) b.style.width = Math.round(f * 100) + '%';
  }
  async function type(el, txt, sp) {
    for (var i = 1; i <= txt.length; i++) { el.textContent = txt.slice(0, i); await sleep(sp || 55); }
  }

  function moveFinger(el, instant) {
    var p = phone.getBoundingClientRect(), r = el.getBoundingClientRect();
    if (!r.width) return;
    if (instant) tapEl.style.transition = 'none';
    tapEl.style.transform = 'translate(' + (r.left - p.left + r.width / 2 - 18) + 'px,' + (r.top - p.top + r.height / 2 - 18) + 'px)';
    tapEl.classList.add('show');
    if (instant) { void tapEl.offsetWidth; tapEl.style.transition = ''; }
  }
  function pulse(el) {
    tapEl.classList.remove('go'); void tapEl.offsetWidth; tapEl.classList.add('go');
    el.classList.add('fx-press');
    setTimeout(function () { el.classList.remove('fx-press'); }, 220);
    setTimeout(function () { tapEl.classList.remove('show'); }, 520);
  }
  /* Espera el toque del usuario; si no llega, lo hace la demo con un dedo animado. */
  function tap(el, wait) {
    var my = run;
    return new Promise(function (res, rej) {
      var done = false;
      el.classList.add('fx-hint');
      function fin(user) {
        if (done) return; done = true;
        clearTimeout(tm); el.removeEventListener('click', onc); el.classList.remove('fx-hint');
        if (my !== run) return rej(new Stop());
        moveFinger(el, user);
        setTimeout(function () {
          if (my !== run) return rej(new Stop());
          pulse(el);
          setTimeout(function () { my === run ? res() : rej(new Stop()); }, 260);
        }, user ? 0 : 480);
      }
      function onc(e) { e.preventDefault(); e.stopPropagation(); fin(true); }
      el.addEventListener('click', onc);
      var tm = setTimeout(function () { fin(false); }, quieto ? 400 : (wait || 1600));
    });
  }

  /* ---------- Agenda lateral ---------- */
  function agendaHtml(extra, titulo) {
    return '<div class="sd"><div class="sd-h"><span class="sd-live"></span>' + (titulo || 'Agenda · Dra. Méndez') + '<small>Mar 17</small></div>' +
      '<div class="sd-rows">' +
        '<div class="sd-r"><span class="t">9:00</span><span class="n">Ana Rossi<small>Control</small></span><span class="pill ok">Confirmado</span></div>' +
        (extra || '') +
        '<div class="sd-r"><span class="t">10:00</span><span class="n">Jorge Paz<small>OSDE</small></span><span class="pill pd">Pendiente</span></div>' +
        '<div class="sd-r"><span class="t">10:30</span><span class="n">Lucía Vera<small>Particular</small></span><span class="pill ok">Confirmado</span></div>' +
      '</div>';
  }
  var filaMartin = function (cls, pill, txt) {
    return '<div class="sd-r ' + (cls || '') + '" data-m><span class="t">9:30</span><span class="n">Martín Gómez<small>OSDE · reservó online</small></span><span class="pill ' + pill + '">' + txt + '</span></div>';
  };

  /* ---------- Escena 1: turnos ---------- */
  async function escenaTurnos() {
    var my = run;
    await sideSet(agendaHtml('', med ? 'Tu agenda de hoy' : 'Agenda del consultorio') +
      '<div class="sd-foot">' + I.info + '<span>Los turnos online entran solos, sin llamadas.</span></div></div>');
    var v = view(
      '<div class="ap-top"><div class="lg">TusRecetas<em>Med</em></div><h4>¿Qué especialista buscás?</h4><div class="sub">Turnos online, sin crear cuenta</div></div>' +
      '<div class="ap-body"><div class="ap-search">' + I.lupa + '<span><span class="ty"></span><i class="ap-caret"></i></span></div>' +
      '<div class="ap-chips"><span>Pediatría</span><span>Clínica</span><span class="os">OSDE</span></div><div class="res"></div></div>', { lt: true });
    prog(.05);
    await sleep(500);
    await type(q('.ty', v), 'Cardiología', 70);
    q('.os', v).classList.add('on');
    prog(.15);
    await sleep(350);
    q('.res', v).innerHTML = '<div class="ap-lbl fx-pop">2 profesionales · atienden OSDE</div>' +
      '<div style="display:grid;gap:8px;margin-top:8px">' +
      '<div class="ap-doc fx-pop d1" style="animation-delay:.1s"><span class="ap-av">LM</span><div><b>Dra. Laura Méndez</b><small>Cardiología · M.P. 12.345</small><small>Urquiza 450, Colón</small><span class="nx">Próximo turno: mañana 9:30</span></div></div>' +
      '<div class="ap-doc fx-pop" style="animation-delay:.25s"><span class="ap-av b">RS</span><div><b>Dr. Ricardo Sosa</b><small>Cardiología · M.P. 9.871</small><small>San Martín 120, Colón</small><span class="nx">Próximo turno: jueves 11:00</span></div></div></div>';
    await sleep(900);
    await tap(q('.d1', v), 1500);
    prog(.3);

    v = view(
      '<div class="ap-top"><div class="lg">TusRecetas<em>Med</em></div><h4>Dra. Laura Méndez</h4><div class="sub">Cardiología · Urquiza 450, Colón</div></div>' +
      '<div class="ap-body"><div class="ap-lbl">Elegí el día</div><div class="ap-days">' +
        '<span>Lun<b>16</b></span><span class="d17">Mar<b>17</b></span><span>Mié<b>18</b></span><span class="off">Jue<b>19</b></span><span>Vie<b>20</b></span></div>' +
        '<div class="ap-lbl sl fx-hide">Horarios libres · martes 17</div><div class="ap-slots fx-hide">' +
        '<span class="off">9:00</span><span class="s930">9:30</span><span>10:00</span><span class="off">10:30</span><span>11:00</span><span class="off">11:30</span></div>' +
        '<div class="ap-sheet"><h5>Tus datos</h5><div class="sum">Martes 17 · 9:30 hs · Dra. Méndez</div>' +
          '<div class="ap-f"><label>Nombre y apellido</label><span class="f1"></span></div>' +
          '<div class="ap-f"><label>Celular (WhatsApp)</label><span class="f2"></span></div>' +
          '<div class="ap-f"><label>Obra social</label><span class="f3"></span></div>' +
          '<div class="ap-btn cf">Confirmar turno</div></div></div>', { lt: true });
    await sleep(600);
    var d = q('.d17', v);
    await tap(d, 1300);
    d.classList.add('on');
    q('.sl', v).classList.remove('fx-hide');
    var sl = q('.ap-slots', v); sl.classList.remove('fx-hide');
    [].forEach.call(sl.children, function (s, i) { s.classList.add('fx-pop'); s.style.animationDelay = (i * 60) + 'ms'; });
    prog(.45);
    await sleep(700);
    var s = q('.s930', v);
    await tap(s, 1400);
    s.classList.add('on');
    await sleep(250);
    q('.ap-sheet', v).classList.add('up');
    prog(.6);
    await sleep(600);
    await type(q('.f1', v), 'Martín Gómez', 45);
    await type(q('.f2', v), '+54 9 3447 55-0123', 35);
    await type(q('.f3', v), 'OSDE 310', 50);
    prog(.75);
    var cf = q('.cf', v);
    await tap(cf, 1300);
    cf.innerHTML = '<span class="ap-spin"></span>Reservando…';
    await sleep(900);
    guard(my);

    view('<div class="ap-ok"><svg viewBox="0 0 90 90" fill="none"><circle class="c" cx="45" cy="45" r="38" stroke="#2F6F62" stroke-width="5"/><path class="k" d="M28 46l11 11 23-24" stroke="#2F6F62" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
      '<h4>¡Turno confirmado!</h4><div class="det"><b>Dra. Laura Méndez · Cardiología</b><span>Martes 17 · 9:30 hs</span><span>Urquiza 450, Colón · OSDE</span></div>' +
      '<div class="wa">' + I.waI + 'Te enviamos la confirmación por WhatsApp</div></div>');
    prog(.9);
    await sleep(500);
    var rows = side.querySelector('.sd-rows');
    if (rows) rows.children[0].insertAdjacentHTML('afterend', filaMartin('new', 'nw', 'Nuevo'));
    prog(1);
    await sleep(2400);
  }

  /* ---------- Escena 2: WhatsApp ---------- */
  function msg(body, cls, extra) {
    return '<div class="wa-m fx-pop ' + (cls || '') + '">' + (extra || '') + body + '<div class="h">' + (cls === 'yo' ? '9:02 ' + I.tk : '18:42') + '</div></div>';
  }
  async function escribe(body, html) {
    var t = document.createElement('div');
    t.className = 'wa-typ fx-pop'; t.innerHTML = '<i></i><i></i><i></i>';
    body.appendChild(t);
    await sleep(1100);
    t.remove();
    body.insertAdjacentHTML('beforeend', html);
  }
  async function escenaWa() {
    var my = run;
    await sideSet(agendaHtml(filaMartin('', 'pd', 'Pendiente'), med ? 'Tu agenda · mañana' : 'Agenda del consultorio') +
      '<div class="sd-foot">' + I.waI + '<span>Enviado desde el número del consultorio.</span></div></div>');
    var v = view(
      '<div class="wa-top"><span class="av">LM</span><div><b>Consultorio Dra. Méndez ' + I.ver + '</b><small>Cuenta de empresa</small></div></div>' +
      '<div class="wa-body"><div class="wa-day">Hoy</div></div><div class="wa-in"><span>Mensaje</span><i></i></div>', { lt: true });
    var body = q('.wa-body', v);
    prog(.05);
    await sleep(500);
    await escribe(body, msg('✅ Hola Martín, tu turno con la <b>Dra. Laura Méndez</b> quedó confirmado para el <b>martes 17 a las 9:30</b> en Urquiza 450.'));
    prog(.25);
    await sleep(1300);
    body.insertAdjacentHTML('beforeend', '<div class="wa-day fx-pop">Lunes 16 · día anterior</div>');
    await sleep(500);
    await escribe(body, msg('⏰ Te recordamos tu turno de <b>mañana a las 9:30</b> con la Dra. Méndez. ¿Asistís?' +
      '<div class="wa-bt"><span class="si">Confirmo ✅</span><span>Necesito cancelar</span></div>', '', '<div class="tpl">Recordatorio automático</div>'));
    prog(.5);
    await sleep(600);
    var si = q('.si', v);
    await tap(si, 1700);
    body.insertAdjacentHTML('beforeend', msg('Confirmo ✅', 'yo'));
    prog(.65);
    await sleep(700);
    var tk = body.querySelector('.wa-m.yo:last-of-type .tk') || body.querySelectorAll('.tk')[body.querySelectorAll('.tk').length - 1];
    if (tk) tk.classList.add('r');
    var p = side.querySelector('[data-m] .pill');
    if (p) { p.className = 'pill ok'; p.textContent = 'Confirmado'; p.parentNode.classList.add('new'); }
    prog(.8);
    await sleep(500);
    await escribe(body, msg('¡Gracias, Martín! Te esperamos mañana a las 9:30. Si te surge algo, avisanos por acá.'));
    guard(my);
    var f = side.querySelector('.sd-foot span');
    if (f) f.textContent = 'Si alguien cancela, el horario se libera y avisamos a la lista de espera.';
    prog(1);
    await sleep(2600);
  }

  /* ---------- Escena 3: receta ---------- */
  function qrSvg() {
    var n = 25, seed = 7, out = '', k = 0;
    function rnd() { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; }
    function finder(x, y) {
      return '<rect x="' + x + '" y="' + y + '" width="7" height="7" rx="1.2" fill="#16211E"/><rect x="' + (x + 1) + '" y="' + (y + 1) + '" width="5" height="5" rx=".8" fill="#fff"/><rect x="' + (x + 2) + '" y="' + (y + 2) + '" width="3" height="3" rx=".5" fill="#16211E"/>';
    }
    for (var y = 0; y < n; y++) for (var x = 0; x < n; x++) {
      var inF = (x < 8 && y < 8) || (x > n - 9 && y < 8) || (x < 8 && y > n - 9);
      if (inF || rnd() < .52) continue;
      out += '<rect class="m" x="' + x + '" y="' + y + '" width="1" height="1" fill="#16211E" style="animation-delay:' + ((k++ % 60) * 12 + (x + y) * 8) + 'ms"/>';
    }
    return '<svg class="rx-qr" viewBox="-1 -1 ' + (n + 2) + ' ' + (n + 2) + '" shape-rendering="crispEdges"><rect x="-1" y="-1" width="' + (n + 2) + '" height="' + (n + 2) + '" fill="#fff"/>' +
      finder(0, 0) + finder(n - 7, 0) + finder(0, n - 7) + out + '</svg>';
  }
  async function escenaRx() {
    var my = run;
    await sideSet('<div class="sd"><div class="sd-h"><span class="sd-live"></span>' + (med ? 'Tu consultorio' : 'Consultorio') + '<small>Martes 17 · 9:42</small></div>' +
      '<div class="sd-k">En consulta</div>' + filaMartin('', 'ok', 'Atendiendo').replace('reservó online', 'Cardiología') +
      '<div class="sd-foot">' + I.info + '<span>Medicamentos del listado oficial, actualizado cada semana.</span></div></div>');
    var v = view(
      '<div class="ap-top"><div class="lg">TusRecetas<em>Med</em> · Médicos</div><h4>Nueva receta</h4><div class="sub">Dra. Laura Méndez · M.P. 12.345</div></div>' +
      '<div class="ap-body">' +
        '<div class="rx-pt"><span class="ap-av">MG</span><div><b>Martín Gómez</b><small>DNI ••• 123 · OSDE 310</small></div><span class="ok">Cobertura ✓</span></div>' +
        '<div class="ap-lbl">Medicamento</div><div class="ap-search">' + I.lupa + '<span><span class="ty"></span><i class="ap-caret"></i></span></div>' +
        '<div class="slot"></div><div class="extra"></div></div>', { lt: true });
    prog(.05);
    await sleep(600);
    await type(q('.ty', v), 'amoxi', 110);
    var slot = q('.slot', v);
    slot.innerHTML = '<div class="rx-dd fx-pop"><div class="o1"><b><mark>Amoxi</mark>cilina 500 mg</b><small>Cápsulas · envase x 16</small></div>' +
      '<div><b><mark>Amoxi</mark>cilina 875 mg</b><small>Comprimidos · envase x 14</small></div><div><b><mark>Amoxi</mark>cilina + Ác. clavulánico</b><small>875/125 mg · x 14</small></div></div>';
    prog(.2);
    await sleep(700);
    await tap(q('.o1', v), 1500);
    q('.ty', v).textContent = 'Amoxicilina 500 mg';
    var car = q('.ap-caret', v); if (car) car.remove();
    slot.innerHTML = '<div class="rx-med fx-pop"><b>Amoxicilina 500 mg · cápsulas x 16</b><small class="pos"></small></div>';
    await sleep(400);
    await type(q('.pos', v), '1 cápsula cada 8 h durante 7 días', 30);
    prog(.4);
    q('.extra', v).innerHTML = '<div class="ap-f fx-pop"><label>Diagnóstico</label><span class="dx"></span></div>' +
      '<div class="ap-btn fx-pop fr" style="animation-delay:.1s">Firmar y emitir</div>';
    await type(q('.dx', v), 'Faringitis aguda', 45);
    var fr = q('.fr', v);
    await tap(fr, 1400);
    prog(.55);
    q('.extra', v).innerHTML = '<div class="rx-sig fx-pop"><svg viewBox="0 0 200 50" fill="none"><path d="M6 36c10-20 18-28 22-20s-8 22 2 18 14-26 20-22-4 20 4 18 10-14 18-12 0 12 8 10 14-18 22-14 2 12 10 10 16-10 26-12 18 4 30 2" stroke="#1F4E45" stroke-width="2.4" stroke-linecap="round"/></svg>Firma digital · Dra. Laura Méndez</div>';
    await sleep(1400);
    guard(my);

    v = view(
      '<div class="wa-top"><span class="av">LM</span><div><b>Consultorio Dra. Méndez ' + I.ver + '</b><small>Cuenta de empresa</small></div></div>' +
      '<div class="wa-body" style="justify-content:center"><div class="rx-card fx-pop"><div class="hd"><div><b>Receta electrónica</b><br><small>N.º 000482 · válida 30 días</small></div><small>Rp/</small></div>' +
      '<div class="bd">' + qrSvg() + '<b style="font-size:12.5px">Amoxicilina 500 mg x 16</b><small>Martín Gómez · OSDE 310<br>Dra. Laura Méndez · M.P. 12.345</small></div></div>' +
      '<div class="wa-m fx-pop" style="animation-delay:.5s">💊 Martín, acá está tu receta. Mostrá el QR en cualquier farmacia.<div class="h">9:43</div></div></div>' +
      '<div class="wa-in"><span>Mensaje</span><i></i></div>', { lt: true });
    prog(.7);
    await sideSet('<div class="sd"><div class="sd-h"><span class="sd-live"></span>Farmacia<small>Validación</small></div><div class="sd-scan">Escaneando QR…</div></div>');
    await sleep(1700);
    await sideSet('<div class="sd"><div class="sd-h"><span class="sd-live"></span>Farmacia<small>Validación</small></div>' +
      '<div class="sd-val fx-pop"><div class="big">' + I.okc + 'Receta válida</div>' +
      '<div class="sd-li"><span>Profesional</span><b>Dra. L. Méndez · M.P. 12.345</b></div>' +
      '<div class="sd-li"><span>Paciente</span><b>Martín Gómez</b></div>' +
      '<div class="sd-li"><span>Medicamento</span><b>Amoxicilina 500 mg x 16</b></div>' +
      '<div class="sd-li"><span>Estado</span><b style="color:#1F7A55">Lista para dispensar</b></div></div>' +
      '<div class="sd-foot">' + I.info + '<span>Firma verificada y sin uso previo: no se puede dispensar dos veces.</span></div></div>');
    prog(1);
    await sleep(3200);
  }

  var SCENES = [escenaTurnos, escenaWa, escenaRx];

  function setTab(i) {
    tabs.forEach(function (t, j) {
      t.classList.toggle('on', j === i);
      t.setAttribute('aria-selected', j === i ? 'true' : 'false');
      var b = t.querySelector('.fx-bar i'); if (b) b.style.width = '0';
    });
    var nav = root.querySelector('.fx-nav'), t = tabs[i];
    if (nav && t && nav.scrollWidth > nav.clientWidth) nav.scrollTo({ left: t.offsetLeft - (nav.clientWidth - t.offsetWidth) / 2, behavior: 'smooth' });
  }
  function whenVisible() {
    return new Promise(function (res) { (function chk() { visible ? res() : setTimeout(chk, 400); })(); });
  }
  async function loop() {
    var my = ++run;
    tapEl.classList.remove('show');
    try {
      for (;;) {
        await whenVisible();
        if (my !== run) return;
        setTab(cur);
        await SCENES[cur]();
        if (my !== run) return;
        cur = (cur + 1) % SCENES.length;
      }
    } catch (e) {
      if (!(e instanceof Stop)) { if (window.console) console.error(e); }
    }
  }

  tabs.forEach(function (t) {
    t.addEventListener('click', function () {
      cur = +t.getAttribute('data-i');
      loop();
    });
  });

  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (es) {
      visible = es[0].isIntersecting;
      if (visible && !iniciado) { iniciado = true; loop(); }
    }, { threshold: .25 }).observe(root);
  } else { visible = true; iniciado = true; loop(); }
  setTab(0);
})();
