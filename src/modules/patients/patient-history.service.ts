import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';

@Injectable()
export class PatientHistoryService {
  private readonly logger = new Logger(PatientHistoryService.name);

  constructor(private db: DatabaseService) {}

  /** Historia clínica completa de un paciente */
  async getFullHistory(orgId: string, patientId: string) {
    // Datos del paciente
    const patient = await this.db.queryOne(
      `SELECT * FROM patients WHERE id = $1 AND organization_id = $2`,
      [patientId, orgId],
    );

    // Turnos (todos, ordenados por fecha desc)
    const appointments = await this.db.queryMany(
      `SELECT a.*, d.first_name || ' ' || d.last_name AS doctor_name, d.specialty
       FROM appointments a
       JOIN organization_doctors od ON od.id = a.org_doctor_id
       JOIN doctors d ON d.id = od.doctor_id
       WHERE a.patient_id = $1 AND a.organization_id = $2
       ORDER BY a.date DESC, a.start_time DESC`,
      [patientId, orgId],
    );

    // Registros médicos (consultas)
    const medicalRecords = await this.db.queryMany(
      `SELECT mr.*, d.first_name || ' ' || d.last_name AS doctor_name
       FROM medical_records mr
       JOIN doctors d ON d.id = mr.doctor_id
       WHERE mr.patient_id = $1 AND mr.organization_id = $2
       ORDER BY mr.created_at DESC`,
      [patientId, orgId],
    );

    // Recetas
    const prescriptions = await this.db.queryMany(
      `SELECT rx.*, d.first_name || ' ' || d.last_name AS doctor_name,
        (SELECT json_agg(pi ORDER BY pi.sort_order) FROM prescription_items pi WHERE pi.prescription_id = rx.id) AS items
       FROM prescriptions rx
       JOIN doctors d ON d.id = rx.doctor_id
       WHERE rx.patient_id = $1 AND rx.organization_id = $2
       ORDER BY rx.issued_at DESC`,
      [patientId, orgId],
    );

    // Stats resumen
    const stats = {
      totalAppointments: appointments.length,
      completedAppointments: appointments.filter((a: any) => a.status === 'completed').length,
      cancelledAppointments: appointments.filter((a: any) => a.status === 'cancelled').length,
      noShowAppointments: appointments.filter((a: any) => a.status === 'no_show').length,
      totalPrescriptions: prescriptions.length,
      activePrescriptions: prescriptions.filter((r: any) => r.status === 'active').length,
      totalRecords: medicalRecords.length,
      firstVisit: appointments.length ? appointments[appointments.length - 1].date : null,
      lastVisit: appointments.length ? appointments[0].date : null,
    };

    // Timeline unificada (todos los eventos ordenados por fecha)
    const timeline: any[] = [];
    
    for (const a of appointments) {
      timeline.push({
        type: 'appointment',
        date: a.date,
        time: a.start_time,
        title: `Consulta — ${a.doctor_name}`,
        subtitle: a.reason || a.specialty,
        status: a.status,
        id: a.id,
      });
    }
    
    for (const r of medicalRecords) {
      timeline.push({
        type: 'record',
        date: r.created_at,
        time: null,
        title: `Registro — ${r.diagnosis || 'Sin diagnóstico'}`,
        subtitle: r.chief_complaint,
        status: null,
        id: r.id,
        diagnosis: r.diagnosis,
        diagnosisCode: r.diagnosis_code,
        treatmentPlan: r.treatment_plan,
        vitalSigns: r.vital_signs,
      });
    }
    
    for (const rx of prescriptions) {
      timeline.push({
        type: 'prescription',
        date: rx.issued_at,
        time: null,
        title: `Receta — ${rx.diagnosis}`,
        subtitle: (rx.items || []).map((i: any) => i.medication_name).join(', '),
        status: rx.status,
        id: rx.id,
      });
    }

    timeline.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    return { patient, stats, timeline, appointments, medicalRecords, prescriptions };
  }
}
