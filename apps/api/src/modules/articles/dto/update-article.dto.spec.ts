import 'reflect-metadata';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { UpdateArticleDto } from './update-article.dto.js';

describe('UpdateArticleDto', () => {
  function transformAndValidate(plain: Record<string, unknown>) {
    const instance = plainToInstance(UpdateArticleDto, plain);
    return validate(instance);
  }

  describe('expectedRevision', () => {
    it('passes with valid expectedRevision and no other fields (empty update)', async () => {
      const errors = await transformAndValidate({
        expectedRevision: 1,
      });
      expect(errors.length).toBe(0);
    });

    it('rejects missing expectedRevision', async () => {
      const errors = await transformAndValidate({
        title: 'Valid Title',
      });
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some((e) => e.property === 'expectedRevision')).toBe(true);
    });

    it('rejects non-integer expectedRevision', async () => {
      const errors = await transformAndValidate({
        expectedRevision: 1.5,
      });
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some((e) => e.property === 'expectedRevision')).toBe(true);
    });

    it('rejects expectedRevision less than 1', async () => {
      const errors0 = await transformAndValidate({
        expectedRevision: 0,
      });
      expect(errors0.some((e) => e.property === 'expectedRevision')).toBe(true);

      const errorsNeg = await transformAndValidate({
        expectedRevision: -5,
      });
      expect(errorsNeg.some((e) => e.property === 'expectedRevision')).toBe(true);
    });

    it('rejects non-number expectedRevision', async () => {
      const errors = await transformAndValidate({
        expectedRevision: 'one',
      });
      expect(errors.some((e) => e.property === 'expectedRevision')).toBe(true);
    });
  });

  describe('title', () => {
    it('passes with valid title', async () => {
      const errors = await transformAndValidate({
        expectedRevision: 1,
        title: 'New Valid Title',
      });
      expect(errors.length).toBe(0);
    });

    it('trims whitespace and validates length boundaries', async () => {
      const valid3 = await transformAndValidate({
        expectedRevision: 1,
        title: '   abc   ',
      });
      expect(valid3.length).toBe(0);

      const invalid2 = await transformAndValidate({
        expectedRevision: 1,
        title: '  ab  ',
      });
      expect(invalid2.some((e) => e.property === 'title')).toBe(true);

      const valid255 = await transformAndValidate({
        expectedRevision: 1,
        title: 'x'.repeat(255),
      });
      expect(valid255.length).toBe(0);

      const invalid256 = await transformAndValidate({
        expectedRevision: 1,
        title: 'x'.repeat(256),
      });
      expect(invalid256.some((e) => e.property === 'title')).toBe(true);
    });

    it('rejects non-string title', async () => {
      const errors = await transformAndValidate({
        expectedRevision: 1,
        title: 12345,
      });
      expect(errors.some((e) => e.property === 'title')).toBe(true);
    });
  });

  describe('draftSlug', () => {
    it('passes with valid slug', async () => {
      const errors = await transformAndValidate({
        expectedRevision: 1,
        draftSlug: 'updated-draft-slug-123',
      });
      expect(errors.length).toBe(0);
    });

    it('rejects uppercase, leading/trailing hyphens, and special characters', async () => {
      const uppercase = await transformAndValidate({
        expectedRevision: 1,
        draftSlug: 'Updated-Draft',
      });
      expect(uppercase.some((e) => e.property === 'draftSlug')).toBe(true);

      const leadingHyphen = await transformAndValidate({
        expectedRevision: 1,
        draftSlug: '-leading-hyphen',
      });
      expect(leadingHyphen.some((e) => e.property === 'draftSlug')).toBe(true);

      const trailingHyphen = await transformAndValidate({
        expectedRevision: 1,
        draftSlug: 'trailing-hyphen-',
      });
      expect(trailingHyphen.some((e) => e.property === 'draftSlug')).toBe(true);

      const specialChars = await transformAndValidate({
        expectedRevision: 1,
        draftSlug: 'slug_with_underscores',
      });
      expect(specialChars.some((e) => e.property === 'draftSlug')).toBe(true);
    });

    it('enforces length boundaries (3 to 280 chars)', async () => {
      const valid3 = await transformAndValidate({
        expectedRevision: 1,
        draftSlug: 'abc',
      });
      expect(valid3.length).toBe(0);

      const invalid2 = await transformAndValidate({
        expectedRevision: 1,
        draftSlug: 'ab',
      });
      expect(invalid2.some((e) => e.property === 'draftSlug')).toBe(true);

      const valid280 = await transformAndValidate({
        expectedRevision: 1,
        draftSlug: 'a'.repeat(280),
      });
      expect(valid280.length).toBe(0);

      const invalid281 = await transformAndValidate({
        expectedRevision: 1,
        draftSlug: 'a'.repeat(281),
      });
      expect(invalid281.some((e) => e.property === 'draftSlug')).toBe(true);
    });
  });

  describe('summary', () => {
    it('accepts string summary up to 500 characters', async () => {
      const errors = await transformAndValidate({
        expectedRevision: 1,
        summary: 'A valid article summary under 500 chars.',
      });
      expect(errors.length).toBe(0);
    });

    it('accepts explicit null to clear summary', async () => {
      const errors = await transformAndValidate({
        expectedRevision: 1,
        summary: null,
      });
      expect(errors.length).toBe(0);
    });

    it('rejects summary exceeding 500 characters', async () => {
      const errors = await transformAndValidate({
        expectedRevision: 1,
        summary: 's'.repeat(501),
      });
      expect(errors.some((e) => e.property === 'summary')).toBe(true);
    });
  });

  describe('typographyPreset', () => {
    it('accepts valid typography presets', async () => {
      for (const preset of ['MODERN_SANS', 'EDITORIAL_SERIF', 'TECHNICAL_MINIMAL']) {
        const errors = await transformAndValidate({
          expectedRevision: 1,
          typographyPreset: preset,
        });
        expect(errors.length).toBe(0);
      }
    });

    it('rejects invalid typography preset', async () => {
      const errors = await transformAndValidate({
        expectedRevision: 1,
        typographyPreset: 'COMIC_SANS',
      });
      expect(errors.some((e) => e.property === 'typographyPreset')).toBe(true);
    });
  });

  describe('coverMediaId', () => {
    it('accepts valid UUIDv4', async () => {
      const errors = await transformAndValidate({
        expectedRevision: 1,
        coverMediaId: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d',
      });
      expect(errors.length).toBe(0);
    });

    it('accepts explicit null to clear cover media', async () => {
      const errors = await transformAndValidate({
        expectedRevision: 1,
        coverMediaId: null,
      });
      expect(errors.length).toBe(0);
    });

    it('rejects invalid UUID string', async () => {
      const errors = await transformAndValidate({
        expectedRevision: 1,
        coverMediaId: 'not-a-uuid',
      });
      expect(errors.some((e) => e.property === 'coverMediaId')).toBe(true);
    });
  });
});
