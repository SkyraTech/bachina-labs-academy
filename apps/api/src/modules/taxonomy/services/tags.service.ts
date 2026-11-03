import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Tag } from '@prisma/client';
import { TagsRepository } from '../repositories/tags.repository.js';
import type { CreateTagDto } from '../dto/create-tag.dto.js';
import type { UpdateTagDto } from '../dto/update-tag.dto.js';
import type { ListTagsQueryDto } from '../dto/list-tags-query.dto.js';
import type { TagResponseDto } from '../dto/tag-response.dto.js';
import type { PaginatedTagsResponseDto } from '../dto/paginated-tags-response.dto.js';

@Injectable()
export class TagsService {
  private readonly logger = new Logger(TagsService.name);

  constructor(private readonly tagsRepo: TagsRepository) {}

  async create(dto: CreateTagDto): Promise<TagResponseDto> {
    const normalizedSlug = dto.slug.trim().toLowerCase();

    // Pre-check for duplicate slug
    const existing = await this.tagsRepo.findBySlug(normalizedSlug);
    if (existing) {
      throw new ConflictException(
        `Tag with slug "${normalizedSlug}" already exists.`,
      );
    }

    try {
      const created = await this.tagsRepo.create({
        name: dto.name.trim(),
        slug: normalizedSlug,
      });

      return this.mapToResponse(created);
    } catch (err: unknown) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException(
          `Tag with slug "${normalizedSlug}" already exists.`,
        );
      }
      throw err;
    }
  }

  async findById(id: string): Promise<TagResponseDto> {
    const tag = await this.tagsRepo.findById(id);
    if (!tag) {
      throw new NotFoundException(`Tag with id "${id}" not found.`);
    }
    return this.mapToResponse(tag);
  }

  async findBySlug(slug: string): Promise<TagResponseDto> {
    const normalizedSlug = slug.trim().toLowerCase();
    const tag = await this.tagsRepo.findBySlug(normalizedSlug);
    if (!tag) {
      throw new NotFoundException(`Tag with slug "${normalizedSlug}" not found.`);
    }
    return this.mapToResponse(tag);
  }

  async update(id: string, dto: UpdateTagDto): Promise<TagResponseDto> {
    if (dto.name === undefined && dto.slug === undefined) {
      throw new BadRequestException('At least one field must be provided for update.');
    }

    const existing = await this.tagsRepo.findById(id);
    if (!existing) {
      throw new NotFoundException(`Tag with id "${id}" not found.`);
    }

    let normalizedSlug: string | undefined;
    if (dto.slug !== undefined) {
      normalizedSlug = dto.slug.trim().toLowerCase();
      const slugCollision = await this.tagsRepo.findBySlug(normalizedSlug);
      if (slugCollision && slugCollision.id !== id) {
        throw new ConflictException(
          `Tag with slug "${normalizedSlug}" already exists.`,
        );
      }
    }

    try {
      const updated = await this.tagsRepo.update(id, {
        name: dto.name !== undefined ? dto.name.trim() : undefined,
        slug: normalizedSlug,
      });

      return this.mapToResponse(updated);
    } catch (err: unknown) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException(
          `Tag with slug "${normalizedSlug ?? dto.slug}" already exists.`,
        );
      }
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2025'
      ) {
        throw new NotFoundException(`Tag with id "${id}" not found.`);
      }
      throw err;
    }
  }

  async delete(id: string): Promise<void> {
    const existing = await this.tagsRepo.findById(id);
    if (!existing) {
      throw new NotFoundException(`Tag with id "${id}" not found.`);
    }

    try {
      await this.tagsRepo.delete(id);
    } catch (err: unknown) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2025'
      ) {
        throw new NotFoundException(`Tag with id "${id}" not found.`);
      }
      throw err;
    }
  }

  async list(query: ListTagsQueryDto): Promise<PaginatedTagsResponseDto> {
    const page = query.page && query.page > 0 ? query.page : 1;
    const limit = query.limit && query.limit > 0 ? query.limit : 20;

    const { items, total } = await this.tagsRepo.list(page, limit);
    const totalPages = total === 0 ? 0 : Math.ceil(total / limit);

    return {
      items: items.map((t) => this.mapToResponse(t)),
      page,
      limit,
      total,
      totalPages,
    };
  }

  private mapToResponse(tag: Tag): TagResponseDto {
    return {
      id: tag.id,
      name: tag.name,
      slug: tag.slug,
      createdAt: tag.createdAt,
      updatedAt: tag.updatedAt,
    };
  }
}

