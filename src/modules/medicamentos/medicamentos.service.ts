import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '../../database/database.service';

/** Sin tildes y en minúscula (igual que unaccent_simple en la base) */
export function normalizar(t: string): string {
  return String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
}

/** Forma farmacéutica a partir de la presentación de PAMI/Alfabeta ("16 mg comp.x 30" → Comprimidos) */
export function formaDe(presentacion: string): string {
  const p = normalizar(presentacion);
  const reglas: [RegExp, string][] = [
    [/comp\.?\s*rec|comp\.rec|recub/, 'Comprimidos recubiertos'],
    [/comp\.?\s*(disp|bucodisp|sublin|mast)/, 'Comprimidos dispersables'],
    [/comp\.?\s*(lib|ret|ap\b|prol)|liberacion/, 'Comprimidos de liberación prolongada'],
    [/comp|tab\b|grag/, 'Comprimidos'],
    [/caps|cap\.|capsul/, 'Cápsulas'],
    [/jbe|jarabe/, 'Jarabe'],
    [/susp/, 'Suspensión oral'],
    [/gts|gotas/, 'Gotas'],
    [/colir|sol\.?\s*oft|oftalm/, 'Colirio'],
    [/amp|iny|vial|f\.a\.|jga\.?prell|jer\.?prell|prellen/, 'Solución inyectable'],
    [/crema/, 'Crema'], [/gel/, 'Gel'], [/pom|unguento/, 'Pomada'], [/loc/, 'Loción'],
    [/aer|inhal|puff/, 'Aerosol para inhalar'], [/spray|nebuliz/, 'Spray'],
    [/sob|polvo/, 'Sobres'], [/ovul/, 'Óvulos'], [/supos/, 'Supositorios'], [/parch/, 'Parches'],
    [/sol\b|solucion|sol\.|liq/, 'Solución'],
  ];
  for (const [re, f] of reglas) if (re.test(p)) return f;
  return '';
}

/** CSV con comillas, detectando el separador */
function parsearCsv(texto: string): string[][] {
  const primera = texto.slice(0, texto.indexOf('\n') > 0 ? texto.indexOf('\n') : texto.length);
  const sep = [';', ',', '\t'].sort((a, b) => primera.split(b).length - primera.split(a).length)[0];
  const filas: string[][] = []; let fila: string[] = []; let campo = ''; let comillas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (comillas) {
      if (c === '"') { if (texto[i + 1] === '"') { campo += '"'; i++; } else comillas = false; } else campo += c;
    } else if (c === '"') comillas = true;
    else if (c === sep) { fila.push(campo); campo = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && texto[i + 1] === '\n') i++; fila.push(campo); campo = ''; if (fila.some((x) => x.trim())) filas.push(fila); fila = []; }
    else campo += c;
  }
  if (campo || fila.length) { fila.push(campo); if (fila.some((x) => x.trim())) filas.push(fila); }
  return filas;
}

const DATASET = 'pami-listado-precios-medicamentos-para-entidades';

/**
 * Catálogo de medicamentos: se descarga del listado oficial que PAMI publica en datos.gob.ar
 * (≈8.700 presentaciones con código Alfabeta) y se actualiza solo una vez por semana.
 */
@Injectable()
export class MedicamentosService implements OnModuleInit {
  private readonly logger = new Logger('Medicamentos');
  private importando = false;
  constructor(private db: DatabaseService, private config: ConfigService) {}

  onModuleInit() {
    if (this.config.get('MEDICAMENTOS_AUTO') === 'false') return;
    // Al arrancar (si está vacío o tiene más de 7 días) y después cada 12 h se fija si hay que actualizar
    setTimeout(() => this.db.conBloqueo('tarea:catalogo-medicamentos', () => this.actualizarSiHaceFalta()).catch(() => {}), 20_000);
    setInterval(() => this.db.conBloqueo('tarea:catalogo-medicamentos', () => this.actualizarSiHaceFalta()).catch(() => {}), 12 * 3600_000).unref();
  }

  async estado() {
    const r = await this.db.queryOne<any>(
      `SELECT count(*) FILTER (WHERE activo)::int AS presentaciones, count(DISTINCT droga) FILTER (WHERE activo)::int AS drogas,
              count(DISTINCT marca) FILTER (WHERE activo)::int AS marcas, max(actualizado_at) AS actualizado
         FROM medicamentos`);
    return { ...r, fuente: 'Listado oficial de medicamentos de PAMI (datos.gob.ar)' };
  }

  async actualizarSiHaceFalta() {
    const e = await this.estado().catch(() => null);
    if (e && e.presentaciones > 0 && e.actualizado && Date.now() - new Date(e.actualizado).getTime() < 7 * 86400_000) return;
    await this.importar();
  }

  /** Descarga el CSV más reciente del dataset de PAMI y actualiza el catálogo */
  async importar(): Promise<{ filas: number; activos: number }> {
    if (this.importando) return { filas: 0, activos: 0 };
    this.importando = true;
    try {
      const pkg: any = await (await fetch(`https://datos.gob.ar/api/3/action/package_show?id=${DATASET}`, { signal: AbortSignal.timeout(60_000) })).json();
      const recursos = (pkg?.result?.resources || []).filter((r: any) => String(r.format).toUpperCase() === 'CSV');
      recursos.sort((a: any, b: any) => String(b.last_modified || b.created).localeCompare(String(a.last_modified || a.created)));
      const url = recursos[0]?.url;
      if (!url) throw new Error('No se encontró el CSV en datos.gob.ar');
      const buf = Buffer.from(await (await fetch(url, { signal: AbortSignal.timeout(180_000) })).arrayBuffer());
      let texto = buf.toString('utf8');
      if (texto.includes('�')) texto = buf.toString('latin1');
      texto = texto.replace(/^﻿/, '');
      const filas = parsearCsv(texto);
      const cab = filas.shift()?.map((c) => normalizar(c)) || [];
      const col = (re: RegExp) => cab.findIndex((c) => re.test(c));
      const iA = col(/alfabeta/), iD = col(/principio|droga/), iM = col(/marca/), iP = col(/presentacion/), iL = col(/laboratorio/), iC = col(/cobertura/);
      if ([iA, iD, iM, iP].some((i) => i < 0)) throw new Error(`Columnas inesperadas: ${cab.join(' | ')}`);
      const datos = filas
        .map((f) => ({ a: parseInt(String(f[iA]).replace(/\D/g, ''), 10), d: String(f[iD] || '').trim(), m: String(f[iM] || '').trim(), p: String(f[iP] || '').trim(), l: iL >= 0 ? String(f[iL] || '').trim() : '', c: iC >= 0 ? String(f[iC] || '').trim() : '' }))
        .filter((x) => x.a > 0 && x.d && x.m && x.p);
      if (datos.length < 1000) throw new Error(`El listado vino incompleto (${datos.length} filas)`);
      const inicio = new Date();
      for (let i = 0; i < datos.length; i += 500) {
        const lote = datos.slice(i, i + 500);
        const vals: any[] = [];
        const ph = lote.map((x, j) => {
          vals.push(x.a, x.d, x.m, x.p, formaDe(x.p), x.l || null, x.c || null, normalizar(`${x.m} ${x.d}`));
          const b = j * 8;
          return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8},true,now())`;
        }).join(',');
        await this.db.query(
          `INSERT INTO medicamentos (alfabeta, droga, marca, presentacion, forma, laboratorio, cobertura_pami, busqueda, activo, actualizado_at)
           VALUES ${ph}
           ON CONFLICT (alfabeta) DO UPDATE SET droga = EXCLUDED.droga, marca = EXCLUDED.marca, presentacion = EXCLUDED.presentacion,
             forma = EXCLUDED.forma, laboratorio = EXCLUDED.laboratorio, cobertura_pami = EXCLUDED.cobertura_pami,
             busqueda = EXCLUDED.busqueda, activo = true, actualizado_at = now()`, vals);
      }
      // Lo que ya no está en el listado queda inactivo (no se borra: puede estar en recetas viejas)
      await this.db.query(`UPDATE medicamentos SET activo = false WHERE actualizado_at < $1`, [inicio]);
      this.logger.log(`Catálogo de medicamentos actualizado: ${datos.length} presentaciones`);
      return { filas: datos.length, activos: datos.length };
    } catch (e: any) {
      this.logger.warn(`No se pudo actualizar el catálogo de medicamentos: ${e.message}`);
      throw e;
    } finally {
      this.importando = false;
    }
  }

  /**
   * Búsqueda por marca o droga. Devuelve una fila por marca (con su droga y laboratorio) y,
   * cuando coincide la droga, también la opción de recetar por nombre genérico.
   */
  async buscar(q: string, limite = 30) {
    const n = normalizar(q).replace(/[%_]/g, '');
    if (n.length < 2) return { genericos: [], marcas: [] };
    const palabras = n.split(' ').filter(Boolean).slice(0, 4);
    const cond = palabras.map((_, i) => `busqueda LIKE $${i + 1}`).join(' AND ');
    const params = palabras.map((p) => `%${p}%`);
    const pre = `${n}%`;
    params.push(pre);
    const marcas = await this.db.query<any>(
      `SELECT marca, droga, min(laboratorio) AS laboratorio, count(*)::int AS presentaciones, min(cobertura_pami) AS cobertura_pami
         FROM medicamentos WHERE activo AND ${cond}
        GROUP BY marca, droga
        ORDER BY (lower(unaccent_simple(marca)) LIKE $${params.length}) DESC, (lower(unaccent_simple(droga)) LIKE $${params.length}) DESC, marca
        LIMIT ${Math.min(Math.max(limite, 1), 60)}`, params);
    const genericos = await this.db.query<any>(
      `SELECT droga, count(DISTINCT marca)::int AS marcas, count(*)::int AS presentaciones
         FROM medicamentos WHERE activo AND lower(unaccent_simple(droga)) LIKE $1
        GROUP BY droga ORDER BY (lower(unaccent_simple(droga)) LIKE $2) DESC, length(droga), droga LIMIT 5`,
      [`%${n}%`, pre]);
    return { genericos: genericos.rows, marcas: marcas.rows };
  }

  /** Presentaciones de una marca (o de todas las marcas de una droga, para recetar por genérico) */
  async presentaciones(droga: string, marca?: string) {
    const r = await this.db.query<any>(
      `SELECT alfabeta, marca, droga, presentacion, forma, laboratorio, cobertura_pami
         FROM medicamentos WHERE activo AND droga = $1 AND ($2::text IS NULL OR marca = $2)
        ORDER BY marca, presentacion LIMIT 300`, [droga, marca || null]);
    if (marca) return r.rows;
    // Por genérico: presentaciones distintas (sin repetir la misma de varios laboratorios)
    const vistas = new Map<string, any>();
    for (const x of r.rows) {
      const k = normalizar(x.presentacion);
      if (!vistas.has(k)) vistas.set(k, { ...x, marca: null, laboratorios: 1 });
      else vistas.get(k).laboratorios++;
    }
    return [...vistas.values()].sort((a, b) => a.presentacion.localeCompare(b.presentacion, 'es', { numeric: true }));
  }
}
