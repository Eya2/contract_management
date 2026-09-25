import { Component, computed, inject, input, linkedSignal, resource } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { Api } from '../../core/api.service';
import { dateTime, fullName, humanize } from '../../shared/format';

/** The version history, and a comparison between any two versions. */
@Component({
  selector: 'cms-versions-panel',
  imports: [FormsModule, MatButtonModule, MatIconModule, MatSelectModule],
  template: `
    <div class="grid gap-6 lg:grid-cols-5">
      <section class="rounded-xl bg-white shadow-sm ring-1 ring-slate-200 lg:col-span-2">
        <h3 class="border-b border-slate-100 px-5 py-3 font-semibold">History</h3>
        <ol class="divide-y divide-slate-100">
          @for (v of versions.value(); track v.id) {
            <li class="px-5 py-3">
              <div class="flex items-center gap-2">
                <span class="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-semibold text-slate-600">v{{ v.versionNumber }}</span>
                <span class="flex-1 truncate text-sm font-medium">{{ v.changeSummary || 'No summary' }}</span>
                @if (v.file) {
                  <button mat-icon-button (click)="download(v.versionNumber, v.file.originalName)" [attr.aria-label]="'Download document of version ' + v.versionNumber">
                    <mat-icon>download</mat-icon>
                  </button>
                }
              </div>
              <p class="mt-0.5 text-xs text-slate-500">{{ fullName(v.createdBy) }} · {{ dateTime(v.createdAt) }}</p>
            </li>
          }
        </ol>
      </section>

      <section class="rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200 lg:col-span-3">
        <div class="mb-4 flex flex-wrap items-center gap-2">
          <h3 class="mr-auto font-semibold">Compare</h3>
          <mat-select class="!w-24" [(ngModel)]="from" aria-label="From version">
            @for (v of numbers(); track v) {
              <mat-option [value]="v">v{{ v }}</mat-option>
            }
          </mat-select>
          <mat-icon class="text-slate-400">arrow_forward</mat-icon>
          <mat-select class="!w-24" [(ngModel)]="to" aria-label="To version">
            @for (v of numbers(); track v) {
              <mat-option [value]="v">v{{ v }}</mat-option>
            }
          </mat-select>
        </div>
        @if (numbers().length < 2) {
          <p class="text-sm text-slate-500">Only one version so far.</p>
        } @else if (diff.value(); as d) {
          @if (!d.fields.length && !d.clauses.added.length && !d.clauses.removed.length && !d.clauses.changed.length && !d.documentChanged) {
            <p class="text-sm text-slate-500">No differences.</p>
          }
          @for (f of d.fields; track f.field) {
            <div class="mb-2 grid grid-cols-[8rem_1fr] gap-2 text-sm">
              <span class="text-slate-500">{{ humanize(f.field) }}</span>
              <span><del class="bg-rose-50 text-rose-700">{{ f.from ?? '—' }}</del> → <ins class="bg-emerald-50 text-emerald-700 no-underline">{{ f.to ?? '—' }}</ins></span>
            </div>
          }
          @if (d.documentChanged) {
            <p class="mb-2 text-sm"><mat-icon class="!size-4 align-middle !text-[16px]">description</mat-icon> The document changed.</p>
          }
          @for (c of d.clauses.added; track c.key) {
            <div class="mt-3 rounded-lg border-l-4 border-emerald-400 bg-emerald-50 p-3 text-sm">
              <p class="font-semibold text-emerald-800">+ {{ c.heading }}</p>
              <p class="whitespace-pre-line text-emerald-900">{{ c.body }}</p>
            </div>
          }
          @for (c of d.clauses.removed; track c.key) {
            <div class="mt-3 rounded-lg border-l-4 border-rose-400 bg-rose-50 p-3 text-sm">
              <p class="font-semibold text-rose-800 line-through">− {{ c.heading }}</p>
              <p class="whitespace-pre-line text-rose-900 line-through">{{ c.body }}</p>
            </div>
          }
          @for (c of d.clauses.changed; track c.key) {
            <div class="mt-3 rounded-lg border-l-4 border-amber-400 bg-amber-50 p-3 text-sm">
              <p class="font-semibold text-amber-900">~ {{ c.to.heading }}</p>
              <div class="mt-1 grid gap-2 sm:grid-cols-2">
                <p class="rounded bg-white/70 p-2 whitespace-pre-line text-slate-500"><span class="block text-xs font-semibold">Before</span>{{ c.from.body }}</p>
                <p class="rounded bg-white p-2 whitespace-pre-line text-ink"><span class="block text-xs font-semibold">After</span>{{ c.to.body }}</p>
              </div>
            </div>
          }
          @if (d.clauses.reordered) {
            <p class="mt-3 text-xs text-slate-500">Clauses were also reordered.</p>
          }
        }
      </section>
    </div>
  `,
})
export class VersionsPanel {
  private readonly api = inject(Api);
  readonly contractId = input.required<string>();
  readonly currentVersion = input.required<number>();

  protected readonly versions = resource({
    params: () => ({ id: this.contractId(), v: this.currentVersion() }),
    loader: ({ params }) => this.api.versions(params.id),
  });
  protected readonly numbers = computed(() => (this.versions.value() ?? []).map((v) => v.versionNumber).sort((a, b) => a - b));
  protected readonly to = linkedSignal(() => this.currentVersion());
  protected readonly from = linkedSignal(() => Math.max(1, this.currentVersion() - 1));
  protected readonly diff = resource({
    params: () => (this.numbers().length > 1 ? { id: this.contractId(), from: this.from(), to: this.to() } : undefined),
    loader: ({ params }) => this.api.diff(params.id, params.from, params.to),
  });
  protected readonly fullName = fullName;
  protected readonly dateTime = dateTime;
  protected readonly humanize = humanize;

  protected download(n: number, name: string) {
    void this.api.download(`/api/contracts/${this.contractId()}/versions/${n}/document`, name);
  }
}
