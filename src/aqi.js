// US EPA AQI categories. The overlay always uses US AQI so every image reads on one scale.

// `lines` is how the label stacks on the receipt strip when one line won't fit.
export const AQI_BANDS = [
  { max: 50,  label: 'Good',                           lines: ['GOOD'] },
  { max: 100, label: 'Moderate',                       lines: ['MODERATE'] },
  { max: 150, label: 'Unhealthy for sensitive groups', lines: ['UNHEALTHY FOR', 'SENSITIVE GROUPS'] },
  { max: 200, label: 'Unhealthy',                      lines: ['UNHEALTHY'] },
  { max: 300, label: 'Very unhealthy',                 lines: ['VERY', 'UNHEALTHY'] },
  { max: 500, label: 'Hazardous',                      lines: ['HAZARDOUS'] },
];

// Colour dot beside the AQI number. "Good" (0–50) is where most people live, so it
// gets three greens to chase: dark green is the prize.
export const AQI_DOTS = [
  { max: 15,  color: '#16683A' }, // dark green
  { max: 33,  color: '#2FA352' }, // green
  { max: 50,  color: '#8ED16B' }, // light green
  { max: 100, color: '#F2D23C' }, // yellow
  { max: 150, color: '#F28A2B' }, // orange
  { max: 200, color: '#E0352B' }, // red
  { max: 300, color: '#8E3A9E' }, // purple
  { max: Infinity, color: '#5A1A5C' }, // dark purple
];

export function aqiCategory(aqi) {
  if (aqi == null || Number.isNaN(aqi)) return null;
  return AQI_BANDS.find((b) => aqi <= b.max) ?? AQI_BANDS[AQI_BANDS.length - 1];
}

export function aqiDotColor(aqi) {
  if (aqi == null || Number.isNaN(aqi)) return null;
  return AQI_DOTS.find((d) => Math.round(aqi) <= d.max).color;
}
