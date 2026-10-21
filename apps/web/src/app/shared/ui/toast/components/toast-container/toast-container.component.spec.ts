import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ToastContainerComponent } from './toast-container.component';
import { ToastService } from '../../services/toast.service';

describe('ToastContainerComponent', () => {
  let component: ToastContainerComponent;
  let fixture: ComponentFixture<ToastContainerComponent>;
  let toastService: ToastService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ToastContainerComponent],
    }).compileComponents();

    toastService = TestBed.inject(ToastService);
    toastService.clear();

    fixture = TestBed.createComponent(ToastContainerComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  afterEach(() => {
    toastService.clear();
  });

  it('should create toast container component', () => {
    expect(component).toBeTruthy();
  });

  it('should render toast items when added to ToastService', () => {
    toastService.success('Profile updated', 'Saved');
    fixture.detectChanges();

    const toastEls = fixture.nativeElement.querySelectorAll('.toast-item');
    expect(toastEls.length).toBe(1);
    expect(toastEls[0].textContent).toContain('Profile updated');
    expect(toastEls[0].textContent).toContain('Saved');
  });

  it('should dismiss toast when dismiss button clicked', () => {
    toastService.info('Notice message');
    fixture.detectChanges();

    const dismissBtn = fixture.nativeElement.querySelector('.toast-dismiss-btn');
    expect(dismissBtn).toBeTruthy();

    dismissBtn.click();
    fixture.detectChanges();

    expect(toastService.toasts().length).toBe(0);
  });
});
