import { Controller, Get, Put, Delete, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { DoctorId } from '../../common/decorators/current-user.decorator';
import { ProfileService } from './profile.service';
import { UpdateProfileDto, UpdateSignatureDto } from '../../common/dto/profile.dto';

@Controller('api/v1/profile')
export class ProfileController {
  constructor(private profileService: ProfileService) {}

  /** GET /api/v1/profile — current doctor profile */
  @Get()
  getProfile(@DoctorId() doctorId: string) {
    return this.profileService.getProfile(doctorId);
  }

  /** PUT /api/v1/profile — update profile fields */
  @Put()
  updateProfile(
    @DoctorId() doctorId: string,
    @Body() dto: UpdateProfileDto,
  ) {
    return this.profileService.updateProfile(doctorId, dto);
  }

  /** PUT /api/v1/profile/signature — upload signature image as base64 JSON */
  @Put('signature')
  @HttpCode(HttpStatus.OK)
  uploadSignature(
    @DoctorId() doctorId: string,
    @Body() dto: UpdateSignatureDto,
  ) {
    return this.profileService.uploadSignature(doctorId, dto.image);
  }

  /** DELETE /api/v1/profile/signature — remove signature */
  @Delete('signature')
  @HttpCode(HttpStatus.OK)
  deleteSignature(@DoctorId() doctorId: string) {
    return this.profileService.deleteSignature(doctorId);
  }
}
