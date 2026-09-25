import { Component, computed, input } from '@angular/core';
import { humanize } from './format';

type Tone = 'neutral' | 'info' | 'progress' | 'success' | 'strong' | 'danger' | 'warn' | 'muted' | 'violet';

const TONE_CLASSES: Record<Tone, string> = {
  neutral: 'bg-slate-100 text-slate-700 ring-slate-500/15 dark:bg-slate-400/10 dark:text-slate-300 dark:ring-slate-400/20',
  muted: 'bg-slate-50 text-slate-500 ring-slate-500/10 dark:bg-slate-400/5 dark:text-slate-400 dark:ring-slate-400/15',
  info: 'bg-sky-50 text-sky-700 ring-sky-600/20 dark:bg-sky-400/10 dark:text-sky-300 dark:ring-sky-400/25',
  progress: 'bg-amber-50 text-amber-800 ring-amber-600/20 dark:bg-amber-400/10 dark:text-amber-300 dark:ring-amber-400/25',
  success: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-400/10 dark:text-emerald-300 dark:ring-emerald-400/25',
  strong: 'bg-emerald-600 text-white ring-emerald-600 dark:bg-emerald-500/90 dark:ring-emerald-400/40',
  danger: 'bg-rose-50 text-rose-700 ring-rose-600/20 dark:bg-rose-400/10 dark:text-rose-300 dark:ring-rose-400/25',
  warn: 'bg-orange-50 text-orange-700 ring-orange-600/20 dark:bg-orange-400/10 dark:text-orange-300 dark:ring-orange-400/25',
  violet: 'bg-violet-50 text-violet-700 ring-violet-600/20 dark:bg-violet-400/10 dark:text-violet-300 dark:ring-violet-400/25',
};

/** Contract, request, step and signer statuses share one color language. */
const STATUS_TONE: Record<string, Tone> = {
  DRAFT: 'neutral',
  SUBMITTED: 'info',
  UNDER_REVIEW: 'progress',
  IN_PROGRESS: 'progress',
  PENDING: 'progress',
  WAITING: 'muted',
  APPROVED: 'success',
  SIGNED: 'success',
  ACTIVE: 'strong',
  REJECTED: 'danger',
  DECLINED: 'danger',
  WITHDRAWN: 'neutral',
  CANCELLED: 'muted',
  SKIPPED: 'muted',
  EXPIRED: 'warn',
  RENEWED: 'violet',
  TERMINATED: 'neutral',
};

@Component({
  selector: 'cms-status',
  template: `
    <span class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset" [class]="classes()">
      <span class="size-1.5 rounded-full bg-current opacity-70" [class.animate-pulse]="live()"></span>{{ label() }}
    </span>
  `,
})
export class StatusBadge {
  readonly status = input.required<string>();
  protected readonly classes = computed(() => TONE_CLASSES[STATUS_TONE[this.status()] ?? 'neutral']);
  protected readonly label = computed(() => humanize(this.status()));
  /** Statuses that are waiting on someone get a gentle pulse. */
  protected readonly live = computed(() => ['PENDING', 'UNDER_REVIEW', 'IN_PROGRESS'].includes(this.status()));
}
