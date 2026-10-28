import { describe, it, expect } from 'vitest';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { ReorderArticleBlocksDto } from './reorder-article-blocks.dto.js';

describe('ReorderArticleBlocksDto Validation', () => {
  it('accepts valid expectedRevision and array of UUIDs', async () => {
    const dto = plainToInstance(ReorderArticleBlocksDto, {
      expectedRevision: 4,
      blockIds: [
        'c0000000-0000-4000-8000-000000000001',
        'c0000000-0000-4000-8000-000000000002',
      ],
    });
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });

  it('rejects missing expectedRevision', async () => {
    const dto = plainToInstance(ReorderArticleBlocksDto, {
      blockIds: ['c0000000-0000-4000-8000-000000000001'],
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].property).toBe('expectedRevision');
  });

  it('rejects non-array blockIds or non-UUID entries', async () => {
    const notArray = plainToInstance(ReorderArticleBlocksDto, {
      expectedRevision: 4,
      blockIds: 'not-an-array',
    });
    expect((await validate(notArray)).length).toBeGreaterThan(0);

    const nonUuids = plainToInstance(ReorderArticleBlocksDto, {
      expectedRevision: 4,
      blockIds: ['c0000000-0000-4000-8000-000000000001', 'invalid-uuid'],
    });
    expect((await validate(nonUuids)).length).toBeGreaterThan(0);
  });
});
