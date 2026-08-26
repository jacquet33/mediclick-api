import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';

export interface NomenclatorItemRow {
  code: string;
  description: string;
  specialty?: string;
  professionalUnits?: number;
  operativeUnits?: number;
  amount?: number;
  requiresAuthorization?: boolean;
  requiresDiagnosis?: boolean;
  maxPerPeriod?: number;
  periodDays?: number;
  minAge?: number;
  maxAge?: number;
  genderRestriction?: string;
  coinsurance?: number;
}

export interface CreateNomenclatorDto {
  name: string;
  insurerId?: string;
  organizationId?: string;
  source?: string;
  validFrom: string;
  validTo?: string;
  /** Valor del galeno/unidad para este período */
  unitValue?: number;
}

export interface ImportResult {
  nomenclatorId: string;
  inserted: number;
  updated: number;
  skipped: number;
  errors: Array<{ row: number; code: string; reason: string }>;
  warnings: string[];
}

@Injectable()
export class NomenclatorService {
  private readonly logger = new Logger(NomenclatorService.name);

  constructor(private db: DatabaseService) {}

  // ═══════════════════════════════════════════════════════════
  // ALTA Y VERSIONADO
  // ═══════════════════════════════════════════════════════════

  /**
   * Crea una versión del nomenclador.
   *
   * Los aranceles cambian seguido (a veces mensualmente), así que
   * cada actualización es una versión nueva con su vigencia. Al
   * facturar, se busca la versión que estaba vigente en la fecha
   * de la prestación — no la actual. Eso evita el error clásico de
   * refacturar meses viejos con valores nuevos y que te lo rechacen.
   */
  async create(dto: CreateNomenclatorDto) {
    if (!dto.insurerId && !dto.organizationId) {
      throw new BadRequestException('El nomenclador tiene que pertenecer a un financiador o a una organización');
    }

    // Cerrar la versión anterior si queda abierta
    if (dto.insurerId) {
      await this.db.query(
        `UPDATE nomenclators
         SET valid_to = ($1::date - INTERVAL '1 day')::date
         WHERE insurer_id = $2 AND valid_to IS NULL AND valid_from < $1::date`,
        [dto.validFrom, dto.insurerId],
      );
    }

    return this.db.queryOne(
      `INSERT INTO nomenclators
         (name, insurer_id, organization_id, source, valid_from, valid_to, unit_value)
       VALUES ($1,$2,$3,$4,$5::date,$6::date,$7)
       RETURNING *`,
      [
        dto.name, dto.insurerId ?? null, dto.organizationId ?? null,
        dto.source ?? 'convenio', dto.validFrom, dto.validTo ?? null,
        dto.unitValue ?? null,
      ],
    );
  }

  /**
   * Importa items. Idempotente por código: si el código ya está
   * en esa versión, actualiza el valor en vez de duplicar.
   */
  async importItems(nomenclatorId: string, rows: NomenclatorItemRow[]): Promise<ImportResult> {
    const nom = await this.db.queryOne(`SELECT * FROM nomenclators WHERE id = $1`, [nomenclatorId]);
    if (!nom) throw new NotFoundException('Nomenclador no encontrado');

    const result: ImportResult = {
      nomenclatorId, inserted: 0, updated: 0, skipped: 0, errors: [], warnings: [],
    };

    let noValue = 0;

    for (const [i, row] of rows.entries()) {
      const code = row.code?.trim();
      if (!code || !row.description?.trim()) {
        result.skipped++;
        continue;
      }

      // Un item sin valor ni unidades no se puede valorizar después
      if (row.amount == null && row.professionalUnits == null && row.operativeUnits == null) {
        noValue++;
      }

      try {
        const existing = await this.db.queryOne(
          `SELECT id FROM nomenclator_items WHERE nomenclator_id = $1 AND code = $2`,
          [nomenclatorId, code],
        );

        const params = [
          row.description.trim(), row.specialty ?? null,
          row.professionalUnits ?? null, row.operativeUnits ?? null, row.amount ?? null,
          row.requiresAuthorization ?? false, row.requiresDiagnosis ?? true,
          row.maxPerPeriod ?? null, row.periodDays ?? null,
          row.minAge ?? null, row.maxAge ?? null,
          row.genderRestriction ?? null, row.coinsurance ?? null,
        ];

        if (existing) {
          await this.db.query(
            `UPDATE nomenclator_items SET
               description=$1, specialty=$2, professional_units=$3, operative_units=$4,
               amount=$5, requires_authorization=$6, requires_diagnosis=$7,
               max_per_period=$8, period_days=$9, min_age=$10, max_age=$11,
               gender_restriction=$12, coinsurance=$13
             WHERE id=$14`,
            [...params, existing.id],
          );
          result.updated++;
        } else {
          await this.db.query(
            `INSERT INTO nomenclator_items
               (nomenclator_id, code, description, specialty, professional_units, operative_units,
                amount, requires_authorization, requires_diagnosis, max_per_period, period_days,
                min_age, max_age, gender_restriction, coinsurance)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
            [nomenclatorId, code, ...params],
          );
          result.inserted++;
        }
      } catch (err) {
        result.errors.push({ row: i + 1, code, reason: err.message });
      }
    }

    if (noValue > 0) {
      result.warnings.push(
        `${noValue} códigos quedaron sin valor ni unidades. No se van a poder valorizar al facturar.`,
      );
    }

    this.logger.log(
      `Nomenclador ${nomenclatorId}: ${result.inserted} nuevos, ${result.updated} actualizados`,
    );
    return result;
  }

  /**
   * Parsea la planilla del nomenclador.
   *
   * Los colegios y las obras sociales mandan Excel con columnas que
   * cambian de nombre entre uno y otro. Detectamos por aproximación
   * para no tener que pedirle al médico que reordene la planilla.
   */
  parseSheet(csv: string): NomenclatorItemRow[] {
    const lines = csv.split(/\r?\n/).filter(l => l.trim());
    if (lines.length < 2) return [];

    const sep = (lines[0].match(/;/g)?.length ?? 0) > (lines[0].match(/,/g)?.length ?? 0) ? ';' : ',';
    const header = this.splitLine(lines[0], sep).map(h => this.normalize(h));

    const col = {
      code: this.find(header, ['codigo', 'cod', 'practica', 'nomenclador']),
      desc: this.find(header, ['descripcion', 'detalle', 'denominacion', 'practicadescripcion', 'nombre']),
      spec: this.find(header, ['especialidad', 'capitulo', 'rubro']),
      profUnits: this.find(header, ['galenosprofesional', 'unidadesprofesional', 'ugp', 'honorarios', 'profesional']),
      opUnits: this.find(header, ['galenosoperativo', 'unidadesoperativa', 'ugo', 'gastos', 'operativo']),
      amount: this.find(header, ['importe', 'valor', 'monto', 'arancel', 'total']),
      auth: this.find(header, ['autorizacion', 'requiereautorizacion', 'autoriza']),
      coins: this.find(header, ['coseguro', 'copago', 'acargodelafiliado']),
    };

    if (col.code < 0 || col.desc < 0) {
      throw new BadRequestException(
        `No encuentro las columnas de código y descripción. Detecté: ${header.filter(Boolean).join(', ')}`,
      );
    }

    const rows: NomenclatorItemRow[] = [];

    for (let i = 1; i < lines.length; i++) {
      const c = this.splitLine(lines[i], sep);
      const code = c[col.code]?.trim();
      const description = c[col.desc]?.trim();
      if (!code || !description) continue;

      // Saltear filas de subtítulo (código no numérico y sin valores)
      if (!/\d/.test(code)) continue;

      rows.push({
        code,
        description,
        specialty: col.spec >= 0 ? c[col.spec]?.trim() || undefined : undefined,
        professionalUnits: this.parseNum(c[col.profUnits]),
        operativeUnits: this.parseNum(c[col.opUnits]),
        amount: this.parseNum(c[col.amount]),
        requiresAuthorization: col.auth >= 0 ? this.parseBool(c[col.auth]) : false,
        coinsurance: this.parseNum(c[col.coins]),
      });
    }

    return rows;
  }

  // ═══════════════════════════════════════════════════════════
  // CONSULTA
  // ═══════════════════════════════════════════════════════════

  /** Versión vigente en una fecha determinada */
  async findActiveVersion(insurerId: string, date: string, orgId?: string) {
    // El nomenclador propio de la organización tiene prioridad sobre el general
    if (orgId) {
      const own = await this.db.queryOne(
        `SELECT * FROM nomenclators
         WHERE organization_id = $1 AND insurer_id = $2 AND is_active
           AND valid_from <= $3::date
           AND (valid_to IS NULL OR valid_to >= $3::date)
         ORDER BY valid_from DESC LIMIT 1`,
        [orgId, insurerId, date],
      );
      if (own) return own;
    }

    return this.db.queryOne(
      `SELECT * FROM nomenclators
       WHERE insurer_id = $1 AND organization_id IS NULL AND is_active
         AND valid_from <= $2::date
         AND (valid_to IS NULL OR valid_to >= $2::date)
       ORDER BY valid_from DESC LIMIT 1`,
      [insurerId, date],
    );
  }

  /** Busca un código en la versión vigente */
  async lookupCode(insurerId: string, code: string, date: string, orgId?: string) {
    const nom = await this.findActiveVersion(insurerId, date, orgId);
    if (!nom) return null;

    const item = await this.db.queryOne(
      `SELECT * FROM nomenclator_items WHERE nomenclator_id = $1 AND code = $2`,
      [nom.id, code.trim()],
    );
    if (!item) return null;

    return { ...item, nomenclator: nom };
  }

  /** Búsqueda por texto para el autocompletar del médico */
  async search(insurerId: string, query: string, date: string, orgId?: string, limit = 20) {
    const nom = await this.findActiveVersion(insurerId, date, orgId);
    if (!nom) return [];

    const q = query.trim();
    if (!q) return [];

    // Si parece un código, buscar por prefijo
    if (/^\d/.test(q)) {
      return this.db.queryMany(
        `SELECT * FROM nomenclator_items
         WHERE nomenclator_id = $1 AND code LIKE $2 || '%'
         ORDER BY code LIMIT $3`,
        [nom.id, q, limit],
      );
    }

    return this.db.queryMany(
      `SELECT *, ts_rank(to_tsvector('spanish', description), plainto_tsquery('spanish', $2)) AS rank
       FROM nomenclator_items
       WHERE nomenclator_id = $1
         AND (to_tsvector('spanish', description) @@ plainto_tsquery('spanish', $2)
              OR description ILIKE '%' || $2 || '%')
       ORDER BY rank DESC, description LIMIT $3`,
      [nom.id, q, limit],
    );
  }

  async listVersions(filters: { insurerId?: string; organizationId?: string } = {}) {
    let where = 'WHERE n.is_active';
    const params: unknown[] = [];
    let p = 1;

    if (filters.insurerId) {
      where += ` AND n.insurer_id = $${p}`;
      params.push(filters.insurerId);
      p++;
    }
    if (filters.organizationId) {
      where += ` AND (n.organization_id = $${p} OR n.organization_id IS NULL)`;
      params.push(filters.organizationId);
      p++;
    }

    return this.db.queryMany(
      `SELECT n.*, i.name AS insurer_name,
              COUNT(ni.id) AS item_count,
              COUNT(ni.id) FILTER (
                WHERE ni.amount IS NULL AND ni.professional_units IS NULL AND ni.operative_units IS NULL
              ) AS items_without_value
       FROM nomenclators n
       LEFT JOIN insurers i ON i.id = n.insurer_id
       LEFT JOIN nomenclator_items ni ON ni.nomenclator_id = n.id
       ${where}
       GROUP BY n.id, i.name
       ORDER BY n.valid_from DESC`,
      params,
    );
  }

  async getVersion(id: string) {
    const nom = await this.db.queryOne(
      `SELECT n.*, i.name AS insurer_name
       FROM nomenclators n
       LEFT JOIN insurers i ON i.id = n.insurer_id
       WHERE n.id = $1`,
      [id],
    );
    if (!nom) throw new NotFoundException('Nomenclador no encontrado');

    const items = await this.db.queryMany(
      `SELECT * FROM nomenclator_items WHERE nomenclator_id = $1 ORDER BY code`,
      [id],
    );

    return { ...nom, items };
  }

  // ─── Helpers ──────────────────────────────────────────────

  private splitLine(line: string, sep: string): string[] {
    const out: string[] = [];
    let cur = '', q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (q && line[i + 1] === '"') { cur += '"'; i++; }
        else q = !q;
      } else if (ch === sep && !q) { out.push(cur); cur = ''; }
      else cur += ch;
    }
    out.push(cur);
    return out;
  }

  private normalize(h: string): string {
    return h.trim().toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]/g, '');
  }

  private find(header: string[], candidates: string[]): number {
    for (const c of candidates) {
      const exact = header.indexOf(c);
      if (exact >= 0) return exact;
    }
    for (const c of candidates) {
      const partial = header.findIndex(h => h.includes(c));
      if (partial >= 0) return partial;
    }
    return -1;
  }

  /** Maneja "1.234,56" y "1,234.56" */
  private parseNum(v?: string): number | undefined {
    if (!v) return undefined;
    let s = v.trim().replace(/[$\s]/g, '');
    if (!s) return undefined;

    const lastComma = s.lastIndexOf(',');
    const lastDot = s.lastIndexOf('.');

    if (lastComma > lastDot) {
      s = s.replace(/\./g, '').replace(',', '.');
    } else if (lastDot > lastComma) {
      s = s.replace(/,/g, '');
    }

    const n = parseFloat(s);
    return Number.isFinite(n) ? n : undefined;
  }

  private parseBool(v?: string): boolean {
    if (!v) return false;
    return ['si', 'sí', 'x', 'true', '1', 'yes'].includes(v.trim().toLowerCase());
  }
}
