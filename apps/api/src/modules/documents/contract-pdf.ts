import PDFDocument from 'pdfkit';

/**
 * Renders a contract version as a formal PDF: letterhead, parties, key terms,
 * numbered clauses, signature blocks (with the drawn or typed signatures
 * stamped in once signed) and a signature certificate page.
 *
 * Pure rendering: all data comes in through `ContractPdfData`, nothing is
 * loaded here. The PDF is a *view* of the version; what signers sign is the
 * version's content hash, which is printed on every page so the two can be
 * matched.
 */

export type PdfLang = 'en' | 'fr';

export interface PdfSigner {
  name: string;
  email: string;
  internal: boolean;
  order: number;
  status: 'PENDING' | 'SIGNED' | 'DECLINED';
  method: 'TYPED' | 'DRAWN' | null;
  typedSignature: string | null;
  signatureImage: Buffer | null;
  signedAt: Date | null;
  ipAddress: string | null;
  userAgent: string | null;
  signedContentHash: string | null;
}

export interface ContractPdfData {
  lang: PdfLang;
  company: string;
  reference: string;
  title: string;
  type: string;
  status: string;
  versionNumber: number;
  contentHash: string;
  generatedAt: Date;
  department: string;
  owner: { name: string; email: string };
  counterparty: { name: string; email: string | null; contactName: string | null; registrationNumber: string | null };
  value: string | null;
  currency: string;
  startDate: Date | null;
  endDate: Date | null;
  autoRenew: boolean;
  clauses: { heading: string; body: string }[];
  document: { name: string; sha256: string } | null;
  signers: PdfSigner[];
  approvals: { step: string; decidedBy: string; decidedAt: Date }[];
}

const LABELS = {
  en: {
    types: { VENDOR: 'Vendor agreement', CLIENT: 'Client agreement', NDA: 'Non-disclosure agreement', EMPLOYMENT: 'Employment agreement' } as Record<string, string>,
    version: 'Version',
    generated: 'Generated',
    parties: 'Parties',
    colon: ': ',
    between: 'Between',
    and: 'And',
    department: 'Department',
    representedBy: 'Represented by',
    registration: 'Registration no.',
    contact: 'Contact',
    keyTerms: 'Key terms',
    value: 'Contract value',
    start: 'Start date',
    end: 'End date',
    renewal: 'Renewal',
    autoRenew: 'Automatic, same terms',
    manualRenew: 'By agreement',
    notSet: 'Not set',
    terms: 'Terms and conditions',
    documentTerms: (name: string, hash: string) => `The terms of this contract are set out in the attached document "${name}" (SHA-256 ${hash}).`,
    signatures: 'Signatures',
    signaturesIntro: 'The parties agree to the terms above and sign this contract electronically.',
    forCompany: (c: string) => `For ${c}`,
    forCounterparty: 'For the counterparty',
    signature: 'Signature',
    date: 'Date',
    signedOn: 'Signed electronically on',
    declined: 'Declined to sign',
    pending: 'Awaiting signature',
    certificate: 'Signature certificate',
    certificateIntro:
      'This certificate is part of the contract. Each signature below was made on the content identified by the SHA-256 fingerprint shown, which is also printed at the foot of every page.',
    fingerprint: 'Content fingerprint (SHA-256)',
    signer: 'Signer',
    method: 'Method',
    drawn: 'Hand-drawn signature',
    typed: 'Typed name',
    ip: 'IP address',
    device: 'Device',
    integrity: 'Integrity',
    matches: 'Signed content matches this document',
    mismatch: 'Signed content differs from this document',
    approvals: 'Approval trail',
    approvedBy: 'approved by',
    page: 'Page',
    of: 'of',
    watermark: 'DRAFT',
    internal: 'internal',
    external: 'external',
    locale: 'en-GB',
  },
  fr: {
    types: { VENDOR: 'Contrat fournisseur', CLIENT: 'Contrat client', NDA: 'Accord de confidentialité', EMPLOYMENT: 'Contrat de travail' } as Record<string, string>,
    version: 'Version',
    generated: 'Généré le',
    parties: 'Les parties',
    colon: ' : ',
    between: 'Entre',
    and: 'Et',
    department: 'Département',
    representedBy: 'Représenté par',
    registration: 'N° d’immatriculation',
    contact: 'Contact',
    keyTerms: 'Conditions principales',
    value: 'Montant du contrat',
    start: 'Date de début',
    end: 'Date de fin',
    renewal: 'Renouvellement',
    autoRenew: 'Automatique, mêmes conditions',
    manualRenew: 'Par accord des parties',
    notSet: 'Non défini',
    terms: 'Conditions générales',
    documentTerms: (name: string, hash: string) => `Les conditions de ce contrat figurent dans le document joint « ${name} » (SHA-256 ${hash}).`,
    signatures: 'Signatures',
    signaturesIntro: 'Les parties acceptent les conditions ci-dessus et signent ce contrat électroniquement.',
    forCompany: (c: string) => `Pour ${c}`,
    forCounterparty: 'Pour le cocontractant',
    signature: 'Signature',
    date: 'Date',
    signedOn: 'Signé électroniquement le',
    declined: 'Signature refusée',
    pending: 'En attente de signature',
    certificate: 'Certificat de signature',
    certificateIntro:
      'Ce certificat fait partie du contrat. Chaque signature ci-dessous porte sur le contenu identifié par l’empreinte SHA-256 indiquée, également imprimée au pied de chaque page.',
    fingerprint: 'Empreinte du contenu (SHA-256)',
    signer: 'Signataire',
    method: 'Méthode',
    drawn: 'Signature manuscrite',
    typed: 'Nom saisi',
    ip: 'Adresse IP',
    device: 'Appareil',
    integrity: 'Intégrité',
    matches: 'Le contenu signé correspond à ce document',
    mismatch: 'Le contenu signé diffère de ce document',
    approvals: 'Circuit d’approbation',
    approvedBy: 'approuvé par',
    page: 'Page',
    of: 'sur',
    watermark: 'BROUILLON',
    internal: 'interne',
    external: 'externe',
    locale: 'fr-FR',
  },
};

const INK = '#1c2c70';
const ACCENT = '#2747dc';
const SEAL = '#ec9a1c';
const TEXT = '#1f2937';
const MUTED = '#6b7280';
const LINE = '#d8dce6';

const A4 = { width: 595.28, height: 841.89 };
const M = { top: 78, bottom: 64, side: 60 };

/** Statuses before approval get a DRAFT watermark: that text is not yet agreed. */
const DRAFT_STATUSES = new Set(['DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'REJECTED']);

/**
 * The built-in PDF fonts only cover Windows-1252. Accented Latin text (French
 * included) is fine; anything else is mapped to a close equivalent or '?',
 * instead of rendering as garbage.
 */
function safe(text: string): string {
  return text
    .replace(/[   ]/g, ' ')
    .replace(/[≥]/g, '>=')
    .replace(/[≤]/g, '<=')
    .replace(/[→]/g, '->')
    .replace(/[✓✔]/g, 'v')
    .replace(/[^\u0009\u000a\u000d -~ -ÿ€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ]/g, '?');
}

export function renderContractPdf(data: ContractPdfData): Promise<Buffer> {
  const L = LABELS[data.lang];
  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: M.top, bottom: M.bottom, left: M.side, right: M.side },
    bufferPages: true,
    info: {
      Title: safe(`${data.reference} ${data.title}`),
      Author: safe(data.company),
      Subject: safe(L.types[data.type] ?? data.type),
      Creator: 'Contract Hub',
    },
  });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  const width = A4.width - 2 * M.side;
  const fmtDate = (d: Date | null) =>
    d ? d.toLocaleDateString(L.locale, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }) : L.notSet;
  const fmtDateTime = (d: Date) =>
    `${d.toLocaleString(L.locale, { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })} UTC`;
  const money =
    data.value === null
      ? L.notSet
      : new Intl.NumberFormat(data.lang === 'fr' ? 'fr-FR' : 'en-US', { style: 'currency', currency: data.currency }).format(Number(data.value));

  const ensureSpace = (h: number) => {
    if (doc.y + h > A4.height - M.bottom) doc.addPage();
  };
  const sectionTitle = (text: string) => {
    ensureSpace(60);
    doc.moveDown(1.2);
    doc.font('Helvetica-Bold').fontSize(9).fillColor(ACCENT).text(safe(text.toUpperCase()), M.side, doc.y, { characterSpacing: 1.2, width });
    const y = doc.y + 4;
    doc.moveTo(M.side, y).lineTo(M.side + width, y).lineWidth(0.6).strokeColor(LINE).stroke();
    doc.y = y + 10;
  };

  // --- Title block -----------------------------------------------------------
  doc.font('Helvetica-Bold').fontSize(9).fillColor(SEAL).text(safe((L.types[data.type] ?? data.type).toUpperCase()), { characterSpacing: 1.5 });
  doc.moveDown(0.3);
  doc.font('Helvetica-Bold').fontSize(22).fillColor(INK).text(safe(data.title), { width });
  doc.moveDown(0.3);
  doc
    .font('Helvetica')
    .fontSize(9.5)
    .fillColor(MUTED)
    .text(safe(`${data.reference}  ·  ${L.version} ${data.versionNumber}  ·  ${L.generated} ${fmtDate(data.generatedAt)}`));

  // --- Parties -----------------------------------------------------------------
  sectionTitle(L.parties);
  const partyTop = doc.y;
  const colW = (width - 16) / 2;
  const party = (x: number, heading: string, lines: [string, string][]) => {
    doc.font('Helvetica').fontSize(8).fillColor(MUTED).text(safe(heading.toUpperCase()), x + 12, partyTop + 12, { width: colW - 24, characterSpacing: 1 });
    doc.font('Helvetica-Bold').fontSize(12).fillColor(TEXT).text(safe(lines[0]![1]), x + 12, doc.y + 3, { width: colW - 24 });
    for (const [label, value] of lines.slice(1)) {
      if (!value) continue;
      doc.font('Helvetica').fontSize(9).fillColor(MUTED).text(safe(`${label}${L.colon}`), x + 12, doc.y + 3, { continued: true, width: colW - 24 });
      doc.fillColor(TEXT).text(safe(value));
    }
    return doc.y;
  };
  const leftEnd = party(M.side, L.between, [
    ['', data.company],
    [L.department, data.department],
    [L.representedBy, `${data.owner.name} (${data.owner.email})`],
  ]);
  const rightEnd = party(M.side + colW + 16, L.and, [
    ['', data.counterparty.name],
    [L.registration, data.counterparty.registrationNumber ?? ''],
    [L.contact, [data.counterparty.contactName, data.counterparty.email].filter(Boolean).join(', ')],
  ]);
  const partyH = Math.max(leftEnd, rightEnd) - partyTop + 12;
  doc.roundedRect(M.side, partyTop, colW, partyH, 6).lineWidth(0.8).strokeColor(LINE).stroke();
  doc.roundedRect(M.side + colW + 16, partyTop, colW, partyH, 6).stroke();
  doc.x = M.side;
  doc.y = partyTop + partyH + 4;

  // --- Key terms -----------------------------------------------------------------
  sectionTitle(L.keyTerms);
  const terms: [string, string][] = [
    [L.value, money],
    [L.start, fmtDate(data.startDate)],
    [L.end, fmtDate(data.endDate)],
    [L.renewal, data.autoRenew ? L.autoRenew : L.manualRenew],
  ];
  const cellW = width / 4;
  const termsTop = doc.y;
  doc.rect(M.side, termsTop, width, 44).fillColor('#f4f6fb').fill();
  terms.forEach(([label, value], i) => {
    const x = M.side + i * cellW + 10;
    doc.font('Helvetica').fontSize(7.5).fillColor(MUTED).text(safe(label.toUpperCase()), x, termsTop + 9, { width: cellW - 16, characterSpacing: 0.6 });
    doc.font('Helvetica-Bold').fontSize(10).fillColor(TEXT).text(safe(value), x, termsTop + 22, { width: cellW - 16 });
  });
  doc.x = M.side;
  doc.y = termsTop + 44;

  // --- Clauses -----------------------------------------------------------------
  sectionTitle(L.terms);
  if (data.clauses.length === 0 && data.document) {
    doc.font('Times-Roman').fontSize(11).fillColor(TEXT).text(safe(L.documentTerms(data.document.name, data.document.sha256)), { width, align: 'justify' });
  }
  data.clauses.forEach((c, i) => {
    ensureSpace(48);
    doc.font('Helvetica-Bold').fontSize(11).fillColor(INK).text(safe(`${i + 1}.  ${c.heading}`), M.side, doc.y, { width });
    doc.moveDown(0.25);
    doc.font('Times-Roman').fontSize(11).fillColor(TEXT).text(safe(c.body), M.side + 16, doc.y, { width: width - 16, align: 'justify', lineGap: 2 });
    doc.moveDown(0.8);
  });

  // --- Signatures -----------------------------------------------------------------
  if (data.signers.length) {
    sectionTitle(L.signatures);
    doc.font('Times-Italic').fontSize(10.5).fillColor(MUTED).text(safe(L.signaturesIntro), M.side, doc.y, { width });
    doc.moveDown(0.8);
    const boxW = (width - 16) / 2;
    const boxH = 130;
    const ordered = [...data.signers].sort((a, b) => a.order - b.order);
    for (let i = 0; i < ordered.length; i += 2) {
      ensureSpace(boxH + 12);
      const rowTop = doc.y;
      ordered.slice(i, i + 2).forEach((s, j) => signatureBox(s, M.side + j * (boxW + 16), rowTop, boxW, boxH));
      doc.x = M.side;
      doc.y = rowTop + boxH + 12;
    }
  }

  function signatureBox(s: PdfSigner, x: number, y: number, w: number, h: number) {
    doc.roundedRect(x, y, w, h, 6).lineWidth(0.8).strokeColor(s.status === 'SIGNED' ? '#9fd8b8' : LINE).stroke();
    doc.font('Helvetica').fontSize(7.5).fillColor(MUTED).text(safe((s.internal ? L.forCompany(data.company) : L.forCounterparty).toUpperCase()), x + 12, y + 10, { width: w - 24, characterSpacing: 0.8 });
    doc.font('Helvetica-Bold').fontSize(10.5).fillColor(TEXT).text(safe(s.name), x + 12, y + 23, { width: w - 24 });
    doc.font('Helvetica').fontSize(8).fillColor(MUTED).text(safe(s.email), x + 12, y + 37, { width: w - 24 });

    const sigTop = y + 52;
    const sigH = 42;
    if (s.status === 'SIGNED' && s.method === 'DRAWN' && s.signatureImage) {
      try {
        doc.image(s.signatureImage, x + 12, sigTop, { fit: [w - 24, sigH], valign: 'center' });
      } catch {
        /* an unreadable image still leaves the certificate evidence */
      }
    } else if (s.status === 'SIGNED' && s.typedSignature) {
      doc.font('Times-BoldItalic').fontSize(22).fillColor('#10205e').text(safe(s.typedSignature), x + 12, sigTop + 10, { width: w - 24, lineBreak: false, ellipsis: true });
    }
    const lineY = sigTop + sigH + 4;
    doc.moveTo(x + 12, lineY).lineTo(x + w - 12, lineY).lineWidth(0.6).strokeColor('#9aa3b5').stroke();
    let status: string;
    let color = MUTED;
    if (s.status === 'SIGNED' && s.signedAt) {
      status = `${L.signedOn} ${fmtDateTime(s.signedAt)}`;
      color = '#047857';
    } else if (s.status === 'DECLINED') {
      status = L.declined;
      color = '#be123c';
    } else {
      status = `${L.signature} / ${L.date}  ·  ${L.pending}`;
    }
    doc.font('Helvetica').fontSize(7.5).fillColor(color).text(safe(status), x + 12, lineY + 6, { width: w - 24 });
  }

  // --- Signature certificate -----------------------------------------------------------------
  const signed = data.signers.filter((s) => s.status === 'SIGNED');
  if (signed.length) {
    doc.addPage();
    doc.font('Helvetica-Bold').fontSize(18).fillColor(INK).text(safe(L.certificate));
    doc.moveDown(0.4);
    doc.font('Helvetica').fontSize(9.5).fillColor(MUTED).text(safe(L.certificateIntro), { width });
    doc.moveDown(1);
    doc.font('Helvetica').fontSize(7.5).fillColor(MUTED).text(safe(L.fingerprint.toUpperCase()), { characterSpacing: 0.8 });
    doc.font('Courier').fontSize(9).fillColor(TEXT).text(data.contentHash);
    for (const s of signed) {
      sectionTitle(`${L.signer}${L.colon}${s.name}`);
      const rows: [string, string][] = [
        ['Email', `${s.email} (${s.internal ? L.internal : L.external})`],
        [L.method, s.method === 'DRAWN' ? L.drawn : `${L.typed}${L.colon}"${s.typedSignature ?? ''}"`],
        [L.date, s.signedAt ? fmtDateTime(s.signedAt) : ''],
        [L.ip, s.ipAddress ?? '-'],
        [L.device, (s.userAgent ?? '-').slice(0, 110)],
        [L.integrity, s.signedContentHash === data.contentHash ? L.matches : L.mismatch],
      ];
      for (const [label, value] of rows) {
        const top = doc.y;
        doc.font('Helvetica').fontSize(8.5).fillColor(MUTED).text(safe(label), M.side, top, { width: 110 });
        doc.font('Helvetica').fontSize(8.5).fillColor(label === L.integrity && s.signedContentHash !== data.contentHash ? '#be123c' : TEXT).text(safe(value), M.side + 115, top, { width: width - 115 });
        doc.y = Math.max(doc.y, top + 12) + 3;
      }
    }
    if (data.approvals.length) {
      sectionTitle(L.approvals);
      for (const a of data.approvals) {
        doc.font('Helvetica').fontSize(8.5).fillColor(TEXT).text(safe(`${a.step} — ${L.approvedBy} ${a.decidedBy}, ${fmtDateTime(a.decidedAt)}`), M.side, doc.y, { width });
        doc.moveDown(0.25);
      }
    }
  }

  // --- Letterhead, footer and watermark on every page -----------------------------------------------------------------
  const range = doc.bufferedPageRange();
  for (let p = range.start; p < range.start + range.count; p++) {
    doc.switchToPage(p);
    // Keep header/footer text from triggering automatic page breaks.
    const bottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;

    doc.roundedRect(M.side, 30, 18, 18, 4).fillColor(ACCENT).fill();
    doc.rect(M.side + 5, 35, 8, 9).fillColor('#ffffff').fill();
    doc.circle(M.side + 15, 44, 3.2).fillColor(SEAL).fill();
    doc.font('Helvetica-Bold').fontSize(10).fillColor(INK).text('Contract', M.side + 24, 34, { continued: true, lineBreak: false });
    doc.fillColor(ACCENT).text('Hub', { lineBreak: false });
    doc.font('Helvetica').fontSize(8.5).fillColor(MUTED).text(safe(data.reference), M.side, 35, { width, align: 'right', lineBreak: false });
    doc.moveTo(M.side, 56).lineTo(M.side + width, 56).lineWidth(0.6).strokeColor(LINE).stroke();

    const footY = A4.height - 40;
    doc.moveTo(M.side, footY - 8).lineTo(M.side + width, footY - 8).lineWidth(0.4).strokeColor(LINE).stroke();
    doc
      .font('Helvetica')
      .fontSize(7.5)
      .fillColor(MUTED)
      .text(safe(`${data.reference} · ${L.version} ${data.versionNumber} · SHA-256 ${data.contentHash.slice(0, 16)}…`), M.side, footY, { width: width - 80, lineBreak: false });
    doc.text(safe(`${L.page} ${p - range.start + 1} ${L.of} ${range.count}`), M.side, footY, { width, align: 'right', lineBreak: false });

    if (DRAFT_STATUSES.has(data.status)) {
      doc.save();
      doc.rotate(-35, { origin: [A4.width / 2, A4.height / 2] });
      doc.font('Helvetica-Bold').fontSize(96).fillColor(ACCENT).fillOpacity(0.06).text(L.watermark, 0, A4.height / 2 - 50, { width: A4.width, align: 'center', lineBreak: false });
      doc.restore();
      doc.fillOpacity(1);
    }
    doc.page.margins.bottom = bottom;
  }

  doc.end();
  return done;
}
