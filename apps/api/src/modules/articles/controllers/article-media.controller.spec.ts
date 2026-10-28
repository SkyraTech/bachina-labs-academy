import { Test, TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Response } from 'express';
import { UserRole, UserStatus } from '@prisma/client';
import { ArticleMediaController } from './article-media.controller.js';
import { ArticleMediaService } from '../services/article-media.service.js';
import { ROLES_KEY } from '../../../common/authorization/decorators/roles.decorator.js';
import type { AuthenticatedUser } from '../../auth/types/jwt.types.js';

describe('ArticleMediaController', () => {
  let controller: ArticleMediaController;
  let reflector: Reflector;
  let serviceMock: {
    uploadImage: ReturnType<typeof vi.fn>;
    listMyMedia: ReturnType<typeof vi.fn>;
    getPrivateMediaContent: ReturnType<typeof vi.fn>;
  };

  const proto = ArticleMediaController.prototype as unknown as Record<
    string,
    (...args: unknown[]) => unknown
  >;

  const mockUser: AuthenticatedUser = {
    id: 'u1111111-0000-4000-8000-000000000001',
    email: 'author@bachinalabs.com',
    role: UserRole.AUTHOR,
    status: UserStatus.ACTIVE,
    emailVerifiedAt: new Date(),
    sessionId: 'sess-1',
  };

  beforeEach(async () => {
    serviceMock = {
      uploadImage: vi.fn(),
      listMyMedia: vi.fn(),
      getPrivateMediaContent: vi.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ArticleMediaController],
      providers: [
        Reflector,
        {
          provide: ArticleMediaService,
          useValue: serviceMock,
        },
      ],
    }).compile();

    controller = module.get<ArticleMediaController>(ArticleMediaController);
    reflector = module.get<Reflector>(Reflector);
  });

  describe('Route security decorators', () => {
    it('requires AUTHOR and ADMIN roles on upload, listMine, and getPrivateContent', () => {
      const uploadRoles = reflector.get<UserRole[]>(ROLES_KEY, proto['upload']);
      expect(uploadRoles).toEqual([UserRole.AUTHOR, UserRole.ADMIN]);

      const listRoles = reflector.get<UserRole[]>(ROLES_KEY, proto['listMine']);
      expect(listRoles).toEqual([UserRole.AUTHOR, UserRole.ADMIN]);

      const contentRoles = reflector.get<UserRole[]>(ROLES_KEY, proto['getPrivateContent']);
      expect(contentRoles).toEqual([UserRole.AUTHOR, UserRole.ADMIN]);
    });
  });

  describe('Method delegations', () => {
    it('delegates upload to mediaService.uploadImage', async () => {
      const mockResult = {
        id: 'm1111111-0000-4000-8000-000000000001',
        originalFilename: 'test.webp',
        mimeType: 'image/webp',
        fileSize: 1024,
        mediaType: 'IMAGE',
        width: null,
        height: null,
        altText: null,
        createdAt: '2026-10-26T12:00:00.000Z',
      };
      serviceMock.uploadImage.mockResolvedValue(mockResult);

      const fakeFile = {
        fieldname: 'file',
        originalname: 'test.webp',
        mimetype: 'image/webp',
        size: 1024,
        buffer: Buffer.from('test'),
      };

      const result = await controller.upload(mockUser, fakeFile);

      expect(serviceMock.uploadImage).toHaveBeenCalledWith(mockUser, fakeFile);
      expect(result).toEqual(mockResult);
    });

    it('delegates listMine to mediaService.listMyMedia', async () => {
      const mockResult = {
        items: [],
        page: 1,
        limit: 20,
        total: 0,
        totalPages: 0,
      };
      serviceMock.listMyMedia.mockResolvedValue(mockResult);

      const result = await controller.listMine(mockUser, { page: 1, limit: 20 });

      expect(serviceMock.listMyMedia).toHaveBeenCalledWith(mockUser, { page: 1, limit: 20 });
      expect(result).toEqual(mockResult);
    });

    it('delegates getPrivateContent to mediaService and sets security headers', async () => {
      const mediaId = 'm1111111-0000-4000-8000-000000000001';
      const mockContent = {
        buffer: Buffer.from('private-image-bytes'),
        mimeType: 'image/webp',
        originalFilename: 'private.webp',
        fileSize: 20,
      };
      serviceMock.getPrivateMediaContent.mockResolvedValue(mockContent);

      let ended = false;
      const setHeader = vi.fn();
      const end = vi.fn((_buf: Buffer) => {
        ended = true;
      });
      const resMock = {
        setHeader,
        end,
      } as unknown as Response;

      await controller.getPrivateContent(mockUser, mediaId, resMock);

      expect(serviceMock.getPrivateMediaContent).toHaveBeenCalledWith(mockUser, mediaId);
      expect(setHeader).toHaveBeenCalledWith('Content-Type', 'image/webp');
      expect(setHeader).toHaveBeenCalledWith('X-Content-Type-Options', 'nosniff');
      expect(setHeader).toHaveBeenCalledWith(
        'Cache-Control',
        'private, no-cache, no-store, must-revalidate',
      );
      expect(end).toHaveBeenCalledWith(mockContent.buffer);
      expect(ended).toBe(true);
    });
  });
});
