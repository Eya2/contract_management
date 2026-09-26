import { effect, Injectable } from '@angular/core';
import { MatPaginatorIntl } from '@angular/material/paginator';
import { lang } from '../core/i18n';

/**
 * Provided by the pages that use a paginator (not globally): importing
 * MatPaginatorIntl at the root would pull the whole paginator module, with its
 * select and tooltip, into the initial bundle.
 */
@Injectable()
export class TranslatedPaginatorIntl extends MatPaginatorIntl {
  constructor() {
    super();
    effect(() => {
      const fr = lang() === 'fr';
      this.itemsPerPageLabel = fr ? 'Éléments par page :' : 'Items per page:';
      this.nextPageLabel = fr ? 'Page suivante' : 'Next page';
      this.previousPageLabel = fr ? 'Page précédente' : 'Previous page';
      this.firstPageLabel = fr ? 'Première page' : 'First page';
      this.lastPageLabel = fr ? 'Dernière page' : 'Last page';
      this.getRangeLabel = (page, size, length) => {
        if (length === 0) return fr ? '0 sur 0' : '0 of 0';
        const start = page * size;
        return `${start + 1} – ${Math.min(start + size, length)} ${fr ? 'sur' : 'of'} ${length}`;
      };
      this.changes.next();
    });
  }
}
