import { TestBed } from '@angular/core/testing';
import { articleEditorDeactivateGuard } from './article-editor-deactivate.guard';
import { ArticleEditorComponent } from '../components/article-editor/article-editor.component';

describe('articleEditorDeactivateGuard', () => {
  it('should delegate canDeactivate check to component.canDeactivate()', async () => {
    const mockComponent = {
      canDeactivate: vi.fn().mockResolvedValue(true),
    } as unknown as ArticleEditorComponent;

    const result = await TestBed.runInInjectionContext(() =>
      articleEditorDeactivateGuard(mockComponent, null as any, null as any, null as any)
    );

    expect(mockComponent.canDeactivate).toHaveBeenCalledTimes(1);
    expect(result).toBe(true);
  });

  it('should return false when component.canDeactivate() returns false', async () => {
    const mockComponent = {
      canDeactivate: vi.fn().mockResolvedValue(false),
    } as unknown as ArticleEditorComponent;

    const result = await TestBed.runInInjectionContext(() =>
      articleEditorDeactivateGuard(mockComponent, null as any, null as any, null as any)
    );

    expect(mockComponent.canDeactivate).toHaveBeenCalledTimes(1);
    expect(result).toBe(false);
  });
});
