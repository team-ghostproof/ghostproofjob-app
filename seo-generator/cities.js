'use strict';
/**
 * seo-generator/cities.js — the metros we publish a "ghost jobs in {city}" page for.
 *
 * HONESTY RULE: a city here only changes the FRAMING of evergreen, factual
 * ghost-job guidance (and the app's location CTA). We never publish invented
 * city-level statistics — see template.js.
 *
 * Company pages are deliberately NOT generated (founder: off until legal review).
 */

const CITIES = [
  ['Houston', 'TX'], ['Dallas', 'TX'], ['Fort Worth', 'TX'], ['Austin', 'TX'], ['San Antonio', 'TX'], ['El Paso', 'TX'],
  ['Los Angeles', 'CA'], ['San Francisco', 'CA'], ['San Diego', 'CA'], ['San Jose', 'CA'], ['Sacramento', 'CA'], ['Fresno', 'CA'],
  ['New York', 'NY'], ['Buffalo', 'NY'], ['Chicago', 'IL'], ['Boston', 'MA'],
  ['Phoenix', 'AZ'], ['Tucson', 'AZ'], ['Philadelphia', 'PA'], ['Pittsburgh', 'PA'], ['Atlanta', 'GA'],
  ['Seattle', 'WA'], ['Denver', 'CO'], ['Miami', 'FL'], ['Orlando', 'FL'], ['Tampa', 'FL'], ['Jacksonville', 'FL'],
  ['Washington', 'DC'], ['Detroit', 'MI'], ['Minneapolis', 'MN'], ['Portland', 'OR'], ['Las Vegas', 'NV'],
  ['Charlotte', 'NC'], ['Raleigh', 'NC'], ['Nashville', 'TN'], ['Memphis', 'TN'],
  ['Columbus', 'OH'], ['Cleveland', 'OH'], ['Cincinnati', 'OH'], ['Indianapolis', 'IN'],
  ['Kansas City', 'MO'], ['St. Louis', 'MO'], ['Baltimore', 'MD'], ['Milwaukee', 'WI'],
  ['Salt Lake City', 'UT'], ['Oklahoma City', 'OK'], ['Louisville', 'KY'], ['New Orleans', 'LA'],
  ['Richmond', 'VA'], ['Virginia Beach', 'VA'], ['Albuquerque', 'NM'], ['Birmingham', 'AL'], ['Boise', 'ID'],
  ['Des Moines', 'IA'], ['Omaha', 'NE'], ['Hartford', 'CT'], ['Providence', 'RI'],
  ['Charleston', 'SC'], ['Columbia', 'SC'], ['Little Rock', 'AR'], ['Wichita', 'KS'],
];

function slugify(s) {
  return String(s).toLowerCase().replace(/[.']/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

const cities = CITIES.map(([city, state]) => ({
  city,
  state,
  label: city + ', ' + state,
  slug: 'ghost-jobs-in-' + slugify(city) + '-' + state.toLowerCase(),
}));

module.exports = { cities, slugify };
