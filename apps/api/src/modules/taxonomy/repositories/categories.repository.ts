import { Injectable } from '@nestjs/common';
import type { Category } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service.js';

export interface CreateCategoryData {
  name: string;
  slug: string;
  description?: string | null;
}

export interface UpdateCategoryData {
  name?: string;
  slug?: string;
  description?: string | null;
}

@Injectable()
export class CategoriesRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string): Promise<Category | null> {
    return this.prisma.category.findUnique({
      where: { id },
    });
  }

  async findBySlug(slug: string): Promise<Category | null> {
    return this.prisma.category.findUnique({
      where: { slug: slug.toLowerCase() },
    });
  }

  async create(data: CreateCategoryData): Promise<Category> {
    return this.prisma.category.create({
      data: {
        name: data.name,
        slug: data.slug.toLowerCase(),
        description: data.description ?? null,
      },
    });
  }

  async update(id: string, data: UpdateCategoryData): Promise<Category> {
    const updateData: Record<string, unknown> = {};
    if (data.name !== undefined) updateData['name'] = data.name;
    if (data.slug !== undefined) updateData['slug'] = data.slug.toLowerCase();
    if (data.description !== undefined) updateData['description'] = data.description;

    return this.prisma.category.update({
      where: { id },
      data: updateData,
    });
  }

  async delete(id: string): Promise<Category> {
    return this.prisma.category.delete({
      where: { id },
    });
  }

  async list(page: number, limit: number): Promise<{ items: Category[]; total: number }> {
    const skip = (page - 1) * limit;
    const [items, total] = await Promise.all([
      this.prisma.category.findMany({
        skip,
        take: limit,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      }),
      this.prisma.category.count(),
    ]);

    return { items, total };
  }
}

