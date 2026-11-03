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
import { Roles } from '../../../common/authorization/decorators/roles.decorator.js';
import { CategoriesService } from '../services/categories.service.js';
import { CreateCategoryDto } from '../dto/create-category.dto.js';
import { UpdateCategoryDto } from '../dto/update-category.dto.js';
import { ListCategoriesQueryDto } from '../dto/list-categories-query.dto.js';
import { CategoryResponseDto } from '../dto/category-response.dto.js';
import { PaginatedCategoriesResponseDto } from '../dto/paginated-categories-response.dto.js';

@ApiTags('admin-categories')
@Controller('admin/categories')
@Roles(UserRole.ADMIN)
export class AdminCategoriesController {
  constructor(private readonly categoriesService: CategoriesService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new category (Administrator only)' })
  @ApiCreatedResponse({
    description: 'Category created successfully',
    type: CategoryResponseDto,
  })
  @ApiBadRequestResponse({ description: 'Validation failed' })
  @ApiConflictResponse({ description: 'Category slug already exists' })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiForbiddenResponse({ description: 'Administrator privileges required' })
  async create(@Body() dto: CreateCategoryDto): Promise<CategoryResponseDto> {
    return this.categoriesService.create(dto);
  }

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'List categories with pagination (Administrator only)' })
  @ApiOkResponse({
    description: 'Paginated list of categories',
    type: PaginatedCategoriesResponseDto,
  })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiForbiddenResponse({ description: 'Administrator privileges required' })
  async list(
    @Query() query: ListCategoriesQueryDto,
  ): Promise<PaginatedCategoriesResponseDto> {
    return this.categoriesService.list(query);
  }

  @Get(':categoryId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get category detail by ID (Administrator only)' })
  @ApiOkResponse({
    description: 'Category detail',
    type: CategoryResponseDto,
  })
  @ApiNotFoundResponse({ description: 'Category not found' })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiForbiddenResponse({ description: 'Administrator privileges required' })
  async findById(
    @Param('categoryId', new ParseUUIDPipe({ version: '4' })) categoryId: string,
  ): Promise<CategoryResponseDto> {
    return this.categoriesService.findById(categoryId);
  }

  @Patch(':categoryId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update a category (Administrator only)' })
  @ApiOkResponse({
    description: 'Category updated successfully',
    type: CategoryResponseDto,
  })
  @ApiBadRequestResponse({ description: 'Validation failed or empty update payload' })
  @ApiNotFoundResponse({ description: 'Category not found' })
  @ApiConflictResponse({ description: 'Category slug collision' })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiForbiddenResponse({ description: 'Administrator privileges required' })
  async update(
    @Param('categoryId', new ParseUUIDPipe({ version: '4' })) categoryId: string,
    @Body() dto: UpdateCategoryDto,
  ): Promise<CategoryResponseDto> {
    return this.categoriesService.update(categoryId, dto);
  }

  @Delete(':categoryId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a category (Administrator only)' })
  @ApiNoContentResponse({ description: 'Category deleted successfully' })
  @ApiNotFoundResponse({ description: 'Category not found' })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiForbiddenResponse({ description: 'Administrator privileges required' })
  async delete(
    @Param('categoryId', new ParseUUIDPipe({ version: '4' })) categoryId: string,
  ): Promise<void> {
    return this.categoriesService.delete(categoryId);
  }
}

