# MARKETXONE

Marketplace de moda, sneakers y streetwear: inventario por talla y color, ofertas y contraofertas,
subastas en vivo con dinero retenido, tiendas, promoción de negocios, IA para crear publicaciones y
servicio al cliente con IA que aprende de las respuestas del equipo.

## Arquitectura
- Web: React + TypeScript, compilada con esbuild (`scripts/build.mjs`). Responsive, móvil primero.
- Backend: Supabase (Auth, Postgres con RLS, Storage). Toda operación crítica (precios, inventario,
  reservas, pedidos, ofertas, campañas) se ejecuta en funciones SQL `security definer` que validan permisos.
- IA: Edge Functions `ai-listing`, `ai-marketing`, `ai-auction` (llena la subasta desde las fotos) y `ai-support`
  (asistente de soporte). La clave `ANTHROPIC_API_KEY` vive solo en el servidor. Sin clave, la web lo indica y el
  soporte contesta con las respuestas aprobadas y pasa lo demás a la bandeja del equipo.
- Subastas (`src/mx/`, migraciones 1300 y 1400): pujas de $1, dinero retenido, reenlistar máximo 3 veces.
- Soporte: conversaciones, bandeja del equipo (Perfil → Soporte al cliente) y base de respuestas que usa la IA.
- Pagos: solo modo de prueba. Pagos reales (Stripe Connect) no implementados.

## Publicación
Cada push a `main` publica la web en GitHub Pages (`.github/workflows/pages.yml`).
Base de datos: aplicar `supabase/migrations/*.sql` en orden (o `node scripts/make-setup-sql.mjs`).

## Pruebas
- `npm test`: motor de demostración (28 escenarios).
- `npm run test:supabase`: contra Postgres + Auth + PostgREST reales (37 escenarios).
