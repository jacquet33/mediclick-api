import { Controller, Get, Param, Res } from '@nestjs/common';
import { Response } from 'express';
import { join } from 'path';
import { Public } from '../../common/guards/auth.guard';

@Public()
@Controller()
export class BookingPageController {
  /** Página pública de reservas: /reservar/:slug */
  @Get('reservar/:slug')
  servePage(@Param('slug') slug: string, @Res() res: Response) {
    res.sendFile(join(__dirname, '..', '..', '..', 'public', 'reservar.html'));
  }

  /** Panel de cobertura del hub: /cobertura */
  @Get('cobertura')
  serveCoverage(@Res() res: Response) {
    res.sendFile(join(__dirname, '..', '..', '..', 'public', 'cobertura.html'));
  }

  /** Seguimiento de reserva: /turno/:token */
  @Get('turno/:token')
  serveStatus(@Param('token') token: string, @Res() res: Response) {
    res.sendFile(join(__dirname, '..', '..', '..', 'public', 'reservar.html'));
  }
}
