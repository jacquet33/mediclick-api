import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';

const DEFAULT_CONSENT_TEXT = `CONSENTIMIENTO INFORMADO PARA HISTORIA CLÍNICA DIGITAL

En cumplimiento de la Ley 26.529 de Derechos del Paciente y la Ley 25.326 de Protección de Datos Personales, se informa al paciente que:

1. Su historia clínica será registrada y almacenada en formato digital a través de la plataforma MediClick.

2. Los datos registrados incluyen: datos personales, antecedentes médicos, diagnósticos, tratamientos, prescripciones, estudios complementarios y toda otra información relevante para su atención médica.

3. El acceso a su historia clínica estará restringido exclusivamente al profesional tratante y al personal autorizado del consultorio.

4. Sus datos de salud son considerados datos sensibles y serán tratados con las máximas medidas de seguridad: encriptación, control de acceso por roles y registro de auditoría.

5. Usted tiene derecho a:
   - Acceder a su historia clínica en cualquier momento
   - Solicitar una copia en formato impreso o digital
   - Solicitar la rectificación de datos inexactos
   - Revocar este consentimiento en cualquier momento

6. La historia clínica será conservada por un mínimo de 10 (diez) años conforme a la legislación vigente.

7. Sus datos NO serán compartidos con terceros salvo requerimiento judicial o para facturación a obras sociales con su autorización expresa.

Al aceptar, usted declara haber sido informado y prestar su consentimiento libre y voluntario para el registro digital de su historia clínica.`;

export interface CreateConsentDto {
  patientId: string;
  consentType?: string;
  consentText?: string;
  accepted: boolean;
  signatureData?: string;
  ipAddress?: string;
  userAgent?: string;
}

@Injectable()
export class ConsentService {
  private readonly logger = new Logger(ConsentService.name);

  constructor(private db: DatabaseService) {}

  async create(orgId: string, doctorId: string, dto: CreateConsentDto) {
    const result = await this.db.queryOne(
      `INSERT INTO informed_consents
        (patient_id, doctor_id, organization_id, consent_type, consent_text,
         accepted, accepted_at, ip_address, user_agent, signature_data)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [
        dto.patientId,
        doctorId,
        orgId,
        dto.consentType || 'historia_clinica_digital',
        dto.consentText || DEFAULT_CONSENT_TEXT,
        dto.accepted,
        dto.accepted ? new Date().toISOString() : null,
        dto.ipAddress || null,
        dto.userAgent || null,
        dto.signatureData || null,
      ],
    );

    this.logger.log(
      `Consent ${dto.accepted ? 'accepted' : 'created'} for patient ${dto.patientId} by doctor ${doctorId}`,
    );

    return result;
  }

  async findByPatient(orgId: string, patientId: string) {
    return this.db.queryMany(
      `SELECT ic.*, d.first_name || ' ' || d.last_name AS doctor_name
       FROM informed_consents ic
       JOIN doctors d ON d.id = ic.doctor_id
       WHERE ic.patient_id = $1 AND ic.organization_id = $2 AND ic.revoked_at IS NULL
       ORDER BY ic.created_at DESC`,
      [patientId, orgId],
    );
  }

  async findActiveConsent(orgId: string, patientId: string, consentType = 'historia_clinica_digital') {
    return this.db.queryOne(
      `SELECT * FROM informed_consents
       WHERE patient_id = $1 AND organization_id = $2 AND consent_type = $3
         AND accepted = true AND revoked_at IS NULL
       ORDER BY accepted_at DESC
       LIMIT 1`,
      [patientId, orgId, consentType],
    );
  }

  async hasActiveConsent(orgId: string, patientId: string, consentType = 'historia_clinica_digital'): Promise<boolean> {
    const consent = await this.findActiveConsent(orgId, patientId, consentType);
    return !!consent;
  }

  async revoke(orgId: string, consentId: string, reason: string) {
    const consent = await this.db.queryOne(
      `SELECT * FROM informed_consents WHERE id = $1 AND organization_id = $2`,
      [consentId, orgId],
    );

    if (!consent) {
      throw new NotFoundException('Consentimiento no encontrado');
    }

    return this.db.queryOne(
      `UPDATE informed_consents
       SET revoked_at = NOW(), revoked_reason = $1, updated_at = NOW()
       WHERE id = $2
       RETURNING *`,
      [reason, consentId],
    );
  }

  getDefaultConsentText(): string {
    return DEFAULT_CONSENT_TEXT;
  }
}
