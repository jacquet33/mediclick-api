// TuConsultorioOnline — firma digital con certificado (Ley 25.506) en el navegador.
// El .p12/.pfx y su contraseña nunca salen de este equipo: al servidor solo va el certificado público
// y la firma PKCS#7 (CMS) del PDF.
(function () {
  const e = (x) => String(x ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let forgeListo = null;
  function cargarForge() {
    if (window.forge) return Promise.resolve(window.forge);
    if (!forgeListo) forgeListo = new Promise((ok, mal) => {
      const s = document.createElement('script'); s.src = '/js/forge.min.js';
      s.onload = () => ok(window.forge); s.onerror = () => mal(new Error('No se pudo cargar el módulo de firma'));
      document.head.appendChild(s);
    });
    return forgeListo;
  }

  // ─── Guardado opcional del .p12 en este navegador (IndexedDB; sigue protegido por su contraseña) ───
  const DB = 'tco-firma-digital';
  function idb() {
    return new Promise((ok, mal) => {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore('p12');
      r.onsuccess = () => ok(r.result); r.onerror = () => mal(r.error);
    });
  }
  async function guardarP12(clave, b64) { try { const d = await idb(); await new Promise((ok, mal) => { const t = d.transaction('p12', 'readwrite'); t.objectStore('p12').put(b64, clave); t.oncomplete = ok; t.onerror = () => mal(t.error); }); } catch { /* sin almacenamiento */ } }
  async function leerP12(clave) { try { const d = await idb(); return await new Promise((ok) => { const q = d.transaction('p12').objectStore('p12').get(clave); q.onsuccess = () => ok(q.result || null); q.onerror = () => ok(null); }); } catch { return null; } }
  async function borrarP12(clave) { try { const d = await idb(); d.transaction('p12', 'readwrite').objectStore('p12').delete(clave); } catch { /* */ } }
  const claveLocal = () => 'p12:' + (localStorage.getItem('mediclick_userId') || 'medico');

  const leerArchivo = (f) => new Promise((ok, mal) => { const r = new FileReader(); r.onload = () => ok(r.result.split(',')[1]); r.onerror = () => mal(new Error('No se pudo leer el archivo')); r.readAsDataURL(f); });

  /** Abre el .p12 con la contraseña: clave privada RSA, certificado del titular y cadena */
  async function abrirP12(b64, password) {
    const forge = await cargarForge();
    let p12;
    try {
      const der = forge.util.decode64(b64);
      p12 = forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(der), false, password);
    } catch (err) {
      throw new Error(/password|MAC|Invalid/i.test(err.message) ? 'Contraseña incorrecta' : 'El archivo no es un certificado .p12/.pfx válido');
    }
    const keyBags = [...(p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag] || []), ...(p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag] || [])];
    const certs = (p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] || []).map((b) => b.cert).filter(Boolean);
    const key = keyBags.map((b) => b.key).find(Boolean);
    if (!key) throw new Error('El archivo no tiene la clave privada (o la clave no es RSA). Exportalo con la clave privada.');
    if (!certs.length) throw new Error('El archivo no tiene el certificado');
    const cert = certs.find((c) => c.publicKey && c.publicKey.n && c.publicKey.n.equals(key.n)) || certs[0];
    const chain = certs.filter((c) => c !== cert);
    return { forge, key, cert, chain };
  }

  // ─── Ventana para pedir archivo y contraseña ───
  function pedirCredenciales({ titulo, conArchivo, recordar }) {
    return new Promise((ok) => {
      const fondo = document.createElement('div');
      fondo.style.cssText = 'position:fixed;inset:0;background:rgba(43,36,31,.45);z-index:999;display:flex;align-items:center;justify-content:center;padding:16px';
      fondo.innerHTML = `<div class="card" style="max-width:420px;width:100%;margin:0">
        <div class="card-title">🔐 ${e(titulo)}</div>
        ${conArchivo ? `<div class="field"><label>Certificado (.p12 / .pfx)</label><input type="file" id="fdArch" accept=".p12,.pfx,application/x-pkcs12"></div>` : '<p class="muted" style="margin-bottom:10px">Se usa el certificado guardado en este navegador.</p>'}
        <div class="field"><label>Contraseña del certificado</label><input type="password" id="fdPass" autocomplete="off"></div>
        ${conArchivo && recordar ? `<label style="display:flex;gap:8px;align-items:center;font-size:13px;margin-bottom:12px"><input type="checkbox" id="fdRec" checked style="accent-color:var(--primary)"> Recordar el certificado en este navegador (la contraseña nunca se guarda)</label>` : ''}
        <p id="fdErr" class="error hidden"></p>
        <div class="flex" style="justify-content:flex-end"><button class="btn btn-sm btn-outline" id="fdNo">Cancelar</button><button class="btn btn-sm btn-primary" id="fdSi">Continuar</button></div>
      </div>`;
      document.body.appendChild(fondo);
      const pass = fondo.querySelector('#fdPass'); setTimeout(() => (conArchivo ? fondo.querySelector('#fdArch') : pass).focus(), 50);
      const cerrar = (v) => { fondo.remove(); ok(v); };
      fondo.querySelector('#fdNo').onclick = () => cerrar(null);
      const seguir = async () => {
        const f = conArchivo ? fondo.querySelector('#fdArch').files[0] : null;
        if (conArchivo && !f) { const x = fondo.querySelector('#fdErr'); x.textContent = 'Elegí el archivo del certificado'; x.classList.remove('hidden'); return; }
        cerrar({ archivo: f ? await leerArchivo(f) : null, password: pass.value, recordar: !!fondo.querySelector('#fdRec')?.checked });
      };
      fondo.querySelector('#fdSi').onclick = seguir;
      pass.onkeydown = (ev) => { if (ev.key === 'Enter') seguir(); };
    });
  }

  /** Registra el certificado del médico (solo la parte pública) */
  window.cargarCertificadoDigital = async function () {
    const c = await pedirCredenciales({ titulo: 'Cargar certificado de firma digital', conArchivo: true, recordar: true });
    if (!c) return;
    try {
      const { forge, cert, chain } = await abrirP12(c.archivo, c.password);
      await apiFetch('/api/v1/digital-signature/certificate', { method: 'POST', body: {
        certPem: forge.pki.certificateToPem(cert), chainPem: chain.map((x) => forge.pki.certificateToPem(x)).join('\n') || undefined,
      } });
      if (c.recordar) await guardarP12(claveLocal(), c.archivo); else await borrarP12(claveLocal());
      alert('✅ Certificado cargado. Ya podés firmar digitalmente tus recetas.');
      if (window.abrirMatricula) abrirMatricula();
    } catch (err) { alert(err.message); }
  };
  window.quitarCertificadoDigital = async function () {
    if (!confirm('¿Quitar el certificado de firma digital? Las recetas ya firmadas siguen siendo válidas.')) return;
    await apiFetch('/api/v1/digital-signature/certificate', { method: 'DELETE' }).catch(() => null);
    await borrarP12(claveLocal());
    if (window.abrirMatricula) abrirMatricula();
  };
  window.certificadoGuardadoLocal = async () => !!(await leerP12(claveLocal()));

  /** Firma digitalmente una receta ya emitida. Devuelve true si quedó firmada. */
  window.firmarRecetaDigital = async function (rxId) {
    let guardado = await leerP12(claveLocal());
    const c = await pedirCredenciales({ titulo: 'Firmar digitalmente la receta', conArchivo: !guardado, recordar: true });
    if (!c) return false;
    const b64 = c.archivo || guardado;
    try {
      const { forge, key, cert, chain } = await abrirP12(b64, c.password);
      if (c.archivo && c.recordar) await guardarP12(claveLocal(), c.archivo);
      const s = await apiFetch(`/api/v1/prescriptions/${rxId}/digital-signature/start`, { method: 'POST' });
      const p7 = forge.pkcs7.createSignedData();
      p7.content = forge.util.createBuffer(forge.util.decode64(s.contenido));
      p7.addCertificate(cert);
      chain.forEach((x) => p7.addCertificate(x));
      p7.addSigner({
        key, certificate: cert, digestAlgorithm: forge.pki.oids.sha256,
        authenticatedAttributes: [
          { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
          { type: forge.pki.oids.messageDigest },
          { type: forge.pki.oids.signingTime, value: new Date() },
        ],
      });
      p7.sign({ detached: true });
      const cms = forge.util.encode64(forge.asn1.toDer(p7.toAsn1()).getBytes());
      await apiFetch(`/api/v1/prescriptions/${rxId}/digital-signature/complete`, { method: 'POST', body: { sessionId: s.sessionId, cms } });
      return true;
    } catch (err) {
      alert(err.message || 'No se pudo firmar');
      return false;
    }
  };
})();
