import { Controller, Get, Param, Query } from '@nestjs/common';
import { AuditService } from './audit.service';
import { DoctorId } from '../../common/decorators/current-user.decorator';

@Controller('api/v1/audit')
export class AuditController {
  constructor(private auditService: AuditService) {}

  @Get('trail/:tableName/:recordId')
  getAuditTrail(
    @DoctorId() _doctorId: string, // ensures only authenticated doctors
    @Param('tableName') tableName: string,
    @Param('recordId') recordId: string,
  ) {
    return this.auditService.getAuditTrail(tableName, recordId);
  }

  @Get('access-logs')
  getAccessLogs(
    @DoctorId() _doctorId: string,
    @Query('user_id') userId?: string,
    @Query('action') action?: string,
    @Query('resource_type') resourceType?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.auditService.getAccessLogs({
      userId,
      action,
      resourceType,
      from,
      to,
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    });
  }
}
