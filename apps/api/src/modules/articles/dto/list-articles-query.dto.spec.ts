import 'reflect-metadata';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { ListArticlesQueryDto } from './list-articles-query.dto.js';
import { ArticleStatus } from '@prisma/client';

describe('ListArticlesQueryDto', () => {

  it('uses default page=1 and limit=20 when empty', async () => {
    const instance = plainToInstance(ListArticlesQueryDto, {});
    const errors = await validate(instance);
    expect(errors.length).toBe(0);
    expect(instance.page).toBe(1);
    expect(instance.limit).toBe(20);
  });

  it('accepts valid string query parameters and converts to numbers', async () => {
    const instance = plainToInstance(ListArticlesQueryDto, {
      page: '3',
      limit: '15',
      status: 'DRAFT',
    });
    const errors = await validate(instance);
    expect(errors.length).toBe(0);
    expect(instance.page).toBe(3);
    expect(instance.limit).toBe(15);
    expect(instance.status).toBe(ArticleStatus.DRAFT);
  });

  it('enforces limit upper bound of 50', async () => {
    const valid50 = plainToInstance(ListArticlesQueryDto, { limit: '50' });
    expect((await validate(valid50)).length).toBe(0);

    const invalid51 = plainToInstance(ListArticlesQueryDto, { limit: '51' });
    const errors = await validate(invalid51);
    expect(errors.some((e) => e.property === 'limit')).toBe(true);
  });

  it('rejects page and limit less than 1', async () => {
    const invalidPage = plainToInstance(ListArticlesQueryDto, { page: '0' });
    expect((await validate(invalidPage)).some((e) => e.property === 'page')).toBe(true);

    const invalidLimit = plainToInstance(ListArticlesQueryDto, { limit: '-1' });
    expect((await validate(invalidLimit)).some((e) => e.property === 'limit')).toBe(true);
  });

  it('rejects non-integer and malformed numbers', async () => {
    const nonIntPage = plainToInstance(ListArticlesQueryDto, { page: '1.5' });
    expect((await validate(nonIntPage)).some((e) => e.property === 'page')).toBe(true);

    const textLimit = plainToInstance(ListArticlesQueryDto, { limit: 'abc' });
    expect((await validate(textLimit)).some((e) => e.property === 'limit')).toBe(true);
  });

  it('validates supported status enum filters', async () => {
    for (const s of ['DRAFT', 'PUBLISHED', 'ARCHIVED']) {
      const validStatus = plainToInstance(ListArticlesQueryDto, { status: s });
      expect((await validate(validStatus)).length).toBe(0);
    }

    const invalidStatus = plainToInstance(ListArticlesQueryDto, { status: 'DELETED' });
    const errors = await validate(invalidStatus);
    expect(errors.some((e) => e.property === 'status')).toBe(true);
  });
});
