import 'reflect-metadata';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { CreateArticleDto } from './create-article.dto.js';

describe('CreateArticleDto', () => {
  function transformAndValidate(plain: Record<string, unknown>) {
    const instance = plainToInstance(CreateArticleDto, plain);
    return validate(instance);
  }

  it('passes with valid required fields and defaults', async () => {
    const errors = await transformAndValidate({
      title: 'PostgreSQL Architecture',
      draftSlug: 'postgresql-architecture',
    });
    expect(errors.length).toBe(0);
  });

  it('trims whitespace and validates title length boundaries', async () => {
    // 3 characters trimmed: valid
    const valid3 = await transformAndValidate({
      title: '   SQL   ',
      draftSlug: 'sql-intro',
    });
    expect(valid3.length).toBe(0);

    // 2 characters trimmed: invalid
    const invalid2 = await transformAndValidate({
      title: '  ab  ',
      draftSlug: 'ab-intro',
    });
    expect(invalid2.length).toBeGreaterThan(0);
    expect(invalid2.some((e) => e.property === 'title')).toBe(true);

    // 255 characters: valid
    const valid255 = await transformAndValidate({
      title: 'a'.repeat(255),
      draftSlug: 'long-title',
    });
    expect(valid255.length).toBe(0);

    // 256 characters: invalid
    const invalid256 = await transformAndValidate({
      title: 'a'.repeat(256),
      draftSlug: 'too-long-title',
    });
    expect(invalid256.length).toBeGreaterThan(0);
    expect(invalid256.some((e) => e.property === 'title')).toBe(true);
  });

  it('rejects empty, untrimmed empty, and non-string title', async () => {
    const emptyErrors = await transformAndValidate({
      title: '    ',
      draftSlug: 'valid-slug',
    });
    expect(emptyErrors.some((e) => e.property === 'title')).toBe(true);

    const missingErrors = await transformAndValidate({
      draftSlug: 'valid-slug',
    });
    expect(missingErrors.some((e) => e.property === 'title')).toBe(true);
  });

  it('validates draftSlug regex syntax and length boundaries', async () => {
    // Valid slugs
    expect(
      (
        await transformAndValidate({
          title: 'Valid Title',
          draftSlug: 'a-b-c',
        })
      ).length,
    ).toBe(0);

    expect(
      (
        await transformAndValidate({
          title: 'Valid Title',
          draftSlug: 'abc',
        })
      ).length,
    ).toBe(0);

    expect(
      (
        await transformAndValidate({
          title: 'Valid Title',
          draftSlug: 'a'.repeat(280),
        })
      ).length,
    ).toBe(0);

    // Invalid: leading hyphen
    expect(
      (
        await transformAndValidate({
          title: 'Valid Title',
          draftSlug: '-invalid-slug',
        })
      ).some((e) => e.property === 'draftSlug'),
    ).toBe(true);

    // Invalid: trailing hyphen
    expect(
      (
        await transformAndValidate({
          title: 'Valid Title',
          draftSlug: 'invalid-slug-',
        })
      ).some((e) => e.property === 'draftSlug'),
    ).toBe(true);

    // Invalid: uppercase characters
    expect(
      (
        await transformAndValidate({
          title: 'Valid Title',
          draftSlug: 'Invalid-Slug',
        })
      ).some((e) => e.property === 'draftSlug'),
    ).toBe(true);

    // Invalid: consecutive hyphens
    expect(
      (
        await transformAndValidate({
          title: 'Valid Title',
          draftSlug: 'invalid--slug',
        })
      ).some((e) => e.property === 'draftSlug'),
    ).toBe(true);

    // Invalid: special symbols
    expect(
      (
        await transformAndValidate({
          title: 'Valid Title',
          draftSlug: 'invalid_slug!',
        })
      ).some((e) => e.property === 'draftSlug'),
    ).toBe(true);

    // Invalid: too short (< 3 chars)
    expect(
      (
        await transformAndValidate({
          title: 'Valid Title',
          draftSlug: 'ab',
        })
      ).some((e) => e.property === 'draftSlug'),
    ).toBe(true);

    // Invalid: too long (> 280 chars)
    expect(
      (
        await transformAndValidate({
          title: 'Valid Title',
          draftSlug: 'a'.repeat(281),
        })
      ).some((e) => e.property === 'draftSlug'),
    ).toBe(true);
  });

  it('validates summary length and allows null or omitted', async () => {
    // Omitted: valid
    expect(
      (
        await transformAndValidate({
          title: 'Valid Title',
          draftSlug: 'valid-slug',
        })
      ).length,
    ).toBe(0);

    // Explicit null: valid
    expect(
      (
        await transformAndValidate({
          title: 'Valid Title',
          draftSlug: 'valid-slug',
          summary: null,
        })
      ).length,
    ).toBe(0);

    // 500 chars: valid
    expect(
      (
        await transformAndValidate({
          title: 'Valid Title',
          draftSlug: 'valid-slug',
          summary: 's'.repeat(500),
        })
      ).length,
    ).toBe(0);

    // 501 chars: invalid
    expect(
      (
        await transformAndValidate({
          title: 'Valid Title',
          draftSlug: 'valid-slug',
          summary: 's'.repeat(501),
        })
      ).some((e) => e.property === 'summary'),
    ).toBe(true);
  });

  it('validates typographyPreset allowed enum values', async () => {
    for (const preset of ['MODERN_SANS', 'EDITORIAL_SERIF', 'TECHNICAL_MINIMAL']) {
      expect(
        (
          await transformAndValidate({
            title: 'Valid Title',
            draftSlug: 'valid-slug',
            typographyPreset: preset,
          })
        ).length,
      ).toBe(0);
    }

    // Invalid preset
    const invalidErrors = await transformAndValidate({
      title: 'Valid Title',
      draftSlug: 'valid-slug',
      typographyPreset: 'COMIC_SANS',
    });
    expect(invalidErrors.some((e) => e.property === 'typographyPreset')).toBe(true);
  });

  it('validates coverMediaId as UUIDv4 or null/omitted', async () => {
    // Valid UUIDv4
    expect(
      (
        await transformAndValidate({
          title: 'Valid Title',
          draftSlug: 'valid-slug',
          coverMediaId: 'a1b2c3d4-e5f6-4a1b-8c2d-3e4f5a6b7c8d',
        })
      ).length,
    ).toBe(0);

    // Null
    expect(
      (
        await transformAndValidate({
          title: 'Valid Title',
          draftSlug: 'valid-slug',
          coverMediaId: null,
        })
      ).length,
    ).toBe(0);

    // Invalid UUID
    const invalidErrors = await transformAndValidate({
      title: 'Valid Title',
      draftSlug: 'valid-slug',
      coverMediaId: 'not-a-valid-uuid',
    });
    expect(invalidErrors.some((e) => e.property === 'coverMediaId')).toBe(true);
  });
});
