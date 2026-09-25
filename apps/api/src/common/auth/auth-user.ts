import type { Role } from '../../generated/prisma/enums.js';

/** The authenticated principal, decoded from the access token. */
export interface AuthUser {
  id: string;
  email: string;
  role: Role;
  departmentId: string;
}
