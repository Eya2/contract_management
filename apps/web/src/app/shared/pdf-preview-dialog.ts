import { Component, inject } from '@angular/core';
import { TPipe } from '../core/i18n';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { PdfViewer } from './pdf-viewer';

export interface PdfPreviewData {
  src: string;
  title: string;
  fileName: string;
}

/** Full-screen-ish preview of a contract PDF. */
@Component({
  imports: [TPipe, MatDialogModule, MatButtonModule, MatIconModule, PdfViewer],
  template: `
    <div class="flex h-[88vh] flex-col gap-3 p-3">
      <div class="flex items-center justify-between px-1">
        <p class="text-xs font-semibold tracking-wider text-muted uppercase">{{ 'Preview' | t }}</p>
        <button mat-icon-button mat-dialog-close [attr.aria-label]="'Close preview' | t"><mat-icon>close</mat-icon></button>
      </div>
      <cms-pdf-viewer class="min-h-0 flex-1" [src]="data.src" [title]="data.title" [fileName]="data.fileName" />
    </div>
  `,
})
export class PdfPreviewDialog {
  protected readonly data = inject<PdfPreviewData>(MAT_DIALOG_DATA);
}

/** Opens the preview of one contract version. */
export function previewContract(dialog: MatDialog, c: { id: string; referenceNumber: string; title: string }, versionNumber: number) {
  dialog.open(PdfPreviewDialog, {
    data: { src: `/api/contracts/${c.id}/versions/${versionNumber}/pdf`, title: `${c.referenceNumber} · ${c.title} · v${versionNumber}`, fileName: `${c.referenceNumber}-v${versionNumber}.pdf` },
    width: 'min(1100px, 96vw)',
    maxWidth: '96vw',
    panelClass: 'pdf-dialog',
    autoFocus: false,
  });
}
