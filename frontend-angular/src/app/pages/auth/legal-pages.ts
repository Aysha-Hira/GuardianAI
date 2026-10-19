import { ChangeDetectionStrategy, Component } from '@angular/core'
import { PRIVACY, TERMS } from '../../auth/legal-content'
import { LegalDocumentComponent } from '../../auth/legal-document'

@Component({
  selector: 'app-terms',
  imports: [LegalDocumentComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display: contents' },
  template: `<app-legal-document [doc]="doc" />`,
})
export class TermsPage {
  protected readonly doc = TERMS
}

@Component({
  selector: 'app-privacy',
  imports: [LegalDocumentComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display: contents' },
  template: `<app-legal-document [doc]="doc" />`,
})
export class PrivacyPage {
  protected readonly doc = PRIVACY
}
