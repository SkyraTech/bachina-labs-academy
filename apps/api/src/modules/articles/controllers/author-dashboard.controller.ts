import { Controller, Get, HttpCode, HttpStatus, UseGuards } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiOkResponse,
  ApiUnauthorizedResponse,
  ApiForbiddenResponse,
} from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { AuthorDashboardService } from '../services/author-dashboard.service.js';
import { AuthorDashboardResponseDto } from '../dto/author-dashboard-response.dto.js';
import { CurrentUser } from '../../auth/decorators/current-user.decorator.js';
import { Roles } from '../../../common/authorization/decorators/roles.decorator.js';
import { VerifiedEmailGuard } from '../../../common/authorization/guards/verified-email.guard.js';
import type { AuthenticatedUser } from '../../auth/types/jwt.types.js';

@ApiTags('author-dashboard')
@Controller('author/dashboard')
@Roles(UserRole.AUTHOR, UserRole.ADMIN)
@UseGuards(VerifiedEmailGuard)
export class AuthorDashboardController {
  constructor(private readonly dashboardService: AuthorDashboardService) {}

  /**
   * GET /api/v1/author/dashboard
   *
   * Retrieves authoritative operational metrics and recently updated articles
   * strictly scoped to the authenticated author.
   */
  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Retrieve author studio dashboard metrics and recent articles',
    description:
      'Returns authoritative database counts for total, draft, published, and archived articles, along with the author’s 5 most recently updated articles.',
  })
  @ApiOkResponse({
    description: 'Author dashboard metrics and recent articles retrieved successfully.',
    type: AuthorDashboardResponseDto,
  })
  @ApiUnauthorizedResponse({ description: 'Authentication required or account inactive.' })
  @ApiForbiddenResponse({ description: 'Insufficient permissions or email unverified.' })
  async getDashboard(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<AuthorDashboardResponseDto> {
    return this.dashboardService.getDashboardData(user);
  }
}
