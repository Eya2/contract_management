import { Component, inject, input, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { Router, RouterLink } from '@angular/router';
import { ContractType, Role } from '@cms/shared';
import { Api } from '../../core/api.service';
import { errorMessage } from '../../core/errors';
import type { Condition, Department } from '../../core/models';
import { Toast } from '../../core/toast.service';
import { humanize } from '../../shared/format';
import { PageHeader } from '../../shared/page-header';

type ConditionMode = 'always' | 'rule' | 'json';

interface StepDraft {
  uid: number;
  stage: number;
  name: string;
  approverRole: string;
  approverScope: 'ANY' | 'CONTRACT_DEPARTMENT';
  escalateAfterHours: number | null;
  mode: ConditionMode;
  field: string;
  op: string;
  value: string;
  json: string;
}

/** What a simple rule can test, and how its value is typed. */
const FIELDS = [
  { value: 'value', label: 'Contract value', kind: 'number' },
  { value: 'durationDays', label: 'Duration (days)', kind: 'number' },
  { value: 'type', label: 'Contract type', kind: 'type' },
  { value: 'currency', label: 'Currency', kind: 'text' },
  { value: 'autoRenew', label: 'Auto-renews', kind: 'boolean' },
] as const;

const OPS: Record<string, { value: string; label: string }[]> = {
  number: [
    { value: 'gt', label: 'is more than' },
    { value: 'gte', label: 'is at least' },
    { value: 'lt', label: 'is less than' },
    { value: 'lte', label: 'is at most' },
    { value: 'eq', label: 'equals' },
  ],
  type: [
    { value: 'eq', label: 'is' },
    { value: 'neq', label: 'is not' },
  ],
  text: [
    { value: 'eq', label: 'is' },
    { value: 'neq', label: 'is not' },
  ],
  boolean: [{ value: 'eq', label: 'is' }],
};

let uid = 0;

@Component({
  imports: [FormsModule, RouterLink, MatButtonModule, MatFormFieldModule, MatIconModule, MatInputModule, MatSelectModule, MatSlideToggleModule, PageHeader],
  template: `
    <a routerLink="/admin/policies" class="mb-5 inline-flex items-center gap-1 text-sm font-medium text-muted hover:text-ink"><mat-icon class="!size-[18px] !text-[18px]">arrow_back</mat-icon>Approval policies</a>
    <cms-page-header [title]="id() ? 'Edit policy' : 'New policy'" subtitle="Contracts already in review keep the steps they started with; changes apply to new submissions.">
      @if (id() && isActive()) {
        <button mat-stroked-button class="!text-rose-600 dark:!text-rose-400" (click)="deactivate()"><mat-icon>block</mat-icon>Deactivate</button>
      }
      <button mat-flat-button [disabled]="busy()" (click)="save()"><mat-icon>save</mat-icon>Save policy</button>
    </cms-page-header>

    <div class="grid gap-6 xl:grid-cols-3">
      <section class="card space-y-1 p-5 xl:col-span-1 xl:self-start">
        <h2 class="mb-3 font-semibold">Scope</h2>
        <mat-form-field class="w-full"><mat-label>Name</mat-label><input matInput [(ngModel)]="name" /></mat-form-field>
        <mat-form-field class="w-full"><mat-label>Description</mat-label><textarea matInput rows="2" [(ngModel)]="description"></textarea></mat-form-field>
        <mat-form-field class="w-full">
          <mat-label>Contract type</mat-label>
          <mat-select [(ngModel)]="contractType">
            <mat-option [value]="null">Any type</mat-option>
            @for (t of types; track t) {
              <mat-option [value]="t">{{ humanize(t) }}</mat-option>
            }
          </mat-select>
        </mat-form-field>
        <mat-form-field class="w-full">
          <mat-label>Department</mat-label>
          <mat-select [(ngModel)]="departmentId">
            <mat-option [value]="null">Any department</mat-option>
            @for (d of departments(); track d.id) {
              <mat-option [value]="d.id">{{ d.name }}</mat-option>
            }
          </mat-select>
        </mat-form-field>
        <div class="flex items-center justify-between rounded-xl bg-subtle p-3">
          <span class="text-sm font-medium text-ink">Active</span>
          <mat-slide-toggle [(ngModel)]="isActive" aria-label="Active" />
        </div>
      </section>

      <section class="space-y-4 xl:col-span-2">
        @for (stage of stageNumbers(); track stage) {
          <div class="card stagger p-5" [style.--i]="$index">
            <div class="mb-3 flex items-center gap-2">
              <span class="flex size-7 items-center justify-center rounded-full bg-[var(--accent)] text-xs font-bold text-white">{{ stage }}</span>
              <h3 class="font-semibold">Stage {{ stage }}</h3>
              <span class="text-xs text-muted">{{ stepsIn(stage).length > 1 ? 'Steps run in parallel; all must approve' : '' }}</span>
              <button mat-button class="!ml-auto" (click)="addStep(stage)"><mat-icon>add</mat-icon>Parallel step</button>
            </div>
            @for (s of stepsIn(stage); track s.uid) {
              <div class="mb-3 rounded-xl border border-line p-4 last:mb-0">
                <div class="grid gap-x-3 sm:grid-cols-2 lg:grid-cols-4">
                  <mat-form-field class="lg:col-span-2"><mat-label>Step name</mat-label><input matInput [(ngModel)]="s.name" placeholder="e.g. Legal review" /></mat-form-field>
                  <mat-form-field>
                    <mat-label>Approver</mat-label>
                    <mat-select [(ngModel)]="s.approverRole">
                      @for (r of approverRoles; track r) {
                        <mat-option [value]="r">{{ humanize(r) }}</mat-option>
                      }
                    </mat-select>
                  </mat-form-field>
                  <mat-form-field>
                    <mat-label>Who</mat-label>
                    <mat-select [(ngModel)]="s.approverScope">
                      <mat-option value="ANY">Anyone with the role</mat-option>
                      <mat-option value="CONTRACT_DEPARTMENT">Contract's department</mat-option>
                    </mat-select>
                  </mat-form-field>
                  <mat-form-field>
                    <mat-label>Escalate after (hours)</mat-label>
                    <input matInput type="number" min="1" [(ngModel)]="s.escalateAfterHours" placeholder="Never" />
                  </mat-form-field>
                  <mat-form-field>
                    <mat-label>Applies</mat-label>
                    <mat-select [(ngModel)]="s.mode">
                      <mat-option value="always">Always</mat-option>
                      <mat-option value="rule">Only if…</mat-option>
                      <mat-option value="json">Advanced rule (JSON)</mat-option>
                    </mat-select>
                  </mat-form-field>
                  <mat-form-field>
                    <mat-label>Stage</mat-label>
                    <mat-select [(ngModel)]="s.stage">
                      @for (n of stageChoices(); track n) {
                        <mat-option [value]="n">Stage {{ n }}</mat-option>
                      }
                    </mat-select>
                  </mat-form-field>
                  <div class="flex items-start justify-end">
                    <button mat-icon-button class="!mt-1" (click)="removeStep(s.uid)" aria-label="Remove step"><mat-icon>delete</mat-icon></button>
                  </div>
                </div>
                @if (s.mode === 'rule') {
                  <div class="mt-1 grid gap-x-3 rounded-xl bg-subtle p-3 pb-0 sm:grid-cols-3">
                    <mat-form-field>
                      <mat-label>When</mat-label>
                      <mat-select [(ngModel)]="s.field" (selectionChange)="s.op = opsFor(s.field)[0]!.value; s.value = ''">
                        @for (f of fields; track f.value) {
                          <mat-option [value]="f.value">{{ f.label }}</mat-option>
                        }
                      </mat-select>
                    </mat-form-field>
                    <mat-form-field>
                      <mat-label>Condition</mat-label>
                      <mat-select [(ngModel)]="s.op">
                        @for (o of opsFor(s.field); track o.value) {
                          <mat-option [value]="o.value">{{ o.label }}</mat-option>
                        }
                      </mat-select>
                    </mat-form-field>
                    @switch (kindOf(s.field)) {
                      @case ('type') {
                        <mat-form-field>
                          <mat-label>Type</mat-label>
                          <mat-select [(ngModel)]="s.value">
                            @for (t of types; track t) {
                              <mat-option [value]="t">{{ humanize(t) }}</mat-option>
                            }
                          </mat-select>
                        </mat-form-field>
                      }
                      @case ('boolean') {
                        <mat-form-field>
                          <mat-label>Value</mat-label>
                          <mat-select [(ngModel)]="s.value"><mat-option value="true">Yes</mat-option><mat-option value="false">No</mat-option></mat-select>
                        </mat-form-field>
                      }
                      @default {
                        <mat-form-field>
                          <mat-label>Value</mat-label>
                          <input matInput [type]="kindOf(s.field) === 'number' ? 'number' : 'text'" [(ngModel)]="s.value" />
                        </mat-form-field>
                      }
                    }
                  </div>
                  <p class="mt-2 text-xs text-muted">If the contract has no value yet, the step is kept (it is never skipped for missing data).</p>
                }
                @if (s.mode === 'json') {
                  <mat-form-field class="mt-1 w-full">
                    <mat-label>Condition JSON</mat-label>
                    <textarea matInput rows="4" class="font-mono !text-xs" [(ngModel)]="s.json"></textarea>
                    <mat-hint>e.g. {{ '{' }}"all": [{{ '{' }}"field": "value", "op": "gt", "value": 10000{{ '}' }}, {{ '{' }}"field": "type", "op": "eq", "value": "VENDOR"{{ '}' }}]{{ '}' }}</mat-hint>
                  </mat-form-field>
                }
              </div>
            }
          </div>
        }
        <button mat-stroked-button class="w-full !border-dashed" (click)="addStep(nextStage())"><mat-icon>playlist_add</mat-icon>Add stage {{ nextStage() }}</button>
        @if (error()) {
          <div class="callout tone-danger" role="alert"><mat-icon>error</mat-icon>{{ error() }}</div>
        }
      </section>
    </div>
  `,
})
export class PolicyEditorPage implements OnInit {
  private readonly api = inject(Api);
  private readonly router = inject(Router);
  private readonly toast = inject(Toast);
  readonly id = input<string>();

  protected readonly types = Object.values(ContractType);
  protected readonly approverRoles = Object.values(Role).filter((r) => r !== 'EMPLOYEE');
  protected readonly fields = FIELDS;
  protected readonly humanize = humanize;

  protected readonly departments = signal<Department[]>([]);
  protected readonly name = signal('');
  protected readonly description = signal('');
  protected readonly contractType = signal<string | null>(null);
  protected readonly departmentId = signal<string | null>(null);
  protected readonly isActive = signal(true);
  protected readonly steps = signal<StepDraft[]>([]);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  async ngOnInit() {
    this.departments.set(await this.api.departments());
    const id = this.id();
    if (!id) {
      this.steps.set([this.draft(1, 'Manager approval', 'MANAGER', 'CONTRACT_DEPARTMENT', 48)]);
      return;
    }
    const p = await this.api.policy(id);
    this.name.set(p.name);
    this.description.set(p.description ?? '');
    this.contractType.set(p.contractType);
    this.departmentId.set(p.departmentId);
    this.isActive.set(p.isActive);
    this.steps.set(
      p.steps.map((s) => {
        const d = this.draft(s.stage, s.name, s.approverRole, s.approverScope, s.escalateAfterHours);
        const c = s.condition as Record<string, unknown> | null;
        if (c && 'field' in c && !Array.isArray(c['value'])) {
          Object.assign(d, { mode: 'rule', field: c['field'], op: c['op'], value: String(c['value']) });
        } else if (c) {
          Object.assign(d, { mode: 'json', json: JSON.stringify(c, null, 2) });
        }
        return d;
      }),
    );
  }

  private draft(stage: number, name = '', role = 'LEGAL', scope: 'ANY' | 'CONTRACT_DEPARTMENT' = 'ANY', hours: number | null = 48): StepDraft {
    return { uid: ++uid, stage, name, approverRole: role, approverScope: scope, escalateAfterHours: hours, mode: 'always', field: 'value', op: 'gt', value: '', json: '' };
  }

  protected stageNumbers() {
    return [...new Set(this.steps().map((s) => s.stage))].sort((a, b) => a - b);
  }
  protected stepsIn(stage: number) {
    return this.steps().filter((s) => s.stage === stage);
  }
  protected nextStage() {
    return Math.max(0, ...this.steps().map((s) => s.stage)) + 1;
  }
  protected stageChoices() {
    return Array.from({ length: this.nextStage() }, (_, i) => i + 1);
  }
  protected addStep(stage: number) {
    this.steps.update((list) => [...list, this.draft(stage)]);
  }
  protected removeStep(id: number) {
    this.steps.update((list) => list.filter((s) => s.uid !== id));
  }
  protected kindOf(field: string) {
    return FIELDS.find((f) => f.value === field)?.kind ?? 'text';
  }
  protected opsFor(field: string) {
    return OPS[this.kindOf(field)]!;
  }

  private condition(s: StepDraft): Condition | null {
    if (s.mode === 'always') return null;
    if (s.mode === 'json') {
      try {
        return JSON.parse(s.json) as Condition;
      } catch {
        throw new Error(`"${s.name}": the condition is not valid JSON`);
      }
    }
    const kind = this.kindOf(s.field);
    if (s.value === '') throw new Error(`"${s.name}": choose a value for the condition`);
    const value = kind === 'number' ? Number(s.value) : kind === 'boolean' ? s.value === 'true' : kind === 'text' ? s.value.trim().toUpperCase() : s.value;
    return { field: s.field, op: s.op, value };
  }

  protected async save() {
    this.error.set(null);
    this.busy.set(true);
    try {
      // Stages are renumbered 1..n so a removed stage leaves no gap.
      const order = this.stageNumbers();
      const steps = this.steps().map((s) => ({
        stage: order.indexOf(s.stage) + 1,
        name: s.name.trim(),
        approverRole: s.approverRole as never,
        approverScope: s.approverScope,
        escalateAfterHours: s.escalateAfterHours ? Number(s.escalateAfterHours) : null,
        condition: this.condition(s),
      }));
      const saved = await this.api.savePolicy(this.id() ?? null, {
        name: this.name().trim(),
        description: this.description().trim() || null,
        contractType: this.contractType(),
        departmentId: this.departmentId(),
        isActive: this.isActive(),
        steps,
      });
      this.toast.success('Policy saved');
      await this.router.navigate(['/admin/policies', saved.id], { replaceUrl: true });
    } catch (err) {
      this.error.set(errorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }

  protected async deactivate() {
    try {
      await this.api.deactivatePolicy(this.id()!);
      this.isActive.set(false);
      this.toast.success('Policy deactivated');
    } catch (err) {
      this.toast.error(err);
    }
  }
}
