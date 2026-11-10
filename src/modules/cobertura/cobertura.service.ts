import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '../../database/database.service';

export interface CoberturaPadron {
  nombre: string;          // denominación de la obra social
  rnos: string | null;     // código del Registro Nacional de Obras Sociales
  tipo: string | null;     // tipo de cobertura (obra social nacional, provincial, PAMI…)
  origen: string | null;   // PUCO | SSSALUD
  vigenciaDesde: string | null;
  actualizado: string | null;
}

export interface ResultadoCobertura {
  estado: 'ok' | 'sin_cobertura' | 'no_encontrado' | 'multiple' | 'no_configurado' | 'error';
  mensaje: string;
  coberturas: CoberturaPadron[];
  persona?: { apellido?: string; nombre?: string };
  fuente: string;
  consultadoAt: string;
  enCache?: boolean;
}

/** Valor de una etiqueta XML o de una clave JSON (el servicio puede responder en cualquiera de los dos) */
function campo(bloque: string, nombre: string): string | null {
  const x = bloque.match(new RegExp(`<${nombre}>([^<]*)</${nombre}>`, 'i'));
  if (x) return x[1].trim() || null;
  const j = bloque.match(new RegExp(`"${nombre}"\\s*:\\s*"([^"]*)"`, 'i'));
  return j ? j[1].trim() || null : null;
}

/**
 * Validación de cobertura contra el padrón oficial: SISA WS042 (Consulta general de ciudadano,
 * Ministerio de Salud). Devuelve las obras sociales del DNI según PUCO y la Superintendencia de Servicios de Salud.
 * Requiere una cuenta SISA con acceso al web service (SISA_USUARIO / SISA_CLAVE), la misma que usa REFEPS.
 * Las prepagas sin derivación de aportes no figuran en el padrón: se cargan a mano.
 */
@Injectable()
export class CoberturaService {
  private readonly logger = new Logger('Cobertura');
  constructor(private db: DatabaseService, private config: ConfigService) {}

  get disponible(): boolean {
    return !!(this.config.get('SISA_USUARIO') && this.config.get('SISA_CLAVE'));
  }

  async consultar(dniRaw: string, sexoRaw?: string, usuarioId?: string, patientId?: string, orgId?: string): Promise<ResultadoCobertura> {
    const dni = String(dniRaw || '').replace(/\D/g, '');
    if (dni.length < 6 || dni.length > 9) throw new BadRequestException('Ingresá un DNI válido, sin puntos');
    const sexo = /^[fm]/i.test(String(sexoRaw || '')) ? String(sexoRaw)[0].toUpperCase() : undefined;
    const ahora = new Date().toISOString();
    if (!this.disponible) {
      return { estado: 'no_configurado', coberturas: [], fuente: 'SISA – Ministerio de Salud', consultadoAt: ahora,
        mensaje: 'La validación automática se activa cuando se cargue la cuenta SISA del consultorio. Mientras tanto podés consultar en la Superintendencia de Servicios de Salud.' };
    }
    // Caché de 24 h: el padrón se actualiza una vez por mes y el servicio tiene cupo diario
    const cache = await this.db.queryOne<{ resultado: ResultadoCobertura }>(
      `SELECT resultado FROM cobertura_consultas WHERE dni = $1 AND COALESCE(sexo, '') = COALESCE($2, '') AND created_at > now() - interval '24 hours'
        AND resultado->>'estado' IN ('ok','sin_cobertura','no_encontrado') ORDER BY created_at DESC LIMIT 1`, [dni, sexo || null]);
    let res: ResultadoCobertura;
    if (cache) res = { ...cache.resultado, enCache: true };
    else {
      res = await this.consultarSisa(dni, sexo);
      await this.db.query(`INSERT INTO cobertura_consultas (dni, sexo, resultado, consultado_por) VALUES ($1, $2, $3, $4)`,
        [dni, sexo || null, JSON.stringify(res), usuarioId || null]).catch(() => undefined);
    }
    if (patientId && orgId && (res.estado === 'ok' || res.estado === 'sin_cobertura')) {
      await this.db.query(`UPDATE patients SET cobertura_verificada_at = now() WHERE id = $1 AND organization_id = $2`, [patientId, orgId]).catch(() => undefined);
    }
    return res;
  }

  private async consultarSisa(dni: string, sexo?: string): Promise<ResultadoCobertura> {
    const base = this.config.get<string>('SISA_CIUDADANO_URL') || 'https://sisa.msal.gov.ar/sisa/services/rest/cmdb/obtener';
    const q = new URLSearchParams({ usuario: this.config.get<string>('SISA_USUARIO')!, clave: this.config.get<string>('SISA_CLAVE')!, nrodoc: dni });
    if (sexo) q.set('sexo', sexo);
    const fuente = 'Padrón oficial (SISA: PUCO y SSSalud)';
    const consultadoAt = new Date().toISOString();
    try {
      const r = await fetch(`${base}?${q}`, { headers: { Accept: 'application/json, application/xml' }, signal: AbortSignal.timeout(20_000) });
      const t = await r.text();
      const resultado = (campo(t, 'resultado') || '').toUpperCase();
      if (resultado === 'MULTIPLE_RESULTADO') return { estado: 'multiple', coberturas: [], fuente, consultadoAt, mensaje: 'Hay más de una persona con ese DNI: indicá el sexo del paciente.' };
      if (resultado === 'REGISTRO_NO_ENCONTRADO') return { estado: 'no_encontrado', coberturas: [], fuente, consultadoAt, mensaje: 'No encontramos ese DNI en el padrón.' };
      if (resultado !== 'OK') {
        this.logger.warn(`SISA WS042 respondió ${resultado || r.status}`);
        const m: Record<string, string> = {
          ERROR_AUTENTICACION: 'La cuenta SISA del consultorio fue rechazada. Revisá usuario, clave y el permiso al servicio de ciudadanos.',
          NO_TIENE_QUOTA_DISPONIBLE: 'Se agotó el cupo diario de consultas al padrón. Probá mañana.',
          SERVICIO_RENAPER_NO_DISPONIBLE: 'El padrón no está respondiendo en este momento. Probá en unos minutos.',
        };
        return { estado: 'error', coberturas: [], fuente, consultadoAt, mensaje: m[resultado] || 'El padrón no respondió. Probá en unos minutos.' };
      }
      // Cada cobertura viene en un bloque <cobertura>…</cobertura> (XML) o como objeto con nombreObraSocial (JSON)
      const bloques = t.match(/<cobertura>[\s\S]*?<\/cobertura>/gi) || t.match(/\{[^{}]*"nombreObraSocial"[^{}]*\}/gi) || [];
      const coberturas: CoberturaPadron[] = bloques.map((b) => ({
        nombre: campo(b, 'nombreObraSocial') || 'Obra social',
        rnos: campo(b, 'rnos'),
        tipo: campo(b, 'tipoCobertura'),
        origen: campo(b, 'origen'),
        vigenciaDesde: campo(b, 'vigenciaDesde'),
        actualizado: campo(b, 'fechaActualizacion'),
      })).filter((c, i, a) => a.findIndex((x) => x.nombre === c.nombre && x.rnos === c.rnos) === i);
      const sinCob = coberturas.length === 0;
      return {
        estado: sinCob ? 'sin_cobertura' : 'ok', coberturas, fuente, consultadoAt,
        persona: { apellido: campo(t, 'apellido') || undefined, nombre: campo(t, 'nombre') || undefined },
        mensaje: sinCob ? 'Sin obra social en el padrón: puede ser particular o tener una prepaga sin derivación de aportes.'
          : `${coberturas.length} cobertura${coberturas.length === 1 ? '' : 's'} en el padrón.`,
      };
    } catch (e: any) {
      this.logger.warn(`SISA WS042 sin respuesta: ${e.message}`);
      return { estado: 'error', coberturas: [], fuente, consultadoAt, mensaje: 'El padrón no respondió. Probá en unos minutos.' };
    }
  }
}
