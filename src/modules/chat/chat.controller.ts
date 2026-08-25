import { Controller, Get, Post, Patch, Body, Param, Query, Headers } from '@nestjs/common';
import { ChatService, SendMessageDto } from './chat.service';

@Controller('api/v1')
export class ChatController {
  constructor(private chatService: ChatService) {}

  @Get('conversations')
  getConversations(
    @Headers('x-organization-id') orgId: string,
    @Headers('x-doctor-id') doctorId: string,
  ) {
    return this.chatService.getConversations(orgId, doctorId);
  }

  @Get('conversations/:id/messages')
  getMessages(
    @Headers('x-organization-id') orgId: string,
    @Param('id') conversationId: string,
    @Query('since') since?: string,
    @Query('limit') limit?: string,
  ) {
    return this.chatService.getMessages(orgId, conversationId, {
      since, limit: limit ? parseInt(limit) : 50,
    });
  }

  @Post('messages')
  sendMessage(
    @Headers('x-organization-id') orgId: string,
    @Headers('x-doctor-id') doctorId: string,
    @Body() dto: SendMessageDto,
  ) {
    return this.chatService.sendMessage(orgId, doctorId, dto);
  }

  @Patch('conversations/:id/read')
  markAsRead(
    @Headers('x-organization-id') orgId: string,
    @Headers('x-doctor-id') doctorId: string,
    @Param('id') conversationId: string,
  ) {
    return this.chatService.markAsRead(orgId, doctorId, conversationId);
  }

  @Get('messages')
  getNewMessages(
    @Headers('x-organization-id') orgId: string,
    @Headers('x-doctor-id') doctorId: string,
    @Query('since') since: string,
  ) {
    return this.chatService.getNewMessages(orgId, doctorId, since);
  }
}
