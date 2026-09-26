import { describe, expect, it } from 'vitest';
import { compactPrefs, resolvePrefs, UpdatePrefsBody, wants } from './preferences.js';

describe('notification preferences', () => {
  it('turns every channel on by default', () => {
    expect(wants({}, 'CONTRACT_SIGNED', 'email')).toBe(true);
    expect(wants(null, 'CONTRACT_SIGNED', 'inApp')).toBe(true);
  });

  it('respects a channel switched off for one type only', () => {
    const prefs = { CONTRACT_SIGNED: { email: false } };
    expect(wants(prefs, 'CONTRACT_SIGNED', 'email')).toBe(false);
    expect(wants(prefs, 'CONTRACT_SIGNED', 'inApp')).toBe(true);
    expect(wants(prefs, 'APPROVAL_REQUESTED', 'email')).toBe(true);
  });

  it('resolves every type for the settings screen', () => {
    const all = resolvePrefs({ APPROVAL_GRANTED: { inApp: false } });
    expect(all.APPROVAL_GRANTED).toEqual({ email: true, inApp: false });
    expect(all.CONTRACT_EXPIRING).toEqual({ email: true, inApp: true });
  });

  it('stores only what is switched off', () => {
    expect(
      compactPrefs({ CONTRACT_SIGNED: { email: false, inApp: true }, APPROVAL_REQUESTED: { email: true, inApp: true } }),
    ).toEqual({ CONTRACT_SIGNED: { email: false } });
  });

  it('rejects unknown notification types', () => {
    expect(UpdatePrefsBody.safeParse({ prefs: { NOPE: { email: true, inApp: true } }, dailyDigest: false }).success).toBe(false);
  });
});
