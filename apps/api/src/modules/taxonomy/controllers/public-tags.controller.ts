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
import { TagsService } from '../services/tags.service.js';
import { ListTagsQueryDto } from '../dto/list-tags-query.dto.js';
import { TagResponseDto } from '../dto/tag-response.dto.js';
import { PaginatedTagsResponseDto } from '../dto/paginated-tags-response.dto.js';

@ApiTags('tags')
@Controller('tags')
@Public()
export class PublicTagsController {
  constructor(private readonly tagsService: TagsService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'List tags for public discovery (Anonymous)' })
  @ApiOkResponse({
    description: 'Paginated list of tags',
    type: PaginatedTagsResponseDto,
  })
  async list(@Query() query: ListTagsQueryDto): Promise<PaginatedTagsResponseDto> {
    return this.tagsService.list(query);
  }

  @Get(':slug')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get tag details by slug for public discovery (Anonymous)' })
  @ApiOkResponse({
    description: 'Tag detail',
    type: TagResponseDto,
  })
  @ApiNotFoundResponse({ description: 'Tag not found' })
  async findBySlug(@Param('slug') slug: string): Promise<TagResponseDto> {
    return this.tagsService.findBySlug(slug);
  }
}

