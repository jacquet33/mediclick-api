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

  get disponible() {
    return !!(this.config.get('SISA_USUARIO') && this.config.get('SISA_CLAVE'));
  }

  async consultar(dni: string, matricula?: string): Promise<RefepsResultado> {
    const vacio: RefepsResultado = { consultado: false, encontrado: false, esMedico: false, matriculaVigente: false, coincideMatricula: false };
    if (!this.disponible) return vacio;
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
