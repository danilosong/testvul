-- Section 15.4 (Endpoint Detail): whether an endpoint was actually
-- observed to require authentication — NULL means never observed either
-- way, never guessed from its classification or path.
ALTER TABLE discovered_endpoints ADD COLUMN auth_required INTEGER CHECK (auth_required IN (0, 1));
