import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Category } from '@prisma/client';
import { CategoriesRepository } from '../repositories/categories.repository.js';
import type { CreateCategoryDto } from '../dto/create-category.dto.js';
import type { UpdateCategoryDto } from '../dto/update-category.dto.js';
import type { ListCategoriesQueryDto } from '../dto/list-categories-query.dto.js';
import type { CategoryResponseDto } from '../dto/category-response.dto.js';
import type { PaginatedCategoriesResponseDto } from '../dto/paginated-categories-response.dto.js';

@Injectable()
export class CategoriesService {
  private readonly logger = new Logger(CategoriesService.name);

  constructor(private readonly categoriesRepo: CategoriesRepository) {}

  async create(dto: CreateCategoryDto): Promise<CategoryResponseDto> {
    const normalizedSlug = dto.slug.trim().toLowerCase();

    // Pre-check for duplicate slug
    const existing = await this.categoriesRepo.findBySlug(normalizedSlug);
    if (existing) {
      throw new ConflictException(
        `Category with slug "${normalizedSlug}" already exists.`,
      );
    }

    try {
      const created = await this.categoriesRepo.create({
        name: dto.name.trim(),
        slug: normalizedSlug,
        description: dto.description?.trim() ?? null,
      });

      return this.mapToResponse(created);
    } catch (err: unknown) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException(
          `Category with slug "${normalizedSlug}" already exists.`,
        );
      }
      throw err;
    }
  }

  async findById(id: string): Promise<CategoryResponseDto> {
    const category = await this.categoriesRepo.findById(id);
    if (!category) {
      throw new NotFoundException(`Category with id "${id}" not found.`);
    }
    return this.mapToResponse(category);
  }

  async findBySlug(slug: string): Promise<CategoryResponseDto> {
    const normalizedSlug = slug.trim().toLowerCase();
    const category = await this.categoriesRepo.findBySlug(normalizedSlug);
    if (!category) {
      throw new NotFoundException(`Category with slug "${normalizedSlug}" not found.`);
    }
    return this.mapToResponse(category);
  }

  async update(id: string, dto: UpdateCategoryDto): Promise<CategoryResponseDto> {
    if (
      dto.name === undefined &&
      dto.slug === undefined &&
      dto.description === undefined
    ) {
      throw new BadRequestException('At least one field must be provided for update.');
    }

    const existing = await this.categoriesRepo.findById(id);
    if (!existing) {
      throw new NotFoundException(`Category with id "${id}" not found.`);
    }

    let normalizedSlug: string | undefined;
    if (dto.slug !== undefined) {
      normalizedSlug = dto.slug.trim().toLowerCase();
      const slugCollision = await this.categoriesRepo.findBySlug(normalizedSlug);
      if (slugCollision && slugCollision.id !== id) {
        throw new ConflictException(
          `Category with slug "${normalizedSlug}" already exists.`,
        );
      }
    }

    try {
      const updated = await this.categoriesRepo.update(id, {
        name: dto.name !== undefined ? dto.name.trim() : undefined,
        slug: normalizedSlug,
        description:
          dto.description !== undefined ? dto.description.trim() : undefined,
      });

      return this.mapToResponse(updated);
    } catch (err: unknown) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException(
          `Category with slug "${normalizedSlug ?? dto.slug}" already exists.`,
        );
      }
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2025'
      ) {
        throw new NotFoundException(`Category with id "${id}" not found.`);
      }
      throw err;
    }
  }

  async delete(id: string): Promise<void> {
    const existing = await this.categoriesRepo.findById(id);
    if (!existing) {
      throw new NotFoundException(`Category with id "${id}" not found.`);
    }

    try {
      await this.categoriesRepo.delete(id);
    } catch (err: unknown) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2025'
      ) {
        throw new NotFoundException(`Category with id "${id}" not found.`);
      }
      throw err;
    }
  }

  async list(query: ListCategoriesQueryDto): Promise<PaginatedCategoriesResponseDto> {
    const page = query.page && query.page > 0 ? query.page : 1;
    const limit = query.limit && query.limit > 0 ? query.limit : 20;

    const { items, total } = await this.categoriesRepo.list(page, limit);
    const totalPages = total === 0 ? 0 : Math.ceil(total / limit);

    return {
      items: items.map((c) => this.mapToResponse(c)),
      page,
      limit,
      total,
      totalPages,
    };
  }

  private mapToResponse(category: Category): CategoryResponseDto {
    return {
      id: category.id,
      name: category.name,
      slug: category.slug,
      description: category.description,
      createdAt: category.createdAt,
      updatedAt: category.updatedAt,
    };
  }
}

