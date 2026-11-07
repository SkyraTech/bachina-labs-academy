import {
  Controller,
  Get,
  Put,
  Body,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiOkResponse,
  ApiBadRequestResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../../../auth/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../../../auth/types/jwt.types.js';
import { UserProfilesService } from '../services/user-profiles.service.js';
import { UpdateUserProfileDto } from '../dto/update-user-profile.dto.js';
import { UserProfileResponseDto } from '../dto/user-profile-response.dto.js';

@ApiTags('account-profile')
@Controller('account/profile')
export class UserProfilesController {
  constructor(private readonly service: UserProfilesService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Get current user profile',
    description: 'Retrieves the authenticated user profile display name or safe fallback.',
  })
  @ApiOkResponse({ type: UserProfileResponseDto })
  @ApiUnauthorizedResponse({ description: 'Authentication required.' })
  async getProfile(@CurrentUser() user: AuthenticatedUser): Promise<UserProfileResponseDto> {
    return this.service.getProfile(user.id);
  }

  @Put()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Update current user profile',
    description: 'Updates or creates the authenticated user profile display name.',
  })
  @ApiOkResponse({ type: UserProfileResponseDto })
  @ApiBadRequestResponse({ description: 'Validation failed.' })
  @ApiUnauthorizedResponse({ description: 'Authentication required.' })
  async updateProfile(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateUserProfileDto,
  ): Promise<UserProfileResponseDto> {
    return this.service.updateProfile(user.id, dto);
  }
}

