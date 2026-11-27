import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthUser } from '../../common/guards/auth.guard';
import { PlataformaService, Servicio } from './plataforma.service';

@Controller('api/v1')
export class PlataformaController {
  constructor(private plataforma: PlataformaService) {}

  /** GET /admin/servicios — solo administradores */
  @Get('admin/servicios')
  listar(@CurrentUser() u: AuthUser) {
    return this.plataforma.listar(u.doctorId);
  }

  /** PUT /admin/servicios/:id { activo } */
  @Put('admin/servicios/:id')
  cambiar(@CurrentUser() u: AuthUser, @Param('id') id: Servicio, @Body() b: { activo: boolean }) {
    return this.plataforma.cambiar(u.doctorId, id, !!b?.activo);
  }
}
