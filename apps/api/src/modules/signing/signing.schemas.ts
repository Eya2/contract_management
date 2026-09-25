import { z } from 'zod';

const InternalSigner = z.object({ userId: z.uuid(), signingOrder: z.number().int().min(1).max(10).default(1) }).strict();
const ExternalSigner = z
  .object({
    name: z.string().trim().min(2).max(200),
    email: z.email().max(254).transform((e) => e.toLowerCase()),
    signingOrder: z.number().int().min(1).max(10).default(1),
  })
  .strict();

export const SignersBody = z.object({
  signers: z.array(z.union([InternalSigner, ExternalSigner])).min(1).max(20),
});
export type SignersBody = z.infer<typeof SignersBody>;

/** A drawn signature arrives as a PNG data URL from the signature pad (max ~300 KB). */
const PngDataUrl = z
  .string()
  .max(400_000)
  .regex(/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/, 'Must be a PNG data URL');

export const SignBody = z
  .object({
    /**
     * The content hash displayed to the signer. If the contract changed after
     * they opened it, the hashes differ and the signature is refused: nobody
     * signs something they didn't see.
     */
    contentHash: z.string().regex(/^[0-9a-f]{64}$/),
    method: z.enum(['TYPED', 'DRAWN']),
    typedName: z.string().trim().min(2).max(200).optional(),
    signatureImage: PngDataUrl.optional(),
    /** Explicit consent to sign electronically. */
    consent: z.literal(true, { error: 'You must agree to sign electronically' }),
  })
  .refine((b) => (b.method === 'TYPED' ? !!b.typedName : !!b.signatureImage), {
    message: 'Provide a typed name or a drawn signature',
    path: ['method'],
  });
export type SignBody = z.infer<typeof SignBody>;

export const DeclineBody = z.object({ reason: z.string().trim().min(3).max(2000) });
export const TokenParams = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) });
