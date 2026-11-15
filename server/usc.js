// USC reference points and the request → OpenStreetMap tag presets the tools use.

export const USC = { lat: 34.0206, lon: -118.2856, name: 'Tommy Trojan, USC University Park campus' };

// 2.5 miles ≈ 4023 m. Used as the default search/reach radius around campus.
export const RADIUS_M = 4023;

// Campus core: University Park campus, USC Village and Exposition Park (south, west, north, east).
export const CORE_BBOX = [34.0095, -118.2945, 34.0290, -118.2735];

// A box roughly 2.5 miles around campus, for biasing geocoding.
export const AREA_BBOX = [USC.lat - 0.0362, USC.lon - 0.0437, USC.lat + 0.0362, USC.lon + 0.0437];

// Free-text request → OSM tags. First match wins; the agent can always pass explicit tags instead.
export const PRESETS = [
  { label: 'Groceries & produce', re: /avocado|guac|fruit|vegetable|veggie|produce|grocer|milk|egg|bread|banana|apple|berr|tomato|onion|lime|lemon|cereal|rice|pasta|chicken|meat|tofu|cheese|yogurt|ingredient|supermarket|tortilla|salsa|snack|frozen/i,
    tags: ['shop=supermarket', 'shop=greengrocer', 'shop=convenience', 'amenity=marketplace'] },
  { label: 'Pharmacy', re: /medicine|pharmac|cold|flu|advil|tylenol|ibuprofen|band.?aid|prescription|toothpaste|vitamin|allerg|sick|cough|sunscreen/i,
    tags: ['amenity=pharmacy', 'shop=chemist'] },
  { label: 'Coffee', re: /coffee|latte|matcha|espresso|\btea\b|cafe|caffeine|boba/i, tags: ['amenity=cafe', 'shop=coffee', 'shop=tea'] },
  { label: 'Food', re: /eat|food|hungry|lunch|dinner|breakfast|taco|pizza|burger|bowl|vegan|vegetarian|restaurant|meal|sushi|ramen/i,
    tags: ['amenity=restaurant', 'amenity=fast_food', 'amenity=food_court'] },
  { label: 'Study spaces', re: /study|library|quiet|read|books/i, tags: ['amenity=library', 'amenity=study_space'] },
  { label: 'ATM & banks', re: /atm|cash|bank|deposit/i, tags: ['amenity=atm', 'amenity=bank'] },
  { label: 'Packages & post', re: /package|parcel|post office|mail|ship|fedex|ups|locker/i, tags: ['amenity=post_office', 'amenity=parcel_locker', 'shop=copyshop'] },
  { label: 'Printing', re: /print|copy|scan/i, tags: ['shop=copyshop', 'amenity=printer', 'craft=printer'] },
  { label: 'Water refill', re: /water|refill|bottle|thirsty/i, tags: ['amenity=drinking_water', 'amenity=water_point'] },
  { label: 'Restrooms', re: /restroom|toilet|bathroom/i, tags: ['amenity=toilets'] },
  { label: 'Gyms', re: /\bgym\b|workout|fitness|exercise|lift|swim/i, tags: ['leisure=fitness_centre', 'leisure=sports_centre', 'leisure=swimming_pool'] },
  { label: 'Parks & gardens', re: /park|garden|nature|green|tree|breeze|outside|fresh air/i, tags: ['leisure=park', 'leisure=garden'] },
  { label: 'Transit', re: /metro|train|bus\b|transit|station|light rail/i, tags: ['railway=station', 'public_transport=station', 'highway=bus_stop'] },
  { label: 'Bikes & scooters', re: /bike|bicycle|scooter/i, tags: ['amenity=bicycle_parking', 'amenity=bicycle_rental', 'shop=bicycle'] },
  { label: 'Things to see', re: /museum|stadium|arena|concert|things to do|visit|tour|gallery|theatre|theater/i,
    tags: ['tourism=museum', 'leisure=stadium', 'amenity=theatre', 'tourism=attraction', 'tourism=gallery'] },
  { label: 'Supplies', re: /charger|cable|dorm|detergent|laundry|household|supplies|notebook|pen|umbrella|battery|batteries|hoodie/i,
    tags: ['shop=department_store', 'shop=variety_store', 'shop=convenience', 'shop=electronics', 'shop=stationery'] }
];

export function presetFor(text) {
  return PRESETS.find(p => p.re.test(text || '')) || null;
}

export function haversineM(a, b) {
  const R = 6371008.8, r = d => d * Math.PI / 180;
  const dLa = r(b.lat - a.lat), dLo = r(b.lon - a.lon);
  const s = Math.sin(dLa / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

export const walkMinutes = m => Math.max(1, Math.round(m / 80)); // ~4.8 km/h
