import { Component, computed, input } from '@angular/core';
import { humanize } from './format';

/** Status colors for contracts, approval steps, requests and signers, in one place. */
const TONES: Record<string, string> = {
  DRAFT: 'bg-slate-100 text-slate-700 ring-slate-200',
  SUBMITTED: 'bg-sky-50 text-sky-700 ring-sky-200',
  UNDER_REVIEW: 'bg-amber-50 text-amber-800 ring-amber-200',
  IN_PROGRESS: 'bg-amber-50 text-amber-800 ring-amber-200',
  PENDING: 'bg-amber-50 text-amber-800 ring-amber-200',
  WAITING: 'bg-slate-50 text-slate-500 ring-slate-200',
  APPROVED: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  SIGNED: 'bg-teal-50 text-teal-700 ring-teal-200',
  ACTIVE: 'bg-green-100 text-green-800 ring-green-300',
  REJECTED: 'bg-rose-50 text-rose-700 ring-rose-200',
  DECLINED: 'bg-rose-50 text-rose-700 ring-rose-200',
  WITHDRAWN: 'bg-slate-100 text-slate-600 ring-slate-200',
  CANCELLED: 'bg-slate-50 text-slate-400 ring-slate-200',
  SKIPPED: 'bg-slate-50 text-slate-400 ring-slate-200',
  EXPIRED: 'bg-orange-50 text-orange-700 ring-orange-200',
  RENEWED: 'bg-indigo-50 text-indigo-700 ring-indigo-200',
  TERMINATED: 'bg-zinc-200 text-zinc-700 ring-zinc-300',
};

@Component({
  selector: 'cms-status',
  template: `<span class="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset whitespace-nowrap" [class]="tone()">{{ label() }}</span>`,
})
export class StatusBadge {
  readonly status = input.required<string>();
  protected readonly tone = computed(() => TONES[this.status()] ?? TONES['DRAFT']);
  protected readonly label = computed(() => humanize(this.status()));
}
