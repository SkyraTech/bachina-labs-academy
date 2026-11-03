import 'reflect-metadata';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { describe, it, expect } from 'vitest';
import { PublicArticlesQueryDto } from './public-articles-query.dto.js';

describe('PublicArticlesQueryDto', () => {
  function transformAndValidate(plain: Record<string, unknown>) {
    const instance = plainToInstance(PublicArticlesQueryDto, plain);
    return validate(instance, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
  }

  it('passes with default empty query (default page 1, limit 20)', async () => {
    const instance = plainToInstance(PublicArticlesQueryDto, {});
    const errors = await validate(instance);
    expect(errors.length).toBe(0);
    expect(instance.page).toBe(1);
    expect(instance.limit).toBe(20);
  });

  it('passes with valid custom page and limit', async () => {
    const errors = await transformAndValidate({ page: '2', limit: '30' });
    expect(errors.length).toBe(0);
  });

  it('passes with maximum allowed limit of 50', async () => {
    const errors = await transformAndValidate({ limit: 50 });
    expect(errors.length).toBe(0);
  });

  it('rejects limit exceeding 50', async () => {
    const errors = await transformAndValidate({ limit: 51 });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.property === 'limit')).toBe(true);
  });

  it('rejects limit less than 1', async () => {
    const errors0 = await transformAndValidate({ limit: 0 });
    expect(errors0.some((e) => e.property === 'limit')).toBe(true);

    const errorsNeg = await transformAndValidate({ limit: -5 });
    expect(errorsNeg.some((e) => e.property === 'limit')).toBe(true);
  });

  it('rejects page less than 1', async () => {
    const errors0 = await transformAndValidate({ page: 0 });
    expect(errors0.some((e) => e.property === 'page')).toBe(true);

    const errorsNeg = await transformAndValidate({ page: -1 });
    expect(errorsNeg.some((e) => e.property === 'page')).toBe(true);
  });

  it('rejects non-integer / floating-point values', async () => {
    const errorsPage = await transformAndValidate({ page: 1.5 });
    expect(errorsPage.some((e) => e.property === 'page')).toBe(true);

    const errorsLimit = await transformAndValidate({ limit: 20.5 });
    expect(errorsLimit.some((e) => e.property === 'limit')).toBe(true);
  });

  it('rejects unknown query properties when forbidNonWhitelisted is active', async () => {
    const errors = await transformAndValidate({
      page: 1,
      extraFilter: 'malicious',
    });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.property === 'extraFilter')).toBe(true);
  });

  describe('category and tag filters validation', () => {
    it('passes with valid category and tag slugs', async () => {
      const errors = await transformAndValidate({
        category: 'backend-engineering',
        tag: 'postgresql',
      });
      expect(errors.length).toBe(0);
    });

    it('rejects empty category or tag string', async () => {
      const errorsCat = await transformAndValidate({ category: '' });
      expect(errorsCat.some((e) => e.property === 'category')).toBe(true);

      const errorsTag = await transformAndValidate({ tag: '' });
      expect(errorsTag.some((e) => e.property === 'tag')).toBe(true);
    });

    it('rejects whitespace-only category or tag string', async () => {
      const errorsCat = await transformAndValidate({ category: '   ' });
      expect(errorsCat.some((e) => e.property === 'category')).toBe(true);

      const errorsTag = await transformAndValidate({ tag: '   ' });
      expect(errorsTag.some((e) => e.property === 'tag')).toBe(true);
    });

    it('rejects uppercase and invalid characters in slugs', async () => {
      const errorsUpper = await transformAndValidate({ category: 'Backend-Engineering' });
      expect(errorsUpper.some((e) => e.property === 'category')).toBe(true);

      const errorsSpecial = await transformAndValidate({ tag: 'tag_with_underscore' });
      expect(errorsSpecial.some((e) => e.property === 'tag')).toBe(true);

      const errorsTrailing = await transformAndValidate({ category: 'trailing-hyphen-' });
      expect(errorsTrailing.some((e) => e.property === 'category')).toBe(true);

      const errorsLeading = await transformAndValidate({ tag: '-leading-hyphen' });
      expect(errorsLeading.some((e) => e.property === 'tag')).toBe(true);
    });

    it('rejects SQL injection attempts and special characters', async () => {
      const errorsInjection = await transformAndValidate({
        category: "backend' OR 1=1--",
      });
      expect(errorsInjection.some((e) => e.property === 'category')).toBe(true);
    });

    it('rejects category slug exceeding 160 characters', async () => {
      const longSlug = 'a'.repeat(161);
      const errors = await transformAndValidate({ category: longSlug });
      expect(errors.some((e) => e.property === 'category')).toBe(true);
    });

    it('rejects tag slug exceeding 120 characters', async () => {
      const longSlug = 'a'.repeat(121);
      const errors = await transformAndValidate({ tag: longSlug });
      expect(errors.some((e) => e.property === 'tag')).toBe(true);
    });

    it('rejects non-string values (arrays, objects, numbers)', async () => {
      const errorsArray = await transformAndValidate({ category: ['backend-engineering'] });
      expect(errorsArray.some((e) => e.property === 'category')).toBe(true);

      const errorsObject = await transformAndValidate({ tag: { slug: 'postgresql' } });
      expect(errorsObject.some((e) => e.property === 'tag')).toBe(true);

      const errorsNumber = await transformAndValidate({ category: 12345 });
      expect(errorsNumber.some((e) => e.property === 'category')).toBe(true);
    });
  });

  describe('search keyword (q) query validation', () => {
    it('passes with no q parameter', async () => {
      const instance = plainToInstance(PublicArticlesQueryDto, {});
      const errors = await validate(instance);
      expect(errors.length).toBe(0);
      expect(instance.q).toBeUndefined();
    });

    it('normalizes empty q string to undefined (no filter)', async () => {
      const instance = plainToInstance(PublicArticlesQueryDto, { q: '' });
      const errors = await validate(instance);
      expect(errors.length).toBe(0);
      expect(instance.q).toBeUndefined();
    });

    it('normalizes whitespace-only q string to undefined (no filter)', async () => {
      const instance = plainToInstance(PublicArticlesQueryDto, { q: '     ' });
      const errors = await validate(instance);
      expect(errors.length).toBe(0);
      expect(instance.q).toBeUndefined();
    });

    it('passes with ordinary single word', async () => {
      const instance = plainToInstance(PublicArticlesQueryDto, { q: 'postgresql' });
      const errors = await validate(instance);
      expect(errors.length).toBe(0);
      expect(instance.q).toBe('postgresql');
    });

    it('passes with multiword phrase preserving internal spaces and trimming ends', async () => {
      const instance = plainToInstance(PublicArticlesQueryDto, {
        q: '  event driven architecture  ',
      });
      const errors = await validate(instance);
      expect(errors.length).toBe(0);
      expect(instance.q).toBe('event driven architecture');
    });

    it('passes with mixed case query', async () => {
      const instance = plainToInstance(PublicArticlesQueryDto, {
        q: 'PostgreSQL Deep Dive',
      });
      const errors = await validate(instance);
      expect(errors.length).toBe(0);
      expect(instance.q).toBe('PostgreSQL Deep Dive');
    });

    it('passes with Unicode characters and punctuation', async () => {
      const instance = plainToInstance(PublicArticlesQueryDto, {
        q: '微服务 架构 & Observability 🚀',
      });
      const errors = await validate(instance);
      expect(errors.length).toBe(0);
      expect(instance.q).toBe('微服务 架构 & Observability 🚀');
    });

    it('passes with exactly 120 characters', async () => {
      const exact120 = 'a'.repeat(120);
      const errors = await transformAndValidate({ q: exact120 });
      expect(errors.length).toBe(0);
    });

    it('rejects q exceeding 120 normalized characters', async () => {
      const overlong = 'a'.repeat(121);
      const errors = await transformAndValidate({ q: overlong });
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some((e) => e.property === 'q')).toBe(true);
    });

    it('rejects repeated q parameters (arrays)', async () => {
      const errors = await transformAndValidate({ q: ['first-term', 'second-term'] });
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some((e) => e.property === 'q')).toBe(true);
    });

    it('rejects control characters in q', async () => {
      const errorsNullByte = await transformAndValidate({ q: 'hello\x00world' });
      expect(errorsNullByte.some((e) => e.property === 'q')).toBe(true);

      const errorsEscape = await transformAndValidate({ q: 'hello\x1bworld' });
      expect(errorsEscape.some((e) => e.property === 'q')).toBe(true);
    });

    it('accepts SQL metacharacters as harmless literal text search input', async () => {
      const sqlShaped = "100% test_case ' OR '1'='1' -- \\";
      const instance = plainToInstance(PublicArticlesQueryDto, { q: sqlShaped });
      const errors = await validate(instance);
      expect(errors.length).toBe(0);
      expect(instance.q).toBe(sqlShaped);
    });
  });
});
