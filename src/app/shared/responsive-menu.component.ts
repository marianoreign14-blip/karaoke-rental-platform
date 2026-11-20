import { Component } from '@angular/core';

import { IconComponent } from './icon.component';

@Component({
  selector: 'app-responsive-menu',
  standalone: true,
  imports: [IconComponent],
  host: {
    '[class.menu-open]': 'menuOpen',
    '(click)': 'closeAfterNavigation($event)',
  },
  template: `
    <button
      type="button"
      class="responsive-menu-toggle"
      aria-label="Toggle navigation menu"
      [attr.aria-expanded]="menuOpen"
      (click)="menuOpen = !menuOpen"
    >
      <app-icon name="menu" [size]="17"></app-icon>
      <span>Menu</span>
    </button>
    <ng-content></ng-content>
  `,
  styles: [':host { display: contents; }'],
})
export class ResponsiveMenuComponent {
  menuOpen = false;

  closeAfterNavigation(event: MouseEvent): void {
    const target = event.target;
    if (target instanceof Element && target.closest('nav a, nav button')) {
      this.menuOpen = false;
    }
  }
}
