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
        position: relative;
        isolation: isolate;
        display: grid;
        place-items: center;
        width: 30px;
        height: 30px;
        border-radius: 9px;
        background: var(--accent);
        color: #ffffff;
        flex-shrink: 0;
        transition:
          transform 180ms ease,
          filter 180ms ease;
      }

      .mark::before {
        position: absolute;
        inset: 0;
        z-index: -1;
        border-radius: inherit;
        box-shadow: 0 0 9px 2px rgba(109, 40, 217, 0.34);
        opacity: 0.2;
        animation: brand-mark-glow 2.8s ease-in-out infinite;
        content: '';
        pointer-events: none;
      }

      .mark:hover {
        transform: scale(1.07);
        filter: drop-shadow(0 0 6px rgba(109, 40, 217, 0.55));
      }

      .wave {
        transform-box: fill-box;
        transform-origin: center;
        animation: brand-wave 1.15s ease-in-out infinite;
      }

      .wave--1 {
        animation-duration: 0.92s;
        animation-delay: -0.28s;
      }

      .wave--2 {
        animation-duration: 1.04s;
        animation-delay: -0.56s;
      }

      .wave--3 {
        animation-duration: 1.18s;
        animation-delay: -0.35s;
      }

      .wave--4 {
        animation-duration: 1.06s;
        animation-delay: -0.72s;
      }

      .wave--5 {
        animation-duration: 0.9s;
        animation-delay: -0.44s;
      }

      @keyframes brand-wave {
        0%,
        100% {
          transform: translateY(1px) scaleY(0.92);
        }

        50% {
          transform: translateY(-1px) scaleY(1.08);
        }
      }

      @keyframes brand-mark-glow {
        0%,
        100% {
          opacity: 0.14;
          transform: scale(0.92);
        }

        50% {
          opacity: 0.42;
          transform: scale(1.12);
        }
      }

      @media (prefers-reduced-motion: reduce) {
        .mark,
        .mark::before,
        .wave {
          animation: none;
          transition: none;
        }
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
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2.4"
        stroke-linecap="round"
      >
        <path class="wave wave--1" d="M4 13v-2" />
        <path class="wave wave--2" d="M8 17V7" />
        <path class="wave wave--3" d="M12 20V4" />
        <path class="wave wave--4" d="M16 17V7" />
        <path class="wave wave--5" d="M20 13v-2" />
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
