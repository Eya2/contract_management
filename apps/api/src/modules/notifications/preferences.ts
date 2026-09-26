import { z } from 'zod';
import { NotificationType } from '../../generated/prisma/enums.js';

/**
 * Which channels a user wants per notification type. Stored sparsely on the
 * user row: only switched-off channels need an entry, so a new notification
 * type is on by default for everyone.
 */
export type Channel = 'email' | 'inApp';
export type ChannelPrefs = Record<Channel, boolean>;
export type NotificationPrefs = Partial<Record<NotificationType, Partial<ChannelPrefs>>>;

export const NOTIFICATION_TYPES = Object.values(NotificationType);

export function wants(prefs: unknown, type: NotificationType, channel: Channel): boolean {
  const entry = (prefs as NotificationPrefs | null)?.[type];
  return entry?.[channel] !== false;
}

/** Every type with both channels spelled out, for the settings screen. */
export function resolvePrefs(prefs: unknown): Record<NotificationType, ChannelPrefs> {
  return Object.fromEntries(NOTIFICATION_TYPES.map((t) => [t, { email: wants(prefs, t, 'email'), inApp: wants(prefs, t, 'inApp') }])) as Record<
    NotificationType,
    ChannelPrefs
  >;
}

export const UpdatePrefsBody = z.object({
  prefs: z.partialRecord(z.enum(NotificationType), z.object({ email: z.boolean(), inApp: z.boolean() })),
  dailyDigest: z.boolean(),
});

/** Keeps only the switched-off channels. */
export function compactPrefs(prefs: z.infer<typeof UpdatePrefsBody>['prefs']): NotificationPrefs {
  const out: NotificationPrefs = {};
  for (const [type, c] of Object.entries(prefs) as [NotificationType, ChannelPrefs][]) {
    if (!c.email || !c.inApp) out[type] = { ...(c.email ? {} : { email: false }), ...(c.inApp ? {} : { inApp: false }) };
  }
  return out;
}
