import { ChangeDetectionStrategy, Component, Input } from '@angular/core';

@Component({
  selector: 'app-brand-mark',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [
    `
      :host {
        display: inline-flex;
        align-items: center;
        gap: 10px;
      }

      .mark {
        display: grid;
        place-items: center;
        width: 30px;
        height: 30px;
        border-radius: 9px;
        background: var(--accent);
        color: #ffffff;
        flex-shrink: 0;
      }

      .brand-text {
        display: flex;
        flex-direction: column;
        line-height: 1.05;
      }

      .wordmark {
        color: var(--text-primary);
        font-size: 15px;
        font-weight: 800;
        letter-spacing: -0.04em;
      }

      .sub {
        color: var(--text-secondary);
        font-size: 10.5px;
        font-weight: 500;
        letter-spacing: 0.01em;
      }
    `,
  ],
  template: `
    <span class="mark" aria-hidden="true">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4">
        <path stroke-linecap="round" d="M4 13v-2M8 17V7M12 20V4M16 17V7M20 13v-2" />
      </svg>
    </span>
    @if (!compact) {
      <span class="brand-text">
        <span class="wordmark">KARAOKE</span>
        @if (subtitle) {
          <span class="sub">{{ subtitle }}</span>
        }
      </span>
    }
  `,
})
export class BrandMarkComponent {
  @Input() subtitle = '';
  @Input() compact = false;
}
