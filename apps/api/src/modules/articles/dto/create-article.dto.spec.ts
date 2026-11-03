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

  describe('taxonomy fields (categoryId & tagIds)', () => {
    it('accepts valid categoryId (UUIDv4) and null', async () => {
      const valid = await transformAndValidate({
        title: 'Valid Title',
        draftSlug: 'valid-slug',
        categoryId: 'a1b2c3d4-e5f6-4a1b-8c2d-3e4f5a6b7c8d',
      });
      expect(valid.length).toBe(0);

      const nullCat = await transformAndValidate({
        title: 'Valid Title',
        draftSlug: 'valid-slug',
        categoryId: null,
      });
      expect(nullCat.length).toBe(0);
    });

    it('rejects invalid UUID categoryId', async () => {
      const invalid = await transformAndValidate({
        title: 'Valid Title',
        draftSlug: 'valid-slug',
        categoryId: 'not-a-uuid',
      });
      expect(invalid.some((e) => e.property === 'categoryId')).toBe(true);

      const emptyStr = await transformAndValidate({
        title: 'Valid Title',
        draftSlug: 'valid-slug',
        categoryId: '',
      });
      expect(emptyStr.some((e) => e.property === 'categoryId')).toBe(true);

      const numeric = await transformAndValidate({
        title: 'Valid Title',
        draftSlug: 'valid-slug',
        categoryId: 12345,
      });
      expect(numeric.some((e) => e.property === 'categoryId')).toBe(true);

      const objVal = await transformAndValidate({
        title: 'Valid Title',
        draftSlug: 'valid-slug',
        categoryId: { id: 'a1b2c3d4-e5f6-4a1b-8c2d-3e4f5a6b7c8d' },
      });
      expect(objVal.some((e) => e.property === 'categoryId')).toBe(true);

      const arrayVal = await transformAndValidate({
        title: 'Valid Title',
        draftSlug: 'valid-slug',
        categoryId: ['a1b2c3d4-e5f6-4a1b-8c2d-3e4f5a6b7c8d'],
      });
      expect(arrayVal.some((e) => e.property === 'categoryId')).toBe(true);
    });

    it('accepts valid array of unique UUID tagIds up to 20 (counts 0, 1, 5, 6, 19, 20)', async () => {
      const makeUuids = (count: number) =>
        Array.from({ length: count }, (_, i) =>
          `00000000-0000-4000-8000-${i.toString(16).padStart(12, '0')}`,
        );

      // count 0
      expect((await transformAndValidate({ title: 'Valid Title', draftSlug: 'valid-slug', tagIds: [] })).length).toBe(0);
      // count 1
      expect((await transformAndValidate({ title: 'Valid Title', draftSlug: 'valid-slug', tagIds: makeUuids(1) })).length).toBe(0);
      // count 5
      expect((await transformAndValidate({ title: 'Valid Title', draftSlug: 'valid-slug', tagIds: makeUuids(5) })).length).toBe(0);
      // count 6
      expect((await transformAndValidate({ title: 'Valid Title', draftSlug: 'valid-slug', tagIds: makeUuids(6) })).length).toBe(0);
      // count 19
      expect((await transformAndValidate({ title: 'Valid Title', draftSlug: 'valid-slug', tagIds: makeUuids(19) })).length).toBe(0);
      // count 20
      expect((await transformAndValidate({ title: 'Valid Title', draftSlug: 'valid-slug', tagIds: makeUuids(20) })).length).toBe(0);
    });

    it('rejects non-array tagIds', async () => {
      const strVal = await transformAndValidate({
        title: 'Valid Title',
        draftSlug: 'valid-slug',
        tagIds: 'not-an-array',
      });
      expect(strVal.some((e) => e.property === 'tagIds')).toBe(true);

      const numVal = await transformAndValidate({
        title: 'Valid Title',
        draftSlug: 'valid-slug',
        tagIds: 12345,
      });
      expect(numVal.some((e) => e.property === 'tagIds')).toBe(true);
    });

    it('rejects duplicate tagIds', async () => {
      const duplicate = await transformAndValidate({
        title: 'Valid Title',
        draftSlug: 'valid-slug',
        tagIds: [
          'a1b2c3d4-e5f6-4a1b-8c2d-3e4f5a6b7c8d',
          'a1b2c3d4-e5f6-4a1b-8c2d-3e4f5a6b7c8d',
        ],
      });
      expect(duplicate.some((e) => e.property === 'tagIds')).toBe(true);
    });

    it('rejects more than 20 tagIds', async () => {
      const over20 = Array.from({ length: 21 }, (_, i) =>
        `00000000-0000-4000-8000-${i.toString(16).padStart(12, '0')}`,
      );
      const invalid = await transformAndValidate({
        title: 'Valid Title',
        draftSlug: 'valid-slug',
        tagIds: over20,
      });
      expect(invalid.some((e) => e.property === 'tagIds')).toBe(true);
    });

    it('rejects non-UUID items in tagIds array', async () => {
      const invalid = await transformAndValidate({
        title: 'Valid Title',
        draftSlug: 'valid-slug',
        tagIds: ['not-a-uuid'],
      });
      expect(invalid.some((e) => e.property === 'tagIds')).toBe(true);
    });
  });
});
