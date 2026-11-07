import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { By } from '@angular/platform-browser';
import { AuthorDashboardPlaceholderComponent } from './author-placeholder.component';

describe('AuthorDashboardPlaceholderComponent', () => {
  let fixture: ComponentFixture<AuthorDashboardPlaceholderComponent>;
  let component: AuthorDashboardPlaceholderComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AuthorDashboardPlaceholderComponent],
      providers: [provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(AuthorDashboardPlaceholderComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create the author overview component', () => {
    expect(component).toBeTruthy();
  });

  it('should render navigation links to New Draft, My Articles, and Account Security', () => {
    const links = fixture.debugElement.queryAll(By.css('a[routerLink]'));
    const hrefs = links.map((el) => el.attributes['routerLink']);

    expect(hrefs).toContain('/author/articles/new');
    expect(hrefs).toContain('/author/articles');
    expect(hrefs).toContain('/account/security');
  });

  it('should display the editorial workflow guide', () => {
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Self-Publishing Workflow');
    expect(text).toContain('Draft & Compose');
    expect(text).toContain('Immutable Snapshots');
  });
});

