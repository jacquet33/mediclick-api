import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';

export interface OnboardingStatus {
  completed: boolean;
  steps: {
    profile: { done: boolean; missing: string[] };
    organization: { done: boolean; orgId?: string; orgName?: string };
    schedule: { done: boolean; daysConfigured: number };
    bookingPage: { done: boolean; slug?: string; enabled: boolean };
  };
  completedSteps: number;
  totalSteps: number;
}

@Injectable()
export class OnboardingService {
  constructor(private db: DatabaseService) {}

  async getStatus(doctorId: string): Promise<OnboardingStatus> {
    // 1. Perfil completo
    const doctor = await this.db.queryOne(
      `SELECT first_name, last_name, email, phone, medical_license,
              medical_license_province, specialty, avatar_url
       FROM doctors WHERE id = $1`,
      [doctorId],
    );

    const profileMissing: string[] = [];
    if (!doctor.phone) profileMissing.push('phone');
    if (!doctor.medical_license || doctor.medical_license.startsWith('PENDING_'))
      profileMissing.push('medicalLicense');
    if (!doctor.medical_license_province) profileMissing.push('medicalLicenseProvince');
    if (!doctor.specialty) profileMissing.push('specialty');

    // 2. Organización
    const org = await this.db.queryOne(
      `SELECT o.id, o.name FROM organizations o
       JOIN organization_doctors od ON od.organization_id = o.id
       WHERE od.doctor_id = $1 AND od.is_active = true
       LIMIT 1`,
      [doctorId],
    );

    // 3. Agenda configurada
    let daysConfigured = 0;
    if (org) {
      const orgDoctor = await this.db.queryOne(
        `SELECT id FROM organization_doctors WHERE organization_id = $1 AND doctor_id = $2 AND is_active = true`,
        [org.id, doctorId],
      );
      if (orgDoctor) {
        const schedules = await this.db.queryMany(
          `SELECT DISTINCT day_of_week FROM doctor_schedules WHERE org_doctor_id = $1 AND is_active = true`,
          [orgDoctor.id],
        );
        daysConfigured = schedules.length;
      }
    }

    // 4. Booking page
    let bookingSlug: string | undefined;
    let bookingEnabled = false;
    if (org) {
      const booking = await this.db.queryOne(
        `SELECT bs.public_slug, bs.is_enabled
         FROM booking_settings bs
         JOIN organization_doctors od ON od.id = bs.org_doctor_id
         WHERE od.organization_id = $1 AND od.doctor_id = $2 AND od.is_active = true`,
        [org.id, doctorId],
      );
      if (booking) {
        bookingSlug = booking.public_slug;
        bookingEnabled = booking.is_enabled;
      }
    }

    const steps = {
      profile: { done: profileMissing.length === 0, missing: profileMissing },
      organization: { done: !!org, orgId: org?.id, orgName: org?.name },
      schedule: { done: daysConfigured > 0, daysConfigured },
      bookingPage: { done: !!bookingSlug && bookingEnabled, slug: bookingSlug, enabled: bookingEnabled },
    };

    const completedSteps = Object.values(steps).filter(s => s.done).length;

    return {
      completed: completedSteps === 4,
      steps,
      completedSteps,
      totalSteps: 4,
    };
  }
}
