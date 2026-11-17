import { CanDeactivateFn } from '@angular/router';
import { ArticleEditorComponent } from '../components/article-editor/article-editor.component';

/**
 * Route guard that prevents accidental navigation away from the Article Editor
 * when unsaved local changes (metadata, blocks, in-flight saves, revision conflicts)
 * are present.
 */
export const articleEditorDeactivateGuard: CanDeactivateFn<ArticleEditorComponent> = (
  component: ArticleEditorComponent,
) => {
  return component.canDeactivate();
};
