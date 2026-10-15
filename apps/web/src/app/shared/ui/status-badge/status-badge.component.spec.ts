import { TestBed, ComponentFixture } from '@angular/core/testing';
import { StatusBadgeComponent } from './status-badge.component';

describe('StatusBadgeComponent', () => {
  let fixture: ComponentFixture<StatusBadgeComponent>;
  let component: StatusBadgeComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [StatusBadgeComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(StatusBadgeComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create status badge', () => {
    expect(component).toBeTruthy();
  });

  it('should apply brand variant classes', () => {
    fixture.componentRef.setInput('variant', 'brand');
    fixture.detectChanges();
    const badge = fixture.nativeElement.querySelector('span');
    expect(badge.className).toContain('bg-[var(--color-brand-surface)]');
  });

  it('should render dot when dot input is true', () => {
    fixture.componentRef.setInput('dot', true);
    fixture.detectChanges();
    const dot = fixture.nativeElement.querySelector('.w-1\\.5');
    expect(dot).toBeTruthy();
  });
});
