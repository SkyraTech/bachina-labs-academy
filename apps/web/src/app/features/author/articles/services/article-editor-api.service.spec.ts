import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClientService } from '../../../../core/api';
import { ArticleEditorApiService } from './article-editor-api.service';

describe('ArticleEditorApiService (P1-SAFETY-BASELINE-02 Containment)', () => {
  let service: ArticleEditorApiService;
  let apiClientMock: {
    get: ReturnType<typeof vi.fn>;
    post: ReturnType<typeof vi.fn>;
    put: ReturnType<typeof vi.fn>;
    patch: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    apiClientMock = {
      get: vi.fn(),
      post: vi.fn(),
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    };

    TestBed.configureTestingModule({
      providers: [
        ArticleEditorApiService,
        { provide: ApiClientService, useValue: apiClientMock },
      ],
    });

    service = TestBed.inject(ArticleEditorApiService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('deleteArticle containment', () => {
    it('fails closed immediately and never dispatches an HTTP DELETE request', async () => {
      let caughtError: unknown;
      try {
        await firstValueFrom(service.deleteArticle('a1b2c3d4-1111-4000-8000-000000000001', 1));
      } catch (err: unknown) {
        caughtError = err;
      }

      expect(caughtError).toBeInstanceOf(Error);
      expect((caughtError as Error).message).toBe(
        'Article deletion is temporarily disabled pending durable soft-deletion support.',
      );
      // Verify zero network calls were made to ApiClientService.delete
      expect(apiClientMock.delete).not.toHaveBeenCalled();
    });
  });
});
