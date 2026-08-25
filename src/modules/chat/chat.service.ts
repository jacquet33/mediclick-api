import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';

export interface SendMessageDto {
  conversationId?: string;
  patientId?: string;
  content: string;
  messageType?: string;
  attachmentUrl?: string;
  attachmentName?: string;
  prescriptionId?: string;
  appointmentId?: string;
}

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(private db: DatabaseService) {}

  async getConversations(orgId: string, doctorId: string) {
    return this.db.queryMany(
      `SELECT c.*, p.first_name || ' ' || p.last_name AS patient_name,
              p.phone AS patient_phone, p.avatar_url AS patient_avatar
       FROM conversations c
       JOIN patients p ON p.id = c.patient_id
       WHERE c.organization_id = $1 AND c.doctor_id = $2 AND c.is_active = true
       ORDER BY c.last_message_at DESC NULLS LAST`,
      [orgId, doctorId],
    );
  }

  async getMessages(orgId: string, conversationId: string, query?: { since?: string; limit?: number }) {
    const limit = Math.min(query?.limit || 50, 100);
    let where = 'WHERE m.conversation_id = $1';
    const params: any[] = [conversationId];
    let idx = 2;

    if (query?.since) {
      where += ` AND m.created_at > $${idx}::timestamptz`;
      params.push(query.since);
      idx++;
    }

    params.push(limit);
    return this.db.queryMany(
      `SELECT m.* FROM messages m ${where} ORDER BY m.created_at DESC LIMIT $${idx}`,
      params,
    );
  }

  async sendMessage(orgId: string, doctorId: string, dto: SendMessageDto) {
    let conversationId = dto.conversationId;

    if (!conversationId && dto.patientId) {
      let conv = await this.db.queryOne(
        `SELECT id FROM conversations WHERE organization_id = $1 AND doctor_id = $2 AND patient_id = $3`,
        [orgId, doctorId, dto.patientId],
      );

      if (!conv) {
        conv = await this.db.queryOne(
          `INSERT INTO conversations (organization_id, doctor_id, patient_id)
           VALUES ($1, $2, $3) RETURNING id`,
          [orgId, doctorId, dto.patientId],
        );
      }
      conversationId = conv.id;
    }

    if (!conversationId) throw new NotFoundException('Conversación no encontrada');

    const message = await this.db.queryOne(
      `INSERT INTO messages (
        conversation_id, sender_type, sender_id, message_type,
        content, attachment_url, attachment_name, prescription_id, appointment_id
      ) VALUES ($1, 'doctor', $2, $3, $4, $5, $6, $7, $8)
      RETURNING *`,
      [
        conversationId, doctorId, dto.messageType || 'text',
        dto.content, dto.attachmentUrl, dto.attachmentName,
        dto.prescriptionId, dto.appointmentId,
      ],
    );

    await this.db.query(
      `UPDATE conversations SET last_message_text = $1, last_message_at = NOW(), patient_unread_count = patient_unread_count + 1
       WHERE id = $2`,
      [dto.content, conversationId],
    );

    return message;
  }

  async markAsRead(orgId: string, doctorId: string, conversationId: string) {
    await this.db.query(
      `UPDATE messages SET is_read = true, read_at = NOW()
       WHERE conversation_id = $1 AND sender_type = 'patient' AND is_read = false`,
      [conversationId],
    );
    await this.db.query(
      `UPDATE conversations SET doctor_unread_count = 0 WHERE id = $1`,
      [conversationId],
    );
    return { message: 'Mensajes marcados como leídos' };
  }

  async getNewMessages(orgId: string, doctorId: string, since: string) {
    return this.db.queryMany(
      `SELECT m.*, c.patient_id
       FROM messages m
       JOIN conversations c ON c.id = m.conversation_id
       WHERE c.organization_id = $1 AND c.doctor_id = $2
         AND m.created_at > $3::timestamptz
       ORDER BY m.created_at ASC`,
      [orgId, doctorId, since],
    );
  }
}
