/** Utilidades de identificación argentinas (CUIL/CUIT, códigos de provincia INDEC) */

/** Dígito verificador de CUIL/CUIT (módulo 11) */
export function digitoCuil(base10: string): number {
  const m = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const s = m.reduce((a, x, i) => a + x * +base10[i], 0);
  const r = 11 - (s % 11);
  return r === 11 ? 0 : r; // 10 = inválido con ese prefijo
}

export function cuilValido(c: string): boolean {
  const d = String(c || '').replace(/\D/g, '');
  if (d.length !== 11) return false;
  const v = digitoCuil(d.slice(0, 10));
  return v !== 10 && v === +d[10];
}

/** CUIL a partir del DNI y el sexo (algoritmo de ANSES). null si no se puede saber el sexo. */
export function cuilDesdeDni(dni: string, sexo?: string | null): string | null {
  const d = String(dni || '').replace(/\D/g, '').padStart(8, '0');
  if (d.length !== 8 || /^0+$/.test(d)) return null;
  const s = String(sexo || '').toLowerCase();
  let pref = s === 'male' || s === 'm' ? '20' : s === 'female' || s === 'f' ? '27' : null;
  if (!pref) return null;
  let v = digitoCuil(pref + d);
  if (v === 10) {
    // Caso especial: prefijo 23 con dígito 9 (masculino) o 4 (femenino)
    v = pref === '20' ? 9 : 4;
    pref = '23';
  }
  return `${pref}${d}${v}`;
}

/** Códigos de provincia INDEC (2 dígitos) para el módulo de jurisdicción del CUIR */
const INDEC: Record<string, string> = {
  'ciudad de buenos aires': '02', 'caba': '02', 'ciudad autonoma de buenos aires': '02', 'capital federal': '02',
  'buenos aires': '06', 'catamarca': '10', 'cordoba': '14', 'corrientes': '18', 'chaco': '22', 'chubut': '26',
  'entre rios': '30', 'formosa': '34', 'jujuy': '38', 'la pampa': '42', 'la rioja': '46', 'mendoza': '50',
  'misiones': '54', 'neuquen': '58', 'rio negro': '62', 'salta': '66', 'san juan': '70', 'san luis': '74',
  'santa cruz': '78', 'santa fe': '82', 'santiago del estero': '86', 'tucuman': '90', 'tierra del fuego': '94',
};
export function codigoProvincia(nombre?: string | null): string {
  const n = String(nombre || '').normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase().trim();
  return INDEC[n] || (n.startsWith('tierra del fuego') ? '94' : '00');
}
