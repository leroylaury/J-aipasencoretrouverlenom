alter table partners add column image_url text;
alter table items add column image_url text;

-- Mettre à jour la fonction save_order pour gérer éventuellement les nouveaux items si on voulait le faire via RPC,
-- mais la demande porte sur le front.

-- On ajoute la permission pour l'impôt si elle n'existe pas déjà (tax.read existe déjà pour admin/controleur)
-- On s'assure que responsable_vente peut aussi voir les impôts si nécessaire,
-- mais selon le SQL initial, c'est admin et controleur_impots.
