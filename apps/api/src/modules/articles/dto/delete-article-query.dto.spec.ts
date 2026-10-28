import 'reflect-metadata';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { DeleteArticleQueryDto } from './delete-article-query.dto.js';

describe('DeleteArticleQueryDto', () => {
  function transformAndValidate(plain: Record<string, unknown>) {
    const instance = plainToInstance(DeleteArticleQueryDto, plain);
    return validate(instance);
  }

  it('rejects missing or omitted expectedRevision', async () => {
    const errors = await transformAndValidate({});
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.property === 'expectedRevision')).toBe(true);
  });

  it('passes with valid integer expectedRevision >= 1', async () => {
    const errors1 = await transformAndValidate({ expectedRevision: '1' });
    expect(errors1.length).toBe(0);

    const errors5 = await transformAndValidate({ expectedRevision: 5 });
    expect(errors5.length).toBe(0);
  });

  it('rejects expectedRevision < 1', async () => {
    const errors0 = await transformAndValidate({ expectedRevision: '0' });
    expect(errors0.length).toBeGreaterThan(0);
    expect(errors0.some((e) => e.property === 'expectedRevision')).toBe(true);

    const errorsNeg = await transformAndValidate({ expectedRevision: -2 });
    expect(errorsNeg.length).toBeGreaterThan(0);
    expect(errorsNeg.some((e) => e.property === 'expectedRevision')).toBe(true);
  });

  it('rejects non-integer, empty, or string expectedRevision', async () => {
    const errorsFloat = await transformAndValidate({ expectedRevision: '1.5' });
    expect(errorsFloat.length).toBeGreaterThan(0);
    expect(errorsFloat.some((e) => e.property === 'expectedRevision')).toBe(true);

    const errorsString = await transformAndValidate({ expectedRevision: 'invalid' });
    expect(errorsString.length).toBeGreaterThan(0);
    expect(errorsString.some((e) => e.property === 'expectedRevision')).toBe(true);

    const errorsEmpty = await transformAndValidate({ expectedRevision: '' });
    expect(errorsEmpty.length).toBeGreaterThan(0);
    expect(errorsEmpty.some((e) => e.property === 'expectedRevision')).toBe(true);
  });
});
