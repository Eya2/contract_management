import { Component, computed, inject, input, output, signal, viewChild } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Api } from '../../core/api.service';
import { TPipe, t } from '../../core/i18n';
import type { CommentItem, CommentThread } from '../../core/models';
import { Toast } from '../../core/toast.service';
import { Avatar } from '../../shared/avatar';
import { ago, dateTime, fullName } from '../../shared/format';
import { CommentComposer, type CommentDraft } from './comment-composer';

/**
 * The threads on one clause (or on the whole contract when `clauseKey` is
 * null), with a box to start a new one. Resolved threads fold away.
 */
@Component({
  selector: 'cms-discussion',
  imports: [TPipe, MatButtonModule, MatIconModule, MatMenuModule, MatTooltipModule, Avatar, CommentComposer],
  template: `
    <div class="space-y-3">
      @for (th of shown(); track th.id) {
        <article
          class="rounded-xl p-3 ring-1 transition-colors"
          [id]="'comment-' + th.id"
          [class]="th.id === highlight() ? 'bg-accent-soft ring-[var(--accent)]' : th.resolvedAt ? 'bg-subtle/50 ring-line-soft' : 'bg-card ring-line'"
        >
          @if (th.outdated || th.resolvedAt) {
            <p class="mb-2 flex flex-wrap items-center gap-2 text-xs">
              @if (th.resolvedAt) {
                <span class="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 font-medium text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-300">
                  <mat-icon class="!size-3.5 !text-[14px]">check_circle</mat-icon>{{ 'Resolved by {name}' | t: { name: fullName(th.resolvedBy) } }}
                </span>
              }
              @if (th.outdated) {
                <span class="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 font-medium text-amber-800 dark:bg-amber-400/10 dark:text-amber-200" [matTooltip]="'The clause was changed after this comment.' | t">
                  <mat-icon class="!size-3.5 !text-[14px]">history</mat-icon>{{ 'On version {n}, clause changed since' | t: { n: th.versionNumber } }}
                </span>
              }
            </p>
          }
          @for (c of messages(th); track c.id; let first = $first) {
            <div class="flex gap-2.5" [class.mt-3]="!first" [class.pl-8]="!first">
              <cms-avatar [name]="fullName(c.author)" [size]="first ? 28 : 24" />
              <div class="min-w-0 flex-1">
                <p class="flex flex-wrap items-baseline gap-x-2 text-xs">
                  <span class="font-medium text-ink">{{ fullName(c.author) }}</span>
                  <span class="text-faint" [title]="dateTime(c.createdAt)">{{ ago(c.createdAt) }}{{ c.editedAt ? ' · ' + ('edited' | t) : '' }}</span>
                  @if (c.canEdit || c.canDelete) {
                    <button mat-icon-button class="!-my-2 !ml-auto !size-7 !p-0.5" [matMenuTriggerFor]="menu" [attr.aria-label]="'Comment actions' | t">
                      <mat-icon class="!text-[18px]">more_horiz</mat-icon>
                    </button>
                    <mat-menu #menu="matMenu" xPosition="before">
                      @if (c.canEdit) {
                        <button mat-menu-item (click)="editing.set(c.id)"><mat-icon>edit</mat-icon>{{ 'Edit' | t }}</button>
                      }
                      @if (c.canDelete) {
                        <button mat-menu-item (click)="remove(c)"><mat-icon>delete</mat-icon>{{ 'Delete' | t }}</button>
                      }
                    </mat-menu>
                  }
                </p>
                @if (editing() === c.id) {
                  <div class="mt-1">
                    <cms-comment-composer [contractId]="contractId()" [initial]="c.body ?? ''" [compact]="true" submitLabel="Save" [cancellable]="true" [busy]="busy()" (submitted)="saveEdit(c, $event)" (cancelled)="editing.set(null)" />
                  </div>
                } @else if (c.deleted) {
                  <p class="mt-0.5 text-sm text-faint italic">{{ 'This comment was deleted.' | t }}</p>
                } @else {
                  <p class="mt-0.5 text-sm break-words whitespace-pre-line text-body">{{ c.body }}</p>
                }
              </div>
            </div>
          }
          <div class="mt-2 flex flex-wrap items-center gap-1 pl-9">
            @if (!th.resolvedAt) {
              <button mat-button class="!h-8 !px-2 !text-xs" (click)="replying.set(replying() === th.id ? null : th.id)"><mat-icon>reply</mat-icon>{{ 'Reply' | t }}</button>
            }
            @if (th.canResolve) {
              <button mat-button class="!h-8 !px-2 !text-xs" (click)="setResolved(th, !th.resolvedAt)">
                <mat-icon>{{ th.resolvedAt ? 'undo' : 'check' }}</mat-icon>{{ (th.resolvedAt ? 'Reopen' : 'Resolve') | t }}
              </button>
            }
          </div>
          @if (replying() === th.id) {
            <div class="mt-2 pl-9">
              <cms-comment-composer [contractId]="contractId()" [compact]="true" [placeholder]="'Write a reply…' | t" submitLabel="Reply" [cancellable]="true" [busy]="busy()" (submitted)="post($event, th.id)" (cancelled)="replying.set(null)" />
            </div>
          }
        </article>
      }

      @if (resolvedCount() && !showResolved()) {
        <button mat-button class="!text-xs" (click)="showResolved.set(true)"><mat-icon>expand_more</mat-icon>{{ '{n} resolved threads' | t: { n: resolvedCount() } }}</button>
      }

      @if (canStart()) {
        <cms-comment-composer
          #composer
          [contractId]="contractId()"
          [placeholder]="(clauseKey() ? 'Comment on this clause…' : 'Start a discussion about this contract…') | t"
          [busy]="busy()"
          (submitted)="post($event)"
        />
      }
    </div>
  `,
})
export class Discussion {
  private readonly api = inject(Api);
  private readonly toast = inject(Toast);

  readonly contractId = input.required<string>();
  readonly clauseKey = input<string | null>(null);
  readonly threads = input.required<CommentThread[]>();
  /** A new thread can only be started on a clause of the current version. */
  readonly canStart = input(true);
  /** Thread to highlight (opened from a notification). */
  readonly highlight = input<string | null>(null);
  readonly changed = output<void>();

  private readonly composer = viewChild<CommentComposer>('composer');
  protected readonly replying = signal<string | null>(null);
  protected readonly editing = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly showResolved = signal(false);

  protected readonly resolvedCount = computed(() => this.threads().filter((th) => th.resolvedAt && th.id !== this.highlight()).length);
  protected readonly shown = computed(() => this.threads().filter((th) => this.showResolved() || !th.resolvedAt || th.id === this.highlight()));

  protected readonly ago = ago;
  protected readonly dateTime = dateTime;
  protected readonly fullName = fullName;

  focus() {
    this.composer()?.focus();
  }

  protected messages(th: CommentThread): CommentItem[] {
    return [th, ...th.replies];
  }

  protected async post(draft: CommentDraft, parentId?: string) {
    await this.act(async () => {
      await this.api.addComment(this.contractId(), { body: draft.body, mentions: draft.mentions, ...(parentId ? { parentId } : { clauseKey: this.clauseKey() }) });
      this.replying.set(null);
      if (!parentId) this.composer()?.reset();
    });
  }

  protected async saveEdit(c: CommentItem, draft: CommentDraft) {
    await this.act(async () => {
      await this.api.editComment(c.id, draft.body);
      this.editing.set(null);
    });
  }

  protected async remove(c: CommentItem) {
    await this.act(() => this.api.deleteComment(c.id), t('Comment deleted'));
  }

  protected async setResolved(th: CommentThread, resolved: boolean) {
    await this.act(() => this.api.resolveComment(th.id, resolved), resolved ? t('Thread resolved') : undefined);
  }

  private async act(fn: () => Promise<unknown>, done?: string) {
    this.busy.set(true);
    try {
      await fn();
      if (done) this.toast.success(done);
      this.changed.emit();
    } catch (err) {
      this.toast.error(err);
    } finally {
      this.busy.set(false);
    }
  }
}
