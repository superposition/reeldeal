import type { Database } from 'bun:sqlite';
import { db } from '../db';
import { listingWire, timestamp, type ListingRow } from './lot-service';
import { json, options } from './stub';

type MarketRow = ListingRow & {
  species_label: string | null; weight_g: number | null; length_mm: number | null;
  human_corrected: number; lot_status: string;
  captured_at: number; image_ref: string;
  decision_id: string; confidence: number; model_id: string;
};

export function getListings(database: Database, request: Request): Response {
  const filters = new URL(request.url).searchParams;
  const org = filters.get('org')?.trim() ?? '';
  const status = filters.get('status')?.trim() ?? '';
  const category = filters.get('category')?.trim() ?? '';
  if (org.length > 80 || !/^[a-z0-9-]*$/.test(org) ||
      (status && !['open', 'accepted', 'settled', 'cancelled'].includes(status)) ||
      category.length > 80) return json({ error: 'invalid_filter' }, 400);

  const correctedSpecies = `(SELECT json_extract(c.human_value, '$') FROM corrections c
    WHERE c.lot_id = l.id AND c.field = 'species_label' ORDER BY c.created_at DESC, c.rowid DESC LIMIT 1)`;
  const rows = database.query(`SELECT li.*,
      coalesce(${correctedSpecies}, l.species_label) AS species_label,
      coalesce((SELECT json_extract(c.human_value, '$') FROM corrections c
        WHERE c.lot_id = l.id AND c.field = 'weight_g' ORDER BY c.created_at DESC, c.rowid DESC LIMIT 1), l.weight_g) AS weight_g,
      coalesce((SELECT json_extract(c.human_value, '$') FROM corrections c
        WHERE c.lot_id = l.id AND c.field = 'length_mm' ORDER BY c.created_at DESC, c.rowid DESC LIMIT 1),
        json_extract(o.payload_json, '$.length_mm')) AS length_mm,
      EXISTS(SELECT 1 FROM corrections c WHERE c.lot_id = l.id) AS human_corrected,
      l.status AS lot_status, s.captured_at, s.image_ref,
      d.id AS decision_id, d.confidence, d.model_id
    FROM listings li
    JOIN lots l ON l.id = li.lot_id
    JOIN fish_scans s ON s.id = l.scan_id
    JOIN decisions d ON d.id = l.decision_id
    JOIN observations o ON o.id = d.observation_id
    JOIN orgs org ON org.id = li.seller_org_id
    WHERE (? = '' OR org.slug = ?) AND (? = '' OR li.status = ?)
      AND (? = '' OR lower(coalesce(${correctedSpecies}, l.species_label)) = lower(?))
    ORDER BY li.created_at DESC, li.id DESC LIMIT 100`).all(org, org, status, status, category, category) as MarketRow[];
  const open = database.query(`SELECT COUNT(*) AS count FROM listings li
    JOIN orgs org ON org.id = li.seller_org_id
    WHERE li.status = 'open' AND (? = '' OR org.slug = ?)`).get(org, org) as { count: number };
  return json({
    listings: rows.map((row) => {
      const image = /^data:image\/(?:jpeg|png|webp|avif);base64,[a-z0-9+/=]+$/i.test(row.image_ref)
        ? row.image_ref : null;
      return {
        ...listingWire(row), species_label: row.species_label, weight_g: row.weight_g,
        length_mm: row.length_mm, human_corrected: Boolean(row.human_corrected), lot_status: row.lot_status,
        captured_at: timestamp(row.captured_at), image_ref: image,
        decision_id: row.decision_id, confidence: row.confidence, model_id: row.model_id,
        demo: row.id.startsWith('demo-listing-'),
      };
    }),
    open_count: open.count,
    filters: { org: org || null, status: status || null, category: category || null },
  });
}

export function makeListingRoutes(database: Database) {
  return {
    '/v1/listings': { GET: (request: Request) => getListings(database, request), OPTIONS: options },
  };
}

export const listingRoutes = makeListingRoutes(db);
