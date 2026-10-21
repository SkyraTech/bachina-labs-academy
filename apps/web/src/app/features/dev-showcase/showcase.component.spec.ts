import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ShowcaseComponent } from './showcase.component';

describe('ShowcaseComponent', () => {
  let component: ShowcaseComponent;
  let fixture: ComponentFixture<ShowcaseComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ShowcaseComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(ShowcaseComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create showcase component', () => {
    expect(component).toBeTruthy();
  });

  it('should toggle table mode between client and server', () => {
    expect(component.tableMode()).toBe('client');
    component.toggleTableMode();
    expect(component.tableMode()).toBe('server');
    component.toggleTableMode();
    expect(component.tableMode()).toBe('client');
  });

  it('should update submittedPayload when form submitted', () => {
    const payload = { authorName: 'Jane Dev', authorEmail: 'jane@example.com' };
    component.onFormSubmit(payload);

    expect(component.submittedPayload()).toEqual(payload);
  });
});
