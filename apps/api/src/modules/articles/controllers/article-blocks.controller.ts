import {
  Controller,
  Post,
  Patch,
  Delete,
  Put,
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
import { ArticleBlocksService } from '../services/article-blocks.service.js';
import { CreateArticleBlockDto } from '../dto/create-article-block.dto.js';
import { UpdateArticleBlockDto } from '../dto/update-article-block.dto.js';
import { DeleteArticleBlockQueryDto } from '../dto/delete-article-block-query.dto.js';
import { ReorderArticleBlocksDto } from '../dto/reorder-article-blocks.dto.js';
import type {
  ArticleBlockWithRevisionDto,
  ReorderBlocksResponseDto,
} from '../dto/article-block-response.dto.js';
import { CurrentUser } from '../../auth/decorators/current-user.decorator.js';
import { Roles } from '../../../common/authorization/decorators/roles.decorator.js';
import { VerifiedEmailGuard } from '../../../common/authorization/guards/verified-email.guard.js';
import type { AuthenticatedUser } from '../../auth/types/jwt.types.js';

@ApiTags('article-blocks')
@Controller('articles')
export class ArticleBlocksController {
  constructor(private readonly articleBlocksService: ArticleBlocksService) {}

  /**
   * POST /api/v1/articles/:articleId/blocks
   *
   * Appends a new content block to an article draft.
   */
  @Post(':articleId/blocks')
  @HttpCode(HttpStatus.CREATED)
  @Roles(UserRole.AUTHOR, UserRole.ADMIN)
  @UseGuards(VerifiedEmailGuard)
  @ApiOperation({ summary: 'Create a new content block on an article draft' })
  @ApiCreatedResponse({ description: 'Block created successfully.' })
  @ApiBadRequestResponse({ description: 'Invalid block payload, schema error, or invalid UUID.' })
  @ApiUnauthorizedResponse({ description: 'Authentication required.' })
  @ApiForbiddenResponse({ description: 'Insufficient permissions or unverified email.' })
  @ApiNotFoundResponse({ description: 'Article or media asset not found.' })
  @ApiConflictResponse({ description: 'Draft revision conflict or archived lifecycle state.' })
  async createBlock(
    @CurrentUser() user: AuthenticatedUser,
    @Param('articleId', new ParseUUIDPipe({ version: '4' })) articleId: string,
    @Body() dto: CreateArticleBlockDto,
  ): Promise<ArticleBlockWithRevisionDto> {
    return this.articleBlocksService.createBlock(user, articleId, dto);
  }

  /**
   * PUT /api/v1/articles/:articleId/blocks/order
   *
   * Atomically reorders all blocks for an article using deferrable unique constraints.
   */
  @Put(':articleId/blocks/order')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.AUTHOR, UserRole.ADMIN)
  @UseGuards(VerifiedEmailGuard)
  @ApiOperation({ summary: 'Atomically reorder all draft blocks for an article' })
  @ApiOkResponse({ description: 'Blocks reordered successfully.' })
  @ApiBadRequestResponse({ description: 'Invalid block ID list, duplicate IDs, or missing blocks.' })
  @ApiUnauthorizedResponse({ description: 'Authentication required.' })
  @ApiForbiddenResponse({ description: 'Insufficient permissions or unverified email.' })
  @ApiNotFoundResponse({ description: 'Article not found.' })
  @ApiConflictResponse({ description: 'Draft revision conflict or archived lifecycle state.' })
  async reorderBlocks(
    @CurrentUser() user: AuthenticatedUser,
    @Param('articleId', new ParseUUIDPipe({ version: '4' })) articleId: string,
    @Body() dto: ReorderArticleBlocksDto,
  ): Promise<ReorderBlocksResponseDto> {
    return this.articleBlocksService.reorderBlocks(user, articleId, dto);
  }

  /**
   * PATCH /api/v1/articles/:articleId/blocks/:blockId
   *
   * Updates mutable attributes of an existing draft block.
   */
  @Patch(':articleId/blocks/:blockId')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.AUTHOR, UserRole.ADMIN)
  @UseGuards(VerifiedEmailGuard)
  @ApiOperation({ summary: 'Update an existing draft content block' })
  @ApiOkResponse({ description: 'Block updated successfully.' })
  @ApiBadRequestResponse({ description: 'Invalid content, prohibited mutation, or invalid UUID.' })
  @ApiUnauthorizedResponse({ description: 'Authentication required.' })
  @ApiForbiddenResponse({ description: 'Insufficient permissions or unverified email.' })
  @ApiNotFoundResponse({ description: 'Article or block not found.' })
  @ApiConflictResponse({ description: 'Draft revision conflict or archived lifecycle state.' })
  async updateBlock(
    @CurrentUser() user: AuthenticatedUser,
    @Param('articleId', new ParseUUIDPipe({ version: '4' })) articleId: string,
    @Param('blockId', new ParseUUIDPipe({ version: '4' })) blockId: string,
    @Body() dto: UpdateArticleBlockDto,
  ): Promise<ArticleBlockWithRevisionDto> {
    return this.articleBlocksService.updateBlock(user, articleId, blockId, dto);
  }

  /**
   * DELETE /api/v1/articles/:articleId/blocks/:blockId?expectedRevision=N
   *
   * Deletes a draft block and compacts remaining positions contiguously.
   */
  @Delete(':articleId/blocks/:blockId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(UserRole.AUTHOR, UserRole.ADMIN)
  @UseGuards(VerifiedEmailGuard)
  @ApiOperation({ summary: 'Delete a draft block and compact positions' })
  @ApiNoContentResponse({ description: 'Block deleted successfully.' })
  @ApiBadRequestResponse({ description: 'Missing or invalid expectedRevision query parameter, or invalid UUID.' })
  @ApiUnauthorizedResponse({ description: 'Authentication required.' })
  @ApiForbiddenResponse({ description: 'Insufficient permissions or unverified email.' })
  @ApiNotFoundResponse({ description: 'Article or block not found.' })
  @ApiConflictResponse({ description: 'Draft revision conflict or archived lifecycle state.' })
  async deleteBlock(
    @CurrentUser() user: AuthenticatedUser,
    @Param('articleId', new ParseUUIDPipe({ version: '4' })) articleId: string,
    @Param('blockId', new ParseUUIDPipe({ version: '4' })) blockId: string,
    @Query() query: DeleteArticleBlockQueryDto,
  ): Promise<void> {
    await this.articleBlocksService.deleteBlock(user, articleId, blockId, query);
  }
}
