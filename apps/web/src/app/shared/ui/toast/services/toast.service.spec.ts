import { TestBed } from '@angular/core/testing';
import { ToastService } from './toast.service';

describe('ToastService', () => {
  let service: ToastService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(ToastService);
    service.clear();
  });

  afterEach(() => {
    service.clear();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should add a toast and expose it in toasts signal', () => {
    service.success('Operation succeeded', 'Done');
    const toasts = service.toasts();

    expect(toasts.length).toBe(1);
    expect(toasts[0].type).toBe('success');
    expect(toasts[0].message).toBe('Operation succeeded');
    expect(toasts[0].title).toBe('Done');
  });

  it('should suppress identical duplicate toasts within window', () => {
    service.error('Failed to connect');
    service.error('Failed to connect');

    expect(service.toasts().length).toBe(1);
  });

  it('should manually dismiss a toast', () => {
    const id = service.info('Test info');
    expect(service.toasts().length).toBe(1);

    service.dismiss(id);
    expect(service.toasts().length).toBe(0);
  });

  it('should limit active toasts to maximum 5', () => {
    for (let i = 1; i <= 7; i++) {
      service.show({ type: 'info', message: `Message ${i}`, duration: 0 });
    }

    expect(service.toasts().length).toBe(5);
  });
});
