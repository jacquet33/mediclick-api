import { Controller, Get, Param, Res } from '@nestjs/common';
import { Response } from 'express';
import { join } from 'path';

@Controller()
export class BookingPageController {
  /** Página pública de reservas: /reservar/:slug */
  @Get('reservar/:slug')
  servePage(@Param('slug') slug: string, @Res() res: Response) {
    res.sendFile(join(__dirname, '..', '..', '..', 'public', 'reservar.html'));
  }

  /** Seguimiento de reserva: /turno/:token */
  @Get('turno/:token')
  serveStatus(@Param('token') token: string, @Res() res: Response) {
    res.sendFile(join(__dirname, '..', '..', '..', 'public', 'reservar.html'));
  }
}
