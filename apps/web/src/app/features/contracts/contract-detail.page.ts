import { Component, computed, inject, input, linkedSignal, resource, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTabsModule } from '@angular/material/tabs';
import { Router, RouterLink } from '@angular/router';
import { Api } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import type { ContractDetail } from '../../core/models';
import { Toast } from '../../core/toast.service';
import { date, dateTime, fileSize, fullName, humanize, money } from '../../shared/format';
import { PromptDialog, type PromptData } from '../../shared/prompt-dialog';
import { StatusBadge } from '../../shared/status-badge';
import { ActivityPanel } from './activity-panel';
import { ApprovalsPanel } from './approvals-panel';
import { SignaturesPanel } from './signatures-panel';
import { VersionsPanel } from './versions-panel';

const TABS = ['overview', 'approvals', 'signatures', 'versions', 'activity'] as const;

@Component({
  imports: [
    RouterLink,
    MatButtonModule,
    MatIconModule,
    MatMenuModule,
    MatTabsModule,
    MatProgressSpinnerModule,
    StatusBadge,
    ApprovalsPanel,
    SignaturesPanel,
    VersionsPanel,
    ActivityPanel,
  ],
  template: `
    <a routerLink="/contracts" class="mb-4 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-ink">
      <mat-icon class="!size-[18px] !text-[18px]">arrow_back</mat-icon>Contracts
    </a>

    @if (contract.error()) {
      <p class="rounded-lg bg-rose-50 p-6 text-rose-700">This contract doesn't exist or you don't have access to it.</p>
    } @else if (contract.value(); as c) {
      <header class="mb-6 flex flex-wrap items-start gap-4">
        <div class="min-w-0 flex-1">
          <div class="flex flex-wrap items-center gap-3">
            <h1 class="text-2xl font-bold text-ink">{{ c.title }}</h1>
            <cms-status [status]="c.status" />
          </div>
          <p class="mt-1 text-sm text-slate-500">
            {{ c.referenceNumber }} · version {{ c.currentVersionNumber }} · {{ c.counterparty.name }} · owned by {{ fullName(c.owner) }} ({{ c.department.name }})
          </p>
        </div>
        <div class="flex flex-wrap gap-2">
          @for (a of actions(); track a.id) {
            @if (a.primary) {
              <button mat-flat-button [disabled]="busy()" (click)="run(a.id)"><mat-icon>{{ a.icon }}</mat-icon>{{ a.label }}</button>
            } @else {
              <button mat-stroked-button [disabled]="busy()" (click)="run(a.id)"><mat-icon>{{ a.icon }}</mat-icon>{{ a.label }}</button>
            }
          }
        </div>
      </header>

      @if (c.status === 'REJECTED') {
        <div class="mb-6 flex items-center gap-3 rounded-xl bg-rose-50 p-4 text-sm text-rose-800 ring-1 ring-rose-200">
          <mat-icon>info</mat-icon> This contract was rejected. See the Approvals tab for the reason, then edit it to start a revision.
        </div>
      }

      <mat-tab-group [selectedIndex]="tabIndex()" (selectedIndexChange)="selectTab($event)" animationDuration="0ms" mat-stretch-tabs="false">
        <mat-tab label="Overview">
          <div class="grid gap-6 pt-6 lg:grid-cols-3">
            <section class="space-y-6 lg:col-span-2">
              <div class="rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
                <dl class="grid grid-cols-2 gap-4 text-sm sm:grid-cols-3">
                  <div><dt class="text-slate-500">Type</dt><dd class="font-medium">{{ humanize(c.type) }}</dd></div>
                  <div><dt class="text-slate-500">Value</dt><dd class="font-medium">{{ money(c.value, c.currency) }}</dd></div>
                  <div><dt class="text-slate-500">Auto-renew</dt><dd class="font-medium">{{ c.autoRenew ? 'Yes' : 'No' }}</dd></div>
                  <div><dt class="text-slate-500">Starts</dt><dd class="font-medium">{{ date(c.startDate) }}</dd></div>
                  <div><dt class="text-slate-500">Ends</dt><dd class="font-medium">{{ date(c.endDate) }}</dd></div>
                  <div><dt class="text-slate-500">Last change</dt><dd class="font-medium">{{ dateTime(c.updatedAt) }}</dd></div>
                </dl>
              </div>
              <div class="rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
                <h2 class="mb-2 font-semibold text-ink">Clauses</h2>
                @for (cl of c.currentVersion.clauses; track cl.key; let i = $index) {
                  <article class="border-t border-slate-100 py-4 first:border-0">
                    <h3 class="font-medium text-ink">{{ i + 1 }}. {{ cl.heading }}</h3>
                    <p class="mt-1 text-sm leading-relaxed whitespace-pre-line text-slate-700">{{ cl.body }}</p>
                  </article>
                } @empty {
                  <p class="text-sm text-slate-500">This contract is defined by its uploaded document.</p>
                }
              </div>
            </section>
            <aside class="space-y-6">
              <div class="rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
                <h2 class="mb-3 font-semibold text-ink">Document</h2>
                @if (c.currentVersion.file; as f) {
                  <button class="flex w-full items-center gap-2 rounded-lg bg-slate-50 p-3 text-left text-sm hover:bg-slate-100" (click)="downloadDocument(c, f.originalName)">
                    <mat-icon class="text-rose-600">picture_as_pdf</mat-icon>
                    <span class="min-w-0 flex-1 truncate">{{ f.originalName }}</span>
                    <span class="text-xs text-slate-500">{{ fileSize(f.sizeBytes) }}</span>
                  </button>
                  <p class="mt-2 font-mono text-[11px] break-all text-slate-400" title="SHA-256">{{ f.sha256 }}</p>
                } @else {
                  <p class="text-sm text-slate-500">No document uploaded.</p>
                }
              </div>
              <div class="rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
                <div class="mb-3 flex items-center justify-between">
                  <h2 class="font-semibold text-ink">Attachments</h2>
                  @if (isOwnerOrAdmin() && !['RENEWED', 'TERMINATED'].includes(c.status)) {
                    <label class="cursor-pointer text-sm font-medium text-brand-600 hover:underline">
                      Add file<input type="file" class="sr-only" (change)="attach($event)" />
                    </label>
                  }
                </div>
                <ul class="space-y-2">
                  @for (a of c.attachments; track a.id) {
                    <li class="flex items-center gap-2 text-sm">
                      <mat-icon class="!size-5 !text-[20px] text-slate-400">attach_file</mat-icon>
                      <button class="min-w-0 flex-1 truncate text-left hover:text-brand-700" (click)="downloadAttachment(c, a.id, a.file.originalName)">
                        {{ a.description || a.file.originalName }}
                      </button>
                      @if (isOwnerOrAdmin() && ['DRAFT', 'REJECTED'].includes(c.status) && a.kind === 'SUPPORTING') {
                        <button mat-icon-button (click)="removeAttachment(c, a.id)" aria-label="Remove attachment"><mat-icon>close</mat-icon></button>
                      }
                    </li>
                  } @empty {
                    <li class="text-sm text-slate-500">None.</li>
                  }
                </ul>
              </div>
            </aside>
          </div>
        </mat-tab>
        <mat-tab label="Approvals">
          <div class="pt-6"><cms-approvals-panel [contractId]="c.id" [status]="c.status" (changed)="refresh()" /></div>
        </mat-tab>
        <mat-tab label="Signatures">
          <div class="pt-6"><cms-signatures-panel [contract]="c" (changed)="refresh()" /></div>
        </mat-tab>
        <mat-tab label="Versions">
          <div class="pt-6"><cms-versions-panel [contractId]="c.id" [currentVersion]="c.currentVersionNumber" /></div>
        </mat-tab>
        <mat-tab label="Activity">
          <div class="pt-6"><cms-activity-panel [contractId]="c.id" [revision]="revision()" /></div>
        </mat-tab>
      </mat-tab-group>
    } @else {
      <mat-spinner diameter="32" />
    }
  `,
})
export class ContractDetailPage {
  private readonly api = inject(Api);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly dialog = inject(MatDialog);
  private readonly toast = inject(Toast);

  readonly id = input.required<string>();
  readonly tab = input<string>();

  protected readonly revision = signal(0);
  protected readonly busy = signal(false);
  protected readonly contract = resource({
    params: () => this.id(),
    loader: ({ params }) => this.api.contract(params),
  });
  protected readonly tabIndex = linkedSignal(() => Math.max(0, TABS.indexOf((this.tab() ?? 'overview') as (typeof TABS)[number])));

  protected readonly isOwnerOrAdmin = computed(() => {
    const u = this.auth.user();
    return u?.role === 'ADMIN' || this.contract.value()?.owner.id === u?.id;
  });

  /** Which workflow buttons to show; the server enforces the same rules. */
  protected readonly actions = computed(() => {
    const c = this.contract.value();
    if (!c || !this.isOwnerOrAdmin()) return [];
    const list: { id: string; label: string; icon: string; primary?: boolean }[] = [];
    if (['DRAFT', 'REJECTED'].includes(c.status) && this.auth.can('contract.update')) {
      list.push({ id: 'edit', label: c.status === 'REJECTED' ? 'Revise' : 'Edit', icon: 'edit' });
    }
    if (c.status === 'DRAFT' && this.auth.can('contract.submit')) list.push({ id: 'submit', label: 'Submit for approval', icon: 'send', primary: true });
    if (['SUBMITTED', 'UNDER_REVIEW'].includes(c.status)) list.push({ id: 'withdraw', label: 'Withdraw', icon: 'undo' });
    if (c.status === 'APPROVED') {
      list.push({ id: 'reopen', label: 'Reopen', icon: 'lock_open' });
      list.push({ id: 'signatures', label: 'Signatures', icon: 'draw', primary: true });
    }
    return list;
  });

  protected readonly money = money;
  protected readonly date = date;
  protected readonly dateTime = dateTime;
  protected readonly humanize = humanize;
  protected readonly fullName = fullName;
  protected readonly fileSize = fileSize;

  /** Reloads in place (keeping the page on screen) and tells the panels to refresh too. */
  protected refresh() {
    this.contract.reload();
    this.revision.update((r) => r + 1);
  }

  protected selectTab(index: number) {
    this.tabIndex.set(index);
    void this.router.navigate([], { queryParams: { tab: TABS[index] }, replaceUrl: true });
  }

  protected run(action: string) {
    const c = this.contract.value()!;
    switch (action) {
      case 'edit':
        void this.router.navigate(['/contracts', c.id, 'edit']);
        return;
      case 'signatures':
        this.selectTab(TABS.indexOf('signatures'));
        return;
      case 'submit':
        return this.prompt(
          { title: 'Submit for approval', message: 'The current version is sent to the approvers. It can’t be edited while in review.', label: 'Note for the approvers (optional)', confirm: 'Submit', minLength: 0 },
          (text) => this.api.submit(c.id, text || undefined),
          'Submitted for approval',
          'approvals',
        );
      case 'withdraw':
        return this.prompt(
          { title: 'Withdraw from review', message: 'Open approval steps are cancelled and the contract returns to draft.', label: 'Reason (optional)', confirm: 'Withdraw', minLength: 0 },
          (text) => this.api.withdraw(c.id, text || undefined),
          'Withdrawn',
        );
      case 'reopen':
        return this.prompt(
          { title: 'Reopen as draft', message: 'The approval stays on record for this version; the edited version will need approval again.', label: 'Why reopen?', confirm: 'Reopen', minLength: 3, danger: true },
          (text) => this.api.reopen(c.id, text),
          'Reopened as draft',
        );
    }
  }

  private prompt(data: PromptData, action: (text: string) => Promise<unknown>, done: string, thenTab?: string) {
    this.dialog
      .open(PromptDialog, { data, width: '480px' })
      .afterClosed()
      .subscribe(async (text?: string) => {
        if (text === undefined) return;
        this.busy.set(true);
        try {
          await action(text);
          this.toast.success(done);
          this.refresh();
          if (thenTab) this.selectTab(TABS.indexOf(thenTab as (typeof TABS)[number]));
        } catch (err) {
          this.toast.error(err);
        } finally {
          this.busy.set(false);
        }
      });
  }

  protected downloadDocument(c: ContractDetail, name: string) {
    void this.api.download(`/api/contracts/${c.id}/versions/${c.currentVersionNumber}/document`, name).catch((e) => this.toast.error(e));
  }

  protected downloadAttachment(c: ContractDetail, attachmentId: string, name: string) {
    void this.api.download(`/api/contracts/${c.id}/attachments/${attachmentId}/download`, name).catch((e) => this.toast.error(e));
  }

  protected async attach(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    const form = new FormData();
    form.append('file', file);
    try {
      await this.api.addAttachment(this.id(), form);
      this.toast.success('Attachment added');
      this.refresh();
    } catch (err) {
      this.toast.error(err);
    } finally {
      input.value = '';
    }
  }

  protected async removeAttachment(c: ContractDetail, attachmentId: string) {
    try {
      await this.api.removeAttachment(c.id, attachmentId);
      this.refresh();
    } catch (err) {
      this.toast.error(err);
    }
  }
}
