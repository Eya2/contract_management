/**
 * Demo data. Idempotent: safe to run repeatedly (upserts by unique keys).
 *
 * Every demo account uses the password below. Contracts, workflow templates and
 * approvals are added to this seed in later steps.
 */
import { prisma } from '../src/lib/prisma.js';
import { hashPassword } from '../src/modules/auth/password.js';
import type { Role } from '../src/generated/prisma/enums.js';

export const DEMO_PASSWORD = 'Demo1234!';

const departments = [
  { code: 'LEG', name: 'Legal' },
  { code: 'FIN', name: 'Finance' },
  { code: 'SAL', name: 'Sales' },
  { code: 'PRC', name: 'Procurement' },
  { code: 'OPS', name: 'Operations' },
] as const;

type DeptCode = (typeof departments)[number]['code'];

const users: { email: string; firstName: string; lastName: string; role: Role; dept: DeptCode; head?: boolean }[] = [
  { email: 'admin@contracthub.dev', firstName: 'Alex', lastName: 'Morgan', role: 'ADMIN', dept: 'OPS', head: true },
  { email: 'legal@contracthub.dev', firstName: 'Leila', lastName: 'Haddad', role: 'LEGAL', dept: 'LEG', head: true },
  { email: 'legal2@contracthub.dev', firstName: 'Karim', lastName: 'Mansour', role: 'LEGAL', dept: 'LEG' },
  { email: 'finance@contracthub.dev', firstName: 'Farah', lastName: 'Ben Ali', role: 'FINANCE', dept: 'FIN', head: true },
  { email: 'sales.manager@contracthub.dev', firstName: 'Sarah', lastName: 'Collins', role: 'MANAGER', dept: 'SAL', head: true },
  { email: 'sales@contracthub.dev', firstName: 'Sami', lastName: 'Trabelsi', role: 'EMPLOYEE', dept: 'SAL' },
  { email: 'procurement.manager@contracthub.dev', firstName: 'Omar', lastName: 'Khalil', role: 'MANAGER', dept: 'PRC', head: true },
  { email: 'procurement@contracthub.dev', firstName: 'Nour', lastName: 'Saidi', role: 'EMPLOYEE', dept: 'PRC' },
];

async function main() {
  const passwordHash = await hashPassword(DEMO_PASSWORD);

  const deptIds = new Map<DeptCode, string>();
  for (const d of departments) {
    const dept = await prisma.department.upsert({ where: { code: d.code }, update: { name: d.name }, create: d });
    deptIds.set(d.code, dept.id);
  }

  for (const u of users) {
    const departmentId = deptIds.get(u.dept)!;
    const user = await prisma.user.upsert({
      where: { email: u.email },
      update: { firstName: u.firstName, lastName: u.lastName, role: u.role, departmentId, isActive: true },
      create: { email: u.email, firstName: u.firstName, lastName: u.lastName, role: u.role, departmentId, passwordHash },
    });
    if (u.head) await prisma.department.update({ where: { id: departmentId }, data: { headId: user.id } });
  }

  console.log(`Seeded ${departments.length} departments and ${users.length} users (password: ${DEMO_PASSWORD})`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
