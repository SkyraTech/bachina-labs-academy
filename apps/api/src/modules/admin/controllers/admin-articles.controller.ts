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
import { AdminArticlesService } from '../services/admin-articles.service.js';
import { ListAdminArticlesQueryDto } from '../dto/list-admin-articles-query.dto.js';
import { AdminArticleItemResponseDto } from '../dto/admin-article-item-response.dto.js';
import { PaginatedAdminArticlesResponseDto } from '../dto/paginated-admin-articles-response.dto.js';

@ApiTags('admin-articles')
@Controller('admin/articles')
@Roles(UserRole.ADMIN)
export class AdminArticlesController {
  constructor(private readonly articlesService: AdminArticlesService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'List articles across all lifecycle states (Administrator only)' })
  @ApiOkResponse({
    description: 'Paginated article list with draft and published metadata distinctions',
    type: PaginatedAdminArticlesResponseDto,
  })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiForbiddenResponse({ description: 'Administrator privileges required' })
  async listArticles(
    @Query() query: ListAdminArticlesQueryDto,
  ): Promise<PaginatedAdminArticlesResponseDto> {
    return this.articlesService.listArticles(query);
  }

  @Get(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get article details by ID (Administrator only)' })
  @ApiOkResponse({
    description: 'Article details showing draft metadata and published snapshot links',
    type: AdminArticleItemResponseDto,
  })
  @ApiNotFoundResponse({ description: 'Article not found' })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiForbiddenResponse({ description: 'Administrator privileges required' })
  async getArticleById(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AdminArticleItemResponseDto> {
    return this.articlesService.getArticleById(id);
  }
}

