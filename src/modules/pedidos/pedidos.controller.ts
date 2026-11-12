import { Body, Controller, Get, Headers, Param, Post, Query } from '@nestjs/common';
import { Public } from '../../common/guards/auth.guard';
import { PublicThrottle, StrictThrottle } from '../../common/decorators/throttle.decorator';
import { PedidosService } from './pedidos.service';

/** Paciente: elegir farmacia, enviar la receta y seguir el pedido */
@Public()
@PublicThrottle()
@Controller('api/v1/pedidos')
export class PedidosController {
  constructor(private svc: PedidosService) {}

  @Get('farmacias')
  farmacias(@Query('q') q?: string) { return this.svc.farmacias(q); }

  @StrictThrottle()
  @Post()
  crear(@Body() b: any) { return this.svc.crear(b || {}); }

  @Get('seguimiento/:token')
  seguimiento(@Param('token') t: string) { return this.svc.seguimiento(t); }

  @StrictThrottle()
  @Post('seguimiento/:token/cancelar')
  cancelar(@Param('token') t: string) { return this.svc.cancelar(t); }
}

/** Farmacia (X-Pharmacy-Key): pedidos recibidos */
@Public()
@PublicThrottle()
@Controller('api/v1/farmacia/pedidos')
export class PedidosFarmaciaController {
  constructor(private svc: PedidosService) {}

  @Get()
  listar(@Headers('x-pharmacy-key') key: string, @Query('estado') estado?: string) { return this.svc.listarFarmacia(key, estado); }

  @Post('config')
  config(@Headers('x-pharmacy-key') key: string, @Body() b: any) { return this.svc.configurar(key, b || {}); }

  @Post(':id/estado')
  estado(@Headers('x-pharmacy-key') key: string, @Param('id') id: string, @Body() b: any) { return this.svc.actualizarFarmacia(key, id, b || {}); }
}
