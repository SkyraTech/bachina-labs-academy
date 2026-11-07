import {
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Body,
  Query,
  Param,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiNoContentResponse,
  ApiUnauthorizedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiBadRequestResponse,
  ApiConflictResponse,
} from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { ArticlesService } from '../services/articles.service.js';
import { CreateArticleDto } from '../dto/create-article.dto.js';
import { UpdateArticleDto } from '../dto/update-article.dto.js';
import { DeleteArticleQueryDto } from '../dto/delete-article-query.dto.js';
import { ListArticlesQueryDto } from '../dto/list-articles-query.dto.js';
import type { ArticleResponseDto } from '../dto/article-response.dto.js';
import type { PaginatedArticlesResponseDto } from '../dto/paginated-articles-response.dto.js';
import type { ArticleDetailResponseDto } from '../dto/article-detail-response.dto.js';
import { CurrentUser } from '../../auth/decorators/current-user.decorator.js';
import { Roles } from '../../../common/authorization/decorators/roles.decorator.js';
import { VerifiedEmailGuard } from '../../../common/authorization/guards/verified-email.guard.js';
import type { AuthenticatedUser } from '../../auth/types/jwt.types.js';

@ApiTags('articles')
@Controller('articles')
export class ArticlesController {
  constructor(private readonly articlesService: ArticlesService) {}

  /**
   * POST /api/v1/articles
   *
   * Creates a new draft article owned by the authenticated author.
   *
   * Preconditions:
   * - Valid JWT authentication.
   * - Role: AUTHOR or ADMIN.
   * - Account: ACTIVE.
   * - Email: Verified.
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Roles(UserRole.AUTHOR, UserRole.ADMIN)
  @UseGuards(VerifiedEmailGuard)
  @ApiOperation({ summary: 'Create a new draft article' })
  @ApiCreatedResponse({ description: 'Draft article created successfully.' })
  @ApiBadRequestResponse({ description: 'Validation failed or invalid cover media.' })
  @ApiUnauthorizedResponse({ description: 'Authentication required.' })
  @ApiForbiddenResponse({ description: 'Insufficient permissions or email unverified.' })
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateArticleDto,
  ): Promise<ArticleResponseDto> {
    return this.articlesService.createDraft(user, dto);
  }

  /**
   * GET /api/v1/articles/mine
   *
   * Lists articles owned by the authenticated author with pagination and optional status filter.
   */
  @Get('mine')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.AUTHOR, UserRole.ADMIN)
  @UseGuards(VerifiedEmailGuard)
  @ApiOperation({ summary: 'List articles owned by the authenticated author' })
  @ApiOkResponse({ description: 'Paginated list of author articles.' })
  @ApiBadRequestResponse({ description: 'Invalid query parameters.' })
  @ApiUnauthorizedResponse({ description: 'Authentication required.' })
  @ApiForbiddenResponse({ description: 'Insufficient permissions or email unverified.' })
  async listMine(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListArticlesQueryDto,
  ): Promise<PaginatedArticlesResponseDto> {
    return this.articlesService.listMyArticles(user, query);
  }

  /**
   * GET /api/v1/articles/:articleId
   *
   * Retrieves a single privately owned editable article including its draft blocks.
   * Returns 404 if the article does not exist or belongs to another author (information disclosure prevention).
   */
  @Get(':articleId')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.AUTHOR, UserRole.ADMIN)
  @UseGuards(VerifiedEmailGuard)
  @ApiOperation({ summary: 'Retrieve an editable draft article by ID' })
  @ApiOkResponse({ description: 'Article draft details retrieved.' })
  @ApiBadRequestResponse({ description: 'Invalid article UUID.' })
  @ApiUnauthorizedResponse({ description: 'Authentication required.' })
  @ApiForbiddenResponse({ description: 'Insufficient permissions or email unverified.' })
  @ApiNotFoundResponse({ description: 'Article not found.' })
  async getById(
    @CurrentUser() user: AuthenticatedUser,
    @Param('articleId', new ParseUUIDPipe({ version: '4' })) articleId: string,
  ): Promise<ArticleDetailResponseDto> {
    return this.articlesService.getPrivateArticle(user, articleId);
  }

  /**
   * PATCH /api/v1/articles/:articleId
   *
   * Updates an owned article's editable draft metadata using optimistic concurrency control.
   */
  @Patch(':articleId')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.AUTHOR, UserRole.ADMIN)
  @UseGuards(VerifiedEmailGuard)
  @ApiOperation({ summary: 'Update draft metadata for an owned article' })
  @ApiOkResponse({ description: 'Article draft metadata updated successfully.' })
  @ApiBadRequestResponse({ description: 'Validation failed or invalid cover media.' })
  @ApiUnauthorizedResponse({ description: 'Authentication required.' })
  @ApiForbiddenResponse({ description: 'Insufficient permissions or email unverified.' })
  @ApiNotFoundResponse({ description: 'Article not found.' })
  @ApiConflictResponse({ description: 'Draft revision conflict or invalid lifecycle state.' })
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('articleId', new ParseUUIDPipe({ version: '4' })) articleId: string,
    @Body() dto: UpdateArticleDto,
  ): Promise<ArticleResponseDto> {
    return this.articlesService.updateDraftMetadata(user, articleId, dto);
  }

  /**
   * DELETE /api/v1/articles/:articleId
   *
   * Safely deletes an eligible draft article owned by the author with no publication history.
   */
  @Delete(':articleId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(UserRole.AUTHOR, UserRole.ADMIN)
  @UseGuards(VerifiedEmailGuard)
  @ApiOperation({ summary: 'Delete an eligible draft article' })
  @ApiNoContentResponse({ description: 'Draft article deleted successfully.' })
  @ApiBadRequestResponse({ description: 'Invalid article UUID or query parameters.' })
  @ApiUnauthorizedResponse({ description: 'Authentication required.' })
  @ApiForbiddenResponse({ description: 'Insufficient permissions or email unverified.' })
  @ApiNotFoundResponse({ description: 'Article not found.' })
  @ApiConflictResponse({ description: 'Article has publication history, active snapshots, or revision conflict.' })
  async delete(
    @CurrentUser() user: AuthenticatedUser,
    @Param('articleId', new ParseUUIDPipe({ version: '4' })) articleId: string,
    @Query() query: DeleteArticleQueryDto,
  ): Promise<void> {
    await this.articlesService.deleteEligibleDraft(user, articleId, query);
  }

  /**
   * POST /api/v1/articles/:articleId/duplicate
   *
   * Duplicates an owned article into a separate new draft.
   */
  @Post(':articleId/duplicate')
  @HttpCode(HttpStatus.CREATED)
  @Roles(UserRole.AUTHOR, UserRole.ADMIN)
  @UseGuards(VerifiedEmailGuard)
  @ApiOperation({ summary: 'Duplicate an owned article into a new draft' })
  @ApiCreatedResponse({ description: 'Article duplicated successfully.' })
  @ApiBadRequestResponse({ description: 'Invalid article UUID.' })
  @ApiUnauthorizedResponse({ description: 'Authentication required.' })
  @ApiForbiddenResponse({ description: 'Insufficient permissions or email unverified.' })
  @ApiNotFoundResponse({ description: 'Article not found.' })
  async duplicate(
    @CurrentUser() user: AuthenticatedUser,
    @Param('articleId', new ParseUUIDPipe({ version: '4' })) articleId: string,
  ): Promise<ArticleDetailResponseDto> {
    return this.articlesService.duplicateArticle(user, articleId);
  }
}

