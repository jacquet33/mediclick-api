import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '../../database/database.service';

/**
 * Asistente para el médico. Todo lo que devuelve es un BORRADOR que el profesional revisa y corrige:
 * no diagnostica ni prescribe.
 *
 * Funciona siempre con reglas (resumen estructurado, datos faltantes, indicaciones a partir de la
 * consulta y la receta, ordenar un dictado por palabras clave). Si se configura un modelo, además
 * redacta en lenguaje natural:
 *   AI_PROVIDER=ollama     + OLLAMA_URL (ej: http://ollama:11434) + OLLAMA_MODEL   → los datos no salen del servidor
 *   AI_PROVIDER=anthropic  + ANTHROPIC_API_KEY (+ ANTHROPIC_MODEL)                 → se envía el texto sin nombre, DNI ni contacto
 * Cada uso queda auditado en ai_requests (sin guardar el texto clínico).
 */
@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  constructor(private db: DatabaseService, private config: ConfigService) {}

  get proveedor(): string {
    const p = (this.config.get<string>('AI_PROVIDER') || '').toLowerCase();
    if (p === 'ollama' && this.config.get('OLLAMA_URL')) return 'ollama';
    if (p === 'anthropic' && this.config.get('ANTHROPIC_API_KEY')) return 'anthropic';
    return '';
  }

  estado() {
    const p = this.proveedor;
    return { modelo: !!p, proveedor: p || 'reglas', local: p === 'ollama' };
  }

  private async auditar(orgId: string, doctorId: string, patientId: string | null, task: string, inChars: number, outChars: number, ok = true, error?: string) {
    await this.db.query(
      `INSERT INTO ai_requests (organization_id, doctor_id, patient_id, task, provider, input_chars, output_chars, ok, error) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [orgId, doctorId, patientId, task, this.proveedor || 'reglas', inChars, outChars, ok, error ? error.slice(0, 300) : null],
    ).catch(() => undefined);
  }

  /** Llama al modelo configurado. Devuelve null si no hay modelo o falla (se usa el resultado por reglas). */
  private async llm(system: string, user: string, maxTokens = 700): Promise<string | null> {
    const p = this.proveedor;
    if (!p) return null;
    try {
      if (p === 'ollama') {
        const r = await fetch(`${this.config.get('OLLAMA_URL')}/api/chat`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: this.config.get('OLLAMA_MODEL') || 'qwen3.5:2b', stream: false, think: false,
            options: { temperature: 0.2, num_predict: maxTokens }, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }),
          signal: AbortSignal.timeout(90_000),
        });
        if (!r.ok) throw new Error(`Ollama ${r.status}`);
        const j: any = await r.json();
        return String(j?.message?.content || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim() || null;
      }
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': String(this.config.get('ANTHROPIC_API_KEY')), 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: this.config.get('ANTHROPIC_MODEL') || 'claude-haiku-5-5', max_tokens: maxTokens, temperature: 0.2, system, messages: [{ role: 'user', content: user }] }),
        signal: AbortSignal.timeout(60_000),
      });
      if (!r.ok) throw new Error(`Anthropic ${r.status}`);
      const j: any = await r.json();
      return (j?.content || []).map((c: any) => c.text || '').join('').trim() || null;
    } catch (e: any) {
      this.logger.warn(`Modelo no disponible: ${e.message}`);
      return null;
    }
  }

  /** Quita datos identificatorios antes de enviar texto a un modelo externo */
  private anonimizar(texto: string, p: any) {
    let t = texto;
    for (const v of [p.first_name, p.last_name, p.dni, p.cuil, p.phone, p.email, p.address, p.insurance_number].filter((x) => x && String(x).length > 2)) {
      t = t.split(String(v)).join('[dato]');
    }
    return t.replace(/\b\d{7,11}\b/g, '[número]').replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[email]');
  }

  private async datosPaciente(orgId: string, patientId: string) {
    const p = await this.db.queryOne(`SELECT * FROM patients WHERE id = $1 AND organization_id = $2`, [patientId, orgId]);
    if (!p) throw new NotFoundException('Paciente no encontrado');
    const [consultas, recetas, docs, turnos] = await Promise.all([
      this.db.queryMany(
        `SELECT to_char(date,'YYYY-MM-DD') AS fecha, chief_complaint, diagnosis, diagnosis_code, treatment_plan, instructions, follow_up, vital_signs,
                allergies, current_medications, personal_history, family_history, habits, lab_orders, imaging_orders, referrals
           FROM medical_records WHERE patient_id = $1 AND organization_id = $2 AND deleted_at IS NULL ORDER BY date DESC LIMIT 12`, [patientId, orgId]),
      this.db.queryMany(
        `SELECT to_char(rx.issued_at,'YYYY-MM-DD') AS fecha, rx.diagnosis, rx.status, rx.expires_at,
                (SELECT string_agg(COALESCE(i.generic_name, i.medication_name) || COALESCE(' ' || i.presentation, '') || ' — ' || i.dosage || ', ' || i.frequency || COALESCE(', ' || i.duration, ''), ' | ' ORDER BY i.sort_order)
                   FROM prescription_items i WHERE i.prescription_id = rx.id) AS meds
           FROM prescriptions rx WHERE rx.patient_id = $1 AND rx.organization_id = $2 ORDER BY rx.issued_at DESC LIMIT 10`, [patientId, orgId]),
      this.db.queryMany(
        `SELECT title, kind, to_char(COALESCE(study_date, created_at::date),'YYYY-MM-DD') AS fecha, left(body_text, 400) AS texto
           FROM patient_documents WHERE patient_id = $1 AND organization_id = $2 AND deleted_at IS NULL ORDER BY COALESCE(study_date, created_at::date) DESC LIMIT 10`, [patientId, orgId]),
      this.db.queryOne(
        `SELECT COUNT(*) FILTER (WHERE status='completed')::int AS atendidos, COUNT(*) FILTER (WHERE status='no_show')::int AS ausentes,
                to_char(MAX(date) FILTER (WHERE status='completed'),'YYYY-MM-DD') AS ultima,
                to_char(MIN(date) FILTER (WHERE date >= (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date AND status IN ('confirmed','pending','pending_approval')),'YYYY-MM-DD') AS proximo
           FROM appointments WHERE patient_id = $1 AND organization_id = $2`, [patientId, orgId]),
    ]);
    return { p, consultas, recetas, docs, turnos };
  }

  private edad(f: any) {
    if (!f) return null;
    const d = new Date(f), h = new Date();
    let a = h.getFullYear() - d.getFullYear();
    if (h.getMonth() < d.getMonth() || (h.getMonth() === d.getMonth() && h.getDate() < d.getDate())) a--;
    return a >= 0 && a < 130 ? a : null;
  }

  private lista(x: any): string[] {
    return (Array.isArray(x) ? x : String(x || '').split(/[,;\n]/)).map((y: any) => String(y).trim()).filter(Boolean);
  }

  /** Datos importantes que faltan en la ficha */
  private faltantes(d: any) {
    const { p, consultas } = d, u = consultas[0] || {};
    const f: { campo: string; texto: string }[] = [];
    if (!String(p.dni || '').replace(/\D/g, '')) f.push({ campo: 'dni', texto: 'DNI (obligatorio para la receta electrónica)' });
    if (!p.gender || p.gender === 'unknown') f.push({ campo: 'sexo', texto: 'Sexo (para calcular el CUIL de la receta)' });
    if (!p.date_of_birth) f.push({ campo: 'nacimiento', texto: 'Fecha de nacimiento' });
    if (!this.lista(p.allergies).length && !this.lista(u.allergies).length) f.push({ campo: 'alergias', texto: 'Alergias: no hay registro (anotar "niega alergias" si corresponde)' });
    if (!this.lista(p.current_medications).length && !this.lista(u.current_medications).length) f.push({ campo: 'medicacion', texto: 'Medicación actual' });
    if (!p.personal_history && !u.personal_history) f.push({ campo: 'antecedentes', texto: 'Antecedentes personales' });
    const v = u.vital_signs || {};
    if (consultas.length && !(v.weight && v.height)) f.push({ campo: 'peso', texto: 'Peso y talla en la última consulta' });
    if (consultas.length && !(v.bloodPressure || v.blood_pressure)) f.push({ campo: 'ta', texto: 'Tensión arterial en la última consulta' });
    if (consultas.length && u.diagnosis && !u.diagnosis_code) f.push({ campo: 'cie10', texto: 'Código CIE-10 del último diagnóstico' });
    if (p.insurance_provider && !/particular|sin obra/i.test(p.insurance_provider) && !p.insurance_number) f.push({ campo: 'afiliado', texto: 'N° de afiliado de la obra social' });
    if (!p.emergency_contact_phone) f.push({ campo: 'emergencia', texto: 'Contacto de emergencia' });
    if (!p.phone) f.push({ campo: 'telefono', texto: 'Celular' });
    return f;
  }

  /** Resumen de la historia clínica para leer antes de atender */
  async resumen(orgId: string, doctorId: string, patientId: string) {
    const d = await this.datosPaciente(orgId, patientId);
    const { p, consultas, recetas, docs, turnos } = d, u = consultas[0] || {};
    const ed = this.edad(p.date_of_birth);
    const sexo = p.gender === 'male' ? 'masculino' : p.gender === 'female' ? 'femenino' : '';
    const alergias = [...new Set([...this.lista(p.allergies), ...this.lista(u.allergies)])];
    const problemas = this.lista(p.chronic_conditions);
    const meds = [...new Set([...this.lista(p.current_medications), ...this.lista(u.current_medications)])];
    const v = u.vital_signs || {};
    const puntos: string[] = [];
    puntos.push(`${ed != null ? ed + ' años' : 'Edad sin dato'}${sexo ? ', sexo ' + sexo : ''}${p.insurance_provider ? ', ' + p.insurance_provider : ''}.`);
    puntos.push(alergias.length ? `⚠️ Alergias: ${alergias.join(', ')}.` : 'Alergias: sin registro.');
    if (problemas.length) puntos.push(`Problemas activos: ${problemas.join(', ')}.`);
    if (meds.length) puntos.push(`Medicación actual: ${meds.join(', ')}.`);
    const ant = [p.personal_history || u.personal_history, p.surgical_history ? 'Quirúrgicos: ' + p.surgical_history : '', p.family_history || u.family_history ? 'Familiares: ' + (p.family_history || u.family_history) : '', p.habits || u.habits ? 'Hábitos: ' + (p.habits || u.habits) : ''].filter(Boolean);
    if (ant.length) puntos.push(`Antecedentes: ${ant.join('. ')}.`);
    if (consultas.length) {
      puntos.push(`Últimas consultas: ${consultas.slice(0, 4).map((c: any) => `${c.fecha.split('-').reverse().join('/')} ${c.diagnosis || c.chief_complaint || 'consulta'}${c.diagnosis_code ? ' (' + c.diagnosis_code + ')' : ''}`).join('; ')}.`);
      if (u.treatment_plan || u.follow_up) puntos.push(`Plan vigente: ${[u.treatment_plan, u.follow_up].filter(Boolean).join('. ')}.`);
      const pend = [...this.lista(u.lab_orders), ...this.lista(u.imaging_orders)];
      if (pend.length) puntos.push(`Estudios pedidos en la última consulta: ${pend.join(', ')}.`);
      const ref = this.lista(u.referrals);
      if (ref.length) puntos.push(`Derivaciones: ${ref.join(', ')}.`);
    } else puntos.push('Sin consultas registradas.');
    const vit = [v.bloodPressure || v.blood_pressure ? 'TA ' + (v.bloodPressure || v.blood_pressure) : '', v.heartRate || v.heart_rate ? 'FC ' + (v.heartRate || v.heart_rate) : '', v.weight ? v.weight + ' kg' : '', v.weight && v.height ? 'IMC ' + (v.weight / ((v.height / 100) ** 2)).toFixed(1) : ''].filter(Boolean);
    if (vit.length) puntos.push(`Últimos signos vitales (${u.fecha.split('-').reverse().join('/')}): ${vit.join(', ')}.`);
    const vigentes = recetas.filter((r: any) => r.status !== 'cancelled' && new Date(r.expires_at) > new Date());
    if (recetas.length) puntos.push(`Recetas: ${recetas.length} emitidas${vigentes.length ? ', ' + vigentes.length + ' vigentes' : ''}. Última (${recetas[0].fecha.split('-').reverse().join('/')}): ${recetas[0].meds || recetas[0].diagnosis || ''}.`);
    if (docs.length) puntos.push(`Estudios y documentos: ${docs.slice(0, 5).map((x: any) => `${x.title} (${x.fecha.split('-').reverse().join('/')})`).join(', ')}.`);
    if (turnos) puntos.push(`Turnos: ${turnos.atendidos || 0} atendidos${turnos.ausentes ? ', ' + turnos.ausentes + ' ausencias' : ''}${turnos.proximo ? ', próximo ' + turnos.proximo.split('-').reverse().join('/') : ''}.`);

    const faltan = this.faltantes(d);
    let narrativo: string | null = null;
    const base = puntos.join('\n');
    if (this.proveedor) {
      const texto = this.proveedor === 'anthropic' ? this.anonimizar(base, p) : base;
      narrativo = await this.llm(
        'Sos un asistente para médicos en Argentina. Redactá un resumen clínico breve (máximo 120 palabras), en español rioplatense profesional, a partir SOLO de los datos dados. No inventes datos, no sugieras diagnósticos ni tratamientos nuevos. Destacá alergias, problemas activos, medicación y pendientes. Texto plano, sin títulos.',
        texto, 400,
      );
    }
    await this.auditar(orgId, doctorId, patientId, 'resumen', base.length, (narrativo || base).length);
    return { puntos, narrativo, faltantes: faltan, fuente: narrativo ? this.proveedor : 'reglas', aviso: 'Borrador generado a partir de la ficha. Revisalo antes de usarlo.' };
  }

  /** Indicaciones claras para el paciente, a partir de la consulta y la receta asociada */
  async indicaciones(orgId: string, doctorId: string, recordId: string) {
    const r = await this.db.queryOne(
      `SELECT mr.*, p.first_name, p.last_name, p.dni, p.phone, p.email, p.cuil, p.address, p.insurance_number
         FROM medical_records mr JOIN patients p ON p.id = mr.patient_id
        WHERE mr.id = $1 AND mr.organization_id = $2 AND mr.deleted_at IS NULL`,
      [recordId, orgId],
    );
    if (!r) throw new NotFoundException('Consulta no encontrada');
    const meds = await this.db.queryMany(
      `SELECT COALESCE(i.generic_name, i.medication_name) AS gen, i.medication_name, i.presentation, i.dosage, i.frequency, i.duration, i.instructions
         FROM prescription_items i JOIN prescriptions rx ON rx.id = i.prescription_id
        WHERE rx.medical_record_id = $1 AND rx.status <> 'cancelled' ORDER BY rx.issued_at, i.sort_order`,
      [recordId],
    );
    const l: string[] = [];
    l.push(`Hola ${r.first_name || ''}, estas son las indicaciones de tu consulta del ${new Date(r.date).toLocaleDateString('es-AR')}:`);
    if (r.diagnosis) l.push(`\n• Diagnóstico: ${r.diagnosis}.`);
    if (meds.length) {
      l.push('\n💊 Medicación:');
      for (const m of meds) {
        const marca = m.medication_name && m.medication_name !== m.gen ? ` (${m.medication_name})` : '';
        l.push(`• ${m.gen}${marca}${m.presentation ? ' ' + m.presentation : ''}: ${String(m.dosage || '').toLowerCase()} ${String(m.frequency || '').toLowerCase()}${m.duration ? ', durante ' + String(m.duration).toLowerCase() : ''}.${m.instructions ? ' ' + m.instructions + '.' : ''}`.replace(/\s+/g, ' ').replace(/\.\./g, '.'));
      }
    }
    if (r.instructions) l.push(`\n📋 Indicaciones:\n${String(r.instructions).split(/\n|;\s*/).filter(Boolean).map((x: string) => '• ' + x.trim()).join('\n')}`);
    if (r.treatment_plan && r.treatment_plan !== r.instructions) l.push(`\n🩺 Plan: ${r.treatment_plan}`);
    const est = [...this.lista(r.lab_orders), ...this.lista(r.imaging_orders)];
    if (est.length) l.push(`\n🧪 Estudios a realizar: ${est.join(', ')}.`);
    const der = this.lista(r.referrals);
    if (der.length) l.push(`\n👩‍⚕️ Derivación: ${der.join(', ')}.`);
    if (r.follow_up) l.push(`\n📅 Control: ${r.follow_up}`);
    l.push('\nSi tenés fiebre alta, dificultad para respirar, dolor intenso o empeorás, consultá de inmediato o andá a la guardia.');
    let texto = l.join('\n');
    let fuente = 'reglas';
    if (this.proveedor) {
      const entrada = this.proveedor === 'anthropic' ? this.anonimizar(texto, r) : texto;
      const out = await this.llm(
        'Reescribí estas indicaciones médicas para que un paciente argentino las entienda fácil: tuteo rioplatense, frases cortas, viñetas, sin tecnicismos. Mantené EXACTAMENTE los medicamentos, dosis, frecuencias, duraciones y estudios; no agregues ni quites indicaciones médicas. Conservá el saludo y el aviso final de guardia.',
        entrada, 700,
      );
      if (out) { texto = this.proveedor === 'anthropic' ? out.split('[dato]').join(r.first_name || '') : out; fuente = this.proveedor; }
    }
    await this.auditar(orgId, doctorId, r.patient_id, 'indicaciones', l.join('\n').length, texto.length);
    return { texto, fuente, aviso: 'Revisá el texto antes de enviarlo al paciente.' };
  }

  /** Ordena un dictado en los campos de la historia clínica */
  async ordenarDictado(orgId: string, doctorId: string, texto: string, patientId?: string) {
    const t = String(texto || '').trim();
    if (t.length < 10) throw new BadRequestException('El dictado es muy corto');
    if (t.length > 15000) throw new BadRequestException('El dictado es demasiado largo');
    const campos = this.porPalabrasClave(t);
    let fuente = 'reglas';
    if (this.proveedor) {
      const out = await this.llm(
        `Convertí el dictado de un médico en campos de historia clínica. Respondé SOLO un JSON con estas claves (omití las que no se mencionan, no inventes nada):
chiefComplaint (motivo de consulta), presentIllness (enfermedad actual), personalHistory, familyHistory, currentMedications, allergies, habits,
physicalExamExtra (examen físico), findings, diagnosis, treatmentPlan, instructions, followUp, labOrders, imagingOrders, referrals,
bloodPressure (ej "120/80"), heartRate, temperature, respiratoryRate, spO2, weight, height (números como texto).`,
        this.proveedor === 'anthropic' ? t.replace(/\b\d{7,11}\b/g, '[número]') : t, 900,
      );
      const m = out && out.match(/\{[\s\S]*\}/);
      if (m) {
        try {
          const j = JSON.parse(m[0]);
          for (const [k, v] of Object.entries(j)) if (CAMPOS.includes(k) && v != null && String(v).trim()) campos[k] = String(v).trim();
          fuente = this.proveedor;
        } catch { /* se queda con las palabras clave */ }
      }
    }
    await this.auditar(orgId, doctorId, patientId || null, 'dictado', t.length, JSON.stringify(campos).length);
    return { campos, fuente, aviso: 'Revisá cada campo: el dictado se ordenó automáticamente.' };
  }

  /** "Motivo de consulta: … Examen físico: … Diagnóstico: … Plan: …" → campos */
  private porPalabrasClave(t: string): Record<string, string> {
    const claves: [RegExp, string][] = [
      [/motivo(?: de (?:la )?consulta)?/, 'chiefComplaint'], [/enfermedad actual|cuadro actual|refiere/, 'presentIllness'],
      [/antecedentes? (?:personales|patol[oó]gicos)/, 'personalHistory'], [/antecedentes? familiares/, 'familyHistory'],
      [/medicaci[oó]n(?: habitual| actual)?/, 'currentMedications'], [/alergias?/, 'allergies'], [/h[aá]bitos/, 'habits'],
      [/examen(?: f[ií]sico)?/, 'physicalExamExtra'], [/hallazgos/, 'findings'], [/diagn[oó]stico|impresi[oó]n diagn[oó]stica/, 'diagnosis'],
      [/plan(?: de tratamiento)?|tratamiento/, 'treatmentPlan'], [/indicaciones/, 'instructions'], [/seguimiento|control(?: en)?/, 'followUp'],
      [/laboratorio|an[aá]lisis/, 'labOrders'], [/im[aá]genes|radiograf[ií]a|ecograf[ií]a/, 'imagingOrders'], [/derivaci[oó]n|derivo a/, 'referrals'],
    ];
    const re = new RegExp(`(?:^|[.\\n;]\\s*)(${claves.map(([r]) => r.source).join('|')})\\s*[:,-]?\\s*`, 'gi');
    const out: Record<string, string> = {};
    const marcas: { i: number; fin: number; campo: string }[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(t))) {
      const k = m[1].toLowerCase();
      const c = claves.find(([r]) => new RegExp(`^(?:${r.source})$`, 'i').test(k));
      if (c) marcas.push({ i: m.index, fin: m.index + m[0].length, campo: c[1] });
    }
    if (!marcas.length) return { presentIllness: t };
    if (marcas[0].i > 0) { const pre = t.slice(0, marcas[0].i).trim(); if (pre) out.presentIllness = pre; }
    marcas.forEach((mk, j) => {
      const val = t.slice(mk.fin, j + 1 < marcas.length ? marcas[j + 1].i : t.length).trim().replace(/^[.,;:\s]+|[.;,\s]+$/g, '');
      if (val) out[mk.campo] = out[mk.campo] ? out[mk.campo] + '. ' + val : val;
    });
    // Signos vitales dichos en el texto
    const ta = t.match(/(?:tensi[oó]n|presi[oó]n|TA)\s*(?:arterial)?\s*(?:de\s*)?(\d{2,3})\s*(?:\/|sobre|con)\s*(\d{2,3})/i); if (ta) out.bloodPressure = `${ta[1]}/${ta[2]}`;
    const fc = t.match(/(?:frecuencia card[ií]aca|FC|pulso)\s*(?:de\s*)?(\d{2,3})/i); if (fc) out.heartRate = fc[1];
    const tp = t.match(/(?:temperatura|temp)\s*(?:de\s*)?(\d{2}(?:[.,]\d)?)/i); if (tp) out.temperature = tp[1].replace(',', '.');
    const sat = t.match(/(?:saturaci[oó]n|SpO2|sat)\s*(?:de\s*)?(\d{2,3})/i); if (sat) out.spO2 = sat[1];
    const pe = t.match(/(?:pesa|peso)\s*(?:de\s*)?(\d{2,3}(?:[.,]\d)?)\s*(?:kg|kilos)?/i); if (pe) out.weight = pe[1].replace(',', '.');
    const ta2 = t.match(/(?:mide|talla|altura)\s*(?:de\s*)?(\d{3}|1[.,]\d{2})\s*(?:cm|metros?|m)?/i); if (ta2) out.height = /[.,]/.test(ta2[1]) ? String(Math.round(parseFloat(ta2[1].replace(',', '.')) * 100)) : ta2[1];
    return out;
  }
}

const CAMPOS = ['chiefComplaint', 'presentIllness', 'personalHistory', 'familyHistory', 'currentMedications', 'allergies', 'habits', 'physicalExamExtra', 'findings',
  'diagnosis', 'treatmentPlan', 'instructions', 'followUp', 'labOrders', 'imagingOrders', 'referrals', 'bloodPressure', 'heartRate', 'temperature', 'respiratoryRate', 'spO2', 'weight', 'height'];
