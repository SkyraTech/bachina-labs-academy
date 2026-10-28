import { describe, it, expect } from 'vitest';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { ArticleBlockType } from '@prisma/client';
import { CreateArticleBlockDto } from './create-article-block.dto.js';

describe('CreateArticleBlockDto Validation', () => {
  it('passes validation with all required valid fields', async () => {
    const dto = plainToInstance(CreateArticleBlockDto, {
      expectedRevision: 1,
      type: ArticleBlockType.HEADING,
      content: { text: 'Valid Heading', level: 2 },
    });

    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });

  it('passes validation for IMAGE type with valid mediaAssetId UUID v4', async () => {
    const dto = plainToInstance(CreateArticleBlockDto, {
      expectedRevision: 1,
      type: ArticleBlockType.IMAGE,
      content: { caption: 'Test image' },
      mediaAssetId: 'a0000000-0000-4000-8000-000000000001',
    });

    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });

  it('fails if expectedRevision is missing, non-integer, or <= 0', async () => {
    const missing = plainToInstance(CreateArticleBlockDto, {
      type: ArticleBlockType.DIVIDER,
      content: {},
    });
    expect((await validate(missing)).length).toBeGreaterThan(0);

    const zero = plainToInstance(CreateArticleBlockDto, {
      expectedRevision: 0,
      type: ArticleBlockType.DIVIDER,
      content: {},
    });
    expect((await validate(zero)).length).toBeGreaterThan(0);

    const negative = plainToInstance(CreateArticleBlockDto, {
      expectedRevision: -1,
      type: ArticleBlockType.DIVIDER,
      content: {},
    });
    expect((await validate(negative)).length).toBeGreaterThan(0);

    const floatVal = plainToInstance(CreateArticleBlockDto, {
      expectedRevision: 1.5,
      type: ArticleBlockType.DIVIDER,
      content: {},
    });
    expect((await validate(floatVal)).length).toBeGreaterThan(0);
  });

  it('fails if type is missing or not a valid ArticleBlockType enum', async () => {
    const invalidType = plainToInstance(CreateArticleBlockDto, {
      expectedRevision: 1,
      type: 'PARAGRAPH',
      content: { text: 'Paragraph' },
    });
    const errors = await validate(invalidType);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].property).toBe('type');
  });

  it('fails if content is missing or not a JSON object', async () => {
    const missingContent = plainToInstance(CreateArticleBlockDto, {
      expectedRevision: 1,
      type: ArticleBlockType.DIVIDER,
    });
    expect((await validate(missingContent)).length).toBeGreaterThan(0);

    const stringContent = plainToInstance(CreateArticleBlockDto, {
      expectedRevision: 1,
      type: ArticleBlockType.DIVIDER,
      content: 'string content',
    });
    expect((await validate(stringContent)).length).toBeGreaterThan(0);
  });

  it('fails if mediaAssetId is not a valid UUID v4', async () => {
    const invalidUuid = plainToInstance(CreateArticleBlockDto, {
      expectedRevision: 1,
      type: ArticleBlockType.IMAGE,
      content: {},
      mediaAssetId: 'not-a-uuid',
    });
    const errors = await validate(invalidUuid);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].property).toBe('mediaAssetId');
  });
});
