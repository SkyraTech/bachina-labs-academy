import { describe, it, expect } from 'vitest';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { UpdateArticleBlockDto } from './update-article-block.dto.js';

describe('UpdateArticleBlockDto Validation', () => {
  it('passes validation with valid expectedRevision and content', async () => {
    const dto = plainToInstance(UpdateArticleBlockDto, {
      expectedRevision: 2,
      content: { text: 'Updated heading', level: 3 },
    });

    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });

  it('passes validation with valid expectedRevision and mediaAssetId', async () => {
    const dto = plainToInstance(UpdateArticleBlockDto, {
      expectedRevision: 2,
      mediaAssetId: 'b0000000-0000-4000-8000-000000000002',
    });

    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });

  it('fails if expectedRevision is missing or <= 0', async () => {
    const missing = plainToInstance(UpdateArticleBlockDto, {
      content: { text: 'Heading' },
    });
    expect((await validate(missing)).length).toBeGreaterThan(0);

    const zero = plainToInstance(UpdateArticleBlockDto, {
      expectedRevision: 0,
      content: { text: 'Heading' },
    });
    expect((await validate(zero)).length).toBeGreaterThan(0);
  });

  it('fails if mediaAssetId is malformed', async () => {
    const malformed = plainToInstance(UpdateArticleBlockDto, {
      expectedRevision: 2,
      mediaAssetId: '123-invalid',
    });
    expect((await validate(malformed)).length).toBeGreaterThan(0);
  });
});
