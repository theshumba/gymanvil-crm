// Pure transform: a row of the lead engine's final_callsheet.csv -> a Gym Anvil lead.
// No I/O, so it stays unit-testable. Mirrors the app's normalizeLead shape.
//
// The lead engine (~/Desktop/Projects/GymAnvil/leads) already did the hard part:
// chains filtered out, booking software detected, Companies House owner resolved,
// a tier and a suggested pitch computed. This maps that onto the CRM's fields:
//   software (their platform)      -> funnelLeak   (the problem to lead with)
//   pitch (engine's opener)        -> outreachAngle(the personalised line in drafts)
//   ch_directors (Companies House) -> ownerName    (who to ask for)
//   tier/wedge                     -> segment      (drives WA + email templates)

// Full member-management platforms: the strongest wedge. A gym here is paying
// monthly for exactly the template software Gym Anvil replaces.
export const FULL_PLATFORMS = new Set([
  'Mindbody', 'Glofox', 'TeamUp', 'ClubRight', 'ClubWise', 'Ashbourne', 'Legend',
  'Gladstone', 'PerfectGym', 'Xplor Gym', 'EZFacility', 'Virtuagym', 'Fisikal',
  'Membr', 'Hapana', 'Wodify', 'Zen Planner', 'PushPress', 'Gymcatch', 'Gymflow',
]);

// Deal value by wedge — what this lead is realistically worth to Gym Anvil.
// Anchored on the pricing in 03-SERVICES: Forge Audit 450, builds 3.5k-30k.
const DEAL_VALUE = {
  on_platform: 6500,     // replace their platform + app: the big build
  whitelabel_app: 6000,  // already paying for an app, swap it for a real one
  dated_site: 3500,      // site rebuild, often the door opener
  no_app: 4500,          // greenfield app
  phone_only: 1500,      // thin, likely audit-only
};

export function deriveSegment(row) {
  const sw = (row.software || '').trim();
  const onPlatform = FULL_PLATFORMS.has(sw);
  const whitelabel = String(row.app_whitelabel || '').startsWith('YES');
  const live = row.website_status === 'LIVE_OK' || row.website_status === 'LIVE_DATED';
  if (onPlatform) return 'on_platform';
  if (whitelabel) return 'whitelabel_app';
  if (row.website_status === 'LIVE_DATED') return 'dated_site';
  if (live) return 'no_app';
  return 'phone_only';
}

function hashStr(s) { let h = 0; for (let i = 0; i < (s || '').length; i++) { h = (h * 31 + s.charCodeAt(i)) | 0; } return h; }
export function slugId(name, website) {
  const base = (name || 'lead').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
  // Hash name+website so re-imports are idempotent and two gyms sharing a name
  // (common: "The Gym", "CrossFit X") never collide onto one doc.
  return base + '-' + Math.abs(hashStr((name || '') + '|' + (website || ''))).toString(36).slice(0, 6);
}

// "SMITH, Matthew John" -> "Matthew Smith" (Companies House order is surname-first).
export function tidyOwner(raw, confidence) {
  const first = String(raw || '').split(';')[0].trim();
  if (!first) return '';
  // LOW-confidence matches may be the wrong company entirely — don't put a
  // stranger's name in front of Melusi on a call.
  if (String(confidence || '').toUpperCase() !== 'HIGH') return '';
  const m = first.match(/^([A-Z'\-]+),\s*(.+)$/);
  if (!m) return titleCase(first);
  const surname = titleCase(m[1]);
  const forename = titleCase(m[2].split(/\s+/)[0]);
  return (forename + ' ' + surname).trim();
}
function titleCase(s) {
  return String(s || '').toLowerCase().replace(/\b([a-z])/g, (c) => c.toUpperCase());
}

// The engine's pitch ends with "; ask for SURNAME, Forename" — raw Companies House
// order, and redundant once ownerName is its own field. Strip it, and drop the
// internal shorthand so the line reads as something Melusi could actually say.
export function tidyPitch(pitch) {
  let p = String(pitch || '').trim();
  p = p.replace(/;?\s*ask for [^;]+/i, '');
  p = p.replace(/\s*\(template software GA replaces\)/i, ', which is off the shelf template software');
  p = p.replace(/\s*—\s*/g, ', ').replace(/\s*–\s*/g, ', ');
  p = p.replace(/\s*;\s*/g, '; ').replace(/;\s*$/, '').replace(/,\s*,/g, ',').trim();
  return p;
}

// UK region from the scraped address tail, for filtering the call list.
export function deriveRegion(location) {
  const parts = String(location || '').split(',').map((p) => p.trim()).filter(Boolean);
  if (!parts.length) return '';
  // Last part is usually "Town POSTCODE" or the postcode itself.
  const tail = parts[parts.length - 1];
  const town = tail.replace(/\b[A-Z]{1,2}\d[A-Z\d]?\s*\d?[A-Z]{0,2}\b/gi, '').trim();
  return town || (parts.length > 1 ? parts[parts.length - 2] : '');
}

function num(v) { const n = parseFloat(String(v || '').replace(/,/g, '')); return Number.isFinite(n) ? n : 0; }

export function csvRowToLead(row) {
  const website = (row.website || '').trim();
  const name = (row.name || '').trim();
  const segment = deriveSegment(row);
  const platform = (row.software || '').trim();
  const onPlatform = FULL_PLATFORMS.has(platform);
  const emailOk = row.email_status === 'MX_OK';
  const phoneOk = String(row.phone_status || '').startsWith('VALID');

  const emails = emailOk && row.email ? [{ address: row.email.trim() }] : [];
  const phones = phoneOk && row.phone ? [{ number: row.phone.trim() }] : [];

  // The problem to lead with, in plain words.
  let funnelLeak = '';
  if (onPlatform) funnelLeak = `runs ${platform}, an off the shelf member platform`;
  else if (segment === 'whitelabel_app') funnelLeak = `member app is a white label (${String(row.app_whitelabel).slice(4)})`;
  else if (segment === 'dated_site') funnelLeak = 'website is dated and undersells the club';
  else if (segment === 'no_app') funnelLeak = 'no member app, retention rests on the front desk';
  if (row.review_complaints) {
    funnelLeak += (funnelLeak ? '; ' : '') + 'members complain about the booking system in reviews';
  }

  const rating = num(row.rating), reviews = num(row.reviews);

  return {
    id: slugId(name, website),
    businessName: name,
    description: (row.description || '').trim(),
    industry: (row.category || 'Gym').trim(),
    country: 'United Kingdom',
    region: deriveRegion(row.location),
    address: (row.location || '').trim(),
    segment,
    platform,                                   // shown in WA/email templates
    website,
    emails, phones,
    whatsapp: '',
    ownerName: tidyOwner(row.ch_directors, row.ch_confidence),
    funnelLeak,
    outreachAngle: tidyPitch(row.pitch),        // engine's suggested opener
    // Gym-specific intel surfaced on the card / used by the AI brain.
    gym: {
      rating, reviews,
      facilities: (row.facilities || '').trim(),
      founded: (row.founded_claim || '').trim(),
      team: (row.team_names || '').trim(),
      appIos: (row.app_ios || '').trim(),
      appAndroid: (row.app_android || '').trim(),
      whitelabel: (row.app_whitelabel || '').trim(),
      complaints: (row.review_complaints || '').trim(),
      websiteStatus: (row.website_status || '').trim(),
      tier: (row.tier || '').trim(),
      score: num(row.premium_score),
      chNumber: (row.ch_number || '').trim(),
      chStatus: (row.ch_status || '').trim(),
      chIncorporated: (row.ch_incorporated || '').trim(),
      chDirectorsRaw: (row.ch_directors || '').trim(),
      chConfidence: (row.ch_confidence || '').trim(),
    },
    contacts: [], activity: [], researchChecklist: [],
    source: 'lead-engine',
    status: 'unqualified',                      // computeQualification decides below
    qualification: null,
    crm: {
      notes: [],
      priority: row.tier === 'PRIME' ? 'high' : (row.tier === 'A' || row.tier === 'B' ? 'medium' : 'low'),
      disposition: '',
      dealValue: DEAL_VALUE[segment] || 3000,
      outcomeReason: '',
      stage: 1,
    },
  };
}

// Mirrors the app's computeQualification: reachable AND we know who/why to call.
// Gym version: a UK independent with a phone or email, and something to say.
export function qualifies(lead) {
  const reachable = (lead.phones && lead.phones.length) || (lead.emails && lead.emails.length) || lead.whatsapp;
  if (!reachable) return { ok: false, reason: 'no phone, email or whatsapp on file' };
  const hasAngle = !!(lead.outreachAngle || lead.funnelLeak);
  const named = !!lead.ownerName;
  if (!hasAngle && !named) return { ok: false, reason: 'no owner name and no angle to open with' };
  const bits = [];
  if (named) bits.push('named owner');
  if (lead.platform) bits.push('on ' + lead.platform);
  if (hasAngle) bits.push('angle on file');
  return { ok: true, reason: bits.join(' + ') };
}
