import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ComponentRef } from '@angular/core';
import { PublicArticlePaginationComponent } from './public-article-pagination.component';

describe('PublicArticlePaginationComponent', () => {
  let component: PublicArticlePaginationComponent;
  let componentRef: ComponentRef<PublicArticlePaginationComponent>;
  let fixture: ComponentFixture<PublicArticlePaginationComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PublicArticlePaginationComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(PublicArticlePaginationComponent);
    component = fixture.componentInstance;
    componentRef = fixture.componentRef;
    componentRef.setInput('page', 1);
    componentRef.setInput('totalPages', 4);
    componentRef.setInput('total', 75);
    fixture.detectChanges();
  });

  it('should instantiate the component with external template and styles', () => {
    expect(component).toBeTruthy();
  });

  it('should render page status information', () => {
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.textContent).toContain('Showing page 1 of 4');
    expect(compiled.textContent).toContain('75 articles total');
  });

  it('should disable previous button on first page', () => {
    const compiled = fixture.nativeElement as HTMLElement;
    const prevBtn = compiled.querySelector('button[aria-label="Previous page"]') as HTMLButtonElement;
    expect(prevBtn).not.toBeNull();
    expect(prevBtn.disabled).toBe(true);
  });

  it('should enable next button on first page if totalPages > 1', () => {
    const compiled = fixture.nativeElement as HTMLElement;
    const nextBtn = compiled.querySelector('button[aria-label="Next page"]') as HTMLButtonElement;
    expect(nextBtn).not.toBeNull();
    expect(nextBtn.disabled).toBe(false);
  });

  it('should disable next button on last page', () => {
    componentRef.setInput('page', 4);
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    const nextBtn = compiled.querySelector('button[aria-label="Next page"]') as HTMLButtonElement;
    expect(nextBtn.disabled).toBe(true);
  });

  it('should emit pageChange when next is clicked', () => {
    let emittedPage = 0;
    component.pageChange.subscribe((p) => {
      emittedPage = p;
    });

    const compiled = fixture.nativeElement as HTMLElement;
    const nextBtn = compiled.querySelector('button[aria-label="Next page"]') as HTMLButtonElement;
    nextBtn.click();

    expect(emittedPage).toBe(2);
  });

  it('should emit pageChange when page number is clicked', () => {
    let emittedPage = 0;
    component.pageChange.subscribe((p) => {
      emittedPage = p;
    });

    component.goToPage(3);
    expect(emittedPage).toBe(3);
  });

  it('should not render pagination markup when totalPages <= 1', () => {
    componentRef.setInput('totalPages', 1);
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('nav')).toBeNull();
  });
});
