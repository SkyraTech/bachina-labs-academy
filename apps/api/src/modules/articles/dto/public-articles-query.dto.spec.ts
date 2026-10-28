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
});
