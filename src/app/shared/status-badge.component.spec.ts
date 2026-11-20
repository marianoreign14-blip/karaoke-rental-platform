import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';

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
  });

  it('maps domain statuses to semantic tones and readable labels', () => {
    component.value = 'completed';
    expect(component.resolvedTone).toBe('success');
    expect(component.resolvedLabel).toBe('completed');

    component.value = 'pending_admin';
    expect(component.resolvedTone).toBe('warning');
    expect(component.resolvedLabel).toBe('pending admin');

    component.value = 'suspended';
    expect(component.resolvedTone).toBe('danger');

    component.value = 'platform_admin';
    expect(component.resolvedTone).toBe('accent');

    component.value = 'custom_label';
    expect(component.resolvedTone).toBe('neutral');
  });

  it('renders custom label override when provided', () => {
    component.value = 'partially_paid';
    component.label = 'Partially paid';
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Partially paid');
    expect(fixture.nativeElement.querySelector('.tone-warning')).toBeTruthy();
  });
});
