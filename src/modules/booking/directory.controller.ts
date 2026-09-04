import { Controller, Get, Query } from '@nestjs/common';
import { Public } from '../../common/guards/auth.guard';
import { DatabaseService } from '../../database/database.service';

@Public()
@Controller('api/v1/public/directory')
export class DirectoryController {
  constructor(private db: DatabaseService) {}

  /** GET /public/directory/doctors — listar médicos con reservas habilitadas */
  @Get('doctors')
  async searchDoctors(
    @Query('specialty') specialty?: string,
    @Query('city') city?: string,
    @Query('insurance') insurance?: string,
    @Query('q') query?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    let sql = `
      SELECT 
        d.id AS doctor_id,
        d.first_name || ' ' || d.last_name AS name,
        d.specialty,
        d.medical_license,
        d.avatar_url,
        o.name AS org_name,
        o.type AS org_type,
        o.address,
        o.city,
        o.province,
        o.phone AS org_phone,
        bs.public_slug
      FROM booking_settings bs
      JOIN organization_doctors od ON od.id = bs.org_doctor_id AND od.is_active = true
      JOIN doctors d ON d.id = od.doctor_id AND d.is_active = true
      JOIN organizations o ON o.id = od.organization_id AND o.is_active = true
      WHERE bs.is_enabled = true
    `;
    const params: any[] = [];

    if (specialty) {
      params.push(`%${specialty}%`);
      sql += ` AND d.specialty ILIKE $${params.length}`;
    }

    if (city) {
      params.push(`%${city}%`);
      sql += ` AND (o.city ILIKE $${params.length} OR o.province ILIKE $${params.length})`;
    }

    if (query) {
      params.push(`%${query}%`);
      sql += ` AND (d.first_name || ' ' || d.last_name ILIKE $${params.length}
                OR d.specialty ILIKE $${params.length}
                OR o.name ILIKE $${params.length})`;
    }

    sql += ` ORDER BY d.last_name, d.first_name`;
    sql += ` LIMIT ${parseInt(limit || '20')} OFFSET ${parseInt(offset || '0')}`;

    const doctors = await this.db.queryMany(sql, params);
    return { doctors, total: doctors.length };
  }

  /** GET /public/directory/specialties — listar especialidades disponibles */
  @Get('specialties')
  async listSpecialties() {
    return this.db.queryMany(`
      SELECT DISTINCT d.specialty, COUNT(*) AS count
      FROM booking_settings bs
      JOIN organization_doctors od ON od.id = bs.org_doctor_id
      JOIN doctors d ON d.id = od.doctor_id
      WHERE bs.is_enabled = true AND d.specialty IS NOT NULL
      GROUP BY d.specialty ORDER BY count DESC
    `);
  }

  /** GET /public/directory/cities — listar ciudades */
  @Get('cities')
  async listCities() {
    return this.db.queryMany(`
      SELECT DISTINCT o.city, o.province, COUNT(*) AS count
      FROM booking_settings bs
      JOIN organization_doctors od ON od.id = bs.org_doctor_id
      JOIN organizations o ON o.id = od.organization_id
      WHERE bs.is_enabled = true AND o.city IS NOT NULL
      GROUP BY o.city, o.province ORDER BY count DESC
    `);
  }
}
