import {
  Controller,
  Get,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  ApiTags,
  ApiOperation,
  ApiOkResponse,
  ApiBadRequestResponse,
  ApiNotFoundResponse,
} from '@nestjs/swagger';
import { Public } from '../../auth/decorators/public.decorator.js';
import { ArticlePublicReaderService } from '../services/article-public-reader.service.js';
import { ArticleMediaService } from '../services/article-media.service.js';
import { PublicArticlesQueryDto } from '../dto/public-articles-query.dto.js';
import { PublicArticleListResponseDto } from '../dto/public-article-list-response.dto.js';
import { PublicArticleDetailResponseDto } from '../dto/public-article-detail-response.dto.js';

@ApiTags('articles-public')
@Controller('articles/public')
export class ArticlePublicReaderController {
  constructor(
    private readonly readerService: ArticlePublicReaderService,
    private readonly mediaService: ArticleMediaService,
  ) {}

  /**
   * GET /api/v1/articles/public/media/:mediaId
   *
   * Delivers public image content for active published snapshot media.
   * Anonymous access permitted only if referenced by the current immutable snapshot
   * of an eligible PUBLISHED article.
   */
  @Public()
  @Get('media/:mediaId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Retrieve public image content for published article media',
    description:
      'Delivers image binary bytes only if retained by the current active snapshot of an eligible published article.',
  })
  @ApiOkResponse({ description: 'Binary image content.' })
  @ApiBadRequestResponse({ description: 'Invalid media UUID.' })
  @ApiNotFoundResponse({ description: 'Media not found or not currently published.' })
  async getPublicMediaContent(
    @Param('mediaId', new ParseUUIDPipe({ version: '4' })) mediaId: string,
    @Res() res: Response,
  ): Promise<void> {
    const content = await this.mediaService.getPublicMediaContent(mediaId);

    res.setHeader('Content-Type', content.mimeType);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'public, max-age=300, must-revalidate');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${encodeURIComponent(content.originalFilename)}"`,
    );

    res.end(content.buffer);
  }

  /**
   * GET /api/v1/articles/public
   *
   * Lists published articles with pagination. Accessible to anonymous visitors.
   */
  @Public()
  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'List published articles with pagination',
    description:
      'Returns a paginated list of published articles sourced exclusively from active immutable publication snapshots.',
  })
  @ApiOkResponse({
    description: 'Paginated list of published articles.',
    type: PublicArticleListResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Invalid pagination query parameters.',
  })
  async listPublishedArticles(
    @Query() query: PublicArticlesQueryDto,
  ): Promise<PublicArticleListResponseDto> {
    return this.readerService.listPublishedArticles(query);
  }

  /**
   * GET /api/v1/articles/public/:slug
   *
   * Retrieves a published article by its current published slug. Accessible to anonymous visitors.
   */
  @Public()
  @Get(':slug')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Retrieve a published article by its current published slug',
    description:
      'Returns the full article and its ordered immutable content blocks sourced exclusively from the active publication snapshot.',
  })
  @ApiOkResponse({
    description: 'Published article detail and immutable content blocks.',
    type: PublicArticleDetailResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Invalid article slug format.',
  })
  @ApiNotFoundResponse({
    description: 'Article not found or not currently published.',
  })
  async getPublishedArticleBySlug(
    @Param('slug') slug: string,
  ): Promise<PublicArticleDetailResponseDto> {
    return this.readerService.getPublishedArticleBySlug(slug);
  }
}
