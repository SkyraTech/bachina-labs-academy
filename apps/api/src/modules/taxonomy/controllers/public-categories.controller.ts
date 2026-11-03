import {
  Controller,
  Get,
  Param,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiOkResponse,
  ApiNotFoundResponse,
} from '@nestjs/swagger';
import { Public } from '../../auth/decorators/public.decorator.js';
import { CategoriesService } from '../services/categories.service.js';
import { ListCategoriesQueryDto } from '../dto/list-categories-query.dto.js';
import { CategoryResponseDto } from '../dto/category-response.dto.js';
import { PaginatedCategoriesResponseDto } from '../dto/paginated-categories-response.dto.js';

@ApiTags('categories')
@Controller('categories')
@Public()
export class PublicCategoriesController {
  constructor(private readonly categoriesService: CategoriesService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'List categories for public discovery (Anonymous)' })
  @ApiOkResponse({
    description: 'Paginated list of categories',
    type: PaginatedCategoriesResponseDto,
  })
  async list(
    @Query() query: ListCategoriesQueryDto,
  ): Promise<PaginatedCategoriesResponseDto> {
    return this.categoriesService.list(query);
  }

  @Get(':slug')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get category details by slug for public discovery (Anonymous)' })
  @ApiOkResponse({
    description: 'Category detail',
    type: CategoryResponseDto,
  })
  @ApiNotFoundResponse({ description: 'Category not found' })
  async findBySlug(@Param('slug') slug: string): Promise<CategoryResponseDto> {
    return this.categoriesService.findBySlug(slug);
  }
}

