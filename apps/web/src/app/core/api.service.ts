import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type {
  ApprovalPreview,
  ApprovalRequest,
  AppNotification,
  Attachment,
  AuditEntry,
  ContractDetail,
  ContractSummary,
  Counterparty,
  Dashboard,
  Page,
  PendingStep,
  PublicSigningView,
  SignaturePayload,
  SignerCandidate,
  SignersInfo,
  TimelineEntry,
  VersionDetail,
  VersionDiff,
  VersionSummary,
} from './models';

export interface ContractQuery {
  q?: string;
  status?: string[];
  type?: string[];
  sort?: string;
  order?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
}

export interface SignerInput {
  userId?: string;
  name?: string;
  email?: string;
  signingOrder: number;
}

/** Typed wrappers around the REST API. Every method returns a Promise. */
@Injectable({ providedIn: 'root' })
export class Api {
  private readonly http = inject(HttpClient);

  private get<T>(url: string, params?: Record<string, string | number | string[] | undefined>) {
    let p = new HttpParams();
    for (const [k, v] of Object.entries(params ?? {})) {
      if (v === undefined || v === '' || (Array.isArray(v) && v.length === 0)) continue;
      p = p.set(k, Array.isArray(v) ? v.join(',') : String(v));
    }
    return firstValueFrom(this.http.get<T>(url, { params: p }));
  }
  private post<T>(url: string, body: unknown = {}) {
    return firstValueFrom(this.http.post<T>(url, body));
  }

  // --- contracts -------------------------------------------------------------
  dashboard = () => this.get<Dashboard>('/api/dashboard');
  contracts = (q: ContractQuery) => this.get<Page<ContractSummary>>('/api/contracts', { ...q });
  contract = (id: string) => this.get<ContractDetail>(`/api/contracts/${id}`);
  createContract = (body: FormData) => this.post<ContractDetail>('/api/contracts', body);
  updateContract = (id: string, body: FormData) => firstValueFrom(this.http.patch<ContractDetail>(`/api/contracts/${id}`, body));
  versions = (id: string) => this.get<VersionSummary[]>(`/api/contracts/${id}/versions`);
  version = (id: string, n: number) => this.get<VersionDetail>(`/api/contracts/${id}/versions/${n}`);
  diff = (id: string, from: number, to: number) => this.get<VersionDiff>(`/api/contracts/${id}/versions/diff`, { from, to });
  timeline = (id: string) => this.get<TimelineEntry[]>(`/api/contracts/${id}/timeline`);
  addAttachment = (id: string, body: FormData) => this.post<Attachment>(`/api/contracts/${id}/attachments`, body);
  removeAttachment = (id: string, attachmentId: string) =>
    firstValueFrom(this.http.delete<void>(`/api/contracts/${id}/attachments/${attachmentId}`));
  counterparties = (q?: string) => this.get<Counterparty[]>('/api/counterparties', { q });
  createCounterparty = (body: { name: string; email?: string }) => this.post<Counterparty>('/api/counterparties', body);

  /** Files need the bearer token, so they're fetched as blobs rather than linked directly. */
  async download(url: string, fallbackName: string) {
    const res = await firstValueFrom(this.http.get(url, { responseType: 'blob', observe: 'response' }));
    const disposition = res.headers.get('content-disposition') ?? '';
    const name = /filename="?([^";]+)"?/.exec(disposition)?.[1] ?? fallbackName;
    const href = URL.createObjectURL(res.body!);
    const a = Object.assign(document.createElement('a'), { href, download: decodeURIComponent(name) });
    a.click();
    setTimeout(() => URL.revokeObjectURL(href), 1000);
  }

  // --- workflow --------------------------------------------------------------
  approvals = (id: string) => this.get<ApprovalRequest[]>(`/api/contracts/${id}/approvals`);
  approvalPreview = (id: string) => this.get<ApprovalPreview>(`/api/contracts/${id}/approval-preview`);
  submit = (id: string, comment?: string) => this.post<ApprovalRequest[]>(`/api/contracts/${id}/submit`, { comment });
  withdraw = (id: string, reason?: string) => this.post<ApprovalRequest[]>(`/api/contracts/${id}/withdraw`, { reason });
  reopen = (id: string, reason: string) => this.post<void>(`/api/contracts/${id}/reopen`, { reason });
  pendingApprovals = () => this.get<PendingStep[]>('/api/approvals/pending');
  approve = (stepId: string, comment?: string) => this.post<ApprovalRequest[]>(`/api/approvals/steps/${stepId}/approve`, { comment });
  reject = (stepId: string, comment: string) => this.post<ApprovalRequest[]>(`/api/approvals/steps/${stepId}/reject`, { comment });

  // --- signatures ------------------------------------------------------------
  signers = (id: string) => this.get<SignersInfo>(`/api/contracts/${id}/signers`);
  signerCandidates = () => this.get<SignerCandidate[]>('/api/signers');
  setSigners = (id: string, signers: SignerInput[]) =>
    firstValueFrom(this.http.put<SignersInfo>(`/api/contracts/${id}/signers`, { signers }));
  sign = (id: string, body: SignaturePayload) => this.post<SignersInfo>(`/api/contracts/${id}/sign`, body);
  declineSignature = (id: string, reason: string) => this.post<SignersInfo>(`/api/contracts/${id}/decline-signature`, { reason });
  publicSigning = (token: string) => this.get<PublicSigningView>(`/api/signing/${token}`);
  publicSign = (token: string, body: SignaturePayload) => this.post<PublicSigningView>(`/api/signing/${token}/sign`, body);
  publicDecline = (token: string, reason: string) => this.post<PublicSigningView>(`/api/signing/${token}/decline`, { reason });

  // --- notifications & audit -------------------------------------------------
  notifications = (limit = 15) => this.get<{ items: AppNotification[]; unreadCount: number }>('/api/notifications', { limit });
  unreadCount = () => this.get<{ unreadCount: number }>('/api/notifications/unread-count');
  markRead = (id: string) => this.post<void>(`/api/notifications/${id}/read`);
  markAllRead = () => this.post<{ marked: number }>('/api/notifications/read-all');
  contractAudit = (id: string, before?: string) =>
    this.get<{ items: AuditEntry[]; nextCursor: string | null }>(`/api/contracts/${id}/audit`, { before, limit: 50 });
}
