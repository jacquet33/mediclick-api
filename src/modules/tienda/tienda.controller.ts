import { Body, Controller, Get, Headers, Param, Post, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import { Public } from '../../common/guards/auth.guard';
import { PublicThrottle, StrictThrottle } from '../../common/decorators/throttle.decorator';
import { TiendaService } from './tienda.service';

/** Tienda pública de cada farmacia y notificaciones de Mercado Pago */
@Public()
@PublicThrottle()
@Controller('api/v1/tienda')
export class TiendaController {
  constructor(private svc: TiendaService) {}

  @Get('mp/callback')
  async callback(@Query('code') code: string, @Query('state') state: string, @Res() res: Response) {
    res.redirect(302, await this.svc.mpCallback(code, state));
  }

  @Post('mp/webhook')
  webhook(@Query('pedido') pedido: string, @Body() body: any, @Query() q: any) { return this.svc.webhook(pedido, body, q); }

  @Get('pedido/:token')
  seguimiento(@Param('token') t: string) { return this.svc.seguimiento(t); }

  @Get(':slug')
  publica(@Param('slug') slug: string) { return this.svc.publica(slug); }

  @StrictThrottle()
  @Post(':slug/pedidos')
  crear(@Param('slug') slug: string, @Body() b: any) { return this.svc.crearPedido(slug, b || {}); }
}

/** Panel de la tienda para la farmacia (X-Pharmacy-Key) */
@Public()
@PublicThrottle()
@Controller('api/v1/farmacia/tienda')
export class TiendaFarmaciaController {
  constructor(private svc: TiendaService) {}

  @Get()
  mia(@Headers('x-pharmacy-key') k: string) { return this.svc.mia(k); }

  @Post()
  guardar(@Headers('x-pharmacy-key') k: string, @Body() b: any) { return this.svc.guardarTienda(k, b || {}); }

  @Post('sucursales')
  sucursal(@Headers('x-pharmacy-key') k: string, @Body() b: any) { return this.svc.guardarSucursal(k, b || {}); }

  @Get('productos')
  productos(@Headers('x-pharmacy-key') k: string, @Query('q') q?: string) { return this.svc.productos(k, q); }

  @Post('productos')
  producto(@Headers('x-pharmacy-key') k: string, @Body() b: any) { return this.svc.guardarProducto(k, b || {}); }

  @Post('productos/importar')
  importar(@Headers('x-pharmacy-key') k: string, @Body('texto') t: string) { return this.svc.importar(k, t); }

  @Get('pedidos')
  pedidos(@Headers('x-pharmacy-key') k: string, @Query('estado') e?: string) { return this.svc.pedidosFarmacia(k, e !== 'todos'); }

  @Post('pedidos/:id/estado')
  estado(@Headers('x-pharmacy-key') k: string, @Param('id') id: string, @Body('estado') e: string) { return this.svc.estadoPedido(k, id, e); }

  @Get('mp/conectar')
  conectar(@Headers('x-pharmacy-key') k: string) { return this.svc.mpConectarUrl(k); }

  @Post('mp/desconectar')
  desconectar(@Headers('x-pharmacy-key') k: string) { return this.svc.mpDesconectar(k); }
}
