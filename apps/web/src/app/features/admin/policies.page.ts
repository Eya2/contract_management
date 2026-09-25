import { Component, computed, inject, resource } from '@angular/core';
import { TPipe } from '../../core/i18n';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { Api } from '../../core/api.service';
import type { Policy, PolicyStep } from '../../core/models';
import { EmptyState } from '../../shared/empty-state';
import { humanize } from '../../shared/format';
import { PageHeader } from '../../shared/page-header';
import { Skeleton } from '../../shared/skeleton';

/** Approval policies with their steps drawn as a stage pipeline. */
@Component({
  imports: [TPipe, RouterLink, MatButtonModule, MatIconModule, PageHeader, Skeleton, EmptyState],
  template: `
    <cms-page-header [eyebrow]="'Administration' | t" [title]="'Approval policies' | t" [subtitle]="'Who approves what. The most specific active policy applies: type + department, then type, then department, then the default.' | t">
      <a mat-flat-button routerLink="/admin/policies/new"><mat-icon>add</mat-icon>{{ 'New policy' | t }}</a>
    </cms-page-header>

    @if (policies.isLoading() && !policies.value()) {
      <div class="card"><cms-skeleton /></div>
    }
    <div class="grid gap-4">
      @for (p of sorted(); track p.id; let i = $index) {
        <a [routerLink]="['/admin/policies', p.id]" class="card card-interactive stagger block p-5" [style.--i]="i" [class.opacity-60]="!p.isActive">
          <div class="flex flex-wrap items-start gap-3">
            <div class="min-w-0 flex-1">
              <div class="flex flex-wrap items-center gap-2">
                <h2 class="font-semibold">{{ p.name }}</h2>
                @if (!p.isActive) {
                  <span class="rounded-full bg-subtle px-2 py-0.5 text-xs font-medium text-muted">{{ 'Inactive' | t }}</span>
                }
              </div>
              @if (p.description) {
                <p class="mt-1 text-sm text-muted">{{ p.description }}</p>
              }
            </div>
            <div class="flex flex-wrap gap-1.5 text-xs">
              <span class="rounded-full bg-accent-soft px-2.5 py-1 font-medium text-accent-ink">{{ p.contractType ? humanize(p.contractType) : ('Any type' | t) }}</span>
              <span class="rounded-full bg-subtle px-2.5 py-1 font-medium text-body">{{ p.department?.name ?? ('Any department' | t) }}</span>
            </div>
          </div>
          <ol class="mt-4 flex flex-wrap items-stretch gap-2">
            @for (stage of stages(p.steps); track stage.stage; let last = $last) {
              <li class="flex items-center gap-2">
                <div class="rounded-xl bg-subtle p-2">
                  <p class="mb-1 px-1 text-[10px] font-semibold tracking-wider text-faint uppercase">{{ 'Stage {n}' | t: { n: stage.stage } }}</p>
                  <div class="flex flex-wrap gap-1.5">
                    @for (s of stage.steps; track s.name) {
                      <span class="rounded-lg bg-card px-2.5 py-1.5 text-xs shadow-sm ring-1 ring-line">
                        <span class="font-medium text-ink">{{ s.name }}</span>
                        <span class="block text-muted">{{ humanize(s.approverRole) }}{{ s.approverScope === 'CONTRACT_DEPARTMENT' ? ' ' + ('(own dept.)' | t) : '' }}{{ s.escalateAfterHours ? ' · ' + s.escalateAfterHours + 'h' : '' }}</span>
                        @if (s.conditionText) {
                          <span class="mt-0.5 block text-seal-600 dark:text-seal-400">{{ 'if {rule}' | t: { rule: s.conditionText } }}</span>
                        }
                      </span>
                    }
                  </div>
                </div>
                @if (!last) {
                  <mat-icon class="text-faint">arrow_forward</mat-icon>
                }
              </li>
            }
          </ol>
        </a>
      } @empty {
        @if (!policies.isLoading()) {
          <div class="card"><cms-empty icon="account_tree" [title]="'No approval policies' | t" [text]="'Contracts can’t be submitted until a policy applies to them.' | t" /></div>
        }
      }
    </div>
  `,
})
export class PoliciesPage {
  private readonly api = inject(Api);
  protected readonly policies = resource({ loader: () => this.api.policies() });
  protected readonly humanize = humanize;
  protected readonly sorted = computed(() => [...(this.policies.value() ?? [])].sort((a, b) => Number(b.isActive) - Number(a.isActive) || a.name.localeCompare(b.name)));

  protected stages(steps: PolicyStep[]) {
    const map = new Map<number, PolicyStep[]>();
    for (const s of steps) map.set(s.stage, [...(map.get(s.stage) ?? []), s]);
    return [...map].sort(([a], [b]) => a - b).map(([stage, list]) => ({ stage, steps: list }));
  }
}
export type { Policy };
