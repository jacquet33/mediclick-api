import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';

export interface CreateTemplateDto {
  name: string;
  category?: string;
  diagnosis?: string;
  diagnosisCode?: string;
  notes?: string;
  isShared?: boolean;
  items: {
    medicationName: string;
    dosage?: string;
    frequency?: string;
    duration?: string;
    quantity?: number;
    instructions?: string;
  }[];
}

@Injectable()
export class PrescriptionTemplateService {
  private readonly logger = new Logger(PrescriptionTemplateService.name);

  constructor(private db: DatabaseService) {}

  /** Listar templates del doctor (propios + compartidos de la org) */
  async list(doctorId: string, orgId: string, category?: string) {
    let query = `
      SELECT t.*, 
        (SELECT json_agg(ti ORDER BY ti.sort_order) 
         FROM prescription_template_items ti WHERE ti.template_id = t.id) AS items
      FROM prescription_templates t
      WHERE t.is_active = true
        AND (t.doctor_id = $1 OR (t.is_shared = true AND t.organization_id = $2))
    `;
    const params: any[] = [doctorId, orgId];

    if (category) {
      params.push(category);
      query += ` AND t.category = $${params.length}`;
    }

    query += ` ORDER BY t.use_count DESC, t.name`;
    return this.db.queryMany(query, params);
  }

  /** Obtener un template por id */
  async getById(templateId: string) {
    const t = await this.db.queryOne(
      `SELECT t.*,
        (SELECT json_agg(ti ORDER BY ti.sort_order) 
         FROM prescription_template_items ti WHERE ti.template_id = t.id) AS items
       FROM prescription_templates t WHERE t.id = $1`,
      [templateId],
    );
    if (!t) throw new NotFoundException('Template no encontrado');
    return t;
  }

  /** Crear template nuevo */
  async create(doctorId: string, orgId: string, dto: CreateTemplateDto) {
    const template = await this.db.queryOne(
      `INSERT INTO prescription_templates (doctor_id, organization_id, name, category, diagnosis, diagnosis_code, notes, is_shared)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [doctorId, orgId, dto.name, dto.category || null, dto.diagnosis || null,
       dto.diagnosisCode || null, dto.notes || null, dto.isShared || false],
    );

    for (let i = 0; i < dto.items.length; i++) {
      const item = dto.items[i];
      await this.db.query(
        `INSERT INTO prescription_template_items (template_id, medication_name, dosage, frequency, duration, quantity, instructions, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [template.id, item.medicationName, item.dosage || null, item.frequency || null,
         item.duration || null, item.quantity || null, item.instructions || null, i],
      );
    }

    this.logger.log(`Template created: ${dto.name} by doctor ${doctorId}`);
    return this.getById(template.id);
  }

  /** Actualizar template */
  async update(templateId: string, doctorId: string, dto: Partial<CreateTemplateDto>) {
    const existing = await this.db.queryOne(
      `SELECT id FROM prescription_templates WHERE id = $1 AND doctor_id = $2`,
      [templateId, doctorId],
    );
    if (!existing) throw new NotFoundException('Template no encontrado o no sos el dueño');

    if (dto.name || dto.category || dto.diagnosis || dto.diagnosisCode !== undefined || dto.notes !== undefined) {
      await this.db.query(
        `UPDATE prescription_templates SET
          name = COALESCE($2, name),
          category = COALESCE($3, category),
          diagnosis = COALESCE($4, diagnosis),
          diagnosis_code = COALESCE($5, diagnosis_code),
          notes = COALESCE($6, notes),
          is_shared = COALESCE($7, is_shared)
         WHERE id = $1`,
        [templateId, dto.name, dto.category, dto.diagnosis,
         dto.diagnosisCode, dto.notes, dto.isShared],
      );
    }

    if (dto.items) {
      await this.db.query('DELETE FROM prescription_template_items WHERE template_id = $1', [templateId]);
      for (let i = 0; i < dto.items.length; i++) {
        const item = dto.items[i];
        await this.db.query(
          `INSERT INTO prescription_template_items (template_id, medication_name, dosage, frequency, duration, quantity, instructions, sort_order)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [templateId, item.medicationName, item.dosage, item.frequency,
           item.duration, item.quantity, item.instructions, i],
        );
      }
    }

    return this.getById(templateId);
  }

  /** Eliminar template */
  async delete(templateId: string, doctorId: string) {
    const result = await this.db.query(
      `UPDATE prescription_templates SET is_active = false WHERE id = $1 AND doctor_id = $2`,
      [templateId, doctorId],
    );
    return { deleted: true };
  }

  /** Incrementar contador de uso */
  async incrementUseCount(templateId: string) {
    await this.db.query(
      `UPDATE prescription_templates SET use_count = use_count + 1 WHERE id = $1`,
      [templateId],
    );
  }

  /** Categorías disponibles */
  async listCategories(doctorId: string, orgId: string) {
    return this.db.queryMany(
      `SELECT DISTINCT category, COUNT(*) AS count
       FROM prescription_templates
       WHERE is_active = true AND category IS NOT NULL
         AND (doctor_id = $1 OR (is_shared = true AND organization_id = $2))
       GROUP BY category ORDER BY count DESC`,
      [doctorId, orgId],
    );
  }
}
