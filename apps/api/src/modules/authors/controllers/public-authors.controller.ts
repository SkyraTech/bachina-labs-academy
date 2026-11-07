import {
  Controller,
  Get,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiOkResponse,
  ApiBadRequestResponse,
  ApiNotFoundResponse,
} from '@nestjs/swagger';
import { Public } from '../../auth/decorators/public.decorator.js';
import { PublicAuthorsService } from '../services/public-authors.service.js';
import { PublicAuthorResponseDto } from '../dto/public-author-response.dto.js';
import { PublicArticlesQueryDto } from '../../articles/dto/public-articles-query.dto.js';
import { PublicArticleListResponseDto } from '../../articles/dto/public-article-list-response.dto.js';

@ApiTags('authors')
@Controller('authors')
export class PublicAuthorsController {
  constructor(private readonly authorsService: PublicAuthorsService) {}

  /**
   * GET /api/v1/authors/:authorId
   *
   * Retrieves public author profile. Accessible to anonymous visitors.
   * Excludes private email, password hash, verification status, sessions, and draft articles.
   */
  @Public()
  @Get(':authorId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Retrieve public author profile',
    description: 'Returns safe public identity projection for an author without private data.',
  })
  @ApiOkResponse({
    description: 'Public author profile.',
    type: PublicAuthorResponseDto,
  })
  @ApiBadRequestResponse({ description: 'Invalid author UUID.' })
  @ApiNotFoundResponse({ description: 'Author not found or account is not active.' })
  async getAuthorProfile(
    @Param('authorId', new ParseUUIDPipe({ version: '4' })) authorId: string,
  ): Promise<PublicAuthorResponseDto> {
    return this.authorsService.getAuthorProfile(authorId);
  }

  /**
   * GET /api/v1/authors/:authorId/articles
   *
   * Lists published articles by a specific author. Accessible to anonymous visitors.
   */
  @Public()
  @Get(':authorId/articles')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'List published articles by author',
    description: 'Returns published articles for the specified author sourced from immutable snapshots.',
  })
  @ApiOkResponse({
    description: 'Paginated list of author published articles.',
    type: PublicArticleListResponseDto,
  })
  @ApiBadRequestResponse({ description: 'Invalid author UUID or query parameters.' })
  @ApiNotFoundResponse({ description: 'Author not found.' })
  async listAuthorPublishedArticles(
    @Param('authorId', new ParseUUIDPipe({ version: '4' })) authorId: string,
    @Query() query: PublicArticlesQueryDto,
  ): Promise<PublicArticleListResponseDto> {
    return this.authorsService.listAuthorPublishedArticles(authorId, query);
  }
}

