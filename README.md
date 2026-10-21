# MARKETZONE

Marketplace de moda, sneakers y streetwear: inventario por talla y color, ofertas y contraofertas,
tiendas, promoción de negocios e IA para crear publicaciones.

## Arquitectura
- Web: React + TypeScript, compilada con esbuild (`scripts/build.mjs`). Responsive, móvil primero.
- Backend: Supabase (Auth, Postgres con RLS, Storage). Toda operación crítica (precios, inventario,
  reservas, pedidos, ofertas, campañas) se ejecuta en funciones SQL `security definer` que validan permisos.
- IA: Edge Functions `ai-listing` y `ai-marketing` (la clave vive en el servidor). Sin clave, la web lo indica.
- Pagos: solo modo de prueba. Pagos reales (Stripe Connect) no implementados.

## Publicación
Cada push a `main` publica la web en GitHub Pages (`.github/workflows/pages.yml`).
Base de datos: aplicar `supabase/migrations/*.sql` en orden (o `node scripts/make-setup-sql.mjs`).

## Pruebas
- `npm test`: motor de demostración (28 escenarios).
- `npm run test:supabase`: contra Postgres + Auth + PostgREST reales (37 escenarios).
