import { Controller, Get, Post, Delete, Body, Param, Query } from '@nestjs/common';
import { ChatbotService } from './chatbot.service';
import { Public } from '../../common/guards/auth.guard';
import { PublicThrottle } from '../../common/decorators/throttle.decorator';
import { OrgId, DoctorId } from '../../common/decorators/current-user.decorator';

// ═══ Público (widget en la web) ═══

@Public()
@PublicThrottle()
@Controller('api/v1/public/chatbot')
export class PublicChatbotController {
  constructor(private service: ChatbotService) {}

  @Get(':slug')
  getConfig(@Param('slug') slug: string) {
    return this.service.getConfig(slug);
  }

  @Post(':slug/ask')
  ask(@Param('slug') slug: string, @Body() body: { message: string }) {
    return this.service.ask(slug, body.message);
  }
}

// ═══ Privado (doctor configura su chatbot) ═══

@Controller('api/v1/chatbot')
export class ChatbotConfigController {
  constructor(private service: ChatbotService) {}

  @Post('config')
  async upsertConfig(
    @OrgId() orgId: string,
    @DoctorId() doctorId: string,
    @Body() dto: any,
  ) {
    const { DatabaseService } = require('../../database/database.service');
    // Get org_doctor_id
    const db = this.service['db'];
    const od = await db.queryOne(
      'SELECT id FROM organization_doctors WHERE organization_id = $1 AND doctor_id = $2',
      [orgId, doctorId],
    );
    if (!od) throw new Error('Doctor no encontrado en esta organización');
    return this.service.upsertConfig(od.id, dto);
  }

  @Post('faqs')
  async addFaq(@Body() body: { configId: string; question: string; keywords: string[]; answer: string; category?: string }) {
    return this.service.addFaq(body.configId, body);
  }

  @Delete('faqs/:id')
  removeFaq(@Param('id') id: string) {
    return this.service.removeFaq(id);
  }

  @Get('faqs/:configId')
  listFaqs(@Param('configId') id: string) {
    return this.service.listFaqs(id);
  }
}
