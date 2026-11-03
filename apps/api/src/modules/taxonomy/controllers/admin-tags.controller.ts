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
import { TagsService } from '../services/tags.service.js';
import { CreateTagDto } from '../dto/create-tag.dto.js';
import { UpdateTagDto } from '../dto/update-tag.dto.js';
import { ListTagsQueryDto } from '../dto/list-tags-query.dto.js';
import { TagResponseDto } from '../dto/tag-response.dto.js';
import { PaginatedTagsResponseDto } from '../dto/paginated-tags-response.dto.js';

@ApiTags('admin-tags')
@Controller('admin/tags')
@Roles(UserRole.ADMIN)
export class AdminTagsController {
  constructor(private readonly tagsService: TagsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new tag (Administrator only)' })
  @ApiCreatedResponse({
    description: 'Tag created successfully',
    type: TagResponseDto,
  })
  @ApiBadRequestResponse({ description: 'Validation failed' })
  @ApiConflictResponse({ description: 'Tag slug already exists' })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiForbiddenResponse({ description: 'Administrator privileges required' })
  async create(@Body() dto: CreateTagDto): Promise<TagResponseDto> {
    return this.tagsService.create(dto);
  }

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'List tags with pagination (Administrator only)' })
  @ApiOkResponse({
    description: 'Paginated list of tags',
    type: PaginatedTagsResponseDto,
  })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiForbiddenResponse({ description: 'Administrator privileges required' })
  async list(@Query() query: ListTagsQueryDto): Promise<PaginatedTagsResponseDto> {
    return this.tagsService.list(query);
  }

  @Get(':tagId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get tag detail by ID (Administrator only)' })
  @ApiOkResponse({
    description: 'Tag detail',
    type: TagResponseDto,
  })
  @ApiNotFoundResponse({ description: 'Tag not found' })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiForbiddenResponse({ description: 'Administrator privileges required' })
  async findById(
    @Param('tagId', new ParseUUIDPipe({ version: '4' })) tagId: string,
  ): Promise<TagResponseDto> {
    return this.tagsService.findById(tagId);
  }

  @Patch(':tagId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update a tag (Administrator only)' })
  @ApiOkResponse({
    description: 'Tag updated successfully',
    type: TagResponseDto,
  })
  @ApiBadRequestResponse({ description: 'Validation failed or empty update payload' })
  @ApiNotFoundResponse({ description: 'Tag not found' })
  @ApiConflictResponse({ description: 'Tag slug collision' })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiForbiddenResponse({ description: 'Administrator privileges required' })
  async update(
    @Param('tagId', new ParseUUIDPipe({ version: '4' })) tagId: string,
    @Body() dto: UpdateTagDto,
  ): Promise<TagResponseDto> {
    return this.tagsService.update(tagId, dto);
  }

  @Delete(':tagId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a tag (Administrator only)' })
  @ApiNoContentResponse({ description: 'Tag deleted successfully' })
  @ApiNotFoundResponse({ description: 'Tag not found' })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiForbiddenResponse({ description: 'Administrator privileges required' })
  async delete(
    @Param('tagId', new ParseUUIDPipe({ version: '4' })) tagId: string,
  ): Promise<void> {
    return this.tagsService.delete(tagId);
  }
}

