import { Component, inject, resource } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { Api } from '../../core/api.service';
import type { PendingStep } from '../../core/models';
import { CountsService } from '../../core/counts.service';
import { Toast } from '../../core/toast.service';
import { dateTime, fullName, humanize, money } from '../../shared/format';
import { PromptDialog, type PromptData } from '../../shared/prompt-dialog';

/** "Pending my approval": the steps the user can decide now, most urgent first. */
@Component({
  imports: [RouterLink, MatButtonModule, MatIconModule],
  template: `
    <h1 class="text-2xl font-bold text-ink">Approvals</h1>
    <p class="mb-6 text-sm text-muted">Contracts waiting for your decision, most urgent first.</p>

    @for (s of queue.value(); track s.id) {
      <article class="card card-interactive stagger mb-4 p-5" [style.--i]="$index" [class.overdue]="s.overdue">
        <div class="flex flex-wrap items-start gap-4">
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-2">
              <a [routerLink]="['/contracts', s.request.contract.id]" [queryParams]="{ tab: 'approvals' }" class="text-lg font-semibold text-ink hover:text-accent">
                {{ s.request.contract.title }}
              </a>
              @if (s.overdue) {
                <span class="rounded-md bg-orange-100 px-1.5 py-0.5 text-xs font-medium text-orange-700 dark:bg-orange-400/15 dark:text-orange-300">Overdue</span>
              }
              @if (s.escalatedToMe) {
                <span class="rounded bg-violet-100 px-1.5 py-0.5 text-xs font-medium text-violet-700">Escalated to you</span>
              }
            </div>
            <p class="mt-1 text-sm text-muted">
              {{ s.request.contract.referenceNumber }} · v{{ s.request.contractVersion.versionNumber }} · {{ s.request.contract.counterparty.name }} ·
              {{ humanize(s.request.contract.type) }} · {{ s.request.contract.department.name }}
            </p>
            <p class="mt-3 text-sm">
              <span class="font-medium">{{ s.name }}</span>
              <span class="text-muted"> (stage {{ s.stage }}) · requested by {{ fullName(s.request.submittedBy) }} · {{ dateTime(s.request.submittedAt) }}</span>
            </p>
            @if (s.dueAt) {
              <p class="text-sm" [class]="s.overdue ? 'text-orange-700 dark:text-orange-300' : 'text-muted'">Due {{ dateTime(s.dueAt) }}</p>
            }
            @if (s.routingNote) {
              <p class="mt-1 text-xs text-muted italic">{{ s.routingNote }}</p>
            }
          </div>
          <div class="text-right">
            <p class="text-xl font-semibold text-ink tabular-nums">{{ money(s.request.contract.value, s.request.contract.currency) }}</p>
            <div class="mt-3 flex gap-2">
              <button mat-stroked-button class="!text-rose-600 dark:!text-rose-400" (click)="reject(s)">Reject</button>
              <button mat-flat-button (click)="approve(s)"><mat-icon>check</mat-icon>Approve</button>
            </div>
          </div>
        </div>
      </article>
    } @empty {
      <div class="rounded-xl bg-card p-12 text-center shadow-sm ring-1 ring-line">
        <mat-icon class="!size-10 !text-[40px] text-emerald-500">task_alt</mat-icon>
        <p class="mt-2 font-medium">{{ queue.isLoading() ? 'Loading…' : 'Nothing is waiting for you.' }}</p>
      </div>
    }
  `,
})
export class ApprovalsPage {
  private readonly api = inject(Api);
  private readonly dialog = inject(MatDialog);
  private readonly toast = inject(Toast);
  private readonly counts = inject(CountsService);
  protected readonly queue = resource({ loader: () => this.api.pendingApprovals() });
  protected readonly money = money;
  protected readonly humanize = humanize;
  protected readonly fullName = fullName;
  protected readonly dateTime = dateTime;

  protected approve(s: PendingStep) {
    this.decide({ title: `Approve “${s.name}”`, message: s.request.contract.title, label: 'Comment (optional)', confirm: 'Approve', minLength: 0 }, (c) =>
      this.api.approve(s.id, c || undefined),
    );
  }

  protected reject(s: PendingStep) {
    this.decide(
      { title: `Reject “${s.name}”`, message: `${s.request.contract.title}. The owner will be asked to revise.`, label: 'Reason', confirm: 'Reject', minLength: 1, danger: true },
      (c) => this.api.reject(s.id, c),
    );
  }

  private decide(data: PromptData, action: (comment: string) => Promise<unknown>) {
    this.dialog
      .open(PromptDialog, { data, width: '480px' })
      .afterClosed()
      .subscribe(async (comment?: string) => {
        if (comment === undefined) return;
        try {
          await action(comment);
          this.toast.success('Decision recorded');
        } catch (err) {
          this.toast.error(err);
        }
        this.queue.reload();
        void this.counts.refresh();
      });
  }
}
