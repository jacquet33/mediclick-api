import { Body, Controller, Delete, ForbiddenException, Get, Param, Patch, Post, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { DocumentsService } from './documents.service';
import { AuditService } from '../audit/audit.service';
import { CurrentUser, OrgId } from '../../common/decorators/current-user.decorator';
import { AuthUser } from '../../common/guards/auth.guard';

function enviar(res: Response, r: any) {
  const nombre = (r.file_name || r.title || 'documento').replace(/[^\w.\- áéíóúñÁÉÍÓÚÑ]/g, '_');
  if (r.content) {
    res.setHeader('Content-Type', r.mime_type || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(nombre)}"`);
    res.setHeader('Cache-Control', 'private, no-store');
    return res.end(r.content);
  }
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'private, no-store');
  return res.end(`${r.title}\n\n${r.body_text || ''}`);
}

/** Documentos del paciente (solo el médico: forman parte de la historia clínica) */
@Controller('api/v1/patients/:patientId/documents')
export class PatientDocumentsController {
  constructor(private docs: DocumentsService, private audit: AuditService) {}

  private medico(u: AuthUser) {
    if (u.userType !== 'doctor') throw new ForbiddenException('Solo el médico accede a estudios y documentos clínicos');
  }

  @Get()
  listar(@OrgId() orgId: string, @CurrentUser() u: AuthUser, @Param('patientId') pid: string) {
    this.medico(u);
    return this.docs.listar(orgId, pid);
  }

  @Post()
  async crear(@OrgId() orgId: string, @CurrentUser() u: AuthUser, @Param('patientId') pid: string, @Body() b: any, @Req() req: Request) {
    this.medico(u);
    const r = await this.docs.crear(orgId, pid, u.doctorId, b);
    this.audit.logAccess(u.doctorId, 'doctor', 'UPLOAD_PATIENT_DOCUMENT', 'patient_documents', r.id, req.ip, req.headers['user-agent'] as string);
    return r;
  }

  @Patch(':id')
  compartir(@OrgId() orgId: string, @CurrentUser() u: AuthUser, @Param('patientId') pid: string, @Param('id') id: string, @Body() b: any) {
    this.medico(u);
    return this.docs.compartir(orgId, pid, id, b?.shared === true);
  }

  @Delete(':id')
  anular(@OrgId() orgId: string, @CurrentUser() u: AuthUser, @Param('patientId') pid: string, @Param('id') id: string, @Body() b: any) {
    this.medico(u);
    return this.docs.anular(orgId, pid, id, b?.reason);
  }

  @Get(':id/file')
  async archivo(@OrgId() orgId: string, @CurrentUser() u: AuthUser, @Param('patientId') pid: string, @Param('id') id: string, @Req() req: Request, @Res() res: Response) {
    this.medico(u);
    const r = await this.docs.archivo(orgId, pid, id);
    this.audit.logAccess(u.doctorId, 'doctor', 'VIEW_PATIENT_DOCUMENT', 'patient_documents', id, req.ip, req.headers['user-agent'] as string);
    return enviar(res, r);
  }
}

/** Portal del paciente: documentos que el consultorio le compartió */
@Controller('api/v1/me/documents')
export class MyDocumentsController {
  constructor(private docs: DocumentsService) {}

  @Get()
  listar(@CurrentUser() u: AuthUser) {
    if (u.userType !== 'patient') throw new ForbiddenException('Disponible para pacientes');
    return this.docs.misDocumentos(u.doctorId);
  }

  @Get(':id/file')
  async archivo(@CurrentUser() u: AuthUser, @Param('id') id: string, @Res() res: Response) {
    if (u.userType !== 'patient') throw new ForbiddenException('Disponible para pacientes');
    return enviar(res, await this.docs.miArchivo(u.doctorId, id));
  }
}
