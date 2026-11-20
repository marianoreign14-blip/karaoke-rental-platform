import { TestBed } from '@angular/core/testing';

import { ConfirmDialogComponent } from './confirm-dialog.component';
import { ConfirmDialogService } from './confirm-dialog.service';

describe('ConfirmDialogService & ConfirmDialogComponent', () => {
  let service: ConfirmDialogService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [ConfirmDialogComponent],
    });
    service = TestBed.inject(ConfirmDialogService);
  });

  it('resolves with confirmed=true and trimmed note when confirmed', async () => {
    const promise = service.open({
      title: 'Reject order',
      message: 'Release reserved equipment?',
      confirmLabel: 'Reject',
      tone: 'danger',
      inputLabel: 'Optional reason',
    });

    expect(service.active()?.options.title).toBe('Reject order');
    service.finish(true, '  Equipment under repair  ');

    const result = await promise;
    expect(result).toEqual({ confirmed: true, note: 'Equipment under repair' });
    expect(service.active()).toBeNull();
  });

  it('resolves with confirmed=false when cancelled', async () => {
    const promise = service.open({
      title: 'Cancel booking',
      message: 'Are you sure?',
    });

    service.finish(false);
    expect(await promise).toEqual({ confirmed: false, note: '' });
  });

  it('traps Tab and Shift+Tab focus inside the modal dialog card', () => {
    const fixture = TestBed.createComponent(ConfirmDialogComponent);
    void service.open({
      title: 'Delete item?',
      message: 'This action cannot be undone.',
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
    });
    fixture.detectChanges();

    const card: HTMLElement | null = fixture.nativeElement.querySelector('.dialog-card');
    expect(card).toBeTruthy();
    const buttons = Array.from(card!.querySelectorAll<HTMLButtonElement>('button:not([disabled])'));
    expect(buttons.length).toBeGreaterThanOrEqual(2);

    const first = buttons[0];
    const last = buttons[buttons.length - 1];

    last.focus();
    expect(document.activeElement).toBe(last);
    const tabForward = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    document.dispatchEvent(tabForward);
    expect(document.activeElement).toBe(first);

    const tabBackward = new KeyboardEvent('keydown', {
      key: 'Tab',
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    document.dispatchEvent(tabBackward);
    expect(document.activeElement).toBe(last);

    service.finish(false);
  });
});
