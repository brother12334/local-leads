import { geocode, overpassMany } from './net.js';

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
    cuisine: t.cuisine || '',
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

// Business-type values per key for "All business types", so the map server skips
// benches, schools, parking and the like instead of sending them back.
const ALL_VALUES = {
  amenity: 'restaurant|fast_food|cafe|bar|pub|biergarten|ice_cream|food_court|dentist|doctors|clinic|veterinary|pharmacy|car_wash|car_rental|driving_school|childcare|nightclub|cinema|theatre|spa|studio|marketplace|money_transfer|internet_cafe|boat_rental|animal_boarding|language_school|music_school|dancing_school|prep_school',
  leisure: 'fitness_centre|sports_centre|spa|dance|bowling_alley|escape_game|amusement_arcade|golf_course|marina|miniature_golf|trampoline_park|water_park|horse_riding|sauna|tanning_salon',
  tourism: 'hotel|motel|guest_house|hostel|apartment|attraction|museum|gallery|zoo|aquarium|theme_park',
};

function bbox(lat, lon, radius) {
  const dLat = radius / 111320;
  const dLon = radius / (111320 * Math.cos(lat * Math.PI / 180));
  return [lat - dLat, lon - dLon, lat + dLat, lon + dLon].map(n => n.toFixed(6)).join(',');
}

function distance(a, b) {
  const R = 6371000, toRad = x => x * Math.PI / 180;
  const dLat = toRad(b.lat - a.lat), dLon = toRad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Small per-key queries: each is quick for the map server, and one failing doesn't lose the rest. */
function buildQueries(kind, box) {
  const head = `[out:json][timeout:25][bbox:${box}];`;
  const tail = 'out center tags;';
  const filters = CATEGORIES[kind]?.[1];
  const groups = {};
  if (filters) {
    for (const f of filters) { const [k, v] = f.split('='); (groups[k] ||= []).push(v); }
  } else {
    for (const k of ALL_KEYS) groups[k] = ALL_VALUES[k] ? ALL_VALUES[k].split('|') : null;
  }
  return Object.entries(groups).map(([k, vals]) => ({
    key: k,
    query: head + (vals ? `nwr["name"]["${k}"~"^(${vals.join('|')})$"];` : `nwr["name"]["${k}"];`) + tail,
  }));
}

const KEY_LABEL = { shop: 'shops', amenity: 'restaurants & services', office: 'offices', craft: 'trades', healthcare: 'healthcare', tourism: 'hotels & attractions', leisure: 'gyms & leisure' };

/**
 * Find businesses around a place. Calls onProgress({leads, done, total}) as each part
 * of the search arrives, so results show up before the slowest part finishes.
 */
export async function searchBusinesses(place, kind, radius, onProgress = () => {}) {
  const geo = await geocode(place);
  const r = Number(radius) || 5000;
  const queries = buildQueries(kind, bbox(geo.lat, geo.lon, r));
  const seen = new Set();
  const leads = [];
  const failed = [];
  let done = 0;

  const take = data => {
    for (const e of data.elements || []) {
      const t = e.tags || {};
      if (!t.name || t.disused || t.abandoned || t.closed || t['disused:shop'] || IGNORE_AMENITY.test(t.amenity || '')) continue;
      const lead = normalize(e);
      if (lead.lat == null || distance(geo, lead) > r) continue;
      const dupe = `${lead.name.toLowerCase()}|${lead.address.toLowerCase()}`;
      if (seen.has(dupe) || seen.has(lead.id)) continue;
      seen.add(dupe); seen.add(lead.id);
      leads.push(lead);
    }
  };

  await overpassMany(queries.map(q => q.query), (i, data, err) => {
    done++;
    if (err) failed.push(KEY_LABEL[queries[i].key] || queries[i].key);
    else take(data);
    onProgress({ geo, leads: [...leads], done, total: queries.length });
  });

  if (failed.length === queries.length) {
    throw Error('The map service didn’t respond (it’s busy or timed out). Try again in a minute, or pick a smaller radius or a specific category.');
  }
  return { geo, leads, failed };
}
