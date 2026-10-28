import { Controller, Get, Param, Res } from '@nestjs/common';
import { Response } from 'express';
import { join } from 'path';
import { Public } from '../../common/guards/auth.guard';
import { PublicThrottle } from '../../common/decorators/throttle.decorator';

@Public()
@PublicThrottle()
@Controller()
export class BookingPageController {
  /** Página pública de reservas: /reservar/:slug */
  @Get('reservar/:slug')
  servePage(@Param('slug') slug: string, @Res() res: Response) {
    res.sendFile(join(__dirname, '..', '..', '..', 'public', 'reservar.html'));
  }

  /** Página con consultorio específico: /reservar/:slug/:orgSlug */
  @Get('reservar/:slug/:orgSlug')
  servePageWithOrg(@Param('slug') slug: string, @Param('orgSlug') orgSlug: string, @Res() res: Response) {
    res.sendFile(join(__dirname, '..', '..', '..', 'public', 'reservar.html'));
  }

  /** Alta del paciente en la cartilla del médico (sin turno): /registro/:slug */
  @Get('registro/:slug')
  serveRegistro(@Param('slug') slug: string, @Res() res: Response) {
    res.sendFile(join(__dirname, '..', '..', '..', 'public', 'registro.html'));
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
