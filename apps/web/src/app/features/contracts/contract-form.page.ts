import { Component, inject, input, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { Router, RouterLink } from '@angular/router';
import { ContractType } from '@cms/shared';
import { Api } from '../../core/api.service';
import { errorMessage } from '../../core/errors';
import type { Counterparty, StoredFile } from '../../core/models';
import { Toast } from '../../core/toast.service';
import { fileSize, humanize } from '../../shared/format';

interface ClauseDraft {
  uid: number;
  key: string;
  heading: string;
  body: string;
}

let uid = 0;

/** Clause keys are stable identifiers across versions; new ones are derived from the heading. */
function slug(text: string, taken: Set<string>): string {
  const base = text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'clause';
  let key = base;
  for (let i = 2; taken.has(key); i++) key = `${base}-${i}`;
  return key;
}

/** Create a contract, or edit one (which saves a new version). */
@Component({
  imports: [FormsModule, RouterLink, MatButtonModule, MatCheckboxModule, MatFormFieldModule, MatIconModule, MatInputModule, MatSelectModule, MatProgressSpinnerModule],
  template: `
    <a [routerLink]="id() ? ['/contracts', id()] : '/contracts'" class="mb-4 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-ink">
      <span class="material-symbols-outlined !text-[18px]">arrow_back</span>Back
    </a>
    <h1 class="mb-6 text-2xl font-bold text-ink">{{ id() ? 'Edit contract' : 'New contract' }}</h1>

    @if (loading()) {
      <mat-spinner diameter="32" />
    } @else {
      <form class="grid gap-6 lg:grid-cols-3" (ngSubmit)="save()">
        <div class="space-y-6 lg:col-span-2">
          <section class="rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
            <h2 class="mb-4 font-semibold text-ink">Details</h2>
            <mat-form-field class="w-full">
              <mat-label>Title</mat-label>
              <input matInput name="title" [(ngModel)]="title" required minlength="3" maxlength="200" />
            </mat-form-field>
            <div class="grid gap-x-4 sm:grid-cols-2">
              <mat-form-field>
                <mat-label>Type</mat-label>
                <mat-select name="type" [(ngModel)]="type" required>
                  @for (t of types; track t) {
                    <mat-option [value]="t">{{ humanize(t) }}</mat-option>
                  }
                </mat-select>
              </mat-form-field>
              <mat-form-field>
                <mat-label>Counterparty</mat-label>
                <mat-select name="counterparty" [(ngModel)]="counterpartyId" required>
                  @for (c of counterparties(); track c.id) {
                    <mat-option [value]="c.id">{{ c.name }}</mat-option>
                  }
                </mat-select>
                <button mat-icon-button matSuffix type="button" (click)="$event.stopPropagation(); addingCounterparty.set(!addingCounterparty())" aria-label="Add counterparty">
                  <mat-icon>add_business</mat-icon>
                </button>
              </mat-form-field>
            </div>
            @if (addingCounterparty()) {
              <div class="mb-4 flex flex-wrap items-start gap-3 rounded-lg bg-slate-50 p-3">
                <mat-form-field subscriptSizing="dynamic" class="flex-1">
                  <mat-label>New counterparty name</mat-label>
                  <input matInput name="newCp" [(ngModel)]="newCounterparty" />
                </mat-form-field>
                <button mat-stroked-button type="button" class="mt-2" [disabled]="newCounterparty().trim().length < 2" (click)="createCounterparty()">Add</button>
              </div>
            }
            <div class="grid gap-x-4 sm:grid-cols-3">
              <mat-form-field class="sm:col-span-2">
                <mat-label>Value</mat-label>
                <input matInput name="value" type="number" min="0" step="0.01" [(ngModel)]="value" />
              </mat-form-field>
              <mat-form-field>
                <mat-label>Currency</mat-label>
                <mat-select name="currency" [(ngModel)]="currency">
                  @for (c of currencies; track c) {
                    <mat-option [value]="c">{{ c }}</mat-option>
                  }
                </mat-select>
              </mat-form-field>
              <mat-form-field>
                <mat-label>Start date</mat-label>
                <input matInput name="startDate" type="date" [(ngModel)]="startDate" />
              </mat-form-field>
              <mat-form-field>
                <mat-label>End date</mat-label>
                <input matInput name="endDate" type="date" [(ngModel)]="endDate" [min]="startDate()" />
              </mat-form-field>
              <mat-checkbox name="autoRenew" class="mt-3" [(ngModel)]="autoRenew">Renews automatically</mat-checkbox>
            </div>
          </section>

          <section class="rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
            <div class="mb-4 flex items-center justify-between">
              <h2 class="font-semibold text-ink">Clauses</h2>
              <button mat-stroked-button type="button" (click)="addClause()"><mat-icon>add</mat-icon>Add clause</button>
            </div>
            @for (c of clauses(); track c.uid; let i = $index, first = $first, last = $last) {
              <div class="mb-4 rounded-lg border border-slate-200 p-4">
                <div class="flex items-start gap-2">
                  <span class="mt-4 w-6 shrink-0 text-sm font-semibold text-slate-400">{{ i + 1 }}.</span>
                  <mat-form-field class="flex-1" subscriptSizing="dynamic">
                    <mat-label>Heading</mat-label>
                    <input matInput [name]="'h' + c.uid" [(ngModel)]="c.heading" required />
                  </mat-form-field>
                  <button mat-icon-button type="button" [disabled]="first" (click)="move(i, -1)" aria-label="Move up"><mat-icon>arrow_upward</mat-icon></button>
                  <button mat-icon-button type="button" [disabled]="last" (click)="move(i, 1)" aria-label="Move down"><mat-icon>arrow_downward</mat-icon></button>
                  <button mat-icon-button type="button" (click)="removeClause(i)" aria-label="Remove clause"><mat-icon>delete</mat-icon></button>
                </div>
                <mat-form-field class="mt-2 w-full pl-8" subscriptSizing="dynamic">
                  <mat-label>Text</mat-label>
                  <textarea matInput [name]="'b' + c.uid" rows="3" [(ngModel)]="c.body" required></textarea>
                </mat-form-field>
              </div>
            } @empty {
              <p class="rounded-lg bg-slate-50 p-4 text-sm text-slate-500">No clauses. Add clauses, or upload the contract document instead.</p>
            }
          </section>
        </div>

        <aside class="space-y-6">
          <section class="rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
            <h2 class="mb-3 font-semibold text-ink">Document</h2>
            @if (currentFile() && !removeDocument() && !file()) {
              <div class="mb-3 flex items-center gap-2 rounded-lg bg-slate-50 p-3 text-sm">
                <mat-icon class="text-rose-600">picture_as_pdf</mat-icon>
                <span class="min-w-0 flex-1 truncate">{{ currentFile()!.originalName }}</span>
                <button mat-icon-button type="button" (click)="removeDocument.set(true)" aria-label="Remove document"><mat-icon>close</mat-icon></button>
              </div>
            }
            <label class="flex cursor-pointer flex-col items-center gap-1 rounded-lg border-2 border-dashed border-slate-300 p-6 text-center text-sm text-slate-500 hover:border-brand-400 hover:bg-brand-50/40">
              <mat-icon>upload_file</mat-icon>
              @if (file(); as f) {
                <span class="font-medium text-ink">{{ f.name }}</span><span>{{ fileSize(f.size) }}</span>
              } @else {
                <span>PDF, DOCX or DOC, up to 20 MB</span>
              }
              <input type="file" class="sr-only" accept=".pdf,.docx,.doc" (change)="pickFile($event)" />
            </label>
          </section>

          @if (id()) {
            <section class="rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
              <h2 class="mb-3 font-semibold text-ink">What changed?</h2>
              <mat-form-field class="w-full" subscriptSizing="dynamic">
                <mat-label>Change summary (shown in the history)</mat-label>
                <textarea matInput name="summary" rows="2" [(ngModel)]="changeSummary" maxlength="500"></textarea>
              </mat-form-field>
              <p class="mt-3 text-xs text-slate-500">Saving creates version {{ (expectedVersion() ?? 0) + 1 }}. Earlier versions stay in the history.</p>
            </section>
          }

          @if (error()) {
            <p class="rounded-lg bg-rose-50 p-3 text-sm text-rose-700" role="alert">{{ error() }}</p>
          }
          <button mat-flat-button type="submit" class="w-full" [disabled]="saving() || !valid()">
            {{ saving() ? 'Saving…' : id() ? 'Save new version' : 'Create draft' }}
          </button>
        </aside>
      </form>
    }
  `,
})
export class ContractFormPage implements OnInit {
  private readonly api = inject(Api);
  private readonly router = inject(Router);
  private readonly toast = inject(Toast);
  /** Route param: present when editing. */
  readonly id = input<string>();

  protected readonly types = Object.values(ContractType);
  protected readonly currencies = ['USD', 'EUR', 'GBP', 'TND', 'CHF'];
  protected readonly humanize = humanize;
  protected readonly fileSize = fileSize;

  protected readonly loading = signal(true);
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly counterparties = signal<Counterparty[]>([]);
  protected readonly addingCounterparty = signal(false);
  protected readonly newCounterparty = signal('');

  protected readonly title = signal('');
  protected readonly type = signal<string>('VENDOR');
  protected readonly counterpartyId = signal<string | null>(null);
  protected readonly value = signal<number | null>(null);
  protected readonly currency = signal('USD');
  protected readonly startDate = signal('');
  protected readonly endDate = signal('');
  protected readonly autoRenew = signal(false);
  protected readonly clauses = signal<ClauseDraft[]>([]);
  protected readonly file = signal<File | null>(null);
  protected readonly currentFile = signal<StoredFile | null>(null);
  protected readonly removeDocument = signal(false);
  protected readonly changeSummary = signal('');
  protected readonly expectedVersion = signal<number | null>(null);

  /** A method, not a computed: clause fields are edited in place, which a computed wouldn't notice. */
  protected valid(): boolean {
    return this.title().trim().length >= 3 && !!this.counterpartyId() && this.clauses().every((c) => c.heading.trim() && c.body.trim());
  }

  async ngOnInit() {
    try {
      this.counterparties.set(await this.api.counterparties());
      const id = this.id();
      if (id) {
        const c = await this.api.contract(id);
        const v = c.currentVersion;
        this.title.set(c.title);
        this.type.set(c.type);
        this.counterpartyId.set(c.counterparty.id);
        this.value.set(c.value === null ? null : Number(c.value));
        this.currency.set(c.currency);
        this.startDate.set(c.startDate?.slice(0, 10) ?? '');
        this.endDate.set(c.endDate?.slice(0, 10) ?? '');
        this.autoRenew.set(c.autoRenew);
        this.clauses.set(v.clauses.map((x) => ({ uid: ++uid, key: x.key, heading: x.heading, body: x.body })));
        this.currentFile.set(v.file);
        this.expectedVersion.set(c.currentVersionNumber);
      }
    } catch (err) {
      this.error.set(errorMessage(err));
    } finally {
      this.loading.set(false);
    }
  }

  protected addClause() {
    this.clauses.update((cs) => [...cs, { uid: ++uid, key: '', heading: '', body: '' }]);
  }

  protected removeClause(i: number) {
    this.clauses.update((cs) => cs.filter((_, j) => j !== i));
  }

  protected move(i: number, delta: number) {
    this.clauses.update((cs) => {
      const next = [...cs];
      [next[i], next[i + delta]] = [next[i + delta]!, next[i]!];
      return next;
    });
  }

  protected pickFile(e: Event) {
    this.file.set((e.target as HTMLInputElement).files?.[0] ?? null);
  }

  protected async createCounterparty() {
    try {
      const cp = await this.api.createCounterparty({ name: this.newCounterparty().trim() });
      this.counterparties.update((list) => [...list, cp].sort((a, b) => a.name.localeCompare(b.name)));
      this.counterpartyId.set(cp.id);
      this.newCounterparty.set('');
      this.addingCounterparty.set(false);
    } catch (err) {
      this.toast.error(err);
    }
  }

  protected async save() {
    this.saving.set(true);
    this.error.set(null);
    const taken = new Set(this.clauses().map((c) => c.key).filter(Boolean));
    const clauses = this.clauses().map((c) => {
      const key = c.key || slug(c.heading, taken);
      taken.add(key);
      return { key, heading: c.heading.trim(), body: c.body.trim() };
    });
    const data: Record<string, unknown> = {
      title: this.title().trim(),
      type: this.type(),
      counterpartyId: this.counterpartyId(),
      value: this.value() === null || (this.value() as unknown) === '' ? null : this.value(),
      currency: this.currency(),
      startDate: this.startDate() || null,
      endDate: this.endDate() || null,
      autoRenew: this.autoRenew(),
      clauses,
    };
    if (this.id()) {
      data['expectedVersion'] = this.expectedVersion();
      if (this.changeSummary().trim()) data['changeSummary'] = this.changeSummary().trim();
      if (this.removeDocument() && !this.file()) data['removeDocument'] = true;
    }
    const form = new FormData();
    form.append('data', JSON.stringify(data));
    if (this.file()) form.append('document', this.file()!);

    try {
      const saved = this.id() ? await this.api.updateContract(this.id()!, form) : await this.api.createContract(form);
      this.toast.success(this.id() ? `Saved as version ${saved.currentVersionNumber}` : `Draft ${saved.referenceNumber} created`);
      await this.router.navigate(['/contracts', saved.id]);
    } catch (err) {
      this.error.set(errorMessage(err));
    } finally {
      this.saving.set(false);
    }
  }
}
