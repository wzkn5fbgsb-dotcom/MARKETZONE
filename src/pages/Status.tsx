import { useApp } from "../app/state";
import { Page } from "../components/layout";
import { Badge, Callout } from "../ui/kit";

type S = "probado" | "implementado" | "config" | "integracion" | "no";
const LABEL: Record<S, [string, "ok" | "info" | "warn" | "bad" | "muted"]> = {
  probado: ["Implementado y probado", "ok"], implementado: ["Implementado", "info"], config: ["Pendiente de configuración", "warn"],
  integracion: ["Pendiente de integración", "warn"], no: ["No implementado", "muted"],
};

export const STATUS: { area: string; items: [string, S, string][] }[] = [
  { area: "Marca y web", items: [
    ["Identidad visual, logotipo y sistema de diseño", "implementado", "Paleta negra con carmesí, componentes reutilizables, favicon."],
    ["Web responsive (móvil primero) con barra inferior", "probado", "Revisada en ancho iPhone y escritorio."],
    ["Página principal con secciones y datos de demostración identificados", "probado", ""],
    ["Búsqueda, categorías y filtros", "probado", "Talla, estado, precio, disponibilidad, descuentos."],
    ["Progressive Web App (instalar en pantalla de inicio)", "implementado", "Manifiesto e iconos; sin modo sin conexión."],
  ] },
  { area: "Cuentas y seguridad", items: [
    ["Registro, inicio y cierre de sesión (Supabase Auth)", "probado", "Probado contra el servidor de autenticación de Supabase."],
    ["Recuperación de contraseña por correo", "probado", "Flujo completo probado con un servidor de correo local; en producción requiere SMTP de Supabase."],
    ["Permisos en el servidor (RLS + funciones)", "probado", "Escritura directa a tablas rechazada; solo funciones validadas."],
    ["Panel administrativo con permisos en servidor", "probado", ""],
    ["Cuentas de la versión demo", "implementado", "Solo en el dispositivo; no son autenticación real."],
  ] },
  { area: "Publicaciones e inventario", items: [
    ["Publicar con fotos, borradores, editar, pausar, eliminar", "probado", ""],
    ["Inventario por talla y color con movimientos", "probado", "Reservas temporales y sin ventas duplicadas de la última unidad."],
    ["Edición rápida y acciones en lote", "probado", ""],
    ["Descuentos solo reales (precio anterior publicado)", "probado", ""],
    ["Almacenamiento de imágenes por usuario", "probado", "Cada usuario solo escribe en su carpeta."],
  ] },
  { area: "Compras y ofertas", items: [
    ["Carrito y checkout con validación de precio y stock en el servidor", "probado", ""],
    ["Prevención de sobreventa con compradores simultáneos", "probado", "10 compradores contra 3 unidades: exactamente 3 pedidos."],
    ["Ofertas, contraofertas y compra al precio acordado", "probado", ""],
    ["Expiración de reservas y ofertas", "probado", "Tarea programada con pg_cron (si está disponible) + liberación al instante en operaciones críticas."],
    ["Envíos: estados, seguimiento escrito por el vendedor, confirmación de entrega", "probado", ""],
    ["Reseñas solo de compras entregadas; reportes con anti-spam", "probado", ""],
  ] },
  { area: "Pagos", items: [
    ["Pagos en modo de prueba (sin dinero real)", "probado", "Claramente identificados como prueba."],
    ["Confirmación de pago solo desde el servidor (webhook)", "implementado", "Función mark_order_paid restringida al servidor; verificación de importe e idempotencia probadas."],
    ["Stripe Connect: cobros, comisiones, liquidaciones y reembolsos reales", "integracion", "Requiere cuenta de Stripe, verificación y pruebas. El modo de prueba no puede desactivarse hasta entonces."],
    ["Impuestos y etiquetas de envío", "no", "Fase posterior."],
  ] },
  { area: "Inteligencia artificial", items: [
    ["Crear publicación con IA (fotos → propuesta revisable)", "probado", "Probado con un servidor de IA simulado; el análisis real requiere la clave en el servidor."],
    ["Clave de IA en el servidor (Edge Function) y cuota diaria", "config", "Configurar ANTHROPIC_API_KEY en los secretos de Supabase."],
    ["IA real dentro de la versión publicada en Claude", "implementado", "Usa el modelo de Claude del visor con su permiso; fuera de Claude se muestra como no disponible."],
    ["IA de marketing (titulares, textos, ideas)", "implementado", ""],
    ["Precios basados en ventas reales comparables", "no", "No se inventan comparables: solo estimación de la IA, identificada como tal."],
  ] },
  { area: "Negocios y publicidad", items: [
    ["Páginas comerciales con URL propia", "probado", ""],
    ["Campañas: borrador → revisión → pago → activa", "probado", "Ninguna campaña se activa sin pago confirmado."],
    ["Impresiones y clics (sin confundir con ventas)", "probado", ""],
    ["Ventas atribuidas a campañas", "no", "Se mostrarán cuando exista atribución fiable."],
  ] },
  { area: "Despliegue", items: [
    ["Versión de prueba publicada (enlace)", "implementado", "Modo demo en el navegador."],
    ["Proyecto Supabase de producción", "config", "Crear proyecto y ejecutar supabase/setup.sql."],
    ["Hosting de la web conectada a Supabase", "config", "GitHub Pages (flujo incluido) o cualquier hosting estático."],
    ["Apps nativas iOS/Android", "no", "Fuera del alcance de esta fase."],
  ] },
];

export default function Status() {
  const { config, settings } = useApp();
  return (
    <Page narrow>
      <div className="stack-xl">
        <div className="stack" style={{ gap: 6 }}>
          <span className="eyebrow">Transparencia</span>
          <h1 className="h1">Estado del proyecto</h1>
          <span className="muted">Qué está implementado, qué está probado y qué falta configurar o integrar. Ninguna función que solo tenga interfaz se marca como completa.</span>
        </div>
        <Callout kind={config.mode === "demo" ? "warn" : "info"}>
          Estás usando la versión <b>{config.mode === "demo" ? "de demostración (datos en este dispositivo)" : "conectada a Supabase"}</b>
          {settings?.test_mode ? " con pagos en modo de prueba." : "."} Versión {config.version}.
        </Callout>
        {STATUS.map((g) => (
          <section key={g.area} className="stack">
            <span className="h3">{g.area}</span>
            <div className="status-grid">
              {g.items.map(([name, s, note]) => (
                <div key={name} className="status-item">
                  <span style={{ fontWeight: 500 }}>{name}</span>
                  <Badge kind={LABEL[s][1]}>{LABEL[s][0]}</Badge>
                  {note && <span className="small dim" style={{ gridColumn: "1 / -1" }}>{note}</span>}
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </Page>
  );
}
