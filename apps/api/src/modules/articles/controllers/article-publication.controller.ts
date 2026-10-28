import {
  Controller,
  Post,
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
  ApiBadRequestResponse,
  ApiUnauthorizedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiConflictResponse,
} from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { ArticlePublicationService } from '../services/article-publication.service.js';
import { PublishArticleDto } from '../dto/publish-article.dto.js';
import { ArticlePublicationResponseDto } from '../dto/article-publication-response.dto.js';
import { CurrentUser } from '../../auth/decorators/current-user.decorator.js';
import { Roles } from '../../../common/authorization/decorators/roles.decorator.js';
import { VerifiedEmailGuard } from '../../../common/authorization/guards/verified-email.guard.js';
import type { AuthenticatedUser } from '../../auth/types/jwt.types.js';

@ApiTags('articles')
@Controller('articles')
export class ArticlePublicationController {
  constructor(
    private readonly publicationService: ArticlePublicationService,
  ) {}

  /**
   * POST /api/v1/articles/:articleId/publish
   *
   * Publishes an owned article draft or republishes an edited published article.
   *
   * Preconditions:
   * - Valid JWT authentication.
   * - Role: AUTHOR or ADMIN.
   * - Account: ACTIVE.
   * - Email: Verified.
   * - Article ownership strictly verified.
   * - Concurrency: expectedRevision must match current draftRevision.
   */
  @Post(':articleId/publish')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.AUTHOR, UserRole.ADMIN)
  @UseGuards(VerifiedEmailGuard)
  @ApiOperation({
    summary: 'Publish an owned article draft or republish an edited article',
  })
  @ApiOkResponse({
    description: 'Article published successfully.',
    type: ArticlePublicationResponseDto,
  })
  @ApiBadRequestResponse({
    description:
      'Invalid request DTO, empty article, invalid draft blocks, or invalid UUID.',
  })
  @ApiUnauthorizedResponse({
    description: 'Authentication required.',
  })
  @ApiForbiddenResponse({
    description: 'Insufficient permissions or unverified email.',
  })
  @ApiNotFoundResponse({
    description: 'Article not found (or belongs to another author).',
  })
  @ApiConflictResponse({
    description:
      'Revision conflict, article archived, no unpublished changes, or published slug collision.',
  })
  async publishArticle(
    @CurrentUser() user: AuthenticatedUser,
    @Param('articleId', new ParseUUIDPipe({ version: '4' })) articleId: string,
    @Body() dto: PublishArticleDto,
  ): Promise<ArticlePublicationResponseDto> {
    return this.publicationService.publishArticle(user, articleId, dto);
  }
}
