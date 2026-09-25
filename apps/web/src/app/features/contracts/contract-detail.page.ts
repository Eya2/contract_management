import { Component, computed, inject, input, linkedSignal, resource, signal } from '@angular/core';
import { TPipe, t } from '../../core/i18n';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatTabsModule } from '@angular/material/tabs';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Router, RouterLink } from '@angular/router';
import { Api } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { CountsService } from '../../core/counts.service';
import type { ContractDetail } from '../../core/models';
import { Toast } from '../../core/toast.service';
import { Avatar } from '../../shared/avatar';
import { date, dateTime, daysUntil, fileSize, fullName, humanize, money } from '../../shared/format';
import { previewContract } from '../../shared/pdf-preview-dialog';
import { PromptDialog, type PromptData } from '../../shared/prompt-dialog';
import { Skeleton } from '../../shared/skeleton';
import { StatusBadge } from '../../shared/status-badge';
import { ActivityPanel } from './activity-panel';
import { ApprovalsPanel } from './approvals-panel';
import { TYPE_ICON } from './contracts-list.page';
import { SignaturesPanel } from './signatures-panel';
import { VersionsPanel } from './versions-panel';

const TABS = ['overview', 'approvals', 'signatures', 'versions', 'activity'] as const;

/** The lifecycle as the user thinks of it; statuses map onto these milestones. */
const MILESTONES = [
  { label: 'Draft', statuses: ['DRAFT', 'REJECTED'] },
  { label: 'Review', statuses: ['SUBMITTED', 'UNDER_REVIEW'] },
  { label: 'Approved', statuses: ['APPROVED'] },
  { label: 'Signed', statuses: ['SIGNED'] },
  { label: 'In force', statuses: ['ACTIVE'] },
  { label: 'Ended', statuses: ['EXPIRED', 'RENEWED', 'TERMINATED'] },
];

@Component({
  imports: [TPipe, 
    RouterLink,
    MatButtonModule,
    MatIconModule,
    MatMenuModule,
    MatTabsModule,
    MatTooltipModule,
    StatusBadge,
    Avatar,
    Skeleton,
    ApprovalsPanel,
    SignaturesPanel,
    VersionsPanel,
    ActivityPanel,
  ],
  template: `
    <a routerLink="/contracts" class="mb-5 inline-flex items-center gap-1 text-sm font-medium text-muted transition-colors hover:text-ink">
      <mat-icon class="!size-[18px] !text-[18px]">arrow_back</mat-icon>{{ 'All contracts' | t }}
    </a>

    @if (contract.error()) {
      <div class="callout tone-danger"><mat-icon>lock</mat-icon>{{ 'This contract doesn’t exist, or you don’t have access to it.' | t }}</div>
    } @else if (contract.value(); as c) {
      <header class="mb-6 flex animate-rise flex-wrap items-start gap-5">
        <span class="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-accent-soft text-accent-ink">
          <mat-icon class="!size-7 !text-[28px]">{{ typeIcon[c.type] }}</mat-icon>
        </span>
        <div class="min-w-0 flex-1">
          <div class="flex flex-wrap items-center gap-3">
            <h1 class="text-2xl font-semibold sm:text-[28px]">{{ c.title }}</h1>
            <cms-status [status]="c.status" />
          </div>
          <div class="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted">
            <span class="font-mono text-xs">{{ c.referenceNumber }}</span>
            <span>{{ 'Version {n}' | t: { n: c.currentVersionNumber } }}</span>
            <span class="flex items-center gap-1"><mat-icon class="!size-4 !text-[16px]">apartment</mat-icon>{{ c.counterparty.name }}</span>
            <span class="flex items-center gap-1.5"><cms-avatar [name]="fullName(c.owner)" [size]="20" />{{ fullName(c.owner) }} · {{ c.department.name }}</span>
          </div>
        </div>
        <div class="flex flex-wrap gap-2">
          @for (a of actions(); track a.id) {
            @if (a.primary) {
              <button mat-flat-button [disabled]="busy()" (click)="run(a.id)"><mat-icon>{{ a.icon }}</mat-icon>{{ a.label | t }}</button>
            } @else {
              <button mat-stroked-button [disabled]="busy()" (click)="run(a.id)"><mat-icon>{{ a.icon }}</mat-icon>{{ a.label | t }}</button>
            }
          }
        </div>
      </header>

      <!-- Lifecycle -->
      <ol class="card mb-6 flex animate-rise items-center gap-2 overflow-x-auto px-5 py-4 text-sm [animation-delay:60ms]" [attr.aria-label]="'Lifecycle' | t">
        @for (m of milestones; track m.label; let i = $index, last = $last) {
          <li class="flex shrink-0 items-center gap-2" [attr.aria-current]="i === stage() ? 'step' : null">
            <span
              class="flex size-7 items-center justify-center rounded-full text-xs font-semibold transition-all duration-500"
              [class]="i < stage() ? 'bg-emerald-500 text-white' : i === stage() ? 'bg-[var(--accent)] text-white ring-4 ring-[var(--accent-soft)]' : 'bg-subtle text-faint'"
            >
              @if (i < stage()) {
                <mat-icon class="!size-4 !text-[16px]">check</mat-icon>
              } @else {
                {{ i + 1 }}
              }
            </span>
            <span [class]="i === stage() ? 'font-semibold text-ink' : i < stage() ? 'text-body' : 'text-faint'">{{ m.label | t }}</span>
          </li>
          @if (!last) {
            <li aria-hidden="true" class="h-px min-w-6 flex-1 transition-colors duration-500" [class]="i < stage() ? 'bg-emerald-400' : 'bg-line'"></li>
          }
        }
      </ol>

      <!-- Situational banners -->
      <div class="mb-6 space-y-3 empty:hidden">
        @if (c.status === 'REJECTED') {
          <div class="callout tone-danger animate-rise"><mat-icon>info</mat-icon><span>{{ 'This contract was rejected. The reason is in the Approvals tab; choose Revise to start a new version.' | t }}</span></div>
        }
        @if (endsIn() !== null && c.status === 'ACTIVE' && endsIn()! <= 30) {
          <div class="callout animate-rise" [class]="endsIn()! <= 7 ? 'tone-danger' : 'tone-warning'">
            <mat-icon>event_upcoming</mat-icon>
            <span class="flex-1">
              <b>{{ endsIn() === 0 ? ('Ends today' | t) : endsIn() === 1 ? ('Ends tomorrow' | t) : ('Ends in {n} days' | t: { n: endsIn() }) }}</b> ({{ date(c.endDate) }}).
              @if (c.renewedBy) {
                {{ 'Its renewal {ref} is {status}.' | t: { ref: c.renewedBy.referenceNumber, status: humanize(c.renewedBy.status).toLowerCase() } }}
              } @else if (c.autoRenew) {
                It renews automatically for another term on the same terms.
              } @else {
                It does not renew automatically.
              }
            </span>
          </div>
        }
        @if (c.renewalOf; as prev) {
          <a [routerLink]="['/contracts', prev.id]" class="callout tone-info animate-rise transition-opacity hover:opacity-90">
            <mat-icon>history</mat-icon><span class="flex-1">{{ 'Renewal of' | t }} <b>{{ prev.referenceNumber }}</b> · {{ prev.title }}</span><cms-status [status]="prev.status" />
          </a>
        }
        @if (c.renewedBy; as next) {
          <a [routerLink]="['/contracts', next.id]" class="callout tone-info animate-rise transition-opacity hover:opacity-90">
            <mat-icon>autorenew</mat-icon><span class="flex-1">{{ 'Renewed by' | t }} <b>{{ next.referenceNumber }}</b> · {{ next.title }}</span><cms-status [status]="next.status" />
          </a>
        }
      </div>

      <mat-tab-group [selectedIndex]="tabIndex()" (selectedIndexChange)="selectTab($event)" animationDuration="200ms" mat-stretch-tabs="false" mat-align-tabs="start">
        <mat-tab [label]="'Overview' | t">
          <div class="grid gap-6 pt-6 lg:grid-cols-3">
            <section class="space-y-6 lg:col-span-2">
              <div class="card grid grid-cols-2 gap-5 p-5 text-sm sm:grid-cols-3">
                @for (f of facts(); track f.label) {
                  <div>
                    <p class="text-xs text-muted">{{ f.label | t }}</p>
                    <p class="mt-0.5 flex items-center gap-1 font-medium text-ink">
                      @if (f.icon) {
                        <mat-icon class="!size-4 !text-[16px] text-muted">{{ f.icon }}</mat-icon>
                      }
                      {{ f.value }}
                    </p>
                  </div>
                }
              </div>
              <div class="card p-6">
                <h2 class="mb-1 font-semibold">{{ 'Clauses' | t }}</h2>
                @for (cl of c.currentVersion.clauses; track cl.key; let i = $index) {
                  <article class="stagger border-t border-line-soft py-4 first-of-type:border-0" [style.--i]="i">
                    <h3 class="font-medium"><span class="mr-1 text-faint tabular-nums">{{ i + 1 }}.</span> {{ cl.heading }}</h3>
                    <p class="mt-1.5 text-[15px] leading-relaxed whitespace-pre-line text-body">{{ cl.body }}</p>
                  </article>
                } @empty {
                  <p class="text-sm text-muted">{{ 'This contract is defined by its uploaded document.' | t }}</p>
                }
              </div>
            </section>
            <aside class="space-y-6">
              <div class="card p-5">
                <h2 class="mb-3 font-semibold">{{ 'Document' | t }}</h2>
                <button class="group mb-3 flex w-full items-center gap-3 rounded-xl bg-accent-soft p-3 text-left text-sm transition-colors hover:opacity-90" (click)="run('preview')">
                  <span class="flex size-10 items-center justify-center rounded-lg bg-card text-accent-ink shadow-sm"><mat-icon>description</mat-icon></span>
                  <span class="min-w-0 flex-1">
                    <span class="block font-medium text-ink">{{ 'Contract PDF' | t }}</span>
                    <span class="text-xs text-muted">{{ ['SIGNED', 'ACTIVE', 'EXPIRED', 'RENEWED', 'TERMINATED'].includes(c.status) ? ('With signatures and certificate' | t) : ('Generated from version {n}' | t: { n: c.currentVersionNumber }) }}</span>
                  </span>
                  <mat-icon class="text-accent-ink transition-transform group-hover:translate-x-0.5">visibility</mat-icon>
                </button>
                @if (c.currentVersion.file; as f) {
                  <p class="mb-2 text-xs text-muted">{{ 'Uploaded document' | t }}</p>
                  <button class="group flex w-full items-center gap-3 rounded-xl bg-subtle p-3 text-left text-sm transition-colors hover:bg-subtle-strong" (click)="downloadDocument(c, f.originalName)">
                    <span class="flex size-10 items-center justify-center rounded-lg bg-rose-100 text-rose-600 dark:bg-rose-400/15 dark:text-rose-300"><mat-icon>picture_as_pdf</mat-icon></span>
                    <span class="min-w-0 flex-1"><span class="block truncate font-medium text-ink">{{ f.originalName }}</span><span class="text-xs text-muted">{{ fileSize(f.sizeBytes) }}</span></span>
                    <mat-icon class="text-faint transition-transform group-hover:translate-y-0.5">download</mat-icon>
                  </button>
                  <p class="mt-2 truncate font-mono text-[10px] text-faint" [matTooltip]="'SHA-256 ' + f.sha256">SHA-256 {{ f.sha256 }}</p>
                }
              </div>
              <div class="card p-5">
                <div class="mb-3 flex items-center justify-between">
                  <h2 class="font-semibold">{{ 'Attachments' | t }}</h2>
                  @if (isOwnerOrAdmin() && !['RENEWED', 'TERMINATED'].includes(c.status)) {
                    <label class="flex cursor-pointer items-center gap-1 text-sm font-medium text-accent hover:underline">
                      <mat-icon class="!size-4 !text-[16px]">add</mat-icon>{{ 'Add' | t }}<input type="file" class="sr-only" (change)="attach($event)" />
                    </label>
                  }
                </div>
                <ul class="space-y-1">
                  @for (a of c.attachments; track a.id) {
                    <li class="group flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-subtle">
                      <mat-icon class="!size-5 !text-[20px] text-faint">attach_file</mat-icon>
                      <button class="min-w-0 flex-1 truncate text-left text-body hover:text-accent" (click)="downloadAttachment(c, a.id, a.file.originalName)">{{ a.description || a.file.originalName }}</button>
                      @if (isOwnerOrAdmin() && ['DRAFT', 'REJECTED'].includes(c.status) && a.kind === 'SUPPORTING') {
                        <button mat-icon-button class="opacity-0 group-hover:opacity-100" (click)="removeAttachment(c, a.id)" [attr.aria-label]="'Remove attachment' | t"><mat-icon>close</mat-icon></button>
                      }
                    </li>
                  } @empty {
                    <li class="text-sm text-muted">{{ 'None yet.' | t }}</li>
                  }
                </ul>
              </div>
            </aside>
          </div>
        </mat-tab>
        <mat-tab [label]="'Approvals' | t">
          <div class="pt-6"><cms-approvals-panel [contractId]="c.id" [status]="c.status" [reference]="c.referenceNumber" [title]="c.title" (changed)="refresh()" /></div>
        </mat-tab>
        <mat-tab [label]="'Signatures' | t">
          <div class="pt-6"><cms-signatures-panel [contract]="c" (changed)="refresh()" /></div>
        </mat-tab>
        <mat-tab [label]="'Versions' | t">
          <div class="pt-6"><cms-versions-panel [contractId]="c.id" [currentVersion]="c.currentVersionNumber" [reference]="c.referenceNumber" [title]="c.title" /></div>
        </mat-tab>
        <mat-tab [label]="'Activity' | t">
          <div class="pt-6"><cms-activity-panel [contractId]="c.id" [revision]="revision()" /></div>
        </mat-tab>
      </mat-tab-group>
    } @else {
      <div class="card"><cms-skeleton [rows]="5" /></div>
    }
  `,
})
export class ContractDetailPage {
  private readonly api = inject(Api);
  private readonly auth = inject(AuthService);
  private readonly counts = inject(CountsService);
  private readonly router = inject(Router);
  private readonly dialog = inject(MatDialog);
  private readonly toast = inject(Toast);

  readonly id = input.required<string>();
  readonly tab = input<string>();

  protected readonly revision = signal(0);
  protected readonly busy = signal(false);
  protected readonly contract = resource({ params: () => this.id(), loader: ({ params }) => this.api.contract(params) });
  protected readonly tabIndex = linkedSignal(() => Math.max(0, TABS.indexOf((this.tab() ?? 'overview') as (typeof TABS)[number])));
  protected readonly milestones = MILESTONES;
  protected readonly typeIcon = TYPE_ICON;

  protected readonly stage = computed(() => {
    const s = this.contract.value()?.status ?? 'DRAFT';
    return MILESTONES.findIndex((m) => m.statuses.includes(s));
  });
  protected readonly endsIn = computed(() => daysUntil(this.contract.value()?.endDate));

  protected readonly isOwnerOrAdmin = computed(() => {
    const u = this.auth.user();
    return u?.role === 'ADMIN' || this.contract.value()?.owner.id === u?.id;
  });

  protected readonly facts = computed(() => {
    const c = this.contract.value();
    if (!c) return [];
    return [
      { label: 'Type', value: humanize(c.type), icon: TYPE_ICON[c.type] },
      { label: 'Value', value: money(c.value, c.currency) },
      { label: 'Renewal', value: t(c.autoRenew ? 'Automatic' : 'Manual'), icon: c.autoRenew ? 'autorenew' : 'front_hand' },
      { label: 'Starts', value: date(c.startDate) },
      { label: 'Ends', value: date(c.endDate) },
      { label: 'Last change', value: dateTime(c.updatedAt) },
    ];
  });

  /** Which workflow buttons to show; the server enforces the same rules. */
  protected readonly actions = computed(() => {
    const c = this.contract.value();
    if (!c) return [];
    const list: { id: string; label: string; icon: string; primary?: boolean }[] = [{ id: 'preview', label: 'Preview PDF', icon: 'visibility' }];
    // Terminating is for admins and managers of the contract's department, not only the owner.
    const u = this.auth.user();
    const canTerminate = this.auth.can('contract.terminate') && (u?.role === 'ADMIN' || u?.department.id === c.department.id);
    if (['ACTIVE', 'SIGNED'].includes(c.status) && canTerminate) list.push({ id: 'terminate', label: 'Terminate', icon: 'cancel' });
    if (!this.isOwnerOrAdmin()) return list;
    if (['DRAFT', 'REJECTED'].includes(c.status) && this.auth.can('contract.update')) {
      list.push({ id: 'edit', label: c.status === 'REJECTED' ? 'Revise' : 'Edit', icon: 'edit' });
    }
    if (c.status === 'DRAFT' && this.auth.can('contract.submit')) list.push({ id: 'submit', label: 'Submit for approval', icon: 'send', primary: true });
    if (['SUBMITTED', 'UNDER_REVIEW'].includes(c.status)) list.push({ id: 'withdraw', label: 'Withdraw', icon: 'undo' });
    if (c.status === 'APPROVED') {
      list.push({ id: 'reopen', label: 'Reopen', icon: 'lock_open' });
      list.push({ id: 'signatures', label: 'Signatures', icon: 'draw', primary: true });
    }
    if (['ACTIVE', 'EXPIRED', 'SIGNED'].includes(c.status) && !c.renewedBy && c.endDate && this.auth.can('contract.create')) {
      list.push({ id: 'renew', label: 'Renew', icon: 'autorenew', primary: c.status !== 'SIGNED' });
    }
    return list;
  });

  protected readonly date = date;
  protected readonly humanize = humanize;
  protected readonly fullName = fullName;
  protected readonly fileSize = fileSize;

  /** Reloads in place (keeping the page on screen) and tells the panels to refresh too. */
  protected refresh() {
    this.contract.reload();
    this.revision.update((r) => r + 1);
    void this.counts.refresh();
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
      case 'preview':
        previewContract(this.dialog, c, c.currentVersionNumber);
        return;
      case 'signatures':
        this.selectTab(TABS.indexOf('signatures'));
        return;
      case 'terminate':
        return this.prompt(
          {
            title: t('Terminate this contract'),
            message: t('It ends now, before its term. This can’t be undone; the reason is kept on the contract and in its history.'),
            label: t('Reason for termination'),
            confirm: t('Terminate'),
            minLength: 3,
            danger: true,
          },
          (text) => this.api.terminate(c.id, text),
          t('Contract terminated'),
        );
      case 'renew':
        return this.prompt(
          {
            title: t('Renew this contract'),
            message: t('A draft for the next term is created with the same clauses and document, dated to follow this one. It goes through approval and signature like any new contract.'),
            label: t('Note (optional, not saved)'),
            confirm: t('Create renewal draft'),
            minLength: 0,
          },
          async () => {
            const next = await this.api.renew(c.id);
            await this.router.navigate(['/contracts', next.id]);
          },
          t('Renewal draft created'),
        );
      case 'submit':
        return this.prompt(
          { title: t('Submit for approval'), message: t('The current version goes to the approvers and can’t be edited while in review.'), label: t('Note for the approvers (optional)'), confirm: t('Submit'), minLength: 0 },
          (text) => this.api.submit(c.id, text || undefined),
          t('Submitted for approval'),
          'approvals',
        );
      case 'withdraw':
        return this.prompt(
          { title: t('Withdraw from review'), message: t('Open approval steps are cancelled and the contract returns to draft.'), label: t('Reason (optional)'), confirm: t('Withdraw'), minLength: 0 },
          (text) => this.api.withdraw(c.id, text || undefined),
          t('Withdrawn'),
        );
      case 'reopen':
        return this.prompt(
          { title: t('Reopen as draft'), message: t('The approval stays on record for this version; the edited version will need approval again.'), label: t('Why reopen?'), confirm: t('Reopen'), minLength: 3, danger: true },
          (text) => this.api.reopen(c.id, text),
          t('Reopened as draft'),
        );
    }
  }

  private prompt(data: PromptData, action: (text: string) => Promise<unknown>, done: string, thenTab?: string) {
    this.dialog
      .open(PromptDialog, { data, width: '500px' })
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
    const inputEl = e.target as HTMLInputElement;
    const file = inputEl.files?.[0];
    if (!file) return;
    const form = new FormData();
    form.append('file', file);
    try {
      await this.api.addAttachment(this.id(), form);
      this.toast.success(t('Attachment added'));
      this.refresh();
    } catch (err) {
      this.toast.error(err);
    } finally {
      inputEl.value = '';
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
