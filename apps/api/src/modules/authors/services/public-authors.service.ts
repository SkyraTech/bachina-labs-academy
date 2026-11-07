import { Injectable, NotFoundException } from '@nestjs/common';
import { PublicAuthorsRepository } from '../repositories/public-authors.repository.js';
import { ArticlePublicReaderService } from '../../articles/services/article-public-reader.service.js';
import type { PublicAuthorResponseDto } from '../dto/public-author-response.dto.js';
import type { PublicArticlesQueryDto } from '../../articles/dto/public-articles-query.dto.js';
import type { PublicArticleListResponseDto } from '../../articles/dto/public-article-list-response.dto.js';

@Injectable()
export class PublicAuthorsService {
  constructor(
    private readonly repository: PublicAuthorsRepository,
    private readonly readerService: ArticlePublicReaderService,
  ) {}

  /**
   * Retrieves public author profile by author UUID.
   * Throws 404 if author does not exist or account is inactive/suspended.
   */
  async getAuthorProfile(authorId: string): Promise<PublicAuthorResponseDto> {
    const profile = await this.repository.findAuthorProfile(authorId);
    if (!profile) {
      throw new NotFoundException(`Author ${authorId} not found.`);
    }
    return profile;
  }

  /**
   * Lists published articles for a specific author.
   * Throws 404 if author does not exist.
   * Guarantees draft edits, duplicate drafts, and other authors' articles are 100% excluded.
   */
  async listAuthorPublishedArticles(
    authorId: string,
    query: PublicArticlesQueryDto,
  ): Promise<PublicArticleListResponseDto> {
    // 1. Author must exist
    const profile = await this.repository.findAuthorProfile(authorId);
    if (!profile) {
      throw new NotFoundException(`Author ${authorId} not found.`);
    }

    // 2. Query published articles strictly scoped to authorId
    const queryWithAuthor: PublicArticlesQueryDto = {
      page: query.page,
      limit: query.limit,
      category: query.category,
      tag: query.tag,
      q: query.q,
      authorId,
    };
    return this.readerService.listPublishedArticles(queryWithAuthor);
  }
}

