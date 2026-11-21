import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';

import { OrderProgressComponent } from './order-progress.component';

describe('OrderProgressComponent', () => {
  let fixture: ComponentFixture<OrderProgressComponent>;
  let component: OrderProgressComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [OrderProgressComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(OrderProgressComponent);
    component = fixture.componentInstance;
  });

  it('marks steps accurately for confirmed unpaid and completed paid orders', () => {
    component.status = 'confirmed';
    component.paymentStatus = 'unpaid';
    fixture.detectChanges();

    expect(component.steps[0].done).toBe(true);
    expect(component.steps[1].done).toBe(true);
    expect(component.steps[2].current).toBe(true);
    expect(component.steps[3].done).toBe(false);

    component.status = 'completed';
    component.paymentStatus = 'paid';
    fixture.detectChanges();

    expect(component.steps.every((step) => step.done)).toBe(true);
  });

  it('renders plain-language closed banner for cancelled and rejected orders', () => {
    component.status = 'cancelled';
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('cancelled');
    expect(fixture.nativeElement.textContent).toContain('released');
  });

  it('keeps ongoing rentals in the accepted stage and explains under-review requests', () => {
    component.status = 'ongoing';
    fixture.detectChanges();
    expect(component.steps[1].done).toBe(true);
    expect(component.helperMessage).toContain('in progress');

    component.status = 'under_review';
    fixture.detectChanges();
    expect(component.steps[1].current).toBe(true);
    expect(component.helperMessage).toContain('requested more information');
  });
});
