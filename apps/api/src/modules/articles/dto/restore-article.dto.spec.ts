import 'reflect-metadata';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { describe, it, expect } from 'vitest';
import { RestoreArticleDto } from './restore-article.dto.js';

describe('RestoreArticleDto', () => {
  function transformAndValidate(plain: Record<string, unknown>) {
    const instance = plainToInstance(RestoreArticleDto, plain);
    return validate(instance, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
  }

  it('passes with valid integer expectedRevision >= 1', async () => {
    const errors1 = await transformAndValidate({ expectedRevision: 1 });
    expect(errors1.length).toBe(0);

    const errors40 = await transformAndValidate({ expectedRevision: 40 });
    expect(errors40.length).toBe(0);
  });

  it('rejects missing expectedRevision', async () => {
    const errors = await transformAndValidate({});
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.property === 'expectedRevision')).toBe(true);
  });

  it('rejects null expectedRevision', async () => {
    const errors = await transformAndValidate({ expectedRevision: null });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.property === 'expectedRevision')).toBe(true);
  });

  it('rejects zero or negative expectedRevision', async () => {
    const errors0 = await transformAndValidate({ expectedRevision: 0 });
    expect(errors0.length).toBeGreaterThan(0);
    expect(errors0.some((e) => e.property === 'expectedRevision')).toBe(true);

    const errorsNeg = await transformAndValidate({ expectedRevision: -1 });
    expect(errorsNeg.length).toBeGreaterThan(0);
    expect(errorsNeg.some((e) => e.property === 'expectedRevision')).toBe(true);
  });

  it('rejects fractional expectedRevision', async () => {
    const errors = await transformAndValidate({ expectedRevision: 2.5 });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.property === 'expectedRevision')).toBe(true);
  });

  it('rejects unknown properties in whitelist mode', async () => {
    const errors = await transformAndValidate({
      expectedRevision: 1,
      unknownField: 'malicious',
    });
    expect(errors.length).toBeGreaterThan(0);
  });
});
