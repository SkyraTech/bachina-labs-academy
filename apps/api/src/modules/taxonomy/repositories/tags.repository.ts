import { Injectable } from '@nestjs/common';
import type { Tag } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service.js';

export interface CreateTagData {
  name: string;
  slug: string;
}

export interface UpdateTagData {
  name?: string;
  slug?: string;
}

@Injectable()
export class TagsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string): Promise<Tag | null> {
    return this.prisma.tag.findUnique({
      where: { id },
    });
  }

  async findBySlug(slug: string): Promise<Tag | null> {
    return this.prisma.tag.findUnique({
      where: { slug: slug.toLowerCase() },
    });
  }

  async create(data: CreateTagData): Promise<Tag> {
    return this.prisma.tag.create({
      data: {
        name: data.name,
        slug: data.slug.toLowerCase(),
      },
    });
  }

  async update(id: string, data: UpdateTagData): Promise<Tag> {
    const updateData: Record<string, unknown> = {};
    if (data.name !== undefined) updateData['name'] = data.name;
    if (data.slug !== undefined) updateData['slug'] = data.slug.toLowerCase();

    return this.prisma.tag.update({
      where: { id },
      data: updateData,
    });
  }

  async delete(id: string): Promise<Tag> {
    return this.prisma.tag.delete({
      where: { id },
    });
  }

  async list(page: number, limit: number): Promise<{ items: Tag[]; total: number }> {
    const skip = (page - 1) * limit;
    const [items, total] = await Promise.all([
      this.prisma.tag.findMany({
        skip,
        take: limit,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      }),
      this.prisma.tag.count(),
    ]);

    return { items, total };
  }
}

