import { Component, computed, ElementRef, inject, input, output, signal, viewChild, type OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { Api } from '../../core/api.service';
import { TPipe } from '../../core/i18n';
import type { UserSummary } from '../../core/models';
import { Avatar } from '../../shared/avatar';

/** People who can see each contract, fetched once per contract for @mentions. */
const participantsCache = new Map<string, Promise<UserSummary[]>>();

export interface CommentDraft {
  body: string;
  mentions: string[];
}

/**
 * A comment box. Typing "@" suggests the people who can see the contract;
 * ↑/↓ pick one, Enter or Tab inserts it, Escape closes the list. Ctrl/⌘+Enter
 * sends the comment.
 */
@Component({
  selector: 'cms-comment-composer',
  imports: [TPipe, FormsModule, MatButtonModule, Avatar],
  template: `
    <form class="relative" (ngSubmit)="send()">
      <textarea
        #box
        name="body"
        [rows]="compact() ? 2 : 3"
        [(ngModel)]="text"
        (input)="onInput()"
        (keydown)="onKey($event)"
        (blur)="closeSoon()"
        [placeholder]="placeholder()"
        [attr.aria-label]="placeholder()"
        role="combobox"
        aria-autocomplete="list"
        [attr.aria-expanded]="suggestions().length > 0"
        [attr.aria-controls]="listId"
        [attr.aria-activedescendant]="suggestions().length ? listId + '-' + highlighted() : null"
        class="block w-full resize-y rounded-xl bg-card px-3 py-2 text-sm text-ink ring-1 ring-line outline-none placeholder:text-faint focus:ring-2 focus:ring-[var(--accent)]"
      ></textarea>
      @if (suggestions().length) {
        <ul [id]="listId" role="listbox" class="absolute z-20 mt-1 max-h-56 w-72 max-w-full overflow-y-auto rounded-xl bg-raised p-1 shadow-lg ring-1 ring-line">
          @for (p of suggestions(); track p.id; let i = $index) {
            <li
              [id]="listId + '-' + i"
              role="option"
              [attr.aria-selected]="i === highlighted()"
              class="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm"
              [class.bg-accent-soft]="i === highlighted()"
              (mousedown)="$event.preventDefault(); pick(p)"
            >
              <cms-avatar [name]="p.firstName + ' ' + p.lastName" [size]="24" />
              <span class="min-w-0"><span class="block truncate text-ink">{{ p.firstName }} {{ p.lastName }}</span><span class="block truncate text-xs text-muted">{{ p.email }}</span></span>
            </li>
          }
        </ul>
      }
      <div class="mt-2 flex items-center justify-end gap-2">
        <span class="mr-auto text-xs text-faint">{{ 'Type @ to mention someone' | t }}</span>
        @if (cancellable()) {
          <button mat-button type="button" (click)="cancelled.emit()">{{ 'Cancel' | t }}</button>
        }
        <button mat-flat-button type="submit" [disabled]="busy() || !text().trim()">{{ submitLabel() | t }}</button>
      </div>
    </form>
  `,
})
export class CommentComposer implements OnInit {
  private readonly api = inject(Api);
  readonly contractId = input.required<string>();
  readonly placeholder = input('');
  readonly submitLabel = input('Comment');
  readonly initial = input('');
  readonly compact = input(false);
  readonly cancellable = input(false);
  readonly busy = input(false);
  readonly submitted = output<CommentDraft>();
  readonly cancelled = output<void>();

  private readonly box = viewChild.required<ElementRef<HTMLTextAreaElement>>('box');
  protected readonly listId = `mentions-${Math.random().toString(36).slice(2, 9)}`;
  protected readonly text = signal('');
  private readonly people = signal<UserSummary[]>([]);
  private readonly query = signal<string | null>(null);
  protected readonly highlighted = signal(0);
  /** People picked from the list; kept only if their "@Name" is still in the text. */
  private readonly picked = new Map<string, string>();

  protected readonly suggestions = computed(() => {
    const q = this.query();
    if (q === null) return [];
    const needle = q.toLowerCase();
    return this.people()
      .filter((p) => `${p.firstName} ${p.lastName} ${p.email}`.toLowerCase().includes(needle))
      .slice(0, 8);
  });

  ngOnInit() {
    this.text.set(this.initial());
  }

  focus() {
    this.box().nativeElement.focus();
  }

  protected onInput() {
    const el = this.box().nativeElement;
    const before = el.value.slice(0, el.selectionStart ?? el.value.length);
    const m = /(?:^|\s)@([\p{L}\p{M}' -]{0,30})$/u.exec(before);
    // Stop suggesting once the "name" has two spaces in it: it's just text by then.
    if (!m || (m[1]!.match(/ /g)?.length ?? 0) > 1) {
      this.query.set(null);
      return;
    }
    this.query.set(m[1]!);
    this.highlighted.set(0);
    if (!participantsCache.has(this.contractId())) participantsCache.set(this.contractId(), this.api.commentParticipants(this.contractId()).catch(() => []));
    void participantsCache.get(this.contractId())!.then((list) => this.people.set(list));
  }

  protected onKey(e: KeyboardEvent) {
    const list = this.suggestions();
    if (list.length) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        this.highlighted.update((i) => (i + (e.key === 'ArrowDown' ? 1 : list.length - 1)) % list.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        this.pick(list[this.highlighted()]!);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        this.query.set(null);
        return;
      }
    }
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      this.send();
    }
  }

  protected pick(p: UserSummary) {
    const el = this.box().nativeElement;
    const caret = el.selectionStart ?? el.value.length;
    const before = el.value.slice(0, caret).replace(/@[^@]*$/, '');
    const label = `@${p.firstName} ${p.lastName}`;
    const next = `${before}${label} ${el.value.slice(caret)}`;
    // Write to the textarea now, not at the next render: keys typed right
    // after picking would otherwise land in the old text and overwrite it.
    el.value = next;
    this.text.set(next);
    this.picked.set(p.id, label);
    this.query.set(null);
    const pos = before.length + label.length + 1;
    el.focus();
    el.setSelectionRange(pos, pos);
  }

  protected closeSoon() {
    setTimeout(() => this.query.set(null), 150);
  }

  protected send() {
    const body = this.text().trim();
    if (!body || this.busy()) return;
    const mentions = [...this.picked].filter(([, label]) => body.includes(label)).map(([id]) => id);
    this.submitted.emit({ body, mentions });
  }

  /** Called by the parent once the comment is saved. */
  reset() {
    this.text.set('');
    this.picked.clear();
    this.query.set(null);
  }
}
