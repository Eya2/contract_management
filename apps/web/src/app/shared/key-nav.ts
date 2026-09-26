import { afterEveryRender, Directive, ElementRef, inject, input } from '@angular/core';

const FOCUSABLE = 'a[href], button, input, select, textarea, [tabindex]';

/**
 * Keyboard navigation for tables, lists and grids (roving tabindex).
 *
 * The container is a single Tab stop: the arrow keys move between the items
 * marked `data-nav-item`, Home/End jump to the first/last, Page Up/Down move by
 * ten rows, and Enter or Space activates the item (its `data-nav-action`
 * element if it has one, else the item itself). Buttons inside the current
 * item stay reachable with Tab; those in other rows are skipped.
 *
 *   <tbody cmsKeyNav>…<tr data-nav-item>…</tr></tbody>        ↑/↓
 *   <div cmsKeyNav="7">…<button data-nav-item>…</div>          ←/→ and ↑/↓ by week
 *
 * `data-nav-default` marks the item to start from (e.g. today in a calendar).
 */
@Directive({
  selector: '[cmsKeyNav]',
  host: { '(keydown)': 'onKey($event)', '(focusin)': 'onFocus($event)' },
})
export class KeyNav {
  /** Items per row: 1 for a list or table, 7 for a month grid. */
  readonly columns = input(1, { alias: 'cmsKeyNav', transform: (v: unknown) => Number(v) || 1 });

  private readonly host: HTMLElement = inject(ElementRef).nativeElement;
  private active = -1;

  constructor() {
    afterEveryRender(() => this.sync());
  }

  private items(): HTMLElement[] {
    return [...this.host.querySelectorAll<HTMLElement>('[data-nav-item]')].filter((el) => el.closest('[cmsKeyNav]') === this.host);
  }

  /** One item is tabbable; controls inside the other items are taken out of the Tab order. */
  private sync() {
    const items = this.items();
    if (!items.length) return;
    if (this.active < 0 || this.active >= items.length) {
      const preferred = items.findIndex((el) => el.hasAttribute('data-nav-default'));
      this.active = Math.max(0, Math.min(preferred >= 0 ? preferred : 0, items.length - 1));
    }
    items.forEach((item, i) => {
      item.tabIndex = i === this.active ? 0 : -1;
      for (const inner of item.querySelectorAll<HTMLElement>(FOCUSABLE)) {
        if (inner.hasAttribute('data-nav-skip')) continue;
        if (i === this.active) {
          if (inner.dataset['navHidden']) {
            inner.removeAttribute('tabindex');
            delete inner.dataset['navHidden'];
          }
        } else if (inner.tabIndex >= 0) {
          inner.tabIndex = -1;
          inner.dataset['navHidden'] = '1';
        }
      }
    });
  }

  protected onFocus(event: FocusEvent) {
    const i = this.items().findIndex((el) => el.contains(event.target as Node));
    if (i >= 0 && i !== this.active) {
      this.active = i;
      this.sync();
    }
  }

  protected onKey(event: KeyboardEvent) {
    const items = this.items();
    const current = items.indexOf(event.target as HTMLElement);
    if (current < 0) return; // focus is on a control inside the item: leave its keys alone
    const cols = this.columns();
    const last = items.length - 1;
    let next: number | null = null;
    switch (event.key) {
      case 'ArrowDown': next = current + cols; break;
      case 'ArrowUp': next = current - cols; break;
      case 'ArrowRight': next = cols > 1 ? current + 1 : null; break;
      case 'ArrowLeft': next = cols > 1 ? current - 1 : null; break;
      case 'Home': next = event.ctrlKey || cols === 1 ? 0 : current - (current % cols); break;
      case 'End': next = event.ctrlKey || cols === 1 ? last : Math.min(last, current - (current % cols) + cols - 1); break;
      case 'PageDown': next = current + (cols > 1 ? cols * 4 : 10); break;
      case 'PageUp': next = current - (cols > 1 ? cols * 4 : 10); break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        (items[current]!.querySelector<HTMLElement>('[data-nav-action]') ?? items[current]!).click();
        return;
      default:
        return;
    }
    if (next === null) return;
    event.preventDefault();
    next = Math.max(0, Math.min(last, next));
    this.active = next;
    this.sync();
    items[next]!.focus();
    items[next]!.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
}
