// Places to suggest when a photo was clearly taken in another time zone. Android
// hides the photo's GPS but keeps its UTC offset, so Aera lists the best-known
// cities whose offset matched on the day the photo was taken (summer time included).
// Order = how likely a traveller is to have been there; the first matches are shown.

const CITIES = `
Tokyo|Japan|35.68|139.69|Asia/Tokyo
Seoul|South Korea|37.57|126.98|Asia/Seoul
New York|United States|40.71|-74.01|America/New_York
London|United Kingdom|51.51|-0.13|Europe/London
Paris|France|48.86|2.35|Europe/Paris
Buenos Aires|Argentina|-34.60|-58.38|America/Argentina/Buenos_Aires
São Paulo|Brazil|-23.55|-46.63|America/Sao_Paulo
Rio de Janeiro|Brazil|-22.91|-43.17|America/Sao_Paulo
Los Angeles|United States|34.05|-118.24|America/Los_Angeles
Bangkok|Thailand|13.76|100.50|Asia/Bangkok
Singapore|Singapore|1.35|103.82|Asia/Singapore
Hong Kong|China|22.32|114.17|Asia/Hong_Kong
Shanghai|China|31.23|121.47|Asia/Shanghai
Beijing|China|39.90|116.41|Asia/Shanghai
Taipei|Taiwan|25.03|121.57|Asia/Taipei
Dubai|United Arab Emirates|25.20|55.27|Asia/Dubai
Istanbul|Türkiye|41.01|28.98|Europe/Istanbul
Barcelona|Spain|41.39|2.17|Europe/Madrid
Madrid|Spain|40.42|-3.70|Europe/Madrid
Rome|Italy|41.90|12.50|Europe/Rome
Berlin|Germany|52.52|13.40|Europe/Berlin
Amsterdam|Netherlands|52.37|4.90|Europe/Amsterdam
Lisbon|Portugal|38.72|-9.14|Europe/Lisbon
Mexico City|Mexico|19.43|-99.13|America/Mexico_City
Sydney|Australia|-33.87|151.21|Australia/Sydney
Montevideo|Uruguay|-34.90|-56.16|America/Montevideo
Santiago|Chile|-33.45|-70.67|America/Santiago
Lima|Peru|-12.05|-77.04|America/Lima
Bogotá|Colombia|4.71|-74.07|America/Bogota
Osaka|Japan|34.69|135.50|Asia/Tokyo
Kyoto|Japan|35.01|135.77|Asia/Tokyo
Busan|South Korea|35.18|129.08|Asia/Seoul
Jeju|South Korea|33.50|126.53|Asia/Seoul
Ho Chi Minh City|Vietnam|10.82|106.63|Asia/Ho_Chi_Minh
Hanoi|Vietnam|21.03|105.85|Asia/Ho_Chi_Minh
Bali|Indonesia|-8.65|115.22|Asia/Makassar
Jakarta|Indonesia|-6.21|106.85|Asia/Jakarta
Manila|Philippines|14.60|120.98|Asia/Manila
Kuala Lumpur|Malaysia|3.14|101.69|Asia/Kuala_Lumpur
Delhi|India|28.61|77.21|Asia/Kolkata
Mumbai|India|19.08|72.88|Asia/Kolkata
Bengaluru|India|12.97|77.59|Asia/Kolkata
Toronto|Canada|43.65|-79.38|America/Toronto
Chicago|United States|41.88|-87.63|America/Chicago
San Francisco|United States|37.77|-122.42|America/Los_Angeles
Miami|United States|25.76|-80.19|America/New_York
Cancún|Mexico|21.16|-86.85|America/Cancun
Córdoba|Argentina|-31.42|-64.18|America/Argentina/Buenos_Aires
Mendoza|Argentina|-32.89|-68.85|America/Argentina/Buenos_Aires
Bariloche|Argentina|-41.13|-71.31|America/Argentina/Buenos_Aires
Mar del Plata|Argentina|-38.00|-57.56|America/Argentina/Buenos_Aires
Punta del Este|Uruguay|-34.96|-54.95|America/Montevideo
Florianópolis|Brazil|-27.60|-48.55|America/Sao_Paulo
Asunción|Paraguay|-25.26|-57.58|America/Asuncion
Cairo|Egypt|30.04|31.24|Africa/Cairo
Moscow|Russia|55.76|37.62|Europe/Moscow
Athens|Greece|37.98|23.73|Europe/Athens
Vienna|Austria|48.21|16.37|Europe/Vienna
Prague|Czechia|50.08|14.44|Europe/Prague
Budapest|Hungary|47.50|19.04|Europe/Budapest
Zurich|Switzerland|47.38|8.54|Europe/Zurich
Munich|Germany|48.14|11.58|Europe/Berlin
Milan|Italy|45.46|9.19|Europe/Rome
Florence|Italy|43.77|11.26|Europe/Rome
Venice|Italy|45.44|12.32|Europe/Rome
Brussels|Belgium|50.85|4.35|Europe/Brussels
Copenhagen|Denmark|55.68|12.57|Europe/Copenhagen
Stockholm|Sweden|59.33|18.07|Europe/Stockholm
Oslo|Norway|59.91|10.75|Europe/Oslo
Helsinki|Finland|60.17|24.94|Europe/Helsinki
Dublin|Ireland|53.35|-6.26|Europe/Dublin
Edinburgh|United Kingdom|55.95|-3.19|Europe/London
Porto|Portugal|41.15|-8.61|Europe/Lisbon
Seville|Spain|37.39|-5.98|Europe/Madrid
Nice|France|43.70|7.27|Europe/Paris
Warsaw|Poland|52.23|21.01|Europe/Warsaw
Reykjavík|Iceland|64.15|-21.94|Atlantic/Reykjavik
Las Palmas|Spain|28.12|-15.44|Atlantic/Canary
Funchal|Portugal|32.65|-16.91|Atlantic/Madeira
Dubrovnik|Croatia|42.65|18.09|Europe/Zagreb
Bucharest|Romania|44.43|26.10|Europe/Bucharest
Kyiv|Ukraine|50.45|30.52|Europe/Kyiv
Tel Aviv|Israel|32.09|34.78|Asia/Jerusalem
Doha|Qatar|25.29|51.53|Asia/Qatar
Abu Dhabi|United Arab Emirates|24.45|54.38|Asia/Dubai
Riyadh|Saudi Arabia|24.71|46.68|Asia/Riyadh
Amman|Jordan|31.95|35.93|Asia/Amman
Tehran|Iran|35.69|51.39|Asia/Tehran
Marrakech|Morocco|31.63|-7.99|Africa/Casablanca
Cape Town|South Africa|-33.92|18.42|Africa/Johannesburg
Johannesburg|South Africa|-26.20|28.05|Africa/Johannesburg
Nairobi|Kenya|-1.29|36.82|Africa/Nairobi
Zanzibar|Tanzania|-6.17|39.20|Africa/Dar_es_Salaam
Lagos|Nigeria|6.52|3.38|Africa/Lagos
Accra|Ghana|5.60|-0.19|Africa/Accra
Dakar|Senegal|14.72|-17.47|Africa/Dakar
Kathmandu|Nepal|27.72|85.32|Asia/Kathmandu
Colombo|Sri Lanka|6.93|79.86|Asia/Colombo
Malé|Maldives|4.18|73.51|Indian/Maldives
Karachi|Pakistan|24.86|67.01|Asia/Karachi
Dhaka|Bangladesh|23.81|90.41|Asia/Dhaka
Yangon|Myanmar|16.84|96.17|Asia/Yangon
Almaty|Kazakhstan|43.24|76.89|Asia/Almaty
Tashkent|Uzbekistan|41.30|69.24|Asia/Tashkent
Ulaanbaatar|Mongolia|47.89|106.91|Asia/Ulaanbaatar
Phuket|Thailand|7.88|98.39|Asia/Bangkok
Chiang Mai|Thailand|18.79|98.99|Asia/Bangkok
Da Nang|Vietnam|16.05|108.20|Asia/Ho_Chi_Minh
Phnom Penh|Cambodia|11.56|104.93|Asia/Phnom_Penh
Cebu|Philippines|10.32|123.89|Asia/Manila
Sapporo|Japan|43.06|141.35|Asia/Tokyo
Fukuoka|Japan|33.59|130.40|Asia/Tokyo
Okinawa|Japan|26.21|127.68|Asia/Tokyo
Incheon|South Korea|37.46|126.71|Asia/Seoul
Gyeongju|South Korea|35.86|129.22|Asia/Seoul
Gangneung|South Korea|37.75|128.88|Asia/Seoul
Shenzhen|China|22.54|114.06|Asia/Shanghai
Macau|China|22.20|113.54|Asia/Macau
Melbourne|Australia|-37.81|144.96|Australia/Melbourne
Brisbane|Australia|-27.47|153.03|Australia/Brisbane
Perth|Australia|-31.95|115.86|Australia/Perth
Adelaide|Australia|-34.93|138.60|Australia/Adelaide
Darwin|Australia|-12.46|130.84|Australia/Darwin
Cairns|Australia|-16.92|145.77|Australia/Brisbane
Hobart|Australia|-42.88|147.33|Australia/Hobart
Auckland|New Zealand|-36.85|174.76|Pacific/Auckland
Queenstown|New Zealand|-45.03|168.66|Pacific/Auckland
Nadi|Fiji|-17.80|177.42|Pacific/Fiji
Papeete|French Polynesia|-17.54|-149.57|Pacific/Tahiti
Guam|United States|13.44|144.79|Pacific/Guam
Honolulu|United States|21.31|-157.86|Pacific/Honolulu
Anchorage|United States|61.22|-149.90|America/Anchorage
Vancouver|Canada|49.28|-123.12|America/Vancouver
Seattle|United States|47.61|-122.33|America/Los_Angeles
Las Vegas|United States|36.17|-115.14|America/Los_Angeles
Denver|United States|39.74|-104.99|America/Denver
Phoenix|United States|33.45|-112.07|America/Phoenix
Calgary|Canada|51.05|-114.07|America/Edmonton
Houston|United States|29.76|-95.37|America/Chicago
Austin|United States|30.27|-97.74|America/Chicago
New Orleans|United States|29.95|-90.07|America/Chicago
Washington|United States|38.91|-77.04|America/New_York
Boston|United States|42.36|-71.06|America/New_York
Orlando|United States|28.54|-81.38|America/New_York
Montreal|Canada|45.50|-73.57|America/Toronto
Halifax|Canada|44.65|-63.57|America/Halifax
St. John's|Canada|47.56|-52.71|America/St_Johns
Guadalajara|Mexico|20.66|-103.35|America/Mexico_City
Havana|Cuba|23.11|-82.37|America/Havana
San Juan|Puerto Rico|18.47|-66.11|America/Puerto_Rico
Santo Domingo|Dominican Republic|18.49|-69.93|America/Santo_Domingo
Panama City|Panama|8.98|-79.52|America/Panama
San José|Costa Rica|9.93|-84.09|America/Costa_Rica
Guatemala City|Guatemala|14.63|-90.51|America/Guatemala
Cartagena|Colombia|10.39|-75.48|America/Bogota
Medellín|Colombia|6.24|-75.58|America/Bogota
Quito|Ecuador|-0.18|-78.47|America/Guayaquil
Cusco|Peru|-13.53|-71.97|America/Lima
La Paz|Bolivia|-16.50|-68.15|America/La_Paz
Caracas|Venezuela|10.49|-66.88|America/Caracas
Salvador|Brazil|-12.97|-38.50|America/Bahia
Brasília|Brazil|-15.79|-47.88|America/Sao_Paulo
Manaus|Brazil|-3.12|-60.02|America/Manaus
`.trim().split('\n').map((line) => {
  const [name, country, lat, lon, tz] = line.split('|');
  return { name, detail: country, lat: +lat, lon: +lon, tz };
});

// The list is mostly big cities: they get a big-city population so a seaside metropolis
// (Rio, Tel Aviv) keeps the city sticker. These are towns and resorts, judged as towns.
const TOWNS = new Set([
  'Punta del Este', 'Mar del Plata', 'Florianópolis', 'Bariloche', 'Bali', 'Phuket', 'Zanzibar', 'Malé',
  'Cairns', 'Queenstown', 'Nadi', 'Papeete', 'Funchal', 'Las Palmas', 'Nice', 'Dubrovnik', 'Jeju', 'Okinawa',
  'Gangneung', 'Gyeongju', 'Da Nang', 'Cebu', 'Cartagena', 'Cusco', 'Chiang Mai', 'Reykjavík', 'Marrakech',
  'Guam', 'Honolulu', 'Cancún', 'Kyoto', 'Busan', 'Sapporo', 'Fukuoka',
]);
for (const c of CITIES) c.pop = TOWNS.has(c.name) ? null : 2_000_000;

const formatters = new Map();

/** Minutes east of UTC in `tz` at `date`, or null if the browser doesn't know the zone. */
export function offsetIn(tz, date = new Date()) {
  try {
    if (!formatters.has(tz)) formatters.set(tz, new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longOffset' }));
    const name = formatters.get(tz).formatToParts(date).find((p) => p.type === 'timeZoneName')?.value ?? '';
    const m = /GMT(?:([+-])(\d{1,2})(?::?(\d{2}))?)?/.exec(name);
    if (!m) return null;
    return m[1] ? (m[1] === '-' ? -1 : 1) * (+m[2] * 60 + +(m[3] ?? 0)) : 0;
  } catch {
    return null;
  }
}

/** The best-known cities that were at `offsetMin` on `date`. */
export function citiesAtOffset(offsetMin, date, count = 6) {
  return CITIES.filter((c) => offsetIn(c.tz, date) === offsetMin).slice(0, count);
}

/** "UTC−3", "UTC+5:30" */
export function offsetLabel(min) {
  const sign = min < 0 ? '−' : '+';
  const a = Math.abs(min);
  return `UTC${sign}${Math.floor(a / 60)}${a % 60 ? ':' + String(a % 60).padStart(2, '0') : ''}`;
}
