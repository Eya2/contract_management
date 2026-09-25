import { z } from 'zod';

export const LoginBody = z.object({
  email: z.email().max(254).transform((e) => e.toLowerCase()),
  password: z.string().min(1).max(200),
});
export type LoginBody = z.infer<typeof LoginBody>;
