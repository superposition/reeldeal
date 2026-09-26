import type { Database } from 'bun:sqlite';

// Keep the existing intake slug stable; seeded board fixtures are a separate org.
export const INTAKE_ORG_SLUG = 'kessenuma';
export const DEMO_INTAKE_REVIEWER = 'demo-intake-operator';

export function ensureIntakeOrg(database: Database): string {
  const existing = database.query('SELECT id FROM orgs WHERE slug = ?').get(INTAKE_ORG_SLUG) as { id: string } | null;
  if (existing) return existing.id;
  const at = Date.now();
  database.query('INSERT OR IGNORE INTO orgs (id,slug,name,status,created_at,updated_at) VALUES (?,?,?,?,?,?)')
    .run(crypto.randomUUID(), INTAKE_ORG_SLUG, 'Kesennuma demo market', 'active', at, at);
  return (database.query('SELECT id FROM orgs WHERE slug = ?').get(INTAKE_ORG_SLUG) as { id: string }).id;
}

/** Explicit seed-time demo attribution, never authentication or caller provisioning. */
export function seedIntakeReviewer(database: Database): void {
  const org = ensureIntakeOrg(database);
  const existing = database.query('SELECT org_id FROM users WHERE id = ?').get(DEMO_INTAKE_REVIEWER) as { org_id: string } | null;
  if (existing && existing.org_id !== org) throw new Error('Demo intake reviewer belongs to another organization; refusing to reassign');
  const at = Date.now();
  database.query('INSERT OR IGNORE INTO users (id,org_id,label,wallet,role,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)')
    .run(DEMO_INTAKE_REVIEWER, org, 'Demo intake reviewer (not authenticated)', null, 'operator', 'active', at, at);
}
