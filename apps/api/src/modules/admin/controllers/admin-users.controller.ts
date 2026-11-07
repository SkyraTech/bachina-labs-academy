import {
  Controller,
  Get,
  Query,
  Param,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiOkResponse,
  ApiUnauthorizedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
} from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { Roles } from '../../../common/authorization/decorators/roles.decorator.js';
import { AdminUsersService } from '../services/admin-users.service.js';
import { ListAdminUsersQueryDto } from '../dto/list-admin-users-query.dto.js';
import { AdminUserItemResponseDto } from '../dto/admin-user-item-response.dto.js';
import { PaginatedAdminUsersResponseDto } from '../dto/paginated-admin-users-response.dto.js';

@ApiTags('admin-users')
@Controller('admin/users')
@Roles(UserRole.ADMIN)
export class AdminUsersController {
  constructor(private readonly usersService: AdminUsersService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'List user directory with safe field allowlist (Administrator only)' })
  @ApiOkResponse({
    description: 'Paginated user list with zero sensitive credentials',
    type: PaginatedAdminUsersResponseDto,
  })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiForbiddenResponse({ description: 'Administrator privileges required' })
  async listUsers(
    @Query() query: ListAdminUsersQueryDto,
  ): Promise<PaginatedAdminUsersResponseDto> {
    return this.usersService.listUsers(query);
  }

  @Get(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get user account details by ID (Administrator only)' })
  @ApiOkResponse({
    description: 'User details with credential exclusion',
    type: AdminUserItemResponseDto,
  })
  @ApiNotFoundResponse({ description: 'User not found' })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiForbiddenResponse({ description: 'Administrator privileges required' })
  async getUserById(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AdminUserItemResponseDto> {
    return this.usersService.getUserById(id);
  }
}

