import 'reflect-metadata';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { describe, it, expect } from 'vitest';
import { UpdateCategoryDto } from './update-category.dto.js';

describe('UpdateCategoryDto', () => {
  async function transformAndValidate(plain: Record<string, unknown>): Promise<{
    errors: ReturnType<typeof validate> extends Promise<infer U> ? U : never;
    instance: UpdateCategoryDto;
  }> {
    const instance = plainToInstance(UpdateCategoryDto, plain);
    const errors = await validate(instance);
    return { errors, instance };
  }

  describe('description', () => {
    it('accepts null and preserves null to explicitly clear description', async () => {
      const { errors, instance } = await transformAndValidate({ description: null });
      expect(errors.length).toBe(0);
      expect(instance.description).toBeNull();
    });

    it('transforms empty string "" to null to explicitly clear description', async () => {
      const { errors, instance } = await transformAndValidate({ description: '' });
      expect(errors.length).toBe(0);
      expect(instance.description).toBeNull();
    });

    it('transforms whitespace-only string "   " to null to explicitly clear description', async () => {
      const { errors, instance } = await transformAndValidate({ description: '   ' });
      expect(errors.length).toBe(0);
      expect(instance.description).toBeNull();
    });

    it('trims and accepts valid nonempty description string', async () => {
      const { errors, instance } = await transformAndValidate({
        description: '   Valid description of category   ',
      });
      expect(errors.length).toBe(0);
      expect(instance.description).toBe('Valid description of category');
    });

    it('preserves undefined when description property is omitted', async () => {
      const { errors, instance } = await transformAndValidate({ name: 'Backend' });
      expect(errors.length).toBe(0);
      expect(instance.description).toBeUndefined();
    });

    it('rejects description longer than 500 characters', async () => {
      const { errors } = await transformAndValidate({ description: 'x'.repeat(501) });
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some((e) => e.property === 'description')).toBe(true);
    });

    it('rejects non-string description (e.g. number)', async () => {
      const { errors } = await transformAndValidate({ description: 12345 });
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some((e) => e.property === 'description')).toBe(true);
    });

    it('rejects non-string description (e.g. boolean)', async () => {
      const { errors } = await transformAndValidate({ description: true });
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some((e) => e.property === 'description')).toBe(true);
    });

    it('rejects non-string description (e.g. array)', async () => {
      const { errors } = await transformAndValidate({ description: ['tag1'] });
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some((e) => e.property === 'description')).toBe(true);
    });
  });
});

