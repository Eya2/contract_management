import { Component, inject, OnInit, signal } from '@angular/core';
import { TPipe } from '../../core/i18n';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { RouterLink } from '@angular/router';
import { Api } from '../../core/api.service';
import type { AuditEntry } from '../../core/models';
import { Avatar } from '../../shared/avatar';
import { EmptyState } from '../../shared/empty-state';
import { dateTime, fullName, humanize } from '../../shared/format';
import { PageHeader } from '../../shared/page-header';
import { Skeleton } from '../../shared/skeleton';

const GROUPS: { label: string; actions: string[] }[] = [
  { label: 'Sign-in & accounts', actions: ['AUTH_LOGIN', 'AUTH_LOGIN_FAILED', 'AUTH_LOGOUT', 'AUTH_TOKEN_REUSE_DETECTED', 'AUTH_PASSWORD_RESET_REQUESTED', 'AUTH_PASSWORD_RESET', 'AUTH_PASSWORD_CHANGED', 'USER_CREATED', 'USER_UPDATED'] },
  { label: 'Contracts', actions: ['CONTRACT_CREATED', 'CONTRACT_VIEWED', 'CONTRACT_UPDATED', 'CONTRACT_SUBMITTED', 'CONTRACT_WITHDRAWN', 'CONTRACT_REOPENED', 'CONTRACT_APPROVED', 'CONTRACT_REJECTED', 'CONTRACT_SIGNED', 'CONTRACT_ACTIVATED', 'CONTRACT_EXPIRED', 'CONTRACT_RENEWED', 'CONTRACT_TERMINATED'] },
  { label: 'Approvals', actions: ['APPROVAL_STEP_APPROVED', 'APPROVAL_STEP_REJECTED', 'APPROVAL_ESCALATED', 'WORKFLOW_TEMPLATE_UPDATED'] },
  { label: 'Documents', actions: ['DOCUMENT_UPLOADED', 'DOCUMENT_DOWNLOADED'] },
];

/** Security events are highlighted; they are what an auditor looks for first. */
const ALERT = new Set(['AUTH_LOGIN_FAILED', 'AUTH_TOKEN_REUSE_DETECTED']);

/** The append-only audit log: who did what, when, from where. */
@Component({
  imports: [TPipe, RouterLink, MatButtonModule, MatIconModule, MatSelectModule, PageHeader, Avatar, Skeleton, EmptyState],
  template: `
    <cms-page-header [eyebrow]="'Administration' | t" [title]="'Audit log' | t" [subtitle]="'Append-only: entries can’t be edited or deleted, not even by an admin.' | t">
      <mat-select class="!w-64" [value]="action()" (selectionChange)="action.set($event.value); load()" [placeholder]="'All events' | t" [attr.aria-label]="'Filter by event' | t">
        <mat-option [value]="undefined">{{ 'All events' | t }}</mat-option>
        @for (g of groups; track g.label) {
          <mat-optgroup [label]="g.label | t">
            @for (a of g.actions; track a) {
              <mat-option [value]="a">{{ humanize(a) }}</mat-option>
            }
          </mat-optgroup>
        }
      </mat-select>
    </cms-page-header>

    <div class="card overflow-hidden">
      @if (loading() && !items().length) {
        <cms-skeleton [rows]="8" />
      }
      <ul class="divide-y divide-line-soft">
        @for (e of items(); track e.id; let i = $index) {
          <li class="stagger" [style.--i]="i % 20">
            <button class="flex w-full items-start gap-4 px-5 py-3 text-left transition-colors hover:bg-subtle/60" (click)="toggle(e.id)" [attr.aria-expanded]="open() === e.id">
              <cms-avatar [name]="fullName(e.user)" [size]="30" />
              <div class="min-w-0 flex-1">
                <p class="text-sm">
                  <span class="font-medium" [class]="alert.has(e.action) ? 'text-rose-600 dark:text-rose-400' : 'text-ink'">{{ humanize(e.action) }}</span>
                  <span class="text-muted">&nbsp;{{ 'by {name}' | t: { name: fullName(e.user) } }}</span>
                </p>
                <p class="text-xs text-muted">
                  {{ dateTime(e.createdAt) }}{{ e.ipAddress ? ' · ' + e.ipAddress : '' }}
                  @if (e.contract) {
                    · <a class="text-accent hover:underline" [routerLink]="['/contracts', e.contractId]" (click)="$event.stopPropagation()">{{ e.contract.referenceNumber }}</a>
                  }
                </p>
              </div>
              <mat-icon class="text-faint transition-transform" [class.rotate-180]="open() === e.id">expand_more</mat-icon>
            </button>
            @if (open() === e.id) {
              <pre class="mx-5 mb-3 animate-rise overflow-x-auto rounded-xl bg-subtle p-3 font-mono text-[11px] leading-relaxed text-body">{{ detail(e) }}</pre>
            }
          </li>
        } @empty {
          @if (!loading()) {
            <cms-empty icon="policy" [title]="'No events' | t" />
          }
        }
      </ul>
      @if (cursor()) {
        <div class="border-t border-line-soft p-3 text-center"><button mat-button [disabled]="loading()" (click)="load(true)">{{ 'Load older' | t }}</button></div>
      }
    </div>
  `,
})
export class AuditPage implements OnInit {
  private readonly api = inject(Api);
  protected readonly items = signal<AuditEntry[]>([]);
  protected readonly cursor = signal<string | null>(null);
  protected readonly loading = signal(false);
  protected readonly action = signal<string | undefined>(undefined);
  protected readonly open = signal<string | null>(null);
  protected readonly groups = GROUPS;
  protected readonly alert = ALERT;
  protected readonly humanize = humanize;
  protected readonly dateTime = dateTime;
  protected readonly fullName = fullName;

  ngOnInit() {
    void this.load();
  }

  protected async load(more = false) {
    this.loading.set(true);
    try {
      const res = await this.api.audit({ action: this.action(), before: more ? (this.cursor() ?? undefined) : undefined });
      this.items.update((list) => (more ? [...list, ...res.items] : res.items));
      this.cursor.set(res.nextCursor);
    } finally {
      this.loading.set(false);
    }
  }

  protected toggle(id: string) {
    this.open.update((cur) => (cur === id ? null : id));
  }

  protected detail(e: AuditEntry) {
    return JSON.stringify({ entity: `${e.entityType}${e.entityId ? ' ' + e.entityId : ''}`, ...(e.metadata ?? {}) }, null, 2);
  }
}
