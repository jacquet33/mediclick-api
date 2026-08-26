import { Injectable, Logger, NotFoundException, ConflictException } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';

export interface InsurerRow {
  rnosCode?: string;
  cuit?: string;
  name: string;
  shortName?: string;
  kind?: 'obra_social' | 'prepaga' | 'mutual' | 'provincial';
  province?: string;
  isNational?: boolean;
  affiliateCount?: number;
  aliases?: string[];
}

export interface ImportSummary {
  inserted: number;
  updated: number;
  skipped: number;
  errors: Array<{ row: number; name: string; reason: string }>;
}

@Injectable()
export class InsurerService {
  private readonly logger = new Logger(InsurerService.name);

  constructor(private db: DatabaseService) {}

  // ═══════════════════════════════════════════════════════════
  // IMPORTACIÓN DEL PADRÓN
  // ═══════════════════════════════════════════════════════════

  /**
   * Importa el padrón desde filas ya parseadas.
   * Idempotente: si el RNOS ya existe, actualiza en vez de duplicar.
   */
  async importPadron(rows: InsurerRow[]): Promise<ImportSummary> {
    const summary: ImportSummary = { inserted: 0, updated: 0, skipped: 0, errors: [] };

    for (const [i, row] of rows.entries()) {
      if (!row.name?.trim()) {
        summary.skipped++;
        continue;
      }

      try {
        const existing = row.rnosCode
          ? await this.db.queryOne(`SELECT id FROM insurers WHERE rnos_code = $1`, [row.rnosCode])
          : await this.db.queryOne(`SELECT id FROM insurers WHERE LOWER(name) = LOWER($1)`, [row.name.trim()]);

        if (existing) {
          await this.db.query(
            `UPDATE insurers SET
               name = $1, short_name = COALESCE($2, short_name),
               cuit = COALESCE($3, cuit), kind = COALESCE($4, kind),
               province = COALESCE($5, province),
               is_national = COALESCE($6, is_national),
               affiliate_count = COALESCE($7, affiliate_count),
               aliases = CASE
                 WHEN $8::text[] IS NULL THEN aliases
                 ELSE ARRAY(SELECT DISTINCT unnest(COALESCE(aliases,'{}') || $8::text[]))
               END
             WHERE id = $9`,
            [
              row.name.trim(), row.shortName ?? null, row.cuit ?? null,
              row.kind ?? null, row.province ?? null,
              row.isNational ?? null, row.affiliateCount ?? null,
              row.aliases?.length ? row.aliases : null, existing.id,
            ],
          );
          summary.updated++;
        } else {
          await this.db.query(
            `INSERT INTO insurers
               (rnos_code, cuit, name, short_name, kind, province, is_national, affiliate_count, aliases)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
            [
              row.rnosCode ?? null, row.cuit ?? null, row.name.trim(),
              row.shortName ?? null, row.kind ?? 'obra_social',
              row.province ?? null, row.isNational ?? !row.province,
              row.affiliateCount ?? null, row.aliases ?? [],
            ],
          );
          summary.inserted++;
        }
      } catch (err) {
        summary.errors.push({ row: i + 1, name: row.name, reason: err.message });
      }
    }

    this.logger.log(
      `Padrón importado: ${summary.inserted} nuevas, ${summary.updated} actualizadas, ${summary.errors.length} errores`,
    );
    return summary;
  }

  /**
   * Parsea el CSV del padrón RNOS de SSSalud.
   * Tolera separador ; o , y detecta las columnas por nombre.
   */
  parsePadronCsv(csv: string): InsurerRow[] {
    const lines = csv.split(/\r?\n/).filter(l => l.trim());
    if (!lines.length) return [];

    const sep = (lines[0].match(/;/g)?.length ?? 0) > (lines[0].match(/,/g)?.length ?? 0) ? ';' : ',';
    const header = this.splitCsvLine(lines[0], sep).map(h => this.normalizeHeader(h));

    const idx = {
      rnos: this.findCol(header, ['rnos', 'codigo', 'cod', 'codigors']),
      name: this.findCol(header, ['razonsocial', 'denominacion', 'nombre', 'obrasocial']),
      cuit: this.findCol(header, ['cuit']),
      province: this.findCol(header, ['provincia', 'jurisdiccion']),
      count: this.findCol(header, ['beneficiarios', 'afiliados', 'cantidad']),
    };

    if (idx.name < 0) {
      throw new Error(
        `No encontré la columna de nombre. Columnas detectadas: ${header.join(', ')}`,
      );
    }

    const rows: InsurerRow[] = [];
    for (let i = 1; i < lines.length; i++) {
      const cells = this.splitCsvLine(lines[i], sep);
      const name = cells[idx.name]?.trim();
      if (!name) continue;

      const rnos = idx.rnos >= 0 ? cells[idx.rnos]?.trim() : undefined;
      const province = idx.province >= 0 ? cells[idx.province]?.trim() : undefined;
      const countRaw = idx.count >= 0 ? cells[idx.count]?.replace(/\D/g, '') : undefined;

      rows.push({
        rnosCode: rnos || undefined,
        cuit: idx.cuit >= 0 ? cells[idx.cuit]?.trim() || undefined : undefined,
        name: this.titleCase(name),
        province: province || undefined,
        isNational: !province,
        affiliateCount: countRaw ? parseInt(countRaw, 10) : undefined,
        aliases: this.deriveAliases(name),
      });
    }

    return rows;
  }

  // ═══════════════════════════════════════════════════════════
  // CONSULTA
  // ═══════════════════════════════════════════════════════════

  async list(filters: {
    search?: string; province?: string; kind?: string;
    onlyMapped?: boolean; page?: number; limit?: number;
  } = {}) {
    const page = filters.page ?? 1;
    const limit = Math.min(filters.limit ?? 50, 200);
    const offset = (page - 1) * limit;

    let where = 'WHERE i.is_active';
    const params: unknown[] = [];
    let p = 1;

    if (filters.search) {
      where += ` AND (i.name ILIKE $${p} OR i.short_name ILIKE $${p} OR i.rnos_code = $${p + 1})`;
      params.push(`%${filters.search}%`, filters.search);
      p += 2;
    }
    if (filters.province) {
      where += ` AND i.province = $${p}`;
      params.push(filters.province);
      p++;
    }
    if (filters.kind) {
      where += ` AND i.kind = $${p}`;
      params.push(filters.kind);
      p++;
    }

    const having = filters.onlyMapped ? 'HAVING COUNT(c.id) FILTER (WHERE c.is_enabled) > 0' : '';

    const total = await this.db.queryOne(
      `SELECT COUNT(*) AS n FROM insurers i ${where}`, params,
    );

    params.push(limit, offset);
    const data = await this.db.queryMany(
      `SELECT i.*,
              COUNT(c.id) FILTER (WHERE c.is_enabled) AS connector_count,
              BOOL_OR(c.can_validate_affiliate AND c.is_enabled) AS supports_validation,
              BOOL_OR(c.can_authorize_practice AND c.is_enabled) AS supports_authorization,
              BOOL_OR(c.can_submit_batch AND c.is_enabled) AS supports_batch,
              (ARRAY_AGG(c.kind ORDER BY c.priority) FILTER (WHERE c.is_enabled))[1] AS primary_kind,
              (ARRAY_AGG(c.health ORDER BY c.priority) FILTER (WHERE c.is_enabled))[1] AS primary_health
       FROM insurers i
       LEFT JOIN connectors c ON c.insurer_id = i.id
       ${where}
       GROUP BY i.id
       ${having}
       ORDER BY i.affiliate_count DESC NULLS LAST, i.name
       LIMIT $${p} OFFSET $${p + 1}`,
      params,
    );

    return { data, total: parseInt(total.n), page, limit };
  }

  async findById(id: string) {
    const insurer = await this.db.queryOne(`SELECT * FROM insurers WHERE id = $1`, [id]);
    if (!insurer) throw new NotFoundException('Financiador no encontrado');

    const [plans, connectors] = await Promise.all([
      this.db.queryMany(`SELECT * FROM insurer_plans WHERE insurer_id = $1 ORDER BY name`, [id]),
      this.db.queryMany(
        `SELECT id, adapter_key, kind, priority, health, consecutive_failures,
                avg_latency_ms, last_success_at, last_failure_at, is_enabled,
                can_validate_affiliate, can_authorize_practice, can_submit_batch
         FROM connectors WHERE insurer_id = $1 ORDER BY priority`,
        [id],
      ),
    ]);

    return { ...insurer, plans, connectors };
  }

  /** Provincias con conteo, para los filtros del panel */
  async provinces() {
    return this.db.queryMany(
      `SELECT province, COUNT(*) AS n
       FROM insurers WHERE is_active AND province IS NOT NULL
       GROUP BY province ORDER BY n DESC`,
    );
  }

  // ═══════════════════════════════════════════════════════════
  // ABM
  // ═══════════════════════════════════════════════════════════

  async create(dto: InsurerRow) {
    if (dto.rnosCode) {
      const dup = await this.db.queryOne(`SELECT id FROM insurers WHERE rnos_code = $1`, [dto.rnosCode]);
      if (dup) throw new ConflictException('Ya existe un financiador con ese código RNOS');
    }

    return this.db.queryOne(
      `INSERT INTO insurers (rnos_code, cuit, name, short_name, kind, province, is_national, affiliate_count, aliases)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [
        dto.rnosCode ?? null, dto.cuit ?? null, dto.name, dto.shortName ?? null,
        dto.kind ?? 'obra_social', dto.province ?? null,
        dto.isNational ?? !dto.province, dto.affiliateCount ?? null,
        dto.aliases ?? this.deriveAliases(dto.name),
      ],
    );
  }

  async update(id: string, dto: Partial<InsurerRow>) {
    await this.findById(id);

    const map: Record<string, string> = {
      rnosCode: 'rnos_code', cuit: 'cuit', name: 'name', shortName: 'short_name',
      kind: 'kind', province: 'province', isNational: 'is_national',
      affiliateCount: 'affiliate_count', aliases: 'aliases',
    };

    const sets: string[] = [];
    const vals: unknown[] = [];
    let p = 1;

    for (const [k, col] of Object.entries(map)) {
      if (dto[k] !== undefined) {
        sets.push(`${col} = $${p}`);
        vals.push(dto[k]);
        p++;
      }
    }
    if (!sets.length) return this.findById(id);

    vals.push(id);
    return this.db.queryOne(
      `UPDATE insurers SET ${sets.join(', ')} WHERE id = $${p} RETURNING *`, vals,
    );
  }

  /** Alta o edición de un conector para un financiador */
  async upsertConnector(insurerId: string, dto: {
    adapterKey: string;
    kind: 'api' | 'portal' | 'manual' | 'offline';
    priority?: number;
    config?: Record<string, unknown>;
    canValidate?: boolean;
    canAuthorize?: boolean;
    canSubmitBatch?: boolean;
    isEnabled?: boolean;
  }) {
    await this.findById(insurerId);

    return this.db.queryOne(
      `INSERT INTO connectors
         (insurer_id, adapter_key, kind, priority, config,
          can_validate_affiliate, can_authorize_practice, can_submit_batch, is_enabled)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT DO NOTHING
       RETURNING *`,
      [
        insurerId, dto.adapterKey, dto.kind, dto.priority ?? 100,
        JSON.stringify(dto.config ?? {}),
        dto.canValidate ?? false, dto.canAuthorize ?? false,
        dto.canSubmitBatch ?? false, dto.isEnabled ?? true,
      ],
    );
  }

  /**
   * Le pone conector manual a todo financiador que no tenga ninguno.
   * Esto es lo que nos deja decir "cubrimos las 300" desde el día uno.
   */
  async ensureManualFallback(): Promise<{ created: number }> {
    const result = await this.db.query(
      `INSERT INTO connectors
         (insurer_id, adapter_key, kind, priority,
          can_validate_affiliate, can_authorize_practice, can_submit_batch, config)
       SELECT i.id, 'generic_manual', 'manual', 900, true, true, true,
              jsonb_build_object('insurerId', i.id)
       FROM insurers i
       WHERE i.is_active
         AND NOT EXISTS (
           SELECT 1 FROM connectors c WHERE c.insurer_id = i.id
         )`,
    );
    return { created: result.rowCount ?? 0 };
  }

  // ─── Helpers ──────────────────────────────────────────────

  private splitCsvLine(line: string, sep: string): string[] {
    const out: string[] = [];
    let cur = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; }
        else inQuotes = !inQuotes;
      } else if (ch === sep && !inQuotes) {
        out.push(cur); cur = '';
      } else cur += ch;
    }
    out.push(cur);
    return out;
  }

  private normalizeHeader(h: string): string {
    return h.trim().toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]/g, '');
  }

  private findCol(header: string[], candidates: string[]): number {
    for (const c of candidates) {
      const i = header.findIndex(h => h === c || h.includes(c));
      if (i >= 0) return i;
    }
    return -1;
  }

  private titleCase(s: string): string {
    if (s !== s.toUpperCase()) return s.trim();
    const minor = new Set(['de', 'del', 'la', 'las', 'los', 'y', 'e', 'para', 'el', 'en']);
    return s.toLowerCase().trim().split(/\s+/)
      .map((w, i) => {
        if (i > 0 && minor.has(w)) return w;
        if (/^[ivxlc]+$/.test(w) && w.length <= 4) return w.toUpperCase();
        return w.charAt(0).toUpperCase() + w.slice(1);
      })
      .join(' ');
  }

  /** Genera variantes de escritura para que el matching difuso enganche */
  private deriveAliases(name: string): string[] {
    const set = new Set<string>();
    const clean = name.trim();
    set.add(clean);
    set.add(clean.toUpperCase());

    const noDots = clean.replace(/\./g, '');
    if (noDots !== clean) set.add(noDots);

    const noPrefix = clean.replace(/^(obra social|o\.?s\.?|instituto|asociacion)\s+/i, '').trim();
    if (noPrefix && noPrefix !== clean) set.add(noPrefix);

    // Sigla: primeras letras de palabras significativas
    const words = clean.split(/\s+/).filter(w => w.length > 2 && !/^(de|del|la|los|las|y|para|el|en)$/i.test(w));
    if (words.length >= 2 && words.length <= 6) {
      set.add(words.map(w => w[0].toUpperCase()).join(''));
    }

    return [...set].filter(Boolean);
  }
}
