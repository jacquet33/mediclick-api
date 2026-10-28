// TuConsultorioOnline — historia clínica, recetas, matrícula y firma (portal web)
// Misma estructura y formato de datos que las apps de iOS y Android.
(function () {
  const H = () => window.HC_DATA || { personales: [], familiares: [], examen: [], revision: [], cie10: [] };
  const $ = (id) => document.getElementById(id);
  const e = (x) => String(x ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const main = () => $('mainContent');

  // ─── Antecedentes: los chips escriben en el texto (igual que iOS) ───
  const norm = (s) => String(s || '').normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase();
  const AT = {
    rango(cond, texto) {
      const t = Array.from(texto).map((ch) => norm(ch)[0] || ch).join('');
      const c = norm(cond);
      let from = 0;
      for (;;) {
        const i = t.indexOf(c, from);
        if (i < 0) return null;
        const antes = i === 0 || !/\p{L}/u.test(t[i - 1]);
        const despues = i + c.length >= t.length || !/\p{L}/u.test(t[i + c.length]);
        if (antes && despues) return [i, i + c.length];
        from = i + 1;
      }
    },
    contiene(cond, texto) { return !!AT.rango(cond, texto || ''); },
    ordenar(t) {
      while (t.includes(', ,')) t = t.replace(', ,', ',');
      while (t.includes(',,')) t = t.replace(',,', ',');
      while (t.includes('  ')) t = t.replace('  ', ' ');
      t = t.replace(/ ,/g, ',').replace(/,\./g, '.');
      return t.trim().replace(/^[,;]+|[,;]+$/g, '').trim();
    },
    alternar(cond, texto) {
      texto = texto || '';
      const r = AT.rango(cond, texto);
      if (r) return AT.ordenar(texto.slice(0, r[0]) + texto.slice(r[1]));
      const base = texto.trim();
      if (!base) return cond;
      return base + (/[,.;]$/.test(base) ? ' ' : ', ') + cond;
    },
    limpio(t) { const x = AT.ordenar(t || ''); return x || null; },
  };

  // ─── Examen / revisión: "[Etiqueta]: nota; …" (formato de iOS) ───
  const CL = {
    combine(sel, notes, items, extra) {
      const parts = [];
      for (const it of items) {
        if (!sel[it.id]) continue;
        const n = (notes[it.id] || '').trim();
        parts.push(`[${it.label}]: ${n || 'evaluado'}`);
      }
      if ((extra || '').trim()) parts.push(extra.trim());
      return parts.join('; ') || null;
    },
    parse(text, items) {
      const sel = {}, notes = {};
      let rem = text || '';
      if (!rem.trim()) return { sel, notes, extra: '' };
      for (const it of items) {
        const pat = `[${it.label}]:`;
        const start = rem.toLowerCase().indexOf(pat.toLowerCase());
        if (start < 0) continue;
        sel[it.id] = true;
        const after = start + pat.length;
        const semi = rem.indexOf(';', after);
        const end = semi < 0 ? rem.length : semi;
        const note = rem.slice(after, end).trim();
        if (note && note !== 'evaluado') notes[it.id] = note;
        rem = rem.slice(0, start) + rem.slice(semi < 0 ? end : semi + 1);
      }
      return { sel, notes, extra: rem.trim().replace(/^[;,\s]+|[;,\s]+$/g, '') };
    },
  };

  const TIPOS = [['primera_consulta', 'Primera consulta'], ['seguimiento', 'Seguimiento'], ['control', 'Control'], ['urgencia', 'Urgencia']];
  const SECCIONES = ['Consulta', 'Antecedentes', 'Examen', 'Diagnóstico', 'Estudios', 'Plan', 'Notas'];
  let F = null; // estado del formulario

  function campo(k, label, opts = {}) {
    const v = F[k] ?? '';
    const ph = opts.ph ? ` placeholder="${e(opts.ph)}"` : '';
    if (opts.rows) return `<div class="field"><label>${label}</label><textarea data-k="${k}" rows="${opts.rows}"${ph} class="hc-in">${e(v)}</textarea></div>`;
    return `<div class="field"><label>${label}</label><input data-k="${k}" class="hc-in" value="${e(v)}"${ph}${opts.type ? ` type="${opts.type}" inputmode="decimal"` : ''}></div>`;
  }
  function chips(lista, k) {
    return `<div class="tags hc-chips">${lista.map((c) => `<button type="button" class="chip ${AT.contiene(c, F[k]) ? 'active' : ''}" data-chip="${e(c)}" data-k="${k}">${e(c)}</button>`).join('')}</div>`;
  }
  function checklist(items, selK, notesK, conSintomas) {
    return items.map((it) => {
      const on = !!F[selK][it.id];
      return `<div class="hc-check ${on ? 'on' : ''}">
        <label style="display:flex;gap:10px;align-items:flex-start;cursor:pointer;padding:8px 0">
          <input type="checkbox" data-sel="${selK}" data-id="${it.id}" ${on ? 'checked' : ''} style="width:18px;height:18px;margin-top:2px;accent-color:var(--primary)">
          <span><b style="font-size:14px">${e(it.label)}</b>${conSintomas && it.symptoms ? `<br><small class="muted">${e(it.symptoms)}</small>` : ''}</span>
        </label>
        ${on ? `<input class="hc-note" data-notes="${notesK}" data-id="${it.id}" value="${e(F[notesK][it.id] || '')}" placeholder="${conSintomas ? 'Detalle de síntomas…' : 'Hallazgos…'}" style="margin:0 0 8px 28px;width:calc(100% - 28px);padding:9px 12px;border:1.5px solid #ECE5D9;border-radius:10px;font:inherit;font-size:13px;background:#FFFDF9">` : ''}
      </div>`;
    }).join('');
  }

  function seccion() {
    const d = H();
    switch (F.section) {
      case 0: return `<div class="card"><div class="card-title">Datos de la consulta</div>
          <div class="field"><label>Tipo de consulta</label><div class="tags">${TIPOS.map(([id, l]) => `<button type="button" class="chip ${F.recordType === id ? 'active' : ''}" data-tipo="${id}">${l}</button>`).join('')}</div></div>
          ${campo('occupation', 'Ocupación', { ph: 'Ej: Empleado, docente, jubilado…' })}
          ${campo('chiefComplaint', 'Motivo de consulta *', { ph: 'Ej: Dolor abdominal, control anual…' })}
          ${campo('presentIllness', 'Enfermedad actual', { rows: 4 })}</div>`;
      case 1: return `<div class="card"><div class="card-title">Antecedentes</div>
          <p class="muted" style="margin-bottom:6px">Antecedentes personales · tocá para agregarlos al texto</p>${chips(d.personales, 'personalHistory')}
          ${campo('personalHistory', 'Detalle de antecedentes personales', { rows: 3, ph: 'Tocá un antecedente o escribilo acá…' })}
          <p class="muted" style="margin:10px 0 6px">Antecedentes familiares · tocá para agregarlos al texto</p>${chips(d.familiares, 'familyHistory')}
          ${campo('familyHistory', 'Detalle de antecedentes familiares', { rows: 3, ph: 'Tocá un antecedente o escribilo acá (ej: madre, diabetes)…' })}
          ${campo('currentMedications', 'Medicación habitual', { rows: 2 })}
          ${campo('allergies', 'Alergias', { rows: 2 })}
          ${campo('habits', 'Hábitos evaluados', { rows: 2, ph: 'Tabaco, alcohol, ejercicio, dieta…' })}</div>`;
      case 2: {
        const imc = parseFloat(String(F.weight).replace(',', '.')) / ((parseFloat(String(F.height).replace(',', '.')) / 100) ** 2);
        return `<div class="card"><div class="card-title">Revisión por sistemas</div>${checklist(d.revision, 'revSel', 'revNotes', true)}
            ${campo('otherSymptoms', 'Otros síntomas / negativos', { rows: 2, ph: 'Síntomas negativos relevantes…' })}</div>
          <div class="card"><div class="card-title">Examen físico por aparatos</div>${checklist(d.examen, 'exSel', 'exNotes', false)}
            ${campo('physicalExamExtra', 'Otros datos del examen', { rows: 2 })}</div>
          <div class="card"><div class="card-title">Signos vitales</div>
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:0 12px">
              ${campo('bloodPressure', 'TA (mmHg)', { ph: '120/80' })}${campo('heartRate', 'FC (lpm)', { ph: '72', type: 'text' })}
              ${campo('temperature', 'Temp (°C)', { ph: '36.5', type: 'text' })}${campo('respiratoryRate', 'FR (rpm)', { ph: '16', type: 'text' })}
              ${campo('spO2', 'SpO₂ (%)', { ph: '98', type: 'text' })}${campo('weight', 'Peso (kg)', { ph: '70.0', type: 'text' })}
              ${campo('height', 'Talla (cm)', { ph: '170', type: 'text' })}${campo('waist', 'Cintura (cm)', { ph: '85', type: 'text' })}
              ${campo('shoulders', 'Hombros (cm)', { ph: '45', type: 'text' })}
            </div>${isFinite(imc) && imc > 0 ? `<p class="muted">IMC: <b>${imc.toFixed(1)}</b></p>` : ''}</div>
          <div class="card">${campo('findings', 'Hallazgos relevantes', { rows: 3 })}</div>`;
      }
      case 3: {
        const sel = d.cie10.find(([c]) => c === F.diagnosisCode);
        return `<div class="card"><div class="card-title">Diagnóstico</div>
          ${campo('diagnosis', 'Diagnóstico principal *', { ph: 'Ej: Gastritis aguda' })}
          <div class="field"><label>Código CIE-10</label><input id="cieQ" placeholder="Buscar código o diagnóstico…" autocomplete="off"></div>
          <div id="cieRes"></div>
          ${F.diagnosisCode ? `<div class="appt-row" style="margin-top:6px"><div class="who"><strong>${e(sel ? sel[0] + ' - ' + sel[1] : F.diagnosisCode)}</strong></div><button type="button" class="btn btn-sm btn-no" data-quitarcie="1">Quitar</button></div>` : ''}
          ${campo('secondaryDx', 'Diagnósticos secundarios (uno por línea)', { rows: 3 })}</div>`;
      }
      case 4: return `<div class="card"><div class="card-title">Estudios solicitados</div>
          ${campo('labOrders', 'Estudios de laboratorio (separar con coma)', { ph: 'Ej: Hemograma, Glucemia, Urea' })}
          ${campo('imagingOrders', 'Estudios por imágenes (separar con coma)', { ph: 'Ej: Rx tórax, Eco abdominal' })}
          ${campo('referrals', 'Derivaciones (separar con coma)', { ph: 'Ej: Cardiología, Nutrición' })}</div>`;
      case 5: return `<div class="card"><div class="card-title">Indicaciones y seguimiento</div>
          ${campo('treatmentPlan', 'Plan de tratamiento', { rows: 3 })}
          ${campo('instructions', 'Indicaciones al paciente', { rows: 3 })}
          ${campo('followUp', 'Seguimiento', { rows: 2, ph: 'Próximo control, derivaciones pendientes…' })}
          ${campo('prevention', 'Prevención evaluada', { rows: 2, ph: 'Vacunas, screening, consejos…' })}</div>`;
      default: return `<div class="card"><div class="card-title">🔒 Notas privadas</div>
          <p class="muted" style="margin-bottom:8px">Solo las ves vos. No se incluyen en informes ni en lo que ve el paciente.</p>
          ${campo('privateNotes', 'Notas privadas', { rows: 6 })}</div>`;
    }
  }

  const hayVoz = () => !!(window.SpeechRecognition || window.webkitSpeechRecognition);
  let _rec = null;
  function enlazarDictado() {
    const ta = $('dicTxt'); if (!ta) return;
    ta.oninput = () => { F.dictado = ta.value; for (const id of ['dicOrdenar', 'dicOrdenarIA']) { const b = $(id); if (b) b.disabled = ta.value.trim().length < 10; } };
    if (F.iaModelo === undefined && window.iaEstado) { F.iaModelo = false; window.iaEstado().then((x) => { if (F && x && x.modelo) { F.iaModelo = true; pintar(); } }); }
    const mic = $('dicMic');
    if (mic) mic.onclick = () => {
      if (F.grabando) { try { _rec && _rec.stop(); } catch {} F.grabando = false; pintar(); return; }
      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      _rec = new SR(); _rec.lang = 'es-AR'; _rec.continuous = true; _rec.interimResults = true;
      const base = (F.dictado || '').trim();
      let final = '';
      _rec.onresult = (ev) => {
        let interim = '';
        for (let k = ev.resultIndex; k < ev.results.length; k++) { const t = ev.results[k][0].transcript; if (ev.results[k].isFinal) final += t + ' '; else interim += t; }
        F.dictado = (base ? base + ' ' : '') + final + interim;
        const t2 = $('dicTxt'); if (t2) { t2.value = F.dictado; t2.scrollTop = t2.scrollHeight; }
        const b = $('dicOrdenar'); if (b) b.disabled = F.dictado.trim().length < 10;
      };
      _rec.onerror = (ev) => { F.grabando = false; F.dicMsg = ev.error === 'not-allowed' ? 'Permití el micrófono en el navegador para dictar.' : 'Se cortó el dictado: ' + ev.error; pintar(); };
      _rec.onend = () => { if (F.grabando) { F.grabando = false; pintar(); } };
      try { _rec.start(); F.grabando = true; F.dicMsg = 'Escuchando… El navegador transcribe la voz (Chrome usa el servicio de Google).'; pintar(); } catch (err) { F.dicMsg = err.message; pintar(); }
    };
    const ordenar = (ord, ia) => async () => {
      if (F.grabando) { try { _rec && _rec.stop(); } catch {} F.grabando = false; }
      ord.disabled = true; ord.textContent = ia ? 'La IA está ordenando… (hasta 1 min)' : 'Ordenando…';
      try {
        const r = await apiFetch('/api/v1/ai/dictation' + (ia ? '?ia=1' : ''), { method: 'POST', body: { text: F.dictado, patientId: F.patientId } });
        const n = [];
        for (const [k, v] of Object.entries(r.campos || {})) {
          if (!v) continue;
          const actual = String(F[k] || '').trim();
          if (!actual) F[k] = v; else if (!actual.includes(v)) F[k] = actual + (['bloodPressure', 'heartRate', 'temperature', 'respiratoryRate', 'spO2', 'weight', 'height'].includes(k) ? '' : '. ' + v);
          n.push(k);
        }
        F.dicMsg = n.length ? `Se completaron ${n.length} campos (${n.map((k) => ETIQ[k] || k).join(', ')})${r.fuente !== 'reglas' ? ' con IA local' : ''}. ${r.aviso}` : 'No se reconocieron campos: revisá el texto.';
      } catch (err) { F.dicMsg = err.message; }
      pintar();
    };
    const ord = $('dicOrdenar'); if (ord) ord.onclick = ordenar(ord, false);
    const ordIa = $('dicOrdenarIA'); if (ordIa) ordIa.onclick = ordenar(ordIa, true);
  }
  const ETIQ = { chiefComplaint: 'motivo', presentIllness: 'enfermedad actual', personalHistory: 'antecedentes', familyHistory: 'ant. familiares', currentMedications: 'medicación', allergies: 'alergias', habits: 'hábitos', physicalExamExtra: 'examen físico', findings: 'hallazgos', diagnosis: 'diagnóstico', treatmentPlan: 'plan', instructions: 'indicaciones', followUp: 'seguimiento', labOrders: 'laboratorio', imagingOrders: 'imágenes', referrals: 'derivaciones', bloodPressure: 'TA', heartRate: 'FC', temperature: 'temperatura', respiratoryRate: 'FR', spO2: 'SpO₂', weight: 'peso', height: 'talla' };

  function pintar() {
    const puede = (F.chiefComplaint || '').trim() && (F.diagnosis || '').trim();
    main().innerHTML = `
      <div class="topbar"><button class="btn btn-sm btn-outline" onclick="hcCancelar()">Cancelar</button>
        <h1 style="font-size:18px;text-align:center">Historia clínica<br><small class="muted" style="font-weight:500">${e(F.patientName || '')}</small></h1>
        <button class="btn btn-sm btn-primary" id="hcGuardar" onclick="hcGuardar()" ${puede && !F.saving ? '' : 'disabled style="opacity:.5"'}>${F.saving ? 'Guardando…' : 'Guardar'}</button></div>
      <div class="chips" style="overflow-x:auto;flex-wrap:nowrap;padding-bottom:4px">${SECCIONES.map((s, i) => `<button type="button" class="chip ${F.section === i ? 'active' : ''}" data-sec="${i}">${s}</button>`).join('')}</div>
      ${F.error ? `<div class="card" style="color:var(--danger)">${e(F.error)}</div>` : ''}
      <div class="card dictado">
        <div class="flex-between" style="flex-wrap:wrap;gap:8px"><b>🎙️ Dictado de la consulta</b>
          <span class="flex" style="gap:6px;flex-wrap:wrap">${hayVoz() ? `<button type="button" class="btn btn-sm ${F.grabando ? 'btn-no' : 'btn-soft'}" id="dicMic">${F.grabando ? '⏹ Detener' : '🎙️ Dictar'}</button>` : ''}<button type="button" class="btn btn-sm btn-primary" id="dicOrdenar" ${(F.dictado || '').trim().length > 9 ? '' : 'disabled'}>✨ Ordenar en la historia</button>${F.iaModelo ? `<button type="button" class="btn btn-sm btn-soft" id="dicOrdenarIA" ${(F.dictado || '').trim().length > 9 ? '' : 'disabled'} title="Usa el modelo de IA local: entiende mejor el texto libre, pero tarda más">🤖 Ordenar con IA</button>` : ''}</span></div>
        <textarea id="dicTxt" rows="${F.dictado ? 4 : 2}" placeholder="${hayVoz() ? 'Tocá Dictar y hablá: «Motivo de consulta… Enfermedad actual… Examen físico… Diagnóstico… Plan… Indicaciones…». También podés pegar o escribir el texto.' : 'Pegá o escribí la nota libre: «Motivo de consulta… Examen físico… Diagnóstico… Plan…»'}">${e(F.dictado || '')}</textarea>
        ${F.dicMsg ? `<p class="muted" style="font-size:12px;margin-top:6px">${e(F.dicMsg)}</p>` : ''}
      </div>
      <div id="hcBody">${seccion()}</div>
      <div class="flex-between" style="margin:8px 0 30px">
        <button class="btn btn-sm btn-outline" ${F.section === 0 ? 'disabled style="opacity:.4"' : ''} data-sec="${F.section - 1}">← ${SECCIONES[F.section - 1] || ''}</button>
        ${F.section < SECCIONES.length - 1 ? `<button class="btn btn-sm btn-primary" data-sec="${F.section + 1}">${SECCIONES[F.section + 1]} →</button>` : ''}
      </div>`;
    enlazar();
    enlazarDictado();
  }

  function actualizarBoton() {
    const b = $('hcGuardar'); if (!b) return;
    const puede = (F.chiefComplaint || '').trim() && (F.diagnosis || '').trim();
    b.disabled = !puede || F.saving; b.style.opacity = b.disabled ? '.5' : '1';
  }

  function enlazar() {
    const m = main();
    m.querySelectorAll('[data-sec]').forEach((b) => b.onclick = () => { const n = +b.dataset.sec; if (n >= 0 && n < SECCIONES.length) { F.section = n; pintar(); window.scrollTo(0, 0); } });
    m.querySelectorAll('.hc-in').forEach((i) => i.oninput = () => {
      F[i.dataset.k] = i.value; actualizarBoton();
      if (i.dataset.k === 'personalHistory' || i.dataset.k === 'familyHistory') {
        m.querySelectorAll(`[data-chip][data-k="${i.dataset.k}"]`).forEach((c) => c.classList.toggle('active', AT.contiene(c.dataset.chip, F[i.dataset.k])));
      }
    });
    m.querySelectorAll('[data-chip]').forEach((c) => c.onclick = () => {
      const k = c.dataset.k; F[k] = AT.alternar(c.dataset.chip, F[k]);
      const ta = m.querySelector(`.hc-in[data-k="${k}"]`); if (ta) ta.value = F[k];
      m.querySelectorAll(`[data-chip][data-k="${k}"]`).forEach((x) => x.classList.toggle('active', AT.contiene(x.dataset.chip, F[k])));
    });
    m.querySelectorAll('[data-tipo]').forEach((c) => c.onclick = () => { F.recordType = c.dataset.tipo; pintar(); });
    m.querySelectorAll('[data-sel]').forEach((c) => c.onchange = () => {
      const s = F[c.dataset.sel], id = c.dataset.id;
      if (c.checked) s[id] = true; else { delete s[id]; delete F[c.dataset.sel === 'revSel' ? 'revNotes' : 'exNotes'][id]; }
      const y = window.scrollY; pintar(); window.scrollTo(0, y);
    });
    m.querySelectorAll('.hc-note').forEach((i) => i.oninput = () => { F[i.dataset.notes][i.dataset.id] = i.value; });
    const q = $('cieQ');
    if (q) q.oninput = () => {
      const t = norm(q.value.trim());
      const r = !t ? [] : H().cie10.filter(([c, d]) => norm(c).startsWith(t)).concat(H().cie10.filter(([c, d]) => !norm(c).startsWith(t) && (norm(c).includes(t) || norm(d).includes(t)))).slice(0, 8);
      $('cieRes').innerHTML = r.map(([c, d]) => `<div class="appt-row" style="cursor:pointer;padding:8px 12px" data-cie="${e(c)}" data-desc="${e(d)}"><div class="who"><strong>${e(c)}</strong><small>${e(d)}</small></div></div>`).join('');
      $('cieRes').querySelectorAll('[data-cie]').forEach((x) => x.onclick = () => {
        F.diagnosisCode = x.dataset.cie;
        if (!(F.diagnosis || '').trim()) F.diagnosis = x.dataset.desc;
        pintar();
      });
    };
    const qc = m.querySelector('[data-quitarcie]'); if (qc) qc.onclick = () => { F.diagnosisCode = ''; pintar(); };
  }

  const num = (s) => { const n = parseFloat(String(s || '').replace(',', '.')); return isFinite(n) ? n : null; };
  const ent = (s) => { const n = num(s); return n == null ? null : Math.round(n); };
  const lista = (s) => { const l = String(s || '').split(',').map((x) => x.trim()).filter(Boolean); return l.length ? l : null; };
  const nn = (s) => { const x = String(s ?? '').trim(); return x || null; };
  const arr = (v) => Array.isArray(v) ? v : (v ? String(v).split(',').map((x) => x.trim()).filter(Boolean) : []);
  const fnum = (v) => (v == null || v === '' ? '' : String(v));

  function payload() {
    const d = H();
    const vit = {
      bloodPressure: nn(F.bloodPressure), heartRate: ent(F.heartRate), temperature: num(F.temperature),
      respiratoryRate: ent(F.respiratoryRate), spO2: ent(F.spO2), weight: num(F.weight), height: num(F.height),
      waistCircumference: num(F.waist), shoulderWidth: num(F.shoulders),
    };
    const hayVit = Object.values(vit).some((x) => x != null);
    const sec = String(F.secondaryDx || '').split('\n').map((x) => x.trim()).filter(Boolean).map((diagnosis) => ({ diagnosis }));
    const p = {
      patientId: F.patientId, recordType: F.recordType, chiefComplaint: F.chiefComplaint.trim(),
      presentIllness: nn(F.presentIllness), personalHistory: AT.limpio(F.personalHistory), familyHistory: AT.limpio(F.familyHistory),
      currentMedications: nn(F.currentMedications), allergies: nn(F.allergies), habits: nn(F.habits),
      systemsReview: CL.combine(F.revSel, F.revNotes, d.revision, F.otherSymptoms), otherSymptoms: nn(F.otherSymptoms),
      vitalSigns: hayVit ? vit : undefined,
      physicalExam: CL.combine(F.exSel, F.exNotes, d.examen, F.physicalExamExtra), findings: nn(F.findings),
      diagnosis: F.diagnosis.trim(), diagnosisCode: nn(F.diagnosisCode), secondaryDiagnoses: sec.length ? sec : undefined,
      treatmentPlan: nn(F.treatmentPlan), instructions: nn(F.instructions),
      labOrders: lista(F.labOrders), imagingOrders: lista(F.imagingOrders), referrals: lista(F.referrals),
      followUp: nn(F.followUp), prevention: nn(F.prevention), occupation: nn(F.occupation), privateNotes: nn(F.privateNotes),
    };
    if (F.appointmentId && !F.recordId) p.appointmentId = F.appointmentId;
    // Nueva: sin campos vacíos. Edición: null para poder borrar un campo
    Object.keys(p).forEach((k) => (p[k] === undefined || (!F.recordId && p[k] === null)) && delete p[k]);
    if (F.recordId) delete p.patientId;
    return p;
  }

  window.abrirFormularioHC = async function (patientId, opts = {}) {
    F = {
      patientId, recordId: opts.recordId || null, appointmentId: opts.appointmentId || null, patientName: opts.nombre || '', volver: opts.volver,
      section: 0, recordType: 'primera_consulta', revSel: {}, revNotes: {}, exSel: {}, exNotes: {},
    };
    main().innerHTML = '<div class="spinner"></div>';
    try {
      if (!F.patientName) {
        const p = await apiFetch(`/api/v1/patients/${patientId}`).catch(() => null);
        if (p) F.patientName = `${p.first_name || ''} ${p.last_name || ''}`.trim();
      }
      if (F.recordId) {
        const r = await apiFetch(`/api/v1/medical-records/${F.recordId}`);
        const d = H(), v = r.vital_signs || {};
        Object.assign(F, {
          recordType: r.record_type || 'consulta', occupation: r.occupation || '', chiefComplaint: r.chief_complaint || '', presentIllness: r.present_illness || '',
          personalHistory: r.personal_history || '', familyHistory: r.family_history || '', currentMedications: r.current_medications || '',
          allergies: r.allergies || '', habits: r.habits || '', findings: r.findings || '', diagnosis: r.diagnosis || '', diagnosisCode: r.diagnosis_code || '',
          secondaryDx: (Array.isArray(r.secondary_diagnoses) ? r.secondary_diagnoses : []).map((x) => x.diagnosis || x).join('\n'),
          labOrders: arr(r.lab_orders).join(', '), imagingOrders: arr(r.imaging_orders).join(', '), referrals: arr(r.referrals).join(', '),
          treatmentPlan: r.treatment_plan || '', instructions: r.instructions || '', followUp: r.follow_up || '', prevention: r.prevention || '', privateNotes: r.private_notes || '',
          bloodPressure: v.bloodPressure || v.blood_pressure || '', heartRate: fnum(v.heartRate ?? v.heart_rate), temperature: fnum(v.temperature),
          respiratoryRate: fnum(v.respiratoryRate ?? v.respiratory_rate), spO2: fnum(v.spO2 ?? v.sp_o2 ?? v.spo2), weight: fnum(v.weight), height: fnum(v.height),
          waist: fnum(v.waistCircumference ?? v.waist_circumference), shoulders: fnum(v.shoulderWidth ?? v.shoulder_width),
        });
        const rv = CL.parse(r.systems_review, d.revision); F.revSel = rv.sel; F.revNotes = rv.notes; F.otherSymptoms = r.other_symptoms || rv.extra;
        const ex = CL.parse(r.physical_exam, d.examen); F.exSel = ex.sel; F.exNotes = ex.notes; F.physicalExamExtra = ex.extra;
      } else {
        // Nueva consulta: trae antecedentes, medicación y alergias de la última
        const prev = await apiFetch(`/api/v1/medical-records?patient_id=${patientId}`).catch(() => []);
        const u = (Array.isArray(prev) ? prev : prev.data || [])[0];
        if (u) Object.assign(F, {
          recordType: 'seguimiento', occupation: u.occupation || '', personalHistory: u.personal_history || '', familyHistory: u.family_history || '',
          currentMedications: u.current_medications || '', allergies: u.allergies || '', habits: u.habits || '',
        });
        // Resumen clínico de la ficha (alergias, medicación y antecedentes cargados a nivel paciente)
        const pp = await apiFetch(`/api/v1/patients/${patientId}`).catch(() => null);
        if (pp) {
          const j = (x) => (Array.isArray(x) ? x.join(', ') : x || '');
          if (!F.allergies) F.allergies = j(pp.allergies);
          if (!F.currentMedications) F.currentMedications = j(pp.current_medications);
          if (!F.personalHistory) F.personalHistory = [pp.personal_history, pp.surgical_history ? 'Quirúrgicos: ' + pp.surgical_history : ''].filter(Boolean).join('. ');
          if (!F.familyHistory) F.familyHistory = pp.family_history || '';
          if (!F.habits) F.habits = pp.habits || '';
        }
      }
    } catch (err) { F.error = err.message; }
    pintar();
  };

  window.hcCancelar = function () {
    const v = F?.volver, id = F?.patientId; F = null;
    if (typeof v === 'function') return v();
    if (id && window.abrirPaciente) return abrirPaciente(id);
    navigateTo('historial');
  };

  window.hcGuardar = async function () {
    if (!F || F.saving) return;
    F.saving = true; F.error = null; actualizarBoton();
    try {
      const body = payload();
      if (F.recordId) {
        const motivo = prompt('Motivo de la modificación (queda registrado junto a la versión anterior):', '');
        if (motivo === null) { F.saving = false; actualizarBoton(); return; }
        body.changeReason = motivo || 'Corrección';
      }
      const r = F.recordId
        ? await apiFetch(`/api/v1/medical-records/${F.recordId}`, { method: 'PUT', body })
        : await apiFetch('/api/v1/medical-records', { method: 'POST', body });
      const id = F.patientId, recId = r?.id || F.recordId, dx = F.diagnosis, code = F.diagnosisCode;
      F = null;
      // Ofrece hacer la receta con el diagnóstico de la consulta
      if (confirm('Consulta guardada. ¿Querés hacer una receta para este paciente?')) return abrirNuevaReceta({ patientId: id, medicalRecordId: recId, diagnosis: dx, diagnosisCode: code });
      if (window.abrirPaciente) abrirPaciente(id); else navigateTo('historial');
    } catch (err) {
      F.saving = false; F.error = err.message || 'No se pudo guardar. Intentá de nuevo.'; pintar();
    }
  };

  // ═══════════════════════════════════════════════════════
  // RECETAS
  // ═══════════════════════════════════════════════════════
  let R = null;
  let _verif = null;
  async function verificacion(force) {
    if (_verif && !force) return _verif;
    _verif = await apiFetch('/api/v1/verification').catch(() => null);
    return _verif;
  }
  window.estadoVerificacion = verificacion;

  function bannerVerificacion(v) {
    if (!v || v.puedeRecetar) return '';
    const txt = v.license_status === 'pending'
      ? 'Tu matrícula está en revisión. Vas a poder emitir recetas cuando quede verificada.'
      : v.license_status === 'rejected'
        ? `No pudimos verificar tu matrícula${v.license_verification_note ? ': ' + e(v.license_verification_note) : ''}. Revisá los datos y volvé a enviarlos.`
        : 'Para emitir recetas electrónicas válidas primero tenemos que verificar que sos médico/a (matrícula vigente).';
    return `<div class="card" style="border:1.5px solid #E9C27A;background:#FFF6E5;display:flex;gap:12px;align-items:center;flex-wrap:wrap">
      <span style="font-size:22px">📇</span><div style="flex:1;min-width:220px;font-size:13px;color:#7A5300">${txt}</div>
      <button class="btn btn-sm btn-primary" onclick="abrirMatricula()">${v.license_status === 'pending' ? 'Ver estado' : 'Verificar matrícula'}</button></div>`;
  }

  async function abrirPdf(id) {
    const w = window.open('', '_blank');
    try {
      const r = await fetch(`${API}/api/v1/prescriptions/${id}/pdf`, { headers: { Authorization: 'Bearer ' + token, 'x-organization-id': orgIdActual() } });
      if (!r.ok) throw new Error('No se pudo generar el PDF');
      const url = URL.createObjectURL(await r.blob());
      if (w) w.location = url; else window.location = url;
    } catch (err) { if (w) w.close(); alert(err.message); }
  }
  window.recetaPdf = abrirPdf;
  window.recetaEmail = async function (id, emailDef) {
    const to = prompt('Enviar la receta en PDF al email:', emailDef || '');
    if (!to) return;
    try { const r = await apiFetch(`/api/v1/prescriptions/${id}/email`, { method: 'POST', body: { email: to } }); alert(r.sent ? `✅ Receta enviada a ${r.to}` : 'No se pudo enviar el email (revisá la configuración de correo).'); }
    catch (err) { alert(err.message); }
  };
  window.recetaWhatsApp = function (code, tel, nombre) {
    const link = `${location.origin}/api/v1/prescriptions/verify/${encodeURIComponent(code)}/pdf`;
    const msg = `Hola ${nombre || ''}! Te envío tu receta electrónica 💊\n\nDescargala acá: ${link}\nCódigo de verificación: ${code}\n\nPodés mostrarla en la farmacia desde el celular.`;
    const t = String(tel || '').replace(/\D/g, '');
    window.open(`https://wa.me/${t ? (t.startsWith('54') ? t : '549' + t) : ''}?text=${encodeURIComponent(msg)}`, '_blank');
  };
  window.recetaAnular = async function (id) {
    if (!confirm('¿Anular la receta? La farmacia la va a ver como anulada.')) return;
    try { await apiFetch(`/api/v1/prescriptions/${id}/cancel`, { method: 'PATCH' }); navigateTo(currentSection); } catch (err) { alert(err.message); }
  };

  const ESTADO_RX = { active: ['Vigente', 'confirmed'], cancelled: ['Anulada', 'cancelled'], dispensed: ['Dispensada', 'completed'], partially_dispensed: ['Dispensa parcial', 'pending'], expired: ['Vencida', 'no_show'] };
  function filaReceta(r) {
    const vencida = r.expires_at && new Date(r.expires_at) < new Date() && r.status === 'active';
    const [lbl, cls] = vencida ? ['Vencida', 'no_show'] : (ESTADO_RX[r.status] || [r.status, '']);
    return `<div class="appt-row">
      <div class="when"><b>${fmtDate(r.issued_at)}</b><span>${e(r.verification_code || '')}</span></div>
      <div class="who link" onclick="abrirPaciente('${r.patient_id}')"><strong>${e(r.patient_name || '')}</strong><small>${e(r.diagnosis || '')}${r.diagnosis_code ? ' · ' + e(r.diagnosis_code) : ''}</small>
        ${r.digital_signed_at ? '<small style="color:#0f6e56">🔐 Firma digital con certificado</small>' : r.content_hash ? '<small style="color:#0f6e56">🔏 Firmada electrónicamente</small>' : ''}</div>
      <div class="side"><span class="badge-sm ${cls}">${lbl}</span>
        <div class="acts">
          <button class="btn btn-sm btn-soft" onclick="recetaPdf('${r.id}')">🖨️ Imprimir / PDF</button>
          <button class="btn btn-sm" style="background:#25D366;color:#fff" onclick="recetaWhatsApp('${e(r.verification_code)}','${e(r.patient_phone || '')}','${e((r.patient_name || '').split(' ')[0])}')">WhatsApp</button>
          <button class="btn btn-sm btn-soft" onclick="recetaEmail('${r.id}','${e(r.patient_email || '')}')">✉️ Email</button>
          ${!r.digital_signed_at && r.status === 'active' && _cert ? `<button class="btn btn-sm btn-ok" onclick="firmarYRecargar('${r.id}')">🔐 Firmar digitalmente</button>` : ''}
          ${r.status === 'active' ? `<button class="btn btn-sm btn-no" onclick="recetaAnular('${r.id}')">Anular</button>` : ''}
        </div></div></div>`;
  }
  let _cert = null;
  async function certificadoActual() { _cert = await apiFetch('/api/v1/digital-signature/certificate').catch(() => null); return _cert; }
  window.firmarYRecargar = async function (id) { if (await firmarRecetaDigital(id)) { alert('✅ Receta firmada digitalmente'); navigateTo(currentSection); } };

  window.loadRecetas = async function () {
    const m = main(); m.innerHTML = '<div class="spinner"></div>';
    try {
      const [v, rxs] = await Promise.all([verificacion(true), apiFetch('/api/v1/prescriptions'), certificadoActual()]);
      const l = asList(rxs);
      m.innerHTML = `<div class="topbar"><h1>Recetas</h1><button class="btn btn-sm btn-primary" onclick="abrirNuevaReceta({})" ${v && !v.puedeRecetar ? 'disabled style="opacity:.5"' : ''}>+ Nueva receta</button></div>
        ${bannerVerificacion(v)}
        <div class="filters"><input type="search" id="rxQ" placeholder="Buscar por paciente, diagnóstico o código" style="flex:1"></div>
        <div class="card" id="rxLista">${l.length ? l.map(filaReceta).join('') : '<p class="muted center" style="padding:30px">Todavía no emitiste recetas.</p>'}</div>`;
      $('rxQ').oninput = (ev) => {
        const q = norm(ev.target.value);
        $('rxLista').innerHTML = l.filter((r) => !q || norm([r.patient_name, r.diagnosis, r.verification_code, r.diagnosis_code].join(' ')).includes(q)).map(filaReceta).join('') || '<p class="muted center">Sin resultados</p>';
      };
    } catch (err) { m.innerHTML = `<div class="card"><p class="error">${e(err.message)}</p></div>`; }
  };

  const FORMAS = ['Comprimidos', 'Comprimidos recubiertos', 'Cápsulas', 'Jarabe', 'Suspensión oral', 'Gotas', 'Solución inyectable', 'Crema', 'Gel', 'Pomada', 'Óvulos', 'Supositorios', 'Aerosol para inhalar', 'Colirio', 'Parches', 'Sobres'];
  const itemVacio = () => ({ genericName: '', medicationName: '', pharmaceuticalForm: '', presentation: '', dosage: '', frequency: '', duration: '', quantity: '', instructions: '' });

  window.abrirNuevaReceta = async function (opts) {
    const v = await verificacion(true);
    R = { patientId: opts.patientId || '', patient: null, medicalRecordId: opts.medicalRecordId || null, diagnosis: opts.diagnosis || '', diagnosisCode: opts.diagnosisCode || '', expiresInDays: 30, notes: '', items: [itemVacio()], templates: [], frecuentes: [], recientes: [], inicio: Date.now(), confirmaAlertas: false };
    const [pac, tpls, frec] = await Promise.all([
      R.patientId ? apiFetch(`/api/v1/patients/${R.patientId}`).catch(() => null) : null,
      apiFetch('/api/v1/prescription-templates').catch(() => []),
      apiFetch('/api/v1/prescriptions/frequent').catch(() => []),
    ]);
    R.patient = pac; R.templates = asList(tpls); R.frecuentes = asList(frec);
    await cargarRecientes();
    await certificadoActual();
    pintarReceta(v);
  };

  async function cargarRecientes() {
    R.recientes = R.patientId ? asList(await apiFetch(`/api/v1/prescriptions/patient/${R.patientId}/recent`).catch(() => [])) : [];
  }
  const VD = () => window.VADEMECUM || { buscar: () => [], revisar: () => [], FRECUENCIAS: [], DURACIONES: [], lista: [] };
  const listaP = (x) => (Array.isArray(x) ? x : String(x || '').split(/[,;\n]/)).map((y) => String(y).trim()).filter(Boolean);
  function alertasReceta() {
    const p = R.patient || {};
    return VD().revisar(R.items.map((x) => x.genericName), listaP(p.current_medications), listaP(p.allergies));
  }
  const itemDe = (x) => ({ ...itemVacio(), genericName: x.generic_name || x.generico || x.medication_name || '', medicationName: (x.generic_name || x.generico) && x.medication_name !== (x.generic_name || x.generico) ? (x.medication_name || '') : '', pharmaceuticalForm: x.pharmaceutical_form || '', presentation: x.presentation || '', dosage: x.dosage || '', frequency: x.frequency || '', duration: x.duration || '', quantity: x.quantity ? String(x.quantity) : '', instructions: x.instructions || '' });
  function agregarItems(nuevos) {
    R.items = R.items.filter((x) => (x.genericName || '').trim()).concat(nuevos);
    if (!R.items.length) R.items = [itemVacio()];
    R.confirmaAlertas = false;
  }
  function pintarAlertas() {
    const box = $('rxAlertas'); if (!box) return;
    const al = alertasReceta();
    box.innerHTML = !al.length ? '' : `<div class="rx-alertas">
      <div class="rx-al-t">⚠️ Revisá antes de emitir</div>
      ${al.map((a) => `<div class="rx-al ${a.nivel}"><b>${a.tipo === 'alergia' ? 'Alergia' : a.tipo === 'duplicado' ? 'Duplicación' : 'Interacción'}${a.nivel === 'alta' ? ' importante' : ''}:</b> ${e(a.texto)}</div>`).join('')}
      ${al.some((a) => a.nivel === 'alta') ? `<label class="rx-al-ok"><input type="checkbox" id="rxConfAl" ${R.confirmaAlertas ? 'checked' : ''}> Revisé las alertas y confirmo la indicación bajo mi criterio profesional</label>` : ''}
      <p class="muted" style="font-size:11px;margin-top:6px">Alertas de apoyo basadas en la ficha del paciente y una lista de interacciones conocidas. No reemplazan tu evaluación.</p></div>`;
    const c = $('rxConfAl'); if (c) c.onchange = () => { R.confirmaAlertas = c.checked; };
  }

  function pintarReceta(v) {
    const p = R.patient;
    const sinDni = p && !String(p.dni || '').replace(/\D/g, '');
    main().innerHTML = `
      <div class="topbar"><button class="btn btn-sm btn-outline" onclick="${R.patientId ? `abrirPaciente('${R.patientId}')` : "navigateTo('recetas')"}">Cancelar</button><h1>Nueva receta</h1><span></span></div>
      ${bannerVerificacion(v)}
      <div class="card"><div class="card-title">👤 Paciente</div>
        ${p ? `<div class="appt-row"><div class="who"><strong>${e(p.first_name)} ${e(p.last_name)}</strong><small>${e([p.dni ? 'DNI ' + p.dni : 'Sin DNI', p.insurance_provider || 'Particular', p.insurance_number ? 'Afiliado ' + p.insurance_number : ''].filter(Boolean).join(' · '))}</small></div><button class="btn btn-sm btn-soft" id="rxCambiarPac">Cambiar</button></div>
          ${(listaP(p.allergies).length || listaP(p.current_medications).length) ? `<div class="rx-pac-info">${listaP(p.allergies).length ? `<div><span class="chip-al">Alergias</span> ${listaP(p.allergies).map(e).join(', ')}</div>` : ''}${listaP(p.current_medications).length ? `<div><span class="chip-med">Medicación actual</span> ${listaP(p.current_medications).map(e).join(', ')}</div>` : ''}</div>` : ''}
          ${!sinDni ? `<div class="field" style="max-width:320px;margin-top:8px"><label>CUIL del paciente *</label><input id="rxCuil" value="${e(R.cuil || p.cuil || cuilDesdeDni(p.dni, p.gender) || '')}" inputmode="numeric" placeholder="Ej: 20301112223"></div>` : ''}
          ${sinDni ? `<p class="error">La receta electrónica necesita el DNI del paciente. <a href="#" onclick="abrirPaciente('${p.id}');setTimeout(()=>editarPaciente('${p.id}'),900);return false" style="color:var(--primary)">Cargarlo</a></p>` : ''}`
        : `<div class="field"><label>Buscar paciente</label><input id="rxPacQ" placeholder="Nombre, DNI o teléfono" autocomplete="off"></div><div id="rxPacRes"></div>`}
      </div>
      <div class="card"><div class="card-title">🩺 Diagnóstico</div>
        <div style="display:grid;grid-template-columns:minmax(0,2fr) minmax(0,1fr);gap:0 12px">
          <div class="field"><label>Diagnóstico *</label><input id="rxDx" value="${e(R.diagnosis)}"></div>
          <div class="field"><label>CIE-10</label><input id="rxCie" value="${e(R.diagnosisCode)}" placeholder="Buscar…" autocomplete="off"></div>
        </div><div id="rxCieRes"></div>
      </div>
      ${(R.frecuentes.length || R.recientes.length) ? `<div class="card rx-atajos"><div class="card-title">⚡ Atajos</div>
        ${R.recientes.length ? `<div class="rx-at-l">Repetir una receta anterior</div><div class="rx-rep">${R.recientes.slice(0, 4).map((r, i) => `<button class="rx-rep-b" data-rep="${i}"><b>${new Date(r.issued_at).toLocaleDateString('es-AR', { day: 'numeric', month: 'short', year: '2-digit' })}</b> ${e(r.diagnosis || '')}<small>${e((r.items || []).map((x) => x.generic_name || x.medication_name).join(' · '))}</small></button>`).join('')}</div>` : ''}
        ${R.frecuentes.length ? `<div class="rx-at-l">Tus medicamentos frecuentes</div><div class="rx-frec">${R.frecuentes.map((f, i) => `<button class="rx-chip" data-frec="${i}" title="${e([f.presentation, f.dosage, f.frequency, f.duration].filter(Boolean).join(' · '))}">+ ${e(f.generico)}${f.presentation ? ` <small>${e(f.presentation)}</small>` : ''}</button>`).join('')}</div>` : ''}
      </div>` : ''}
      <div class="card"><div class="card-title" style="justify-content:space-between"><span>💊 Medicamentos</span>
        ${R.templates.length ? `<select id="rxTpl" style="padding:8px;border:1.5px solid #ECE5D9;border-radius:10px;font:inherit;font-size:13px"><option value="">Usar plantilla…</option>${R.templates.map((t) => `<option value="${t.id}">${e(t.name)}</option>`).join('')}</select>` : ''}</div>
        ${R.items.map((it, i) => `<div class="card" style="background:#FFFDF9;border:1px solid #F4EEE6;box-shadow:none">
          <div class="flex-between"><b style="font-size:13px">Medicamento ${i + 1}</b>${R.items.length > 1 ? `<button class="btn btn-sm btn-no" data-quitar="${i}">Quitar</button>` : ''}</div>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:0 12px;margin-top:8px">
            <div class="field" style="position:relative"><label>Nombre genérico (DCI) *</label><input data-i="${i}" data-f="genericName" data-ac="${i}" value="${e(it.genericName)}" placeholder="Escribí para buscar: ibup…" autocomplete="off"><div class="rx-ac" id="rxAc${i}"></div></div>
            <div class="field"><label>Marca (opcional)</label><input data-i="${i}" data-f="medicationName" value="${e(it.medicationName)}" placeholder="Ej: Ibupirac"></div>
            <div class="field"><label>Forma farmacéutica</label><input data-i="${i}" data-f="pharmaceuticalForm" value="${e(it.pharmaceuticalForm)}" list="rxFormas${i}" placeholder="Comprimidos"><datalist id="rxFormas${i}">${((VD().lista.find((m) => VD().norm(m[0]) === VD().norm(it.genericName)) || [])[2] || FORMAS).map((f) => `<option value="${e(f)}">`).join('')}</datalist></div>
            <div class="field"><label>Presentación / concentración</label><input data-i="${i}" data-f="presentation" value="${e(it.presentation)}" list="rxPres${i}" placeholder="400 mg x 20"><datalist id="rxPres${i}">${(((VD().lista.find((m) => VD().norm(m[0]) === VD().norm(it.genericName)) || [])[3]) || []).map((f) => `<option value="${e(f)}">`).join('')}</datalist></div>
            <div class="field"><label>Dosis *</label><input data-i="${i}" data-f="dosage" value="${e(it.dosage)}" placeholder="1 comprimido"></div>
            <div class="field"><label>Frecuencia *</label><input data-i="${i}" data-f="frequency" value="${e(it.frequency)}" list="rxFrecs" placeholder="Cada 8 horas"></div>
            <div class="field"><label>Duración</label><input data-i="${i}" data-f="duration" value="${e(it.duration)}" list="rxDurs" placeholder="5 días"></div>
            <div class="field"><label>Cantidad (envases)</label><input data-i="${i}" data-f="quantity" value="${e(it.quantity)}" inputmode="numeric" placeholder="1"></div>
          </div>
          <div class="field"><label>Indicaciones</label><input data-i="${i}" data-f="instructions" value="${e(it.instructions)}" placeholder="Tomar con comida"></div>
        </div>`).join('')}
        <datalist id="rxFrecs">${VD().FRECUENCIAS.map((f) => `<option value="${e(f)}">`).join('')}</datalist>
        <datalist id="rxDurs">${VD().DURACIONES.map((f) => `<option value="${e(f)}">`).join('')}</datalist>
        <div class="flex" style="flex-wrap:wrap;gap:8px"><button class="btn btn-sm btn-outline" id="rxMas">+ Agregar medicamento</button><button class="btn btn-sm btn-soft" id="rxGuardarTpl">💾 Guardar como plantilla</button></div>
        <div id="rxAlertas"></div>
      </div>
      <div class="card"><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:0 12px">
        <div class="field"><label>Validez</label><select id="rxVence">${[[30, '30 días'], [60, '60 días'], [90, '90 días (tratamiento prolongado)']].map(([d, l]) => `<option value="${d}" ${R.expiresInDays == d ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
        <div class="field"><label>Notas para la farmacia (opcional)</label><input id="rxNotas" value="${e(R.notes)}"></div></div>
        ${_cert && !_cert.vencido ? `<label style="display:flex;gap:8px;align-items:center;font-size:13px;margin:4px 0 12px"><input type="checkbox" id="rxDigital" checked style="width:18px;height:18px;accent-color:var(--primary)"> 🔐 Firmar digitalmente con mi certificado (${e(_cert.subject_cn)})</label>` : `<p class="muted" style="font-size:12px;margin-bottom:10px">Podés sumar firma digital con certificado (Ley 25.506) cargándolo en <a href="#" onclick="abrirMatricula();return false" style="color:var(--primary)">Matrícula y firma</a>.</p>`}
        <p id="rxErr" class="error hidden"></p>
        <button class="btn btn-primary" id="rxEmitir" style="max-width:320px" ${v && !v.puedeRecetar ? 'disabled' : ''}>🔏 Firmar y emitir receta</button>
        <p class="muted" style="margin-top:8px;font-size:12px">Se firma electrónicamente con tus datos de matrícula y queda con código QR y CUIR para que la farmacia la valide (Ley 27.553).</p>
      </div>`;
    enlazarReceta(v);
  }

  function cuilDesdeDni(dni, sexo) {
    const d = String(dni || '').replace(/\D/g, '').padStart(8, '0');
    let pref = sexo === 'male' ? '20' : sexo === 'female' ? '27' : null;
    if (!pref || d.length !== 8) return '';
    const dig = (b) => { const m = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2]; const r = 11 - (m.reduce((a, x, i) => a + x * +b[i], 0) % 11); return r === 11 ? 0 : r; };
    let v = dig(pref + d);
    if (v === 10) { v = pref === '20' ? 9 : 4; pref = '23'; }
    return pref + d + v;
  }
  function leerReceta() {
    const cu = $('rxCuil'); if (cu) R.cuil = cu.value.replace(/\D/g, '');
    const dx = $('rxDx'); if (dx) R.diagnosis = dx.value;
    const c = $('rxCie'); if (c) R.diagnosisCode = c.value.split(' ')[0];
    const ve = $('rxVence'); if (ve) R.expiresInDays = +ve.value;
    const n = $('rxNotas'); if (n) R.notes = n.value;
    main().querySelectorAll('[data-i][data-f]').forEach((i) => { R.items[+i.dataset.i][i.dataset.f] = i.value; });
  }

  function enlazarReceta(v) {
    const m = main();
    m.querySelectorAll('[data-i][data-f]').forEach((i) => i.oninput = () => { R.items[+i.dataset.i][i.dataset.f] = i.value; if (i.dataset.f === 'genericName') { R.confirmaAlertas = false; pintarAlertas(); } });
    pintarAlertas();
    // Autocompletado del genérico con el vademécum
    m.querySelectorAll('[data-ac]').forEach((inp) => {
      const idx = +inp.dataset.ac, box = $('rxAc' + idx);
      const cerrar = () => { box.innerHTML = ''; box.classList.remove('open'); };
      inp.addEventListener('input', () => {
        const r = VD().buscar(inp.value, 7);
        if (!r.length) return cerrar();
        box.innerHTML = r.map((x, j) => `<div class="rx-ac-i" data-j="${j}"><b>${e(x[0])}</b><small>${e(x[1])}</small></div>`).join('');
        box.classList.add('open');
        box.querySelectorAll('[data-j]').forEach((d) => d.onpointerdown = (ev) => {
          ev.preventDefault(); const x = r[+d.dataset.j];
          leerReceta(); const it = R.items[idx];
          it.genericName = x[0];
          if (!it.pharmaceuticalForm && x[2].length === 1) it.pharmaceuticalForm = x[2][0];
          // Si el médico ya lo recetó antes, se sugiere lo que suele indicar
          const f = R.frecuentes.find((y) => VD().norm(y.generico) === VD().norm(x[0]));
          if (f) { const d2 = itemDe(f); for (const k of ['pharmaceuticalForm', 'presentation', 'dosage', 'frequency', 'duration', 'quantity', 'instructions']) if (!it[k]) it[k] = d2[k]; }
          R.confirmaAlertas = false; pintarReceta(v);
          setTimeout(() => { const n = main().querySelector(`[data-i="${idx}"][data-f="${it.presentation ? 'dosage' : 'presentation'}"]`); n && n.focus(); }, 0);
        });
      });
      inp.addEventListener('blur', () => setTimeout(cerrar, 150));
      inp.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') cerrar(); if (ev.key === 'Enter') { const f = box.querySelector('[data-j]'); if (f) { ev.preventDefault(); f.dispatchEvent(new PointerEvent('pointerdown')); } } });
    });
    m.querySelectorAll('[data-frec]').forEach((b) => b.onclick = () => { leerReceta(); agregarItems([itemDe(R.frecuentes[+b.dataset.frec])]); pintarReceta(v); });
    m.querySelectorAll('[data-rep]').forEach((b) => b.onclick = () => {
      const r = R.recientes[+b.dataset.rep]; if (!r) return; leerReceta();
      if (!R.diagnosis.trim()) { R.diagnosis = r.diagnosis || ''; R.diagnosisCode = r.diagnosis_code || ''; }
      agregarItems((r.items || []).map(itemDe)); pintarReceta(v);
    });
    const gt = $('rxGuardarTpl'); if (gt) gt.onclick = async () => {
      leerReceta(); const items = R.items.filter((x) => (x.genericName || '').trim());
      if (!items.length) return alert('Agregá al menos un medicamento');
      const name = prompt('Nombre de la plantilla (ej: "Faringitis adulto", "HTA inicio"):', R.diagnosis || ''); if (!name) return;
      try {
        const t = await apiFetch('/api/v1/prescription-templates', { method: 'POST', body: { name: name.trim(), diagnosis: R.diagnosis || undefined, diagnosisCode: R.diagnosisCode || undefined, items: items.map((x) => ({ medicationName: (x.medicationName || '').trim() || x.genericName.trim(), genericName: x.genericName.trim(), pharmaceuticalForm: x.pharmaceuticalForm || undefined, presentation: x.presentation || undefined, dosage: x.dosage || undefined, frequency: x.frequency || undefined, duration: x.duration || undefined, quantity: parseInt(x.quantity, 10) || undefined, instructions: x.instructions || undefined })) } });
        R.templates.push(t); gt.textContent = '✓ Plantilla guardada'; gt.disabled = true;
      } catch (ex) { alert(ex.message); }
    };
    const mas = $('rxMas'); if (mas) mas.onclick = () => { leerReceta(); R.items.push(itemVacio()); pintarReceta(v); };
    m.querySelectorAll('[data-quitar]').forEach((b) => b.onclick = () => { leerReceta(); R.items.splice(+b.dataset.quitar, 1); pintarReceta(v); });
    const tpl = $('rxTpl'); if (tpl) tpl.onchange = () => {
      const t = R.templates.find((x) => x.id === tpl.value); if (!t) return;
      leerReceta();
      if (!R.diagnosis && t.diagnosis) R.diagnosis = t.diagnosis;
      if (!R.diagnosisCode && t.diagnosis_code) R.diagnosisCode = t.diagnosis_code;
      agregarItems((t.items || []).map(itemDe));
      pintarReceta(v);
    };
    const cambiar = $('rxCambiarPac'); if (cambiar) cambiar.onclick = () => { leerReceta(); R.patient = null; R.patientId = ''; pintarReceta(v); };
    const pq = $('rxPacQ');
    if (pq) {
      let t = null;
      pq.oninput = () => {
        clearTimeout(t);
        t = setTimeout(async () => {
          const q = pq.value.trim(); if (q.length < 2) { $('rxPacRes').innerHTML = ''; return; }
          const r = asList(await apiFetch(`/api/v1/patients?search=${encodeURIComponent(q)}&limit=8`).catch(() => []));
          $('rxPacRes').innerHTML = r.map((p) => `<div class="appt-row" style="cursor:pointer;padding:8px 12px" data-pac="${p.id}"><div class="who"><strong>${e(p.first_name)} ${e(p.last_name)}</strong><small>${e([p.dni ? 'DNI ' + p.dni : '', p.insurance_provider, p.phone].filter(Boolean).join(' · '))}</small></div></div>`).join('') || '<p class="muted">Sin resultados</p>';
          $('rxPacRes').querySelectorAll('[data-pac]').forEach((x) => x.onclick = async () => { leerReceta(); R.patientId = x.dataset.pac; R.patient = await apiFetch(`/api/v1/patients/${R.patientId}`).catch(() => r.find((p) => p.id === x.dataset.pac)); await cargarRecientes(); pintarReceta(v); });
        }, 250);
      };
    }
    const cie = $('rxCie');
    if (cie) cie.oninput = () => {
      const q = norm(cie.value.trim());
      const res = !q ? [] : H().cie10.filter(([c, d]) => norm(c).startsWith(q) || norm(d).includes(q)).slice(0, 6);
      $('rxCieRes').innerHTML = res.map(([c, d]) => `<div class="appt-row" style="cursor:pointer;padding:8px 12px" data-c="${e(c)}" data-d="${e(d)}"><div class="who"><strong>${e(c)}</strong><small>${e(d)}</small></div></div>`).join('');
      $('rxCieRes').querySelectorAll('[data-c]').forEach((x) => x.onclick = () => { cie.value = x.dataset.c; const dx = $('rxDx'); if (dx && !dx.value.trim()) dx.value = x.dataset.d; $('rxCieRes').innerHTML = ''; });
    };
    const emitir = $('rxEmitir');
    if (emitir) emitir.onclick = async () => {
      leerReceta();
      const err = $('rxErr');
      const items = R.items.filter((x) => (x.genericName || '').trim());
      const sinDosis = items.findIndex((x) => !(x.dosage || '').trim() || !(x.frequency || '').trim());
      const fallo = !R.patientId ? 'Elegí el paciente' : !R.diagnosis.trim() ? 'Indicá el diagnóstico' : !items.length ? 'Agregá al menos un medicamento con su nombre genérico' : sinDosis >= 0 ? `Completá dosis y frecuencia del medicamento ${sinDosis + 1}` : '';
      const alertas = alertasReceta();
      const falloAl = !fallo && alertas.some((a) => a.nivel === 'alta') && !R.confirmaAlertas ? 'Hay alertas importantes: revisalas y marcá la confirmación antes de emitir' : '';
      if (fallo || falloAl) { err.textContent = fallo || falloAl; err.classList.remove('hidden'); if (falloAl) $('rxAlertas')?.scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
      emitir.disabled = true; emitir.textContent = 'Firmando…';
      try {
        const r = await apiFetch('/api/v1/prescriptions', { method: 'POST', body: {
          patientId: R.patientId, patientCuil: R.cuil || undefined, medicalRecordId: R.medicalRecordId || undefined, diagnosis: R.diagnosis.trim(), diagnosisCode: R.diagnosisCode || undefined,
          expiresInDays: R.expiresInDays, notes: R.notes || undefined,
          composeSeconds: Math.round((Date.now() - R.inicio) / 1000), alertsAcknowledged: alertas.length ? alertas : undefined,
          items: items.map((x) => ({ genericName: x.genericName.trim(), medicationName: (x.medicationName || '').trim() || x.genericName.trim(), pharmaceuticalForm: x.pharmaceuticalForm || undefined, presentation: x.presentation || undefined, dosage: x.dosage || undefined, frequency: x.frequency || undefined, duration: x.duration || undefined, quantity: parseInt(x.quantity, 10) || undefined, instructions: x.instructions || undefined })),
        } });
        const p = R.patient || {};
        const digital = $('rxDigital')?.checked ? await firmarRecetaDigital(r.id) : false;
        main().innerHTML = `<div class="card center" style="padding:30px">
          <p style="font-size:42px">✅</p><h2 style="margin:6px 0">Receta emitida y firmada</h2>
          <p class="muted">CUIR <b>${e(r.cuir || r.verification_code)}</b> · código ${e(r.verification_code)}</p>
          <p class="muted" style="font-size:12px;margin-top:4px">⏱️ La armaste en ${(() => { const sg = Math.round((Date.now() - R.inicio) / 1000); return sg < 60 ? sg + ' segundos' : Math.floor(sg / 60) + ' min ' + (sg % 60) + ' s'; })()}</p>
          <p style="margin-top:8px;font-size:13px">${digital ? '🔐 Con firma digital de tu certificado (Ley 25.506)' : '🔏 Con firma electrónica de la plataforma'}</p>
          <div class="flex" style="justify-content:center;flex-wrap:wrap;margin-top:16px">
            ${!digital && _cert ? `<button class="btn btn-sm btn-ok" onclick="firmarYRecargar('${r.id}')">🔐 Firmar digitalmente</button>` : ''}
            <button class="btn btn-sm btn-primary" onclick="recetaPdf('${r.id}')">🖨️ Imprimir / PDF</button>
            <button class="btn btn-sm" style="background:#25D366;color:#fff" onclick="recetaWhatsApp('${e(r.verification_code)}','${e(p.phone || '')}','${e(p.first_name || '')}')">Enviar por WhatsApp</button>
            <button class="btn btn-sm btn-soft" onclick="recetaEmail('${r.id}','${e(p.email || '')}')">✉️ Enviar por email</button>
            <button class="btn btn-sm btn-outline" onclick="abrirPaciente('${R.patientId}')">Volver a la ficha</button>
          </div></div>`;
      } catch (ex) { emitir.disabled = false; emitir.textContent = '🔏 Firmar y emitir receta'; err.textContent = ex.message; err.classList.remove('hidden'); }
    };
  }

  // ═══════════════════════════════════════════════════════
  // MATRÍCULA Y FIRMA
  // ═══════════════════════════════════════════════════════
  const PROVINCIAS = ['Buenos Aires', 'Ciudad de Buenos Aires', 'Catamarca', 'Chaco', 'Chubut', 'Córdoba', 'Corrientes', 'Entre Ríos', 'Formosa', 'Jujuy', 'La Pampa', 'La Rioja', 'Mendoza', 'Misiones', 'Neuquén', 'Río Negro', 'Salta', 'San Juan', 'San Luis', 'Santa Cruz', 'Santa Fe', 'Santiago del Estero', 'Tierra del Fuego', 'Tucumán'];
  const ESTADOS_M = { verified: ['✅ Verificada', 'confirmed'], pending: ['⏳ En revisión', 'pending'], rejected: ['❌ Rechazada', 'cancelled'], unverified: ['Sin verificar', 'no_show'] };

  window.abrirMatricula = async function () {
    const m = main(); m.innerHTML = '<div class="spinner"></div>';
    const v = await verificacion(true);
    if (!v) { m.innerHTML = '<div class="card"><p class="error">No se pudo cargar tu perfil</p></div>'; return; }
    const [lbl, cls] = ESTADOS_M[v.license_status] || ESTADOS_M.unverified;
    const bloqueado = v.license_status === 'verified';
    m.innerHTML = `<div class="topbar"><h1>Matrícula y firma</h1><span class="badge-sm ${cls}" style="font-size:13px;padding:6px 14px">${lbl}</span></div>
      <div class="card"><div class="card-title">📇 Verificación profesional</div>
        <p class="muted" style="margin-bottom:12px">Para emitir recetas electrónicas verificamos que tu matrícula esté vigente en la Red Federal de Registros de Profesionales de la Salud (REFEPS) del Ministerio de Salud. ${v.refepsAutomatico ? 'La consulta es automática.' : 'La revisión la hace nuestro equipo con tu DNI, matrícula y la foto de la credencial (suele tardar menos de 24 h hábiles).'}</p>
        ${v.license_verification_note ? `<p style="font-size:13px;margin-bottom:10px"><b>Detalle:</b> ${e(v.license_verification_note)}</p>` : ''}
        ${bloqueado ? `<div class="kv"><div><span>Profesional</span><b>${e(v.first_name)} ${e(v.last_name)}</b></div><div><span>DNI</span><b>${e(v.dni)}</b></div><div><span>Matrícula</span><b>${v.license_type === 'MN' ? 'M.N.' : 'M.P.'} ${e(v.medical_license)}${v.license_type === 'MP' && v.medical_license_province ? ' (' + e(v.medical_license_province) + ')' : ''}</b></div><div><span>Especialidad</span><b>${e(v.specialty || '—')}</b></div><div><span>Verificada</span><b>${v.license_verified_at ? fmtDate(v.license_verified_at) : ''}</b></div></div>
          <p class="muted" style="margin-top:10px;font-size:12px">Si cambiás de matrícula escribinos a contact@rispy.io.</p>` : `
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:0 12px">
          <div class="field"><label>DNI *</label><input id="mDni" value="${e(v.dni || '')}" inputmode="numeric"></div>
          <div class="field"><label>Tipo de matrícula *</label><select id="mTipo"><option value="MP" ${v.license_type !== 'MN' ? 'selected' : ''}>Provincial (M.P.)</option><option value="MN" ${v.license_type === 'MN' ? 'selected' : ''}>Nacional (M.N.)</option></select></div>
          <div class="field" id="mProvBox"><label>Provincia *</label><select id="mProv"><option value="">Elegí…</option>${PROVINCIAS.map((p) => `<option ${v.medical_license_province === p ? 'selected' : ''}>${p}</option>`).join('')}</select></div>
          <div class="field"><label>Número de matrícula *</label><input id="mMat" value="${e(v.medical_license || '')}"></div>
          <div class="field"><label>Especialidad</label><input id="mEsp" value="${e(v.specialty || '')}"></div>
          <div class="field"><label>Foto de la credencial o título ${v.has_document ? '(ya cargada)' : ''}</label><input id="mDoc" type="file" accept="image/*"></div>
        </div>
        <p id="mErr" class="error hidden"></p>
        <button class="btn btn-sm btn-primary" id="mEnviar">${v.license_status === 'pending' ? 'Actualizar datos' : 'Enviar para verificar'}</button>`}
      </div>
      <div class="card"><div class="card-title">✍️ Firma para las recetas</div>
        <p class="muted" style="margin-bottom:10px">Se imprime arriba de tu sello en cada receta. Dibujala con el mouse o el dedo, o subí una foto de tu firma sobre papel blanco.</p>
        ${v.has_signature ? '<p style="font-size:13px;margin-bottom:8px">✅ Ya tenés una firma cargada. Podés reemplazarla.</p>' : ''}
        <canvas id="firmaCv" width="600" height="200" style="width:100%;max-width:600px;height:auto;aspect-ratio:3/1;border:1.5px dashed #D9CBB8;border-radius:12px;background:#fff;touch-action:none;cursor:crosshair"></canvas>
        <div class="flex" style="flex-wrap:wrap;margin-top:10px">
          <button class="btn btn-sm btn-outline" id="firmaBorrar">Borrar</button>
          <label class="btn btn-sm btn-soft" style="cursor:pointer">Subir imagen<input type="file" id="firmaArchivo" accept="image/*" hidden></label>
          <button class="btn btn-sm btn-primary" id="firmaGuardar">Guardar firma</button>
          <span id="firmaMsg" class="muted"></span>
        </div>
      </div>
      <div class="card"><div class="card-title">🔐 Firma digital con certificado (Ley 25.506)</div>
        <p class="muted" style="margin-bottom:10px">Con tu certificado de firma digital (archivo .p12 / .pfx emitido por un certificador licenciado: AC ONTI, AC Modernización, etc.) cada receta queda firmada digitalmente dentro del PDF y cualquier lector (Adobe, la farmacia) puede validarla. La clave privada y la contraseña <b>nunca salen de tu equipo</b>.</p>
        <div id="certBox"><div class="spinner" style="margin:10px 0"></div></div>
      </div>
      ${v.is_platform_admin ? `<div class="card"><div class="card-title">🛡️ Administración</div><div class="flex" style="flex-wrap:wrap"><button class="btn btn-sm btn-primary" onclick="abrirActividad()">📈 Altas y accesos</button><button class="btn btn-sm btn-outline" onclick="abrirVerificaciones()">Revisar matrículas pendientes</button><button class="btn btn-sm btn-outline" onclick="abrirFarmaciasAdmin()">Farmacias habilitadas</button><button class="btn btn-sm btn-outline" onclick="abrirPedidosDatos()">Pedidos de datos personales</button></div></div>` : ''}`;
    enlazarMatricula();
    const c = await certificadoActual();
    const box = $('certBox');
    if (box) box.innerHTML = c ? `<div class="kv"><div><span>Titular</span><b>${e(c.subject_cn)}</b></div><div><span>CUIL/CUIT</span><b>${e(c.subject_serial)}</b></div>
        <div><span>Emisor</span><b>${e(c.issuer_cn || c.issuer_o)}${c.issuer_recognized ? ' ✅' : ' <span style="color:#85500b">(no reconocido como certificador licenciado)</span>'}</b></div>
        <div><span>Vigencia</span><b>${fmtDate(c.not_before)} – ${fmtDate(c.not_after)}${c.vencido ? ' <span style="color:var(--danger)">VENCIDO</span>' : ''}</b></div></div>
        <p class="muted" style="margin-top:8px;font-size:12px">${(await certificadoGuardadoLocal()) ? 'El certificado está guardado en este navegador; al firmar solo te pide la contraseña.' : 'En este navegador no está guardado: al firmar vas a elegir el archivo.'}</p>
        <div class="flex" style="margin-top:10px;flex-wrap:wrap"><button class="btn btn-sm btn-soft" onclick="cargarCertificadoDigital()">Reemplazar certificado</button><button class="btn btn-sm btn-no" onclick="quitarCertificadoDigital()">Quitar</button></div>`
      : `<button class="btn btn-sm btn-primary" onclick="cargarCertificadoDigital()">Cargar mi certificado (.p12 / .pfx)</button>
         <p class="muted" style="margin-top:8px;font-size:12px">¿No tenés? Se tramita gratis en la <a href="https://www.argentina.gob.ar/servicio/obtener-un-certificado-de-firma-digital" target="_blank" rel="noopener" style="color:var(--primary)">AC ONTI / AC Modernización</a> o con tu colegio médico. Los tokens USB todavía no se pueden usar desde el navegador.</p>`;
  };

  const leerImagen = (file, lado, tipo = 'image/jpeg') => new Promise((ok, mal) => {
    const fr = new FileReader();
    fr.onerror = () => mal(new Error('No se pudo leer el archivo'));
    fr.onload = () => {
      const i = new Image();
      i.onerror = () => mal(new Error('Formato no soportado: usá JPG o PNG'));
      i.onload = () => {
        const r = Math.min(1, lado / Math.max(i.width, i.height));
        const c = document.createElement('canvas'); c.width = Math.round(i.width * r); c.height = Math.round(i.height * r);
        const x = c.getContext('2d'); if (tipo === 'image/png') { x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); }
        x.drawImage(i, 0, 0, c.width, c.height); ok(c.toDataURL(tipo, 0.85));
      };
      i.src = fr.result;
    };
    fr.readAsDataURL(file);
  });

  function enlazarMatricula() {
    const tipo = $('mTipo'), box = $('mProvBox');
    if (tipo) { const f = () => (box.style.display = tipo.value === 'MP' ? '' : 'none'); tipo.onchange = f; f(); }
    const env = $('mEnviar');
    if (env) env.onclick = async () => {
      const err = $('mErr'); err.classList.add('hidden');
      env.disabled = true; env.textContent = 'Enviando…';
      try {
        const f = $('mDoc').files[0];
        const document = f ? await leerImagen(f, 1400) : undefined;
        await apiFetch('/api/v1/verification', { method: 'POST', body: { dni: $('mDni').value, licenseType: tipo.value, province: tipo.value === 'MP' ? $('mProv').value : undefined, medicalLicense: $('mMat').value, specialty: $('mEsp').value, document } });
        abrirMatricula();
      } catch (ex) { err.textContent = ex.message; err.classList.remove('hidden'); env.disabled = false; env.textContent = 'Enviar para verificar'; }
    };
    // Firma: dibujo
    const cv = $('firmaCv'); if (!cv) return;
    const ctx = cv.getContext('2d'); let dib = false, usado = false;
    const limpiar = () => { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height); usado = false; };
    limpiar(); ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#1f2a44';
    const pos = (ev) => { const r = cv.getBoundingClientRect(); return [(ev.clientX - r.left) * cv.width / r.width, (ev.clientY - r.top) * cv.height / r.height]; };
    cv.onpointerdown = (ev) => { dib = true; usado = true; cv.setPointerCapture(ev.pointerId); ctx.beginPath(); ctx.moveTo(...pos(ev)); };
    cv.onpointermove = (ev) => { if (!dib) return; ctx.lineTo(...pos(ev)); ctx.stroke(); };
    cv.onpointerup = cv.onpointercancel = () => { dib = false; };
    $('firmaBorrar').onclick = limpiar;
    $('firmaArchivo').onchange = async (ev) => {
      const f = ev.target.files[0]; if (!f) return;
      try {
        const url = await leerImagen(f, 600, 'image/png');
        const i = new Image(); i.onload = () => { limpiar(); const r = Math.min(cv.width / i.width, cv.height / i.height); ctx.drawImage(i, (cv.width - i.width * r) / 2, (cv.height - i.height * r) / 2, i.width * r, i.height * r); usado = true; }; i.src = url;
      } catch (ex) { alert(ex.message); }
    };
    $('firmaGuardar').onclick = async () => {
      const msg = $('firmaMsg');
      if (!usado) { msg.textContent = 'Dibujá o subí tu firma primero'; return; }
      try { await apiFetch('/api/v1/profile/signature', { method: 'PUT', body: { image: cv.toDataURL('image/png') } }); msg.textContent = '✅ Firma guardada'; _verif = null; }
      catch (ex) { msg.textContent = ex.message; }
    };
  }

  // ─── Panel de verificaciones (administrador de la plataforma) ───
  window.abrirVerificaciones = async function (estado = 'pending') {
    const m = main(); m.innerHTML = '<div class="spinner"></div>';
    try {
      const l = await apiFetch(`/api/v1/verification/admin?estado=${estado}`);
      m.innerHTML = `<div class="topbar"><button class="btn btn-sm btn-outline" onclick="abrirMatricula()">← Volver</button><h1>Verificación de matrículas</h1><span></span></div>
        <div class="chips">${[['pending', 'Pendientes'], ['verified', 'Verificadas'], ['rejected', 'Rechazadas'], ['unverified', 'Sin enviar']].map(([k, t]) => `<button class="chip ${k === estado ? 'active' : ''}" onclick="abrirVerificaciones('${k}')">${t}</button>`).join('')}</div>
        <p class="muted" style="margin-bottom:10px">Controlá en <a href="https://sisa.msal.gov.ar/sisa/#sisa" target="_blank" rel="noopener" style="color:var(--primary)">SISA → REFEPS (consulta pública de profesionales)</a> que el DNI tenga matrícula de médico/a vigente.</p>
        ${l.length ? l.map((d) => `<div class="card"><div class="flex-between" style="flex-wrap:wrap;gap:10px">
            <div><b style="font-size:15px">${e(d.first_name)} ${e(d.last_name)}</b><br><span class="muted">${e(d.email)} · ${e(d.phone || '')}</span></div>
            <span class="muted">${d.license_requested_at ? 'Enviada ' + fmtDate(d.license_requested_at) : 'Registrado ' + fmtDate(d.created_at)}</span></div>
          <div class="kv" style="margin-top:10px"><div><span>DNI</span><b>${e(d.dni || '—')}</b></div><div><span>Matrícula</span><b>${d.license_type === 'MN' ? 'M.N.' : 'M.P.'} ${e(String(d.medical_license || '').startsWith('PENDING_') ? '—' : d.medical_license)}${d.medical_license_province ? ' (' + e(d.medical_license_province) + ')' : ''}</b></div><div><span>Especialidad</span><b>${e(d.specialty || '—')}</b></div><div><span>REFEPS</span><b>${d.refeps_data ? e(JSON.stringify(d.refeps_data).slice(0, 160)) : 'sin consulta automática'}</b></div></div>
          ${d.license_verification_note ? `<p class="muted" style="margin-top:6px">${e(d.license_verification_note)}</p>` : ''}
          ${d.license_document ? `<img src="${d.license_document}" alt="Credencial" style="max-width:100%;max-height:320px;border-radius:10px;margin-top:10px;border:1px solid #F4EEE6">` : ''}
          <div class="flex" style="margin-top:10px">${d.license_status !== 'verified' ? `<button class="btn btn-sm btn-ok" onclick="resolverMatricula('${d.id}',true,'${estado}')">✓ Aprobar</button>` : ''}${d.license_status !== 'rejected' ? `<button class="btn btn-sm btn-no" onclick="resolverMatricula('${d.id}',false,'${estado}')">✕ Rechazar</button>` : ''}</div>
        </div>`).join('') : '<div class="card"><p class="muted center">No hay solicitudes en este estado.</p></div>'}`;
    } catch (ex) { m.innerHTML = `<div class="card"><p class="error">${e(ex.message)}</p></div>`; }
  };
  window.resolverMatricula = async function (id, ok, estado) {
    const nota = prompt(ok ? 'Nota (opcional): cómo la verificaste' : 'Motivo del rechazo (lo ve el médico):', ok ? 'Verificada en REFEPS' : '');
    if (nota === null) return;
    try { await apiFetch(`/api/v1/verification/admin/${id}/${ok ? 'aprobar' : 'rechazar'}`, { method: 'POST', body: { nota } }); abrirVerificaciones(estado); } catch (ex) { alert(ex.message); }
  };
  // ─── Farmacias habilitadas (administrador de la plataforma) ───
  window.abrirFarmaciasAdmin = async function (nuevaClave) {
    const m = main(); m.innerHTML = '<div class="spinner"></div>';
    try {
      const l = await apiFetch('/api/v1/admin/pharmacies');
      m.innerHTML = `<div class="topbar"><button class="btn btn-sm btn-outline" onclick="abrirMatricula()">← Volver</button><h1>Farmacias</h1><span></span></div>
        ${nuevaClave ? `<div class="card" style="border:1.5px solid #9FDCC3;background:#F0FBF6"><b>Clave de ${e(nuevaClave.name)}</b> (se muestra una sola vez; enviásela a la farmacia):<p style="font-family:monospace;font-size:14px;margin-top:8px;word-break:break-all;user-select:all">${e(nuevaClave.apiKey)}</p><p class="muted" style="margin-top:6px">La farmacia entra en ${location.origin}/farmacia o integra su sistema con la API.</p></div>` : ''}
        <div class="card"><div class="card-title">➕ Habilitar farmacia</div>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:0 12px">
            ${[['phName', 'Nombre *'], ['phCuit', 'CUIT'], ['phHab', 'N° de habilitación'], ['phFarm', 'Farmacéutico/a responsable'], ['phMat', 'Matrícula del farmacéutico'], ['phEmail', 'Email'], ['phTel', 'Teléfono'], ['phDir', 'Dirección'], ['phCiudad', 'Ciudad'], ['phProv', 'Provincia']].map(([id, l]) => `<div class="field"><label>${l}</label><input id="${id}"></div>`).join('')}
          </div><button class="btn btn-sm btn-primary" id="phCrear">Crear y generar clave</button></div>
        <div class="card"><div class="card-title">🏪 Farmacias (${l.length})</div>
          ${l.length ? l.map((f) => `<div class="appt-row"><div class="who"><strong>${e(f.name)}</strong><small>${e([f.city, f.province, f.cuit && 'CUIT ' + f.cuit, f.pharmacist_name].filter(Boolean).join(' · '))}</small><small>Clave ${e(f.api_key_prefix)}… · ${f.dispensas} dispensas · último uso ${f.last_used_at ? fmtDate(f.last_used_at) : 'nunca'}</small></div>
            <div class="side"><span class="badge-sm ${f.is_active ? 'confirmed' : 'cancelled'}">${f.is_active ? 'Activa' : 'Deshabilitada'}</span>${f.self_registered ? '<span class="badge-sm pending">Se registró sola</span>' : ''}<div class="acts">
              <button class="btn btn-sm btn-soft" onclick="farmaciaAccion('${f.id}','regenerate-key')">Nueva clave</button>
              <button class="btn btn-sm ${f.is_active ? 'btn-no' : 'btn-ok'}" onclick="farmaciaAccion('${f.id}','${f.is_active ? 'deactivate' : 'activate'}')">${f.is_active ? 'Deshabilitar' : 'Habilitar'}</button></div></div></div>`).join('') : '<p class="muted">Todavía no hay farmacias habilitadas.</p>'}
        </div>`;
      $('phCrear').onclick = async () => {
        const v = (id) => $(id).value.trim() || undefined;
        try { const r = await apiFetch('/api/v1/admin/pharmacies', { method: 'POST', body: { name: v('phName'), cuit: v('phCuit'), habilitacion: v('phHab'), pharmacistName: v('phFarm'), pharmacistLicense: v('phMat'), email: v('phEmail'), phone: v('phTel'), address: v('phDir'), city: v('phCiudad'), province: v('phProv') } }); abrirFarmaciasAdmin(r); }
        catch (ex) { alert(ex.message); }
      };
    } catch (ex) { m.innerHTML = `<div class="card"><p class="error">${e(ex.message)}</p></div>`; }
  };
  window.abrirPedidosDatos = async function (estado = 'pending') {
    const m = main(); m.innerHTML = '<div class="spinner"></div>';
    try {
      const l = await apiFetch(`/api/v1/admin/data-requests?estado=${estado}`);
      const tipos = { acceso: 'Acceso', rectificacion: 'Rectificación', supresion: 'Supresión', oposicion: 'Oposición' };
      m.innerHTML = `<div class="topbar"><button class="btn btn-sm btn-outline" onclick="abrirMatricula()">← Volver</button><h1>Pedidos de datos (Ley 25.326)</h1><span></span></div>
        <div class="chips">${[['pending', 'Pendientes'], ['done', 'Resueltos'], ['rejected', 'Rechazados']].map(([k, t]) => `<button class="chip ${k === estado ? 'active' : ''}" onclick="abrirPedidosDatos('${k}')">${t}</button>`).join('')}</div>
        <p class="muted" style="margin-bottom:10px">Plazos: acceso 10 días corridos; rectificación, supresión u oposición 5 días hábiles. La historia clínica no se suprime antes de los 10 años: se bloquea.</p>
        ${l.length ? l.map((r) => `<div class="card"><div class="flex-between" style="flex-wrap:wrap"><b>${tipos[r.kind] || r.kind}</b><span class="muted">Vence ${fmtDate(r.due_at)}</span></div>
          <p style="font-size:13px;margin-top:6px">${e(r.patient_name || r.full_name || '')} · DNI ${e(r.dni || '—')} · ${e(r.email || '')}</p>
          ${r.detail ? `<p class="muted" style="margin-top:4px">${e(r.detail)}</p>` : ''}${r.response ? `<p style="margin-top:6px;font-size:13px">Respuesta: ${e(r.response)}</p>` : ''}
          ${r.status === 'pending' ? `<div class="flex" style="margin-top:8px"><button class="btn btn-sm btn-ok" onclick="resolverPedido('${r.id}','done')">Marcar resuelto</button><button class="btn btn-sm btn-no" onclick="resolverPedido('${r.id}','rejected')">Rechazar</button></div>` : ''}</div>`).join('') : '<div class="card"><p class="muted center">No hay pedidos.</p></div>'}`;
    } catch (ex) { m.innerHTML = `<div class="card"><p class="error">${e(ex.message)}</p></div>`; }
  };
  window.resolverPedido = async function (id, status) {
    const resp = prompt('Respuesta enviada al titular (queda registrada):', status === 'done' ? 'Respondido por email' : '');
    if (resp === null) return;
    try { await apiFetch(`/api/v1/admin/data-requests/${id}/resolve`, { method: 'POST', body: { status, response: resp } }); abrirPedidosDatos(); } catch (ex) { alert(ex.message); }
  };
  window.farmaciaAccion = async function (id, acc) {
    if (acc === 'regenerate-key' && !confirm('La clave anterior deja de funcionar. ¿Generar una nueva?')) return;
    try { const r = await apiFetch(`/api/v1/admin/pharmacies/${id}/${acc}`, { method: 'POST' }); abrirFarmaciasAdmin(r && r.apiKey ? r : null); } catch (ex) { alert(ex.message); }
  };
})();
