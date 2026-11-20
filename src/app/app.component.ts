import { Component } from '@angular/core';
import { IonApp, IonRouterOutlet } from '@ionic/angular';

import { ConfirmDialogComponent } from './shared/confirm-dialog.component';
import { ToastHostComponent } from './shared/toast-host.component';

@Component({
  selector: 'app-root',
  templateUrl: 'app.component.html',
  imports: [IonApp, IonRouterOutlet, ConfirmDialogComponent, ToastHostComponent],
})
export class AppComponent {
  constructor() {}
}
