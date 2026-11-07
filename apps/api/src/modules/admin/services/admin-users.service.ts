import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service.js';
import { ListAdminUsersQueryDto } from '../dto/list-admin-users-query.dto.js';
import { AdminUserItemResponseDto } from '../dto/admin-user-item-response.dto.js';
import { PaginatedAdminUsersResponseDto } from '../dto/paginated-admin-users-response.dto.js';

@Injectable()
export class AdminUsersService {
  constructor(private readonly prisma: PrismaService) {}

  async listUsers(query: ListAdminUsersQueryDto): Promise<PaginatedAdminUsersResponseDto> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const where: Prisma.UserWhereInput = {};

    if (query.role) {
      where.role = query.role;
    }
    if (query.status) {
      where.status = query.status;
    }
    if (query.q) {
      const term = query.q.trim();
      if (term) {
        where.email = { contains: term, mode: 'insensitive' };
      }
    }

    const [total, users] = await Promise.all([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        select: {
          id: true,
          email: true,
          role: true,
          status: true,
          emailVerifiedAt: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
    ]);

    const items: AdminUserItemResponseDto[] = users.map((u) => ({
      id: u.id,
      email: u.email,
      role: u.role,
      status: u.status,
      isEmailVerified: u.emailVerifiedAt !== null,
      createdAt: u.createdAt.toISOString(),
      updatedAt: u.updatedAt.toISOString(),
    }));

    const totalPages = Math.ceil(total / limit) || (total === 0 ? 0 : 1);

    return {
      items,
      total,
      page,
      limit,
      totalPages,
    };
  }

  async getUserById(id: string): Promise<AdminUserItemResponseDto> {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        role: true,
        status: true,
        emailVerifiedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!user) {
      throw new NotFoundException(`User with id '${id}' not found`);
    }

    return {
      id: user.id,
      email: user.email,
      role: user.role,
      status: user.status,
      isEmailVerified: user.emailVerifiedAt !== null,
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
    };
  }
}

