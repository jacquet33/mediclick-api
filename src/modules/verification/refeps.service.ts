import { createHmac } from 'crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface RefepsResultado {
  consultado: boolean;          // false si no hay credenciales SISA configuradas
  encontrado: boolean;
  esMedico: boolean;
  matriculaVigente: boolean;
  coincideMatricula: boolean;
  nombre?: string;
  matriculas?: { matricula: string; profesion: string; jurisdiccion: string; vigente: boolean; estado: string }[];
  raw?: any;
  error?: string;
}

/**
 * Consulta nominal de profesionales en REFEPS (SISA, Ministerio de Salud de la Nación).
 * WS020: https://sisa.msal.gov.ar/sisa/services/rest/profesional/obtener  (usuario, clave, nrodoc)
 * Requiere una cuenta SISA con permiso al web service: SISA_USUARIO / SISA_CLAVE.
 */
@Injectable()
export class RefepsService {
  private readonly logger = new Logger(RefepsService.name);
  constructor(private config: ConfigService) {}

  /** Bus de interoperabilidad (FHIR Practitioner) con la secret word del dominio */
  get busDisponible() {
    return !!this.config.get('BUS_FHIR_SECRET');
  }
  get disponible() {
    return this.busDisponible || !!(this.config.get('SISA_USUARIO') && this.config.get('SISA_CLAVE'));
  }

  private token: { valor: string; vence: number } | null = null;
  private get busUrl() { return (this.config.get<string>('BUS_URL') || 'https://bus.msal.gob.ar').replace(/\/$/, ''); }

  private async tokenFhir(forzar = false): Promise<string> {
    if (!forzar && this.token && this.token.vence > Date.now()) return this.token.valor;
    const b64 = (o: any) => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url');
    const n = Math.floor(Date.now() / 1000);
    const cuerpo = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({
      iss: this.config.get<string>('BUS_ISSUER') || 'https://tusrecetasmed.com',
      iat: n, exp: n + 3600, aud: 'aud', sub: 'sub', name: 'name', ident: 'ident', role: 'role',
    })}`;
    const firma = createHmac('sha256', this.config.get<string>('BUS_FHIR_SECRET')!).update(cuerpo).digest('base64url');
    const r = await fetch(this.config.get<string>('BUS_FHIR_TOKEN_URL') || `${this.busUrl}/bus-auth/v2/auth`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ grantType: 'client_credentials', scope: 'Practitioner/*.read',
        clientAssertionType: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer', clientAssertion: `${cuerpo}.${firma}` }),
      signal: AbortSignal.timeout(20000),
    });
    const j: any = await r.json().catch(() => ({}));
    const t = j.accessToken || j.token;
    if (!r.ok || !t) throw new Error(`token FHIR ${r.status}`);
    this.token = { valor: t, vence: Date.now() + 30 * 60_000 };
    return t;
  }

  /** Practitioner por DNI: el servicio exige el sexo, así que se prueban los dos. */
  private async consultarBus(nrodoc: string, matricula?: string): Promise<RefepsResultado> {
    const base: RefepsResultado = { consultado: true, encontrado: false, esMedico: false, matriculaVigente: false, coincideMatricula: false };
    let p: any = null;
    let fallo: string | undefined;
    for (const gender of ['male', 'female']) {
      const url = `${this.busUrl}/fhir/Practitioner?identifier=${encodeURIComponent('https://www.renaper.org.ar/dni|' + nrodoc)}&gender=${gender}`;
      for (let intento = 0; intento < 2 && !p; intento++) {
        const r = await fetch(url, { headers: { Authorization: `Bearer ${await this.tokenFhir(intento > 0)}`, Accept: 'application/fhir+json' }, signal: AbortSignal.timeout(25000) });
        if (r.status === 401 && intento === 0) continue;
        const x: any = await r.json().catch(() => null);
        if (r.status === 404) break;
        if (!r.ok) { fallo = `HTTP ${r.status}`; break; }
        p = x?.resourceType === 'Bundle' ? x.entry?.find((e: any) => e?.resource?.resourceType === 'Practitioner')?.resource : x?.resourceType === 'Practitioner' ? x : null;
        break;
      }
      if (p) break;
    }
    if (!p) return fallo ? { ...base, error: fallo } : base;

    const ahora = Date.now();
    const texto = (cc: any) => cc?.text || (cc?.coding || []).map((c: any) => c.display || c.code).filter(Boolean).join(' ') || '';
    const matriculas = (p.qualification || []).map((q: any) => {
      const ext = (q.extension || []).map((e: any) => String(e.valueString || e.valueCode || texto(e.valueCodeableConcept) || '')).join(' ');
      const fin = q.period?.end ? Date.parse(q.period.end) : NaN;
      const estado = ext || (q.period?.end ? `hasta ${q.period.end}` : '');
      return {
        matricula: (q.identifier || []).map((i: any) => String(i.value || '')).filter(Boolean).join(' / '),
        profesion: texto(q.code),
        jurisdiccion: String(q.issuer?.display || q.issuer?.reference || ''),
        vigente: p.active !== false && !/baja|inhabilit|suspend|vencid|inactiv/i.test(ext) && (isNaN(fin) || fin > ahora),
        estado,
      };
    });
    const medicas = matriculas.filter((m: any) => /m[eé]dic/i.test(m.profesion));
    const limpia = (x: string) => x.replace(/\D/g, '');
    const coincide = !!matricula && medicas.some((m: any) => m.matricula.split(' / ').some((v: string) => limpia(v) === limpia(matricula)));
    const nom = (p.name || [])[0] || {};
    const nombre = nom.text || [(nom.family || ''), (nom.given || []).join(' ')].filter(Boolean).join(', ');
    this.logger.log(`REFEPS bus: ${matriculas.length} matrícula(s), ${medicas.length} médica(s), coincide=${coincide}`);
    return {
      consultado: true, encontrado: true, esMedico: medicas.length > 0,
      matriculaVigente: medicas.some((m: any) => m.vigente), coincideMatricula: coincide,
      nombre, matriculas, raw: { fuente: 'bus-fhir', nombre, matriculas },
    };
  }

  async consultar(dni: string, matricula?: string): Promise<RefepsResultado> {
    const vacio: RefepsResultado = { consultado: false, encontrado: false, esMedico: false, matriculaVigente: false, coincideMatricula: false };
    if (!this.disponible) return vacio;
    if (this.busDisponible) {
      try { return await this.consultarBus((dni || '').replace(/\D/g, ''), matricula); }
      catch (e: any) { this.logger.warn(`REFEPS bus: ${e.message}`); return { ...vacio, consultado: true, error: e.message }; }
    }
    const nrodoc = (dni || '').replace(/\D/g, '');
    const url = this.config.get('SISA_REFEPS_URL') || 'https://sisa.msal.gov.ar/sisa/services/rest/profesional/obtener';
    try {
      const qs = new URLSearchParams({ nrodoc });
      const r = await fetch(`${url}?${qs}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ usuario: this.config.get('SISA_USUARIO'), clave: this.config.get('SISA_CLAVE'), nrodoc }),
        signal: AbortSignal.timeout(15000),
      });
      const data: any = await r.json().catch(() => null);
      const p = data?.Profesional || data?.profesional || data;
      const resultado = String(p?.resultado || '').toUpperCase();
      if (resultado !== 'OK') return { ...vacio, consultado: true, error: resultado || `HTTP ${r.status}`, raw: data };

      const lista = [].concat(p?.matriculas?.matricula || p?.matriculas || []).filter(Boolean) as any[];
      const matriculas = lista.map((m) => ({
        matricula: String(m.matricula ?? ''),
        profesion: String(m.profesion ?? ''),
        jurisdiccion: String(m.jurisdiccion ?? ''),
        vigente: m.vigente === true || String(m.vigente).toUpperCase() === 'SI' || String(m.estado || '').toUpperCase().includes('HABILITADO'),
        estado: String(m.estado ?? ''),
      }));
      const medicas = matriculas.filter((m) => /m[eé]dic/i.test(m.profesion));
      const limpia = (x: string) => x.replace(/\D/g, '');
      const coincide = !!matricula && medicas.some((m) => limpia(m.matricula) === limpia(matricula));
      return {
        consultado: true,
        encontrado: true,
        esMedico: medicas.length > 0,
        matriculaVigente: medicas.some((m) => m.vigente),
        coincideMatricula: coincide,
        nombre: [p?.apellido, p?.nombre].filter(Boolean).join(', '),
        matriculas,
        raw: { apellido: p?.apellido, nombre: p?.nombre, numeroDocumento: p?.numeroDocumento, matriculas },
      };
    } catch (e) {
      this.logger.warn(`REFEPS: ${e.message}`);
      return { ...vacio, consultado: true, error: e.message };
    }
  }
}
