import { Controller, ForbiddenException, Get, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthUser, Public } from '../../common/guards/auth.guard';
import { MedicamentosService } from './medicamentos.service';

/** Catálogo de medicamentos para la receta: GET /medicamentos?q= · /medicamentos/presentaciones · /medicamentos/estado */
@Controller('api/v1/medicamentos')
export class MedicamentosController {
  constructor(private svc: MedicamentosService) {}

  @Get()
  buscar(@Query('q') q = '', @Query('limit') limit?: string) {
    return this.svc.buscar(String(q).slice(0, 80), limit ? parseInt(limit, 10) : 30);
  }

  @Get('presentaciones')
  presentaciones(@Query('droga') droga = '', @Query('marca') marca?: string) {
    return this.svc.presentaciones(String(droga).slice(0, 200), marca ? String(marca).slice(0, 200) : undefined);
  }

  @Public()
  @Get('estado')
  estado() { return this.svc.estado(); }

  /** Fuerza la actualización desde datos.gob.ar (solo administradores de la plataforma) */
  @Post('actualizar')
  async actualizar(@CurrentUser() u: AuthUser) {
    if (!u.isPlatformAdmin) throw new ForbiddenException();
    return this.svc.importar();
  }
}
