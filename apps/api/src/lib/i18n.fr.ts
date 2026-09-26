/**
 * French text for the messages the server writes, keyed by the English
 * template (see i18n.ts). A missing entry falls back to English.
 */
export const FR: Record<string, string> = {
  // --- Joiners and small words ---------------------------------------------------
  '{a} and {b}': '{a} et {b}',
  '{a} or {b}': '{a} ou {b}',
  '{a} AND {b}': '{a} ET {b}',
  '{a} OR {b}': '{a} OU {b}',
  'NOT {a}': 'NON {a}',
  '({a})': '({a})',
  yes: 'oui',
  no: 'non',
  'one of': 'parmi',
  '{amount} {currency}': '{amount} {currency}',

  // --- Approval conditions (skip reasons) ------------------------------------------
  value: 'valeur',
  durationDays: 'durée (jours)',
  currency: 'devise',
  type: 'type',
  autoRenew: 'renouvellement automatique',
  '{field} is not set': '{field} n’est pas renseigné(e)',
  '{field} {actual} is {op} {expected}': '{field} {actual} est {op} {expected}',
  '{field} {actual} is not {op} {expected}': '{field} {actual} n’est pas {op} {expected}',
  '{field} {op} {expected}': '{field} {op} {expected}',
  '{reason}, so the step is required': '{reason}, l’étape est donc requise',
  'enum.VENDOR': 'Fournisseur',
  'enum.CLIENT': 'Client',
  'enum.NDA': 'Confidentialité (NDA)',
  'enum.EMPLOYMENT': 'Travail',

  // --- Routing notes -----------------------------------------------------------------
  'Routed to {name} ({label}) because the only eligible {role} is the requester.':
    'Confiée à {name} ({label}) car le seul {role} habilité est le demandeur.',
  'Routed to {name} ({label}) because there is no active {role} who can approve it.':
    'Confiée à {name} ({label}) car aucun {role} actif ne peut l’approuver.',
  'head of {department}': 'responsable {department}',
  admin: 'administrateur',
  Admin: 'Administrateur',
  Legal: 'Juridique',
  Finance: 'Finance',
  Manager: 'Manager',
  Employee: 'Collaborateur',

  // --- Status change reasons -----------------------------------------------------------
  'Start date reached': 'Date de début atteinte',
  'End date reached': 'Date de fin atteinte',
  'All parties signed': 'Toutes les parties ont signé',
  'Signature declined by {name}: {reason}': 'Signature refusée par {name} : {reason}',
  'Final approval: {step}': 'Approbation finale : {step}',
  'First approval: {step}': 'Première approbation : {step}',
  'Withdrawn from review': 'Retiré de la revue',
  'No approval step applies to this contract': 'Aucune étape d’approbation ne s’applique à ce contrat',
  'Continued by {ref}': 'Poursuivi par {ref}',
  'Renewed automatically as {ref}': 'Renouvelé automatiquement sous {ref}',
  'Renewed by {ref}': 'Renouvelé par {ref}',

  // --- Notifications -----------------------------------------------------------------------
  'Approval needed: {ref} {title}': 'Approbation requise : {ref} {title}',
  '"{step}" is waiting for your decision.': '« {step} » attend votre décision.',
  '"{step}" is waiting for your decision (due {due} UTC).': '« {step} » attend votre décision (échéance {due} UTC).',
  'Overdue approval: {ref} {title}': 'Approbation en retard : {ref} {title}',
  '"{step}" has been waiting past its deadline and was escalated to you. You can decide it directly.':
    '« {step} » a dépassé son délai et vous a été escaladée. Vous pouvez décider directement.',
  '{ref} {title} is approved': '{ref} {title} est approuvé',
  '{ref} {title} was rejected': '{ref} {title} a été rejeté',
  '{ref} {title} passed a review step': '{ref} {title} a franchi une étape de revue',
  'No approval step applied, so it was approved automatically.': 'Aucune étape d’approbation ne s’appliquait : il a été approuvé automatiquement.',
  '{who} rejected it at "{step}": {comment}': '{who} l’a rejeté à l’étape « {step} » : {comment}',
  'All approvals are in (last: {who}, "{step}").': 'Toutes les approbations sont réunies (dernière : {who}, « {step} »).',
  '{who} approved "{step}".': '{who} a approuvé « {step} ».',
  'Signature needed: {ref} {title}': 'Signature requise : {ref} {title}',
  'The contract is approved and waiting for your signature.': 'Le contrat est approuvé et attend votre signature.',
  '{ref} {title} is fully signed': '{ref} {title} est entièrement signé',
  'All parties signed. It becomes active on {date}.': 'Toutes les parties ont signé. Il entre en vigueur le {date}.',
  'All parties signed. The contract is now active.': 'Toutes les parties ont signé. Le contrat est en vigueur.',
  '{ref} {title}: signature declined': '{ref} {title} : signature refusée',
  '{name} declined to sign: {reason}. The contract is back in draft.': '{name} a refusé de signer : {reason}. Le contrat repasse en brouillon.',
  '{ref} {title} was terminated': '{ref} {title} a été résilié',
  'Reason: {reason}': 'Motif : {reason}',
  '{ref} {title} ends today': '{ref} {title} se termine aujourd’hui',
  '{ref} {title} ends tomorrow': '{ref} {title} se termine demain',
  '{ref} {title} ends in {n} days': '{ref} {title} se termine dans {n} jours',
  'It renews automatically on {date} unless you act before then.': 'Il se renouvelle automatiquement le {date}, sauf action de votre part d’ici là.',
  'A renewal is in progress but not signed yet.': 'Un renouvellement est en cours mais n’est pas encore signé.',
  'It does not renew automatically. Start a renewal if it should continue.': 'Il ne se renouvelle pas automatiquement. Lancez un renouvellement s’il doit continuer.',
  '{ref} {title} renewed automatically': '{ref} {title} renouvelé automatiquement',
  'A new term runs from {from} to {to} as {ref}, on the same terms.': 'Une nouvelle période court du {from} au {to} sous {ref}, aux mêmes conditions.',
  '{ref} {title} has expired': '{ref} {title} a expiré',
  'Its renewal {ref} is not signed yet.': 'Son renouvellement {ref} n’est pas encore signé.',
  'It ended without renewal. You can still start one.': 'Il s’est terminé sans renouvellement. Vous pouvez encore en lancer un.',

  // --- Emails -----------------------------------------------------------------------------
  'Open in Contract Hub: {url}': 'Ouvrir dans Contract Hub : {url}',
  'Please sign: {title}': 'Signature demandée : {title}',
  'Hello {name},\n\n{title} ({ref}) is ready for your signature. The link is personal and valid for {days} days.':
    'Bonjour {name},\n\n{title} ({ref}) est prêt pour votre signature. Ce lien est personnel et valable {days} jours.',
  'Reset your Contract Hub password': 'Réinitialisez votre mot de passe Contract Hub',
  'Hello {name},\n\nSomeone (hopefully you) asked to reset your Contract Hub password. The link below is valid for one hour and can be used once.\n\nIf you didn’t ask for this, ignore this email: your password stays the same.':
    'Bonjour {name},\n\nQuelqu’un (vous, espérons-le) a demandé à réinitialiser votre mot de passe Contract Hub. Le lien ci-dessous est valable une heure et ne peut servir qu’une fois.\n\nSi vous n’êtes pas à l’origine de cette demande, ignorez cet e-mail : votre mot de passe reste inchangé.',

  // --- Daily summary ------------------------------------------------------------------------
  'Hello {name},': 'Bonjour {name},',
  'Here is your Contract Hub summary for today.': 'Voici votre récapitulatif Contract Hub du jour.',
  'To do': 'À faire',
  '{n} approval waiting for you': '{n} approbation vous attend',
  '{n} approvals waiting for you': '{n} approbations vous attendent',
  '{n} contract to sign': '{n} contrat à signer',
  '{n} contracts to sign': '{n} contrats à signer',
  '{n} rejected contract to revise': '{n} contrat rejeté à réviser',
  '{n} rejected contracts to revise': '{n} contrats rejetés à réviser',
  'Ending in the next {n} days': 'Se terminent dans les {n} prochains jours',
  '{ref} {title}, ends {date}': '{ref} {title}, se termine le {date}',
  'In the last 24 hours': 'Ces dernières 24 heures',
  'You receive this summary because it is on in your account settings.': 'Vous recevez ce récapitulatif car il est activé dans les paramètres de votre compte.',
  'Your Contract Hub summary': 'Votre récapitulatif Contract Hub',
  'Your Contract Hub summary: {n} item to do': 'Votre récapitulatif Contract Hub : {n} élément à traiter',
  'Your Contract Hub summary: {n} items to do': 'Votre récapitulatif Contract Hub : {n} éléments à traiter',
};
