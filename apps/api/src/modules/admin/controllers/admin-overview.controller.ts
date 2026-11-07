import { Controller, Get, HttpCode, HttpStatus } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiOkResponse,
  ApiUnauthorizedResponse,
  ApiForbiddenResponse,
} from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { Roles } from '../../../common/authorization/decorators/roles.decorator.js';
import { AdminOverviewService } from '../services/admin-overview.service.js';
import { AdminOverviewResponseDto } from '../dto/admin-overview-response.dto.js';

@ApiTags('admin-overview')
@Controller('admin/overview')
@Roles(UserRole.ADMIN)
export class AdminOverviewController {
  constructor(private readonly overviewService: AdminOverviewService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Retrieve authoritative platform oversight metrics (Administrator only)' })
  @ApiOkResponse({
    description: 'Platform metrics calculated from verified persistence store',
    type: AdminOverviewResponseDto,
  })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiForbiddenResponse({ description: 'Administrator privileges required' })
  async getOverviewMetrics(): Promise<AdminOverviewResponseDto> {
    return this.overviewService.getOverviewMetrics();
  }
}

