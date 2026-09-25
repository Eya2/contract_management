import { Component, ElementRef, output, signal, viewChild, type AfterViewInit } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';

/**
 * A drawing surface for handwritten signatures. Pointer events cover mouse,
 * pen and touch alike. Emits a PNG data URL after each stroke, or null when
 * cleared.
 */
@Component({
  selector: 'cms-signature-pad',
  imports: [MatButtonModule],
  template: `
    <div class="relative rounded-lg border-2 border-dashed border-slate-300 bg-white">
      <canvas
        #canvas
        class="block h-40 w-full cursor-crosshair touch-none"
        aria-label="Signature drawing area"
        (pointerdown)="start($event)"
        (pointermove)="move($event)"
        (pointerup)="end()"
        (pointerleave)="end()"
      ></canvas>
      @if (empty()) {
        <span class="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-slate-400">Sign here</span>
      }
      <div class="pointer-events-none absolute right-6 bottom-8 left-6 border-b border-slate-300"></div>
    </div>
    <button mat-button type="button" class="mt-1" (click)="clear()" [disabled]="empty()">Clear</button>
  `,
})
export class SignaturePad implements AfterViewInit {
  readonly changed = output<string | null>();
  protected readonly empty = signal(true);
  private readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private ctx!: CanvasRenderingContext2D;
  private drawing = false;

  ngAfterViewInit() {
    const el = this.canvas().nativeElement;
    // Match the backing store to the displayed size (and pixel ratio) for crisp strokes.
    const ratio = window.devicePixelRatio || 1;
    el.width = el.offsetWidth * ratio;
    el.height = el.offsetHeight * ratio;
    this.ctx = el.getContext('2d')!;
    this.ctx.scale(ratio, ratio);
    this.ctx.lineWidth = 2.2;
    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';
    this.ctx.strokeStyle = '#0f172a';
  }

  protected start(e: PointerEvent) {
    this.drawing = true;
    this.canvas().nativeElement.setPointerCapture(e.pointerId);
    this.ctx.beginPath();
    this.ctx.moveTo(e.offsetX, e.offsetY);
  }

  protected move(e: PointerEvent) {
    if (!this.drawing) return;
    this.ctx.lineTo(e.offsetX, e.offsetY);
    this.ctx.stroke();
    this.empty.set(false);
  }

  protected end() {
    if (!this.drawing) return;
    this.drawing = false;
    if (!this.empty()) this.changed.emit(this.canvas().nativeElement.toDataURL('image/png'));
  }

  clear() {
    const el = this.canvas().nativeElement;
    this.ctx.clearRect(0, 0, el.width, el.height);
    this.empty.set(true);
    this.changed.emit(null);
  }
}
