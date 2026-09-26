import { Component, computed, input } from '@angular/core';

export interface ChartSeries {
  key: string;
  label: string;
  /** Tailwind background class, e.g. 'bg-brand-500'. */
  color: string;
  values: number[];
}

/**
 * A small vertical bar chart (stacked when there are several series), drawn
 * with plain elements so it follows the theme and needs no chart library.
 * Screen readers get the same numbers as a table.
 */
@Component({
  selector: 'cms-bar-chart',
  template: `
    <figure class="m-0">
      <div class="relative flex h-44 items-end gap-1.5 pl-12 sm:gap-2" aria-hidden="true">
        <!-- Grid lines with their values -->
        @for (g of grid(); track g.pct) {
          <div class="pointer-events-none absolute inset-x-0 border-t border-dashed border-line-soft" [style.bottom.%]="g.pct">
            <span class="absolute -top-2 left-0 w-10 text-right text-[10px] text-faint tabular-nums">{{ g.label }}</span>
          </div>
        }
        @for (col of columns(); track col.label; let i = $index) {
          <div class="group relative flex h-full flex-1 flex-col justify-end" [title]="col.title">
            @for (seg of col.segments; track seg.key) {
              <div
                class="w-full origin-bottom animate-[grow_0.6s_var(--ease-spring)_both] transition-opacity first:rounded-t-md group-hover:opacity-80"
                [class]="seg.color"
                [style.height.%]="seg.pct"
                [style.animation-delay.ms]="i * 40"
              ></div>
            }
          </div>
        }
      </div>
      <div class="mt-2 flex gap-1.5 pl-12 sm:gap-2" aria-hidden="true">
        <!-- With many columns, every other label, so they stay readable -->
        @for (col of columns(); track col.label; let i = $index) {
          <span class="flex-1 overflow-visible text-center text-[10px] whitespace-nowrap text-muted">{{ columns().length > 8 && i % 2 ? '' : col.label }}</span>
        }
      </div>
      @if (series().length > 1) {
        <figcaption class="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted" aria-hidden="true">
          @for (s of series(); track s.key) {
            <span class="flex items-center gap-1.5"><span class="size-2 rounded-sm" [class]="s.color"></span>{{ s.label }}</span>
          }
        </figcaption>
      }
      <table class="sr-only">
        <caption>{{ caption() }}</caption>
        <thead>
          <tr>
            <th scope="col">{{ labelHeader() }}</th>
            @for (s of series(); track s.key) {
              <th scope="col">{{ s.label }}</th>
            }
          </tr>
        </thead>
        <tbody>
          @for (label of labels(); track label; let i = $index) {
            <tr>
              <th scope="row">{{ label }}</th>
              @for (s of series(); track s.key) {
                <td>{{ format()(s.values[i] ?? 0) }}</td>
              }
            </tr>
          }
        </tbody>
      </table>
    </figure>
  `,
  styles: `
    @keyframes grow {
      from { transform: scaleY(0); }
    }
  `,
})
export class BarChart {
  readonly labels = input.required<string[]>();
  readonly series = input.required<ChartSeries[]>();
  readonly format = input<(n: number) => string>((n) => n.toLocaleString());
  /** Short format for the axis (e.g. "120k"). */
  readonly axisFormat = input<(n: number) => string>((n) => n.toLocaleString());
  readonly caption = input('');
  readonly labelHeader = input('');

  private readonly max = computed(() => {
    const totals = this.labels().map((_, i) => this.series().reduce((sum, s) => sum + (s.values[i] ?? 0), 0));
    return niceCeil(Math.max(0, ...totals));
  });

  protected readonly grid = computed(() => {
    const max = this.max();
    if (!max) return [{ pct: 0, label: this.axisFormat()(0) }];
    return [0, 0.5, 1].map((f) => ({ pct: f * 100, label: this.axisFormat()(max * f) }));
  });

  protected readonly columns = computed(() => {
    const max = this.max() || 1;
    return this.labels().map((label, i) => {
      // Top of the stack last in the DOM order is drawn first (flex-col justify-end), so reverse.
      const segments = this.series()
        .map((s) => ({ key: s.key, color: s.color, value: s.values[i] ?? 0 }))
        .filter((s) => s.value > 0)
        .reverse()
        .map((s) => ({ ...s, pct: (s.value / max) * 100 }));
      const parts = this.series()
        .filter((s) => (s.values[i] ?? 0) > 0)
        .map((s) => (this.series().length > 1 ? `${s.label}: ` : '') + this.format()(s.values[i]!));
      return { label, segments, title: `${label}\n${parts.join('\n') || this.format()(0)}` };
    });
  });
}

/** Rounds up to 1, 2 or 5 × a power of ten, so the axis reads well. */
export function niceCeil(n: number): number {
  if (n <= 0) return 0;
  const p = 10 ** Math.floor(Math.log10(n));
  const f = n / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
}
