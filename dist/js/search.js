import { geocode, overpass } from './net.js';

// value → [label, overpass tag filters]
export const CATEGORIES = {
  all: ['All business types', null],
  restaurant: ['Restaurants', ['amenity=restaurant', 'amenity=fast_food']],
  cafe: ['Cafes & coffee', ['amenity=cafe', 'shop=coffee']],
  bar: ['Bars & pubs', ['amenity=bar', 'amenity=pub']],
  bakery: ['Bakeries & desserts', ['shop=bakery', 'shop=pastry', 'amenity=ice_cream', 'shop=confectionery']],
  hairdresser: ['Hair salons & barbers', ['shop=hairdresser']],
  beauty: ['Beauty, nails & spa', ['shop=beauty', 'shop=cosmetics', 'leisure=spa', 'shop=massage']],
  dentist: ['Dentists', ['amenity=dentist', 'healthcare=dentist']],
  doctor: ['Doctors & clinics', ['amenity=doctors', 'amenity=clinic', 'healthcare=doctor', 'healthcare=physiotherapist', 'healthcare=optometrist']],
  veterinary: ['Vets & pet care', ['amenity=veterinary', 'shop=pet', 'shop=pet_grooming']],
  car_repair: ['Auto repair & dealers', ['shop=car_repair', 'shop=car', 'shop=tyres', 'amenity=car_wash']],
  trades: ['Trades (plumbing, HVAC, electric…)', ['craft=plumber', 'craft=electrician', 'craft=hvac', 'craft=roofer', 'craft=carpenter', 'craft=painter', 'craft=builder', 'office=construction_company']],
  professional: ['Lawyers, accountants & agents', ['office=lawyer', 'office=accountant', 'office=estate_agent', 'office=insurance', 'office=financial', 'office=tax_advisor']],
  fitness: ['Gyms & studios', ['leisure=fitness_centre', 'leisure=sports_centre', 'shop=sports']],
  retail: ['Boutiques & retail', ['shop=clothes', 'shop=gift', 'shop=jewelry', 'shop=florist', 'shop=furniture', 'shop=shoes', 'shop=books']],
  home: ['Home services & cleaning', ['shop=dry_cleaning', 'shop=laundry', 'craft=gardener', 'shop=hardware', 'shop=interior_decoration']],
  lodging: ['Hotels & lodging', ['tourism=hotel', 'tourism=motel', 'tourism=guest_house']],
};

const ALL_KEYS = ['shop', 'amenity', 'office', 'craft', 'healthcare', 'tourism', 'leisure'];
const IGNORE_AMENITY = /^(parking|bench|toilets|waste_basket|bicycle_parking|drinking_water|fuel|atm|post_box|recycling|shelter|place_of_worship|school|parking_entrance|telephone|vending_machine|charging_station|fountain|grave_yard|townhall|police|fire_station|library|post_office|kindergarten|social_facility|public_bookcase|bus_station|bank)$/;

function label(tags) {
  for (const k of ALL_KEYS) if (tags[k]) return tags[k].replace(/_/g, ' ');
  return 'business';
}

function normalize(e) {
  const t = e.tags;
  return {
    id: `${e.type}/${e.id}`,
    name: t.name,
    category: label(t),
    address: [t['addr:housenumber'], t['addr:street']].filter(Boolean).join(' '),
    city: t['addr:city'] || '',
    phone: t.phone || t['contact:phone'] || '',
    email: t.email || t['contact:email'] || '',
    website: t.website || t['contact:website'] || t['operator:website'] || t.url || t['contact:url'] || t['brand:website'] || '',
    facebook: t['contact:facebook'] || t.facebook || '',
    brand: t.brand || (t['brand:wikidata'] ? t.name : ''),
    brandWikidata: t['brand:wikidata'] || t['operator:wikidata'] || '',
    instagram: t['contact:instagram'] || '',
    postcode: t['addr:postcode'] || '',
    hours: t.opening_hours || '',
    lat: e.lat ?? e.center?.lat,
    lon: e.lon ?? e.center?.lon,
    osm: `https://www.openstreetmap.org/${e.type}/${e.id}`,
  };
}

export async function searchBusinesses(place, kind, radius) {
  const geo = await geocode(place);
  const area = `(around:${Number(radius) || 5000},${geo.lat},${geo.lon})`;
  const filters = CATEGORIES[kind]?.[1];
  const clauses = filters
    ? filters.map(f => { const [k, v] = f.split('='); return `nwr["name"]["${k}"="${v}"]${area};`; })
    : ALL_KEYS.map(k => `nwr["name"]["${k}"]${area};`);
  const data = await overpass(`[out:json][timeout:40];(${clauses.join('')});out center tags 400;`);
  const seen = new Set();
  const leads = [];
  for (const e of data.elements || []) {
    const t = e.tags || {};
    if (!t.name || t.disused || t.abandoned || t.closed || t['disused:shop'] || IGNORE_AMENITY.test(t.amenity || '')) continue;
    const lead = normalize(e);
    if (lead.lat == null) continue;
    const dupe = `${lead.name.toLowerCase()}|${lead.address.toLowerCase()}`;
    if (seen.has(dupe)) continue;
    seen.add(dupe);
    leads.push(lead);
  }
  return { geo, leads };
}
