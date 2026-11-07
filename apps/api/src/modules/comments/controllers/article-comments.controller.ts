import {
  Controller,
  Patch,
  Delete,
  Param,
  Body,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiOkResponse,
  ApiNoContentResponse,
  ApiBadRequestResponse,
  ApiUnauthorizedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiConflictResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../../auth/decorators/current-user.decorator.js';
import { VerifiedEmailGuard } from '../../../common/authorization/guards/verified-email.guard.js';
import type { AuthenticatedUser } from '../../auth/types/jwt.types.js';
import { ArticleCommentsService } from '../services/article-comments.service.js';
import { UpdateCommentDto } from '../dto/update-comment.dto.js';
import { PublicCommentResponseDto } from '../dto/public-comment-response.dto.js';

@ApiTags('article-comments')
@Controller('comments')
@UseGuards(VerifiedEmailGuard)
export class ArticleCommentsController {
  constructor(private readonly service: ArticleCommentsService) {}

  @Patch(':commentId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Edit an owned visible comment',
    description: 'Allows an authenticated comment author to update the body of their own visible comment.',
  })
  @ApiOkResponse({ type: PublicCommentResponseDto })
  @ApiBadRequestResponse({ description: 'Validation failed.' })
  @ApiUnauthorizedResponse({ description: 'Authentication required.' })
  @ApiForbiddenResponse({ description: 'Cannot edit comments authored by another user.' })
  @ApiNotFoundResponse({ description: 'Comment not found.' })
  @ApiConflictResponse({ description: 'Comment has been moderated and cannot be edited.' })
  async updateComment(
    @CurrentUser() user: AuthenticatedUser,
    @Param('commentId', new ParseUUIDPipe({ version: '4' })) commentId: string,
    @Body() dto: UpdateCommentDto,
  ): Promise<PublicCommentResponseDto> {
    return this.service.updateComment(user, commentId, dto);
  }

  @Delete(':commentId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Physically delete an owned comment',
    description: 'Permanently deletes an owned comment from the database.',
  })
  @ApiNoContentResponse({ description: 'Comment deleted successfully.' })
  @ApiUnauthorizedResponse({ description: 'Authentication required.' })
  @ApiForbiddenResponse({ description: 'Cannot delete comments authored by another user.' })
  @ApiNotFoundResponse({ description: 'Comment not found.' })
  async deleteComment(
    @CurrentUser() user: AuthenticatedUser,
    @Param('commentId', new ParseUUIDPipe({ version: '4' })) commentId: string,
  ): Promise<void> {
    return this.service.deleteComment(user, commentId);
  }
}

