import { Directive, effect, ElementRef, inject, input } from '@angular/core';

/** Animates a number from its previous value to the new one (skipped with reduced motion). */
@Directive({ selector: '[cmsCountUp]' })
export class CountUp {
  readonly cmsCountUp = input.required<number>();
  private readonly el = inject(ElementRef<HTMLElement>);
  private shown = 0;

  constructor() {
    effect((onCleanup) => {
      const target = this.cmsCountUp();
      const from = this.shown;
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (reduce || from === target) {
        this.render(target);
        return;
      }
      const start = performance.now();
      const duration = 700;
      let frame = 0;
      const tick = (now: number) => {
        const t = Math.min(1, (now - start) / duration);
        const eased = 1 - Math.pow(1 - t, 3);
        this.render(Math.round(from + (target - from) * eased));
        if (t < 1) frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
      onCleanup(() => cancelAnimationFrame(frame));
    });
  }

  private render(n: number) {
    this.shown = n;
    this.el.nativeElement.textContent = n.toLocaleString('en-US');
  }
}
