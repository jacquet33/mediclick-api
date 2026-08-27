import { Controller, Get, Post, Patch, Body, Param, Query, Res, Header } from '@nestjs/common';
import { Public } from '../../common/guards/auth.guard';
import { PrescriptionService, CreatePrescriptionDto } from './prescription.service';
import { PrescriptionPdfService } from './prescription-pdf.service';
import { OrgId, DoctorId } from '../../common/decorators/current-user.decorator';
import { Response } from 'express';

@Controller('api/v1/prescriptions')
export class PrescriptionController {
  constructor(
    private rxService: PrescriptionService,
    private pdfService: PrescriptionPdfService,
  ) {}

  @Get()
  findAll(
    @OrgId() orgId: string,
    @DoctorId() doctorId: string,
    @Query('patient_id') patientId?: string,
    @Query('status') status?: string,
    @Query('updated_since') updatedSince?: string,
  ) {
    return this.rxService.findAll(orgId, doctorId, { patientId, status, updatedSince });
  }

  @Public()
  @Get('verify/:code')
  verify(@Param('code') code: string) {
    return this.rxService.verify(code);
  }

  @Public()
  @Get('verify/:code/pdf')
  async verifyAndDownloadPdf(
    @Param('code') code: string,
    @Res() res: Response,
  ) {
    try {
      const rx = await this.rxService.verify(code);
      if (!rx) return res.status(404).json({ message: 'Receta no encontrada' });
      const buffer = await this.pdfService.generatePdf(rx.organization_id, rx.id);
      res.set({
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="receta-${code}.pdf"`,
        'Content-Length': buffer.length,
      });
      res.end(buffer);
    } catch (e) {
      res.status(500).json({ message: e.message || 'Error generando PDF' });
    }
  }

  @Get(':id/pdf')
  async downloadPdf(
    @OrgId() orgId: string,
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    try {
      console.log(`PDF request: prescriptionId=${id}, orgId=${orgId}`);
      const buffer = await this.pdfService.generatePdf(orgId, id);
      console.log(`PDF generated: ${buffer.length} bytes`);
      res.set({
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="receta-${id.slice(0, 8)}.pdf"`,
        'Content-Length': buffer.length,
      });
      res.end(buffer);
    } catch (e) {
      console.error(`PDF error: ${e.message}`, e.stack);
      res.status(500).json({ message: e.message || 'Error generando PDF', stack: e.stack?.split('\n').slice(0, 5) });
    }
  }

  @Get(':id/pdf-debug')
  async debugPdf(
    @OrgId() orgId: string,
    @Param('id') id: string,
  ) {
    // Returns the data that would be used to generate the PDF
    try {
      const rx = await this.rxService.findById(orgId, id);
      const pdfkitInstalled = (() => { try { require('pdfkit'); return true; } catch { return false; } })();
      return { ok: true, prescriptionFound: !!rx, pdfkitInstalled, orgId, id, prescription: rx };
    } catch (e) {
      return { ok: false, error: e.message, orgId, id };
    }
  }

  @Get(':id')
  findById(@OrgId() orgId: string, @Param('id') id: string) {
    return this.rxService.findById(orgId, id);
  }

  @Post()
  create(
    @OrgId() orgId: string,
    @DoctorId() doctorId: string,
    @Body() dto: CreatePrescriptionDto,
  ) {
    return this.rxService.create(orgId, doctorId, dto);
  }

  @Patch(':id/cancel')
  cancel(@OrgId() orgId: string, @Param('id') id: string) {
    return this.rxService.cancel(orgId, id);
  }
}
