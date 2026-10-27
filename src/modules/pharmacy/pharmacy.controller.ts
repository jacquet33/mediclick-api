import { Controller, Get, Post, Body, Param, Query, Headers, Req, ForbiddenException } from '@nestjs/common';
import { Request } from 'express';
import { Public, AuthUser } from '../../common/guards/auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PublicThrottle } from '../../common/decorators/throttle.decorator';
import { PharmacyService } from './pharmacy.service';

/** API para farmacias: header X-Pharmacy-Key */
@Public()
@PublicThrottle()
@Controller('api/v1/farmacia')
export class PharmacyApiController {
  constructor(private service: PharmacyService) {}

  @Get('me')
  async me(@Headers('x-pharmacy-key') key: string) {
    const ph = await this.service.autenticar(key);
    return { id: ph.id, nombre: ph.name, farmaceutico: ph.pharmacist_name, ciudad: ph.city, provincia: ph.province };
  }

  /** GET /farmacia/recetas?codigo=XXXX&dni=NNNN — la receta que se está dispensando */
  @Get('recetas')
  consultar(@Headers('x-pharmacy-key') key: string, @Query('codigo') codigo: string, @Query('dni') dni: string, @Req() req: Request) {
    return this.service.consultar(key, codigo, dni, req.ip);
  }

  /** POST /farmacia/recetas/:codigo/dispensar { dni, items: [{ itemId, cantidad, producto?, lote?, vencimiento? }], farmaceutico?, notas? } */
  @Post('recetas/:codigo/dispensar')
  dispensar(@Headers('x-pharmacy-key') key: string, @Param('codigo') codigo: string, @Body() body: any, @Req() req: Request) {
    return this.service.dispensar(key, codigo, body, req.ip);
  }
}

/** Alta y gestión de farmacias (administrador de la plataforma) */
@Controller('api/v1/admin/pharmacies')
export class PharmacyAdminController {
  constructor(private service: PharmacyService) {}
  private admin(u: AuthUser) { if (u.userType !== 'doctor') throw new ForbiddenException(); return u.doctorId; }

  @Get() listar(@CurrentUser() u: AuthUser) { return this.service.listar(this.admin(u)); }
  @Post() crear(@CurrentUser() u: AuthUser, @Body() dto: any) { return this.service.crear(this.admin(u), dto); }
  @Post(':id/regenerate-key') regenerar(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.service.regenerar(this.admin(u), id); }
  @Post(':id/activate') activar(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.service.activar(this.admin(u), id, true); }
  @Post(':id/deactivate') desactivar(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.service.activar(this.admin(u), id, false); }
}
