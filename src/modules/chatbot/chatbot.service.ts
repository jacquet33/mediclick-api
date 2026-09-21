import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';

@Injectable()
export class ChatbotService {
  private readonly logger = new Logger(ChatbotService.name);

  constructor(private db: DatabaseService) {}

  /** Obtener config del chatbot de un médico (por slug) */
  async getConfig(slug: string) {
    const config = await this.db.queryOne(
      `SELECT cc.*, bs.public_slug,
        d.first_name || ' ' || d.last_name AS doctor_name,
        d.specialty, o.name AS org_name
       FROM chatbot_config cc
       JOIN organization_doctors od ON od.id = cc.org_doctor_id
       JOIN booking_settings bs ON bs.org_doctor_id = od.id
       JOIN doctors d ON d.id = od.doctor_id
       JOIN organizations o ON o.id = od.organization_id
       WHERE bs.public_slug = $1 AND cc.is_enabled = true`,
      [slug],
    );
    if (!config) return null;

    const faqs = await this.db.queryMany(
      `SELECT id, question, category, sort_order FROM chatbot_faqs
       WHERE chatbot_config_id = $1 AND is_active = true ORDER BY sort_order`,
      [config.id],
    );

    return { ...config, suggestedQuestions: faqs.map((f: any) => f.question) };
  }

  /** Responder una pregunta usando keyword matching */
  async ask(slug: string, userMessage: string) {
    const config = await this.db.queryOne(
      `SELECT cc.* FROM chatbot_config cc
       JOIN organization_doctors od ON od.id = cc.org_doctor_id
       JOIN booking_settings bs ON bs.org_doctor_id = od.id
       WHERE bs.public_slug = $1 AND cc.is_enabled = true`,
      [slug],
    );
    if (!config) return { answer: 'El chatbot no está habilitado para este profesional.' };

    const message = userMessage.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

    // Buscar FAQ con mejor match de keywords
    const faqs = await this.db.queryMany(
      `SELECT * FROM chatbot_faqs WHERE chatbot_config_id = $1 AND is_active = true`,
      [config.id],
    );

    let bestMatch: any = null;
    let bestScore = 0;

    for (const faq of faqs) {
      const keywords = (faq.keywords || []) as string[];
      let score = 0;
      for (const kw of keywords) {
        const kwNorm = kw.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        if (message.includes(kwNorm)) score++;
      }
      if (score > bestScore) {
        bestScore = score;
        bestMatch = faq;
      }
    }

    if (bestMatch && bestScore > 0) {
      return { answer: bestMatch.answer, category: bestMatch.category, matched: true };
    }

    // Smart fallback: intentar responder con la config general
    const smartAnswer = this.trySmartAnswer(message, config);
    if (smartAnswer) return { answer: smartAnswer, category: 'auto', matched: true };

    return { answer: config.fallback_message, matched: false };
  }

  /** Respuestas automáticas basadas en la config del médico */
  private trySmartAnswer(message: string, config: any): string | null {
    if (this.matches(message, ['precio', 'costo', 'cuanto', 'valor', 'cobra', 'tarifa', 'honorario'])) {
      if (config.consultation_fee) {
        const ins = config.accepted_insurance?.length
          ? `\n\nObras sociales aceptadas: ${config.accepted_insurance.join(', ')}`
          : '';
        return `💰 El valor de la consulta es de $${Number(config.consultation_fee).toLocaleString('es-AR')}.${ins}`;
      }
      return config.accepted_insurance?.length
        ? `Aceptamos las siguientes obras sociales: ${config.accepted_insurance.join(', ')}. Para consultas particulares, comunicarse al consultorio.`
        : null;
    }

    if (this.matches(message, ['horario', 'hora', 'atiende', 'disponib', 'cuando', 'turno', 'agenda'])) {
      if (config.schedule_text) return `🕐 ${config.schedule_text}`;
      return '📅 Podés ver los horarios disponibles y reservar turno directamente desde esta página.';
    }

    if (this.matches(message, ['donde', 'direccion', 'ubicacion', 'llegar', 'queda', 'mapa'])) {
      if (config.address_text) return `📍 ${config.address_text}`;
      return null;
    }

    if (this.matches(message, ['obra social', 'osde', 'iosper', 'swiss', 'galeno', 'pami', 'cobertura', 'seguro', 'prepaga'])) {
      if (config.accepted_insurance?.length) {
        return `🏥 Obras sociales y prepagas aceptadas:\n\n${config.accepted_insurance.map((i: string) => `✓ ${i}`).join('\n')}`;
      }
      return null;
    }

    if (this.matches(message, ['telefono', 'llamar', 'contacto', 'comunicar', 'whatsapp'])) {
      let resp = '';
      if (config.phone) resp += `📞 Teléfono: ${config.phone}\n`;
      if (config.whatsapp) resp += `💬 WhatsApp: ${config.whatsapp}`;
      return resp || null;
    }

    if (this.matches(message, ['hola', 'buenas', 'buen dia', 'buenos dias', 'buenas tardes'])) {
      return config.welcome_message;
    }

    if (this.matches(message, ['gracias', 'muchas gracias', 'genial', 'perfecto'])) {
      return '😊 ¡De nada! ¿Hay algo más en lo que pueda ayudarte?';
    }

    if (this.matches(message, ['reservar', 'sacar turno', 'pedir turno', 'agendar'])) {
      return '📅 Para reservar un turno, usá el calendario de arriba. Elegí el día, el horario y completá tus datos. ¡Es muy fácil!';
    }

    return null;
  }

  private matches(text: string, keywords: string[]): boolean {
    return keywords.some(kw => text.includes(kw));
  }

  // ═══════════════════════════════════════════════════════════
  // GESTIÓN (médico configura su chatbot)
  // ═══════════════════════════════════════════════════════════

  async upsertConfig(orgDoctorId: string, dto: any) {
    const existing = await this.db.queryOne(
      'SELECT id FROM chatbot_config WHERE org_doctor_id = $1', [orgDoctorId],
    );

    if (existing) {
      return this.db.queryOne(
        `UPDATE chatbot_config SET
          is_enabled = COALESCE($2, is_enabled),
          welcome_message = COALESCE($3, welcome_message),
          fallback_message = COALESCE($4, fallback_message),
          consultation_fee = COALESCE($5, consultation_fee),
          accepted_insurance = COALESCE($6, accepted_insurance),
          schedule_text = COALESCE($7, schedule_text),
          address_text = COALESCE($8, address_text),
          phone = COALESCE($9, phone),
          whatsapp = COALESCE($10, whatsapp),
          extra_info = COALESCE($11, extra_info)
         WHERE org_doctor_id = $1 RETURNING *`,
        [orgDoctorId, dto.isEnabled, dto.welcomeMessage, dto.fallbackMessage,
         dto.consultationFee, dto.acceptedInsurance, dto.scheduleText,
         dto.addressText, dto.phone, dto.whatsapp, dto.extraInfo],
      );
    }

    return this.db.queryOne(
      `INSERT INTO chatbot_config (org_doctor_id, consultation_fee, accepted_insurance,
        schedule_text, address_text, phone, whatsapp, extra_info)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [orgDoctorId, dto.consultationFee, dto.acceptedInsurance,
       dto.scheduleText, dto.addressText, dto.phone, dto.whatsapp, dto.extraInfo],
    );
  }

  async addFaq(configId: string, dto: { question: string; keywords: string[]; answer: string; category?: string }) {
    return this.db.queryOne(
      `INSERT INTO chatbot_faqs (chatbot_config_id, question, keywords, answer, category)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [configId, dto.question, dto.keywords, dto.answer, dto.category || 'general'],
    );
  }

  async removeFaq(faqId: string) {
    return this.db.query('DELETE FROM chatbot_faqs WHERE id = $1', [faqId]);
  }

  async listFaqs(configId: string) {
    return this.db.queryMany(
      'SELECT * FROM chatbot_faqs WHERE chatbot_config_id = $1 ORDER BY sort_order', [configId],
    );
  }
}
