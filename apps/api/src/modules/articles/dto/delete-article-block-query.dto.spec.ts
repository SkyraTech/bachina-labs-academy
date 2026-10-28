import { describe, it, expect } from 'vitest';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { DeleteArticleBlockQueryDto } from './delete-article-block-query.dto.js';

describe('DeleteArticleBlockQueryDto Validation', () => {
  it('accepts positive integer expectedRevision', async () => {
    const dto = plainToInstance(DeleteArticleBlockQueryDto, {
      expectedRevision: '3',
    });
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
    expect(dto.expectedRevision).toBe(3);
  });

  it('rejects missing expectedRevision', async () => {
    const dto = plainToInstance(DeleteArticleBlockQueryDto, {});
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].property).toBe('expectedRevision');
  });

  it('rejects zero or negative expectedRevision', async () => {
    const zero = plainToInstance(DeleteArticleBlockQueryDto, { expectedRevision: 0 });
    expect((await validate(zero)).length).toBeGreaterThan(0);

    const negative = plainToInstance(DeleteArticleBlockQueryDto, { expectedRevision: -1 });
    expect((await validate(negative)).length).toBeGreaterThan(0);
  });

  it('rejects non-numeric strings and floats', async () => {
    const stringVal = plainToInstance(DeleteArticleBlockQueryDto, { expectedRevision: 'abc' });
    expect((await validate(stringVal)).length).toBeGreaterThan(0);

    const floatVal = plainToInstance(DeleteArticleBlockQueryDto, { expectedRevision: 1.5 });
    expect((await validate(floatVal)).length).toBeGreaterThan(0);
  });
});
