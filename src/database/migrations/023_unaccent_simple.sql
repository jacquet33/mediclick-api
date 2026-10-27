-- 023: comparar nombres sin tildes (sin depender de la extensión unaccent)
CREATE OR REPLACE FUNCTION unaccent_simple(t TEXT) RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $$
  SELECT translate(COALESCE(t, ''), 'áéíóúÁÉÍÓÚäëïöüÄËÏÖÜàèìòùÀÈÌÒÙñÑ', 'aeiouAEIOUaeiouAEIOUaeiouAEIOUnN')
$$;
