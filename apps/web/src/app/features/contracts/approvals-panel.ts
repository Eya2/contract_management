import { Component, inject, input, output, resource } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { Api } from '../../core/api.service';
import type { ApprovalStep } from '../../core/models';
import { Toast } from '../../core/toast.service';
import { dateTime, fullName, humanize } from '../../shared/format';
import { PromptDialog, type PromptData } from '../../shared/prompt-dialog';
import { StatusBadge } from '../../shared/status-badge';

/** Every review round of the contract, stage by stage, with approve/reject where the user may act. */
@Component({
  selector: 'cms-approvals-panel',
  imports: [MatButtonModule, MatIconModule, StatusBadge],
  template: `
    @if (status() === 'DRAFT' && preview.value(); as p) {
      <section class="mb-6 callout tone-info !block !p-5">
        <h3 class="font-semibold text-ink">If you submit now</h3>
        @if (p.template) {
          <p class="mb-3 text-sm text-body">Policy: <span class="font-medium">{{ p.template.name }}</span></p>
          <ol class="space-y-1 text-sm">
            @for (s of p.steps; track $index) {
              <li class="flex flex-wrap items-center gap-2" [class.text-faint]="!s.willRun">
                <span class="w-16 text-xs font-semibold text-faint uppercase">Stage {{ s.stage }}</span>
                <span [class.line-through]="!s.willRun">{{ s.name }}</span>
                <span class="text-xs text-muted">({{ humanize(s.approverRole) }}{{ s.slaHours ? ', ' + s.slaHours + ' h SLA' : '' }})</span>
                @if (!s.willRun) {
                  <span class="text-xs italic">skipped: {{ s.skipReason }}</span>
                } @else if (s.condition) {
                  <span class="text-xs text-muted">applies because {{ s.condition }}</span>
                }
              </li>
            }
          </ol>
        } @else {
          <p class="text-sm text-rose-700 dark:text-rose-300">No approval policy applies to this contract yet. Ask an admin to configure one.</p>
        }
      </section>
    }

    @for (r of requests.value(); track r.id; let latest = $first) {
      <section class="mb-6 card" [class.opacity-80]="!latest">
        <header class="flex flex-wrap items-center gap-3 border-b border-line-soft px-5 py-3">
          <h3 class="font-semibold text-ink">Review of version {{ r.contractVersion.versionNumber }}</h3>
          <cms-status [status]="r.status" />
          <span class="ml-auto text-xs text-muted">
            Submitted by {{ fullName(r.submittedBy) }} · {{ dateTime(r.submittedAt) }}{{ r.workflowTemplate ? ' · ' + r.workflowTemplate.name : '' }}
          </span>
        </header>
        <ol class="relative px-5 py-4">
          @for (s of r.steps; track s.id; let last = $last) {
            <li class="relative flex gap-4 pb-5" [class.pb-0]="last">
              @if (!last) {
                <span class="absolute top-8 left-[15px] h-full w-px bg-line"></span>
              }
              <span class="z-10 flex size-8 shrink-0 items-center justify-center rounded-full text-white" [class]="dot(s)">
                <mat-icon class="!size-4 !text-[16px]">{{ icon(s) }}</mat-icon>
              </span>
              <div class="min-w-0 flex-1">
                <div class="flex flex-wrap items-center gap-2">
                  <span class="text-xs font-semibold text-faint uppercase">Stage {{ s.stage }}</span>
                  <span class="font-medium text-ink">{{ s.name }}</span>
                  <cms-status [status]="s.status" />
                  @if (s.escalationLevel > 0) {
                    <span class="rounded-md bg-orange-100 px-1.5 py-0.5 text-xs font-medium text-orange-700 dark:bg-orange-400/15 dark:text-orange-300">Escalated ×{{ s.escalationLevel }}</span>
                  }
                </div>
                <p class="mt-0.5 text-sm text-muted">
                  {{ s.assignee ? 'Assigned to ' + fullName(s.assignee) : humanize(s.approverRole) + (s.approverDepartment ? ' of ' + s.approverDepartment.name : ', any') }}
                  @if (s.status === 'PENDING' && s.dueAt) {
                    · due {{ dateTime(s.dueAt) }}
                  }
                </p>
                @if (s.routingNote) {
                  <p class="mt-1 text-xs text-muted italic">{{ s.routingNote }}</p>
                }
                @if (s.skipReason) {
                  <p class="mt-1 text-xs text-muted">Skipped: {{ s.skipReason }}</p>
                }
                @if (s.decidedBy) {
                  <p class="mt-1 text-sm">
                    <span class="font-medium">{{ fullName(s.decidedBy) }}</span>
                    <span class="text-muted"> {{ s.status === 'APPROVED' ? 'approved' : 'rejected' }} · {{ dateTime(s.decidedAt) }}</span>
                  </p>
                  @if (s.comment) {
                    <blockquote class="mt-1 border-l-2 border-line pl-3 text-sm text-body">{{ s.comment }}</blockquote>
                  }
                }
                @for (e of s.escalations; track $index) {
                  <p class="mt-1 text-xs text-orange-700 dark:text-orange-300">Escalated to {{ fullName(e.escalatedTo) }} (level {{ e.level }}) · {{ dateTime(e.createdAt) }}</p>
                }
                @if (s.canDecide) {
                  <div class="mt-3 flex gap-2">
                    <button mat-flat-button (click)="approve(s)"><mat-icon>check</mat-icon>Approve</button>
                    <button mat-stroked-button class="!text-rose-600 dark:!text-rose-400" (click)="reject(s)"><mat-icon>close</mat-icon>Reject</button>
                  </div>
                }
              </div>
            </li>
          }
        </ol>
      </section>
    } @empty {
      @if (status() !== 'DRAFT') {
        <p class="py-10 text-center text-sm text-muted">This contract has not been through approval.</p>
      }
    }
  `,
})
export class ApprovalsPanel {
  private readonly api = inject(Api);
  private readonly dialog = inject(MatDialog);
  private readonly toast = inject(Toast);
  readonly contractId = input.required<string>();
  /** Current contract status; changes when the contract reloads, which reloads this panel too. */
  readonly status = input.required<string>();
  readonly changed = output<void>();

  protected readonly requests = resource({
    params: () => ({ id: this.contractId(), status: this.status() }),
    loader: ({ params }) => this.api.approvals(params.id),
  });
  protected readonly preview = resource({
    params: () => (this.status() === 'DRAFT' ? this.contractId() : undefined),
    loader: ({ params }) => this.api.approvalPreview(params),
  });
  protected readonly fullName = fullName;
  protected readonly dateTime = dateTime;
  protected readonly humanize = humanize;

  protected icon(s: ApprovalStep) {
    return { APPROVED: 'check', REJECTED: 'close', PENDING: 'hourglass_top', WAITING: 'schedule', SKIPPED: 'redo', CANCELLED: 'block' }[s.status];
  }

  protected dot(s: ApprovalStep) {
    return {
      APPROVED: 'bg-emerald-500',
      REJECTED: 'bg-rose-500',
      PENDING: 'bg-amber-500',
      WAITING: 'bg-subtle-strong',
      SKIPPED: 'bg-subtle-strong',
      CANCELLED: 'bg-subtle-strong',
    }[s.status];
  }

  protected approve(s: ApprovalStep) {
    this.decide(s, { title: `Approve “${s.name}”`, label: 'Comment (optional)', confirm: 'Approve', minLength: 0 }, (c) => this.api.approve(s.id, c || undefined));
  }

  protected reject(s: ApprovalStep) {
    this.decide(
      s,
      { title: `Reject “${s.name}”`, message: 'The whole review round ends and the owner is asked to revise.', label: 'Reason (required)', confirm: 'Reject', minLength: 1, danger: true },
      (c) => this.api.reject(s.id, c),
    );
  }

  private decide(_s: ApprovalStep, data: PromptData, action: (comment: string) => Promise<unknown>) {
    this.dialog
      .open(PromptDialog, { data, width: '480px' })
      .afterClosed()
      .subscribe(async (comment?: string) => {
        if (comment === undefined) return;
        try {
          await action(comment);
          this.toast.success('Decision recorded');
          this.changed.emit();
        } catch (err) {
          this.toast.error(err);
          this.requests.reload();
        }
      });
  }
}
