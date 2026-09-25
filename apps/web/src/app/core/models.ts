import type {
  ApprovalRequestStatus,
  ApprovalStepStatus,
  ContractStatus,
  ContractType,
  Role,
} from '@cms/shared';

/** Shapes returned by the API (dates arrive as ISO strings, decimals as strings). */

export interface UserSummary {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
}

export interface Profile extends UserSummary {
  role: Role;
  department: { id: string; name: string; code: string };
  permissions: string[];
}

export interface Department {
  id: string;
  name: string;
  code: string;
}

export interface Counterparty {
  id: string;
  name: string;
  kind?: 'COMPANY' | 'INDIVIDUAL';
  email?: string | null;
}

export interface StoredFile {
  id: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  createdAt: string;
}

export interface ContractSummary {
  id: string;
  referenceNumber: string;
  title: string;
  type: ContractType;
  status: ContractStatus;
  value: string | null;
  currency: string;
  startDate: string | null;
  endDate: string | null;
  autoRenew: boolean;
  currentVersionNumber: number;
  createdAt: string;
  updatedAt: string;
  counterparty: { id: string; name: string };
  owner: UserSummary;
  department: Department;
}

export interface Clause {
  id?: string;
  key: string;
  heading: string;
  body: string;
}

export interface VersionSummary {
  id: string;
  versionNumber: number;
  title: string;
  changeSummary: string | null;
  contentHash: string;
  createdAt: string;
  createdBy: UserSummary;
  file: StoredFile | null;
}

export interface VersionDetail extends VersionSummary {
  type: ContractType;
  counterparty: Counterparty;
  value: string | null;
  currency: string;
  startDate: string | null;
  endDate: string | null;
  clauses: Clause[];
}

export interface Attachment {
  id: string;
  kind: 'SUPPORTING' | 'SIGNED_COPY';
  description: string | null;
  createdAt: string;
  file: StoredFile & { uploadedBy: UserSummary };
}

export interface ContractDetail extends ContractSummary {
  activatedAt: string | null;
  terminatedAt: string | null;
  attachments: Attachment[];
  currentVersion: VersionDetail;
  latestApprovalRequest: { id: string; status: ApprovalRequestStatus; currentStage: number | null } | null;
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface VersionDiff {
  from: number;
  to: number;
  fields: { field: string; from: string | null; to: string | null }[];
  clauses: {
    added: Clause[];
    removed: Clause[];
    changed: { key: string; from: Clause; to: Clause }[];
    reordered: boolean;
  };
  documentChanged: boolean;
}

export interface TimelineEntry {
  id: string;
  fromStatus: ContractStatus | null;
  toStatus: ContractStatus;
  reason: string | null;
  createdAt: string;
  actor: UserSummary | null;
}

export interface ApprovalStep {
  id: string;
  stage: number;
  name: string;
  approverRole: Role;
  approverDepartment: Department | null;
  assignee: UserSummary | null;
  status: ApprovalStepStatus;
  routingNote: string | null;
  skipReason: string | null;
  slaHours: number | null;
  activatedAt: string | null;
  dueAt: string | null;
  decidedAt: string | null;
  decidedBy: UserSummary | null;
  comment: string | null;
  escalationLevel: number;
  escalations: { level: number; createdAt: string; escalatedTo: UserSummary }[];
  canDecide: boolean;
}

export interface ApprovalRequest {
  id: string;
  status: ApprovalRequestStatus;
  currentStage: number | null;
  submittedAt: string;
  completedAt: string | null;
  submittedBy: UserSummary;
  contractVersion: { id: string; versionNumber: number; contentHash: string };
  workflowTemplate: { id: string; name: string } | null;
  steps: ApprovalStep[];
}

export interface PendingStep extends Omit<ApprovalStep, 'canDecide' | 'escalations'> {
  escalatedToMe: boolean;
  overdue: boolean;
  request: {
    id: string;
    submittedAt: string;
    submittedBy: UserSummary;
    contractVersion: { versionNumber: number };
    contract: Pick<ContractSummary, 'id' | 'referenceNumber' | 'title' | 'type' | 'status' | 'value' | 'currency'> & {
      counterparty: { id: string; name: string };
      department: Department;
    };
  };
}

export interface ApprovalPreview {
  template: { id: string; name: string } | null;
  steps: { stage: number; name: string; approverRole: Role; condition: string | null; willRun: boolean; skipReason: string | null; slaHours: number | null }[];
}

export interface Signer {
  id: string;
  userId: string | null;
  name: string;
  email: string;
  signingOrder: number;
  status: 'PENDING' | 'SIGNED' | 'DECLINED';
  method: 'TYPED' | 'DRAWN' | null;
  typedSignature: string | null;
  signedContentHash: string | null;
  signedAt: string | null;
  ipAddress: string | null;
  declineReason: string | null;
  signatureFile: StoredFile | null;
  isMe: boolean;
  canSign: boolean;
}

export interface SignersInfo {
  versionNumber: number | null;
  contentHash: string | null;
  signers: Signer[];
}

export interface SignerCandidate extends UserSummary {
  role: Role;
  department: { name: string };
}

export interface SignaturePayload {
  contentHash: string;
  method: 'TYPED' | 'DRAWN';
  typedName?: string;
  signatureImage?: string;
  consent: true;
}

export interface PublicSigningView {
  signer: { name: string; email: string; status: Signer['status']; signingOrder: number };
  canSign: boolean;
  contract: { referenceNumber: string; status: ContractStatus; owner: { firstName: string; lastName: string; email: string } };
  version: VersionDetail;
  signers: { name: string; signingOrder: number; status: Signer['status']; signedAt: string | null }[];
}

export interface AppNotification {
  id: string;
  type: string;
  title: string;
  body: string;
  link: string | null;
  contractId: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface AuditEntry {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  ipAddress: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  user: UserSummary | null;
  contract: { referenceNumber: string; title: string } | null;
}

export interface Dashboard {
  counts: {
    byStatus: Partial<Record<ContractStatus, number>>;
    myDrafts: number;
    pendingMyApproval: number;
    awaitingMySignature: number;
    expiringSoon: number;
  };
  expiringSoon: ContractSummary[];
  recent: ContractSummary[];
  expiryWindowDays: number;
}

/** The API's error envelope. */
export interface ApiError {
  error: { code: string; message: string; details?: { fieldErrors?: Record<string, string[]>; formErrors?: string[] } };
}
