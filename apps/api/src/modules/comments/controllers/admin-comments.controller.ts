import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Body,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiOkResponse,
  ApiBadRequestResponse,
  ApiUnauthorizedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
} from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { Roles } from '../../../common/authorization/decorators/roles.decorator.js';
import { CurrentUser } from '../../auth/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../../auth/types/jwt.types.js';
import { ArticleCommentsService } from '../services/article-comments.service.js';
import { AdminCommentsQueryDto } from '../dto/admin-comments-query.dto.js';
import { AdminRemoveCommentDto } from '../dto/admin-remove-comment.dto.js';
import {
  AdminCommentResponseDto,
  PaginatedAdminCommentsResponseDto,
} from '../dto/admin-comment-response.dto.js';

@ApiTags('admin-comments')
@Controller('admin/comments')
@Roles(UserRole.ADMIN)
export class AdminCommentsController {
  constructor(private readonly service: ArticleCommentsService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'List comments for admin moderation',
    description: 'Returns paginated comments with moderation metadata and 30-day retention body redaction.',
  })
  @ApiOkResponse({ type: PaginatedAdminCommentsResponseDto })
  @ApiUnauthorizedResponse({ description: 'Authentication required.' })
  @ApiForbiddenResponse({ description: 'Admin role required.' })
  async listComments(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: AdminCommentsQueryDto,
  ): Promise<PaginatedAdminCommentsResponseDto> {
    return this.service.listAdminComments(user, query);
  }

  @Post(':commentId/remove')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Soft-remove a comment with a moderation reason',
    description: 'Marks comment as REMOVED, excludes it from public views, and emits an audit event.',
  })
  @ApiOkResponse({ type: AdminCommentResponseDto })
  @ApiBadRequestResponse({ description: 'Invalid moderation reason.' })
  @ApiUnauthorizedResponse({ description: 'Authentication required.' })
  @ApiForbiddenResponse({ description: 'Admin role required.' })
  @ApiNotFoundResponse({ description: 'Comment not found.' })
  async removeComment(
    @CurrentUser() user: AuthenticatedUser,
    @Param('commentId', new ParseUUIDPipe({ version: '4' })) commentId: string,
    @Body() dto: AdminRemoveCommentDto,
  ): Promise<AdminCommentResponseDto> {
    return this.service.removeComment(user, commentId, dto);
  }
}
