import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '../../database/database.service';

/**
 * Receta en HL7 FHIR R4 (Res. 2214/2025, Anexo III): Bundle con Patient, Practitioner, Organization
 * y un MedicationRequest por medicamento, identificado con su CUIR.
 */
@Injectable()
export class FhirService {
  constructor(private db: DatabaseService, private config: ConfigService) {}

  async bundle(prescriptionId: string) {
    const rx = await this.db.queryOne(
      `SELECT rx.*, p.first_name AS p_fn, p.last_name AS p_ln, p.dni AS p_dni, p.gender AS p_gender, p.date_of_birth AS p_dob,
              p.insurance_provider, p.insurance_plan, p.insurance_number,
              d.first_name AS d_fn, d.last_name AS d_ln, d.dni AS d_dni, d.medical_license, d.license_type, d.medical_license_province,
              d.refeps_code, d.specialty,
              o.name AS org_name, o.address AS org_address, o.city AS org_city, o.province AS org_province, o.phone AS org_phone
       FROM prescriptions rx JOIN patients p ON p.id = rx.patient_id JOIN doctors d ON d.id = rx.doctor_id
       JOIN organizations o ON o.id = rx.organization_id WHERE rx.id = $1`,
      [prescriptionId],
    );
    if (!rx) throw new NotFoundException('Receta no encontrada');
    const items = await this.db.queryMany(
      `SELECT * FROM prescription_items WHERE prescription_id = $1 ORDER BY sort_order, created_at`, [prescriptionId]);
    const base = this.config.get('BASE_URL') || 'https://tuconsultorio.rispy.io';
    const fecha = (d: any) => (d ? new Date(d).toISOString() : undefined);
    const genero = ({ male: 'male', female: 'female', other: 'other' } as any)[rx.p_gender] || 'unknown';
    const patientRef = `urn:uuid:${rx.patient_id}`, practRef = `urn:uuid:${rx.doctor_id}`, orgRef = `urn:uuid:${rx.organization_id}`;
    const estado = rx.status === 'cancelled' ? 'cancelled' : rx.status === 'dispensed' ? 'completed' : 'active';

    const recursos: any[] = [
      {
        fullUrl: patientRef,
        resource: {
          resourceType: 'Patient', id: rx.patient_id,
          identifier: [
            { system: 'http://www.renaper.gob.ar/dni', value: String(rx.p_dni || '').replace(/\D/g, '') },
            ...(rx.patient_cuil ? [{ system: 'http://www.afip.gob.ar/cuil', value: rx.patient_cuil }] : []),
          ],
          name: [{ family: rx.p_ln, given: [rx.p_fn] }],
          gender: genero,
          birthDate: rx.p_dob ? new Date(rx.p_dob).toISOString().slice(0, 10) : undefined,
        },
      },
      {
        fullUrl: practRef,
        resource: {
          resourceType: 'Practitioner', id: rx.doctor_id,
          identifier: [
            ...(rx.refeps_code ? [{ system: 'https://sisa.msal.gov.ar/REFEPS', value: rx.refeps_code }] : []),
            ...(rx.d_dni ? [{ system: 'http://www.renaper.gob.ar/dni', value: rx.d_dni }] : []),
            { system: rx.license_type === 'MN' ? 'https://sisa.msal.gov.ar/matricula/nacional' : `https://sisa.msal.gov.ar/matricula/provincial/${encodeURIComponent(rx.medical_license_province || '')}`, value: rx.medical_license },
          ],
          name: [{ family: rx.d_ln, given: [rx.d_fn], prefix: [rx.title_prefix || 'Dr/a.'] }],
          qualification: rx.specialty ? [{ code: { text: rx.specialty } }] : undefined,
        },
      },
      {
        fullUrl: orgRef,
        resource: {
          resourceType: 'Organization', id: rx.organization_id, name: rx.org_name,
          address: [{ line: rx.org_address ? [rx.org_address] : undefined, city: rx.org_city, state: rx.org_province, country: 'AR' }],
          telecom: rx.org_phone ? [{ system: 'phone', value: rx.org_phone }] : undefined,
        },
      },
    ];
    if (rx.insurance_provider) {
      recursos.push({
        fullUrl: `urn:uuid:${rx.patient_id}-coverage`,
        resource: {
          resourceType: 'Coverage', status: 'active', beneficiary: { reference: patientRef },
          payor: [{ display: rx.insurance_provider }], subscriberId: rx.insurance_number || undefined,
          class: rx.insurance_plan ? [{ type: { text: 'plan' }, value: rx.insurance_plan }] : undefined,
        },
      });
    }
    items.forEach((i: any, n: number) => {
      recursos.push({
        fullUrl: `urn:uuid:${i.id}`,
        resource: {
          resourceType: 'MedicationRequest', id: i.id, status: estado, intent: 'order',
          identifier: [
            { system: 'https://www.argentina.gob.ar/salud/cuir', value: i.cuir || `${rx.cuir || rx.verification_code}${String(n + 1).padStart(2, '0')}` },
            { system: `${base}/verificar-receta`, value: rx.verification_code },
          ],
          groupIdentifier: { system: 'https://www.argentina.gob.ar/salud/cuir', value: rx.cuir || rx.verification_code },
          medicationCodeableConcept: {
            text: [i.generic_name || i.medication_name, i.presentation, i.pharmaceutical_form].filter(Boolean).join(' · '),
            coding: [],
          },
          subject: { reference: patientRef },
          requester: { reference: practRef },
          authoredOn: fecha(rx.issued_at),
          reasonCode: rx.diagnosis ? [{
            text: rx.diagnosis,
            coding: rx.diagnosis_code ? [{ system: 'http://hl7.org/fhir/sid/icd-10', code: rx.diagnosis_code }] : undefined,
          }] : undefined,
          dosageInstruction: [{ text: [i.dosage, i.frequency, i.duration, i.instructions].filter(Boolean).join(' · ') }],
          dispenseRequest: {
            validityPeriod: { start: fecha(rx.issued_at), end: fecha(rx.expires_at) },
            quantity: { value: i.quantity || 1, unit: 'envase' },
          },
          substitution: { allowedBoolean: true }, // Ley 25.649: se prescribe por principio activo
          note: rx.notes ? [{ text: rx.notes }] : undefined,
        },
      });
    });
    return {
      resourceType: 'Bundle', type: 'document', id: rx.id, timestamp: fecha(rx.issued_at),
      identifier: { system: 'https://www.argentina.gob.ar/salud/cuir', value: rx.cuir || rx.verification_code },
      entry: recursos,
    };
  }
}
