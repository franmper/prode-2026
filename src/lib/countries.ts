// English (football-data.org) -> Spanish name + ISO code for flag lookup.
// Keyed lowercased; includes common API aliases. Unknown -> name returned
// as-is and no flag.
//
// Flag images are served from flagcdn.com. For UK home nations we use the
// ISO 3166-2 subdivision codes that flagcdn supports (gb-eng, gb-sct, etc.).

type Country = { es: string; iso: string };

const ES: Record<string, Country> = {
  // CONMEBOL
  argentina: { es: 'Argentina', iso: 'ar' },
  brazil: { es: 'Brasil', iso: 'br' },
  uruguay: { es: 'Uruguay', iso: 'uy' },
  colombia: { es: 'Colombia', iso: 'co' },
  ecuador: { es: 'Ecuador', iso: 'ec' },
  peru: { es: 'Perú', iso: 'pe' },
  paraguay: { es: 'Paraguay', iso: 'py' },
  chile: { es: 'Chile', iso: 'cl' },
  bolivia: { es: 'Bolivia', iso: 'bo' },
  venezuela: { es: 'Venezuela', iso: 've' },

  // UEFA
  france: { es: 'Francia', iso: 'fr' },
  spain: { es: 'España', iso: 'es' },
  germany: { es: 'Alemania', iso: 'de' },
  england: { es: 'Inglaterra', iso: 'gb-eng' },
  portugal: { es: 'Portugal', iso: 'pt' },
  netherlands: { es: 'Países Bajos', iso: 'nl' },
  holland: { es: 'Países Bajos', iso: 'nl' },
  belgium: { es: 'Bélgica', iso: 'be' },
  italy: { es: 'Italia', iso: 'it' },
  croatia: { es: 'Croacia', iso: 'hr' },
  switzerland: { es: 'Suiza', iso: 'ch' },
  denmark: { es: 'Dinamarca', iso: 'dk' },
  sweden: { es: 'Suecia', iso: 'se' },
  norway: { es: 'Noruega', iso: 'no' },
  poland: { es: 'Polonia', iso: 'pl' },
  serbia: { es: 'Serbia', iso: 'rs' },
  austria: { es: 'Austria', iso: 'at' },
  wales: { es: 'Gales', iso: 'gb-wls' },
  scotland: { es: 'Escocia', iso: 'gb-sct' },
  'republic of ireland': { es: 'Irlanda', iso: 'ie' },
  ireland: { es: 'Irlanda', iso: 'ie' },
  'northern ireland': { es: 'Irlanda del Norte', iso: 'gb-nir' },
  turkey: { es: 'Turquía', iso: 'tr' },
  'türkiye': { es: 'Turquía', iso: 'tr' },
  turkiye: { es: 'Turquía', iso: 'tr' },
  greece: { es: 'Grecia', iso: 'gr' },
  ukraine: { es: 'Ucrania', iso: 'ua' },
  'czech republic': { es: 'República Checa', iso: 'cz' },
  czechia: { es: 'República Checa', iso: 'cz' },
  hungary: { es: 'Hungría', iso: 'hu' },
  romania: { es: 'Rumania', iso: 'ro' },
  slovenia: { es: 'Eslovenia', iso: 'si' },
  slovakia: { es: 'Eslovaquia', iso: 'sk' },
  'bosnia and herzegovina': { es: 'Bosnia y Herzegovina', iso: 'ba' },
  'bosnia & herzegovina': { es: 'Bosnia y Herzegovina', iso: 'ba' },
  'bosnia-herzegovina': { es: 'Bosnia y Herzegovina', iso: 'ba' },
  'bosnia herzegovina': { es: 'Bosnia y Herzegovina', iso: 'ba' },
  bosnia: { es: 'Bosnia y Herzegovina', iso: 'ba' },
  'north macedonia': { es: 'Macedonia del Norte', iso: 'mk' },
  albania: { es: 'Albania', iso: 'al' },
  iceland: { es: 'Islandia', iso: 'is' },
  finland: { es: 'Finlandia', iso: 'fi' },
  russia: { es: 'Rusia', iso: 'ru' },
  georgia: { es: 'Georgia', iso: 'ge' },

  // CONCACAF
  'united states': { es: 'Estados Unidos', iso: 'us' },
  usa: { es: 'Estados Unidos', iso: 'us' },
  mexico: { es: 'México', iso: 'mx' },
  canada: { es: 'Canadá', iso: 'ca' },
  'costa rica': { es: 'Costa Rica', iso: 'cr' },
  panama: { es: 'Panamá', iso: 'pa' },
  jamaica: { es: 'Jamaica', iso: 'jm' },
  honduras: { es: 'Honduras', iso: 'hn' },
  'el salvador': { es: 'El Salvador', iso: 'sv' },
  guatemala: { es: 'Guatemala', iso: 'gt' },
  'trinidad and tobago': { es: 'Trinidad y Tobago', iso: 'tt' },
  haiti: { es: 'Haití', iso: 'ht' },
  curacao: { es: 'Curazao', iso: 'cw' },
  'curaçao': { es: 'Curazao', iso: 'cw' },

  // CAF
  morocco: { es: 'Marruecos', iso: 'ma' },
  senegal: { es: 'Senegal', iso: 'sn' },
  tunisia: { es: 'Túnez', iso: 'tn' },
  algeria: { es: 'Argelia', iso: 'dz' },
  egypt: { es: 'Egipto', iso: 'eg' },
  nigeria: { es: 'Nigeria', iso: 'ng' },
  ghana: { es: 'Ghana', iso: 'gh' },
  cameroon: { es: 'Camerún', iso: 'cm' },
  'ivory coast': { es: 'Costa de Marfil', iso: 'ci' },
  "cote d'ivoire": { es: 'Costa de Marfil', iso: 'ci' },
  "côte d'ivoire": { es: 'Costa de Marfil', iso: 'ci' },
  mali: { es: 'Malí', iso: 'ml' },
  'burkina faso': { es: 'Burkina Faso', iso: 'bf' },
  'south africa': { es: 'Sudáfrica', iso: 'za' },
  'cape verde': { es: 'Cabo Verde', iso: 'cv' },
  'cape verde islands': { es: 'Cabo Verde', iso: 'cv' },
  'cabo verde': { es: 'Cabo Verde', iso: 'cv' },
  'dr congo': { es: 'RD Congo', iso: 'cd' },
  'congo dr': { es: 'RD Congo', iso: 'cd' },
  'democratic republic of the congo': { es: 'RD Congo', iso: 'cd' },
  gabon: { es: 'Gabón', iso: 'ga' },
  guinea: { es: 'Guinea', iso: 'gn' },
  'equatorial guinea': { es: 'Guinea Ecuatorial', iso: 'gq' },
  angola: { es: 'Angola', iso: 'ao' },
  zambia: { es: 'Zambia', iso: 'zm' },
  'south sudan': { es: 'Sudán del Sur', iso: 'ss' },
  benin: { es: 'Benín', iso: 'bj' },

  // AFC
  japan: { es: 'Japón', iso: 'jp' },
  'south korea': { es: 'Corea del Sur', iso: 'kr' },
  'korea republic': { es: 'Corea del Sur', iso: 'kr' },
  iran: { es: 'Irán', iso: 'ir' },
  'ir iran': { es: 'Irán', iso: 'ir' },
  'saudi arabia': { es: 'Arabia Saudita', iso: 'sa' },
  australia: { es: 'Australia', iso: 'au' },
  qatar: { es: 'Catar', iso: 'qa' },
  iraq: { es: 'Irak', iso: 'iq' },
  'united arab emirates': { es: 'Emiratos Árabes Unidos', iso: 'ae' },
  uzbekistan: { es: 'Uzbekistán', iso: 'uz' },
  jordan: { es: 'Jordania', iso: 'jo' },
  oman: { es: 'Omán', iso: 'om' },
  bahrain: { es: 'Baréin', iso: 'bh' },
  china: { es: 'China', iso: 'cn' },
  'china pr': { es: 'China', iso: 'cn' },
  'north korea': { es: 'Corea del Norte', iso: 'kp' },
  'korea dpr': { es: 'Corea del Norte', iso: 'kp' },
  indonesia: { es: 'Indonesia', iso: 'id' },
  thailand: { es: 'Tailandia', iso: 'th' },
  vietnam: { es: 'Vietnam', iso: 'vn' },
  india: { es: 'India', iso: 'in' },
  palestine: { es: 'Palestina', iso: 'ps' },

  // OFC
  'new zealand': { es: 'Nueva Zelanda', iso: 'nz' },
};

function lookup(name: string | null | undefined): Country | null {
  if (!name) return null;
  return ES[name.trim().toLowerCase()] ?? null;
}

export function teamName(name: string | null | undefined): string {
  if (!name) return '';
  return lookup(name)?.es ?? name;
}

// Returns a flagcdn SVG URL or null if the country is unknown.
export function teamFlag(name: string | null | undefined): string | null {
  const c = lookup(name);
  return c ? `https://flagcdn.com/${c.iso}.svg` : null;
}
