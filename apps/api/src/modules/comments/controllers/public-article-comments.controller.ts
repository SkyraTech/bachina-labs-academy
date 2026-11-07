import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Body,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiOkResponse,
  ApiCreatedResponse,
  ApiBadRequestResponse,
  ApiUnauthorizedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
} from '@nestjs/swagger';
import { Public } from '../../auth/decorators/public.decorator.js';
import { CurrentUser } from '../../auth/decorators/current-user.decorator.js';
import { VerifiedEmailGuard } from '../../../common/authorization/guards/verified-email.guard.js';
import type { AuthenticatedUser } from '../../auth/types/jwt.types.js';
import { ArticleCommentsService } from '../services/article-comments.service.js';
import { CreateCommentDto } from '../dto/create-comment.dto.js';
import { PublicCommentsQueryDto } from '../dto/public-comments-query.dto.js';
import {
  PublicCommentResponseDto,
  PaginatedPublicCommentsResponseDto,
} from '../dto/public-comment-response.dto.js';

@ApiTags('article-comments-public')
@Controller('articles/public')
export class PublicArticleCommentsController {
  constructor(private readonly service: ArticleCommentsService) {}

  @Public()
  @Get(':publishedSlug/comments')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'List visible comments for a published article',
    description: 'Retrieves publicly visible comments with safe author attribution and pagination.',
  })
  @ApiOkResponse({ type: PaginatedPublicCommentsResponseDto })
  @ApiNotFoundResponse({ description: 'Published article not found.' })
  async listComments(
    @Param('publishedSlug') publishedSlug: string,
    @Query() query: PublicCommentsQueryDto,
  ): Promise<PaginatedPublicCommentsResponseDto> {
    return this.service.listPublicComments(publishedSlug, query);
  }

  @Post(':publishedSlug/comments')
  @UseGuards(VerifiedEmailGuard)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create a flat comment on a published article',
    description: 'Creates a new plain-text comment linked to the article and its current active snapshot revision.',
  })
  @ApiCreatedResponse({ type: PublicCommentResponseDto })
  @ApiBadRequestResponse({ description: 'Validation failed.' })
  @ApiUnauthorizedResponse({ description: 'Authentication required.' })
  @ApiForbiddenResponse({ description: 'Active verified account required.' })
  @ApiNotFoundResponse({ description: 'Published article not found.' })
  async createComment(
    @CurrentUser() user: AuthenticatedUser,
    @Param('publishedSlug') publishedSlug: string,
    @Body() dto: CreateCommentDto,
  ): Promise<PublicCommentResponseDto> {
    return this.service.createComment(user, publishedSlug, dto);
  }
}

