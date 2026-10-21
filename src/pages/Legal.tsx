// Aviso de privacidad y Términos de uso. Describen lo que la app hace de verdad con los datos.
// Revisión recomendada por un abogado antes de operar con pagos reales.
import type { ReactNode } from "react";
import { useApp } from "../app/state";
import { Link } from "../app/router";
import { pct } from "../app/format";
import { Page } from "../components/layout";
import { LEGAL } from "../app/legal";

function Doc({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Page narrow>
      <article className="legal stack-lg">
        <header className="stack" style={{ gap: 6 }}>
          <h1 className="h1">{title}</h1>
          <span className="small dim">Vigente desde el {LEGAL.effectiveDate}.</span>
        </header>
        {children}
      </article>
    </Page>
  );
}

function Contact() {
  return LEGAL.contactEmail
    ? <>escríbenos a <a className="link" href={`mailto:${LEGAL.contactEmail}`}>{LEGAL.contactEmail}</a></>
    : <>usa la opción Reportar dentro de la app</>;
}

export function Privacy() {
  return (
    <Doc title="Aviso de privacidad">
      <p>Este aviso explica qué datos guarda MARKETZONE, para qué los usa y qué puedes hacer con ellos. No vendemos tus datos.</p>

      <section className="stack">
        <h2 className="h3">Qué datos guardamos</h2>
        <ul>
          <li><b>Cuenta:</b> correo, contraseña (cifrada; nadie puede leerla), nombre visible, nombre de usuario y, si la subes, tu foto.</li>
          <li><b>Lo que publicas:</b> fotos y datos de tus productos, tu tienda, tu página de negocio y tus campañas.</li>
          <li><b>Compras y ventas:</b> carrito, ofertas, pedidos, direcciones de envío, reseñas y reportes.</li>
          <li><b>Uso:</b> visitas a productos y clics en anuncios, ligados a un identificador temporal de la visita. Sirven para mostrar estadísticas a vendedores y anunciantes.</li>
          <li><b>En tu teléfono:</b> tu sesión iniciada y el tema que elegiste (claro u oscuro). No usamos cookies de publicidad.</li>
        </ul>
      </section>

      <section className="stack">
        <h2 className="h3">Para qué los usamos</h2>
        <ul>
          <li>Operar tu cuenta, tus publicaciones, tus compras y tus ventas.</li>
          <li>Mostrar a cada vendedor la dirección de envío solo de sus propios pedidos.</li>
          <li>Prevenir fraudes, abusos y spam, y atender reportes.</li>
          <li>Calcular comisiones y mostrar estadísticas de ventas y anuncios.</li>
        </ul>
      </section>

      <section className="stack">
        <h2 className="h3">Con quién se comparten</h2>
        <ul>
          <li><b>Otros usuarios</b> ven tu nombre de usuario, tu tienda, tus productos y tus reseñas. Tu correo y tus direcciones no son públicos.</li>
          <li><b>Supabase</b> aloja la base de datos, las cuentas y las fotos.</li>
          <li><b>GitHub Pages</b> aloja la página web.</li>
          <li><b>Anthropic (Claude)</b> recibe las fotos y datos que envíes al usar "Publicar con IA", solo para generar la propuesta.</li>
          <li><b>Un proveedor de pagos</b> (por ejemplo, Stripe) procesará los pagos cuando se activen. MARKETZONE nunca guarda números de tarjeta.</li>
          <li><b>Autoridades</b>, solo cuando la ley lo exija.</li>
        </ul>
      </section>

      <section className="stack">
        <h2 className="h3">Tus derechos</h2>
        <ul>
          <li>Ver y corregir tus datos en <Link to="/ajustes" className="link">Ajustes</Link>.</li>
          <li>Eliminar tu cuenta en cualquier momento desde Ajustes → Eliminar mi cuenta. Se borran tus datos personales. Los pedidos que hiciste o recibiste se conservan sin tu nombre ni tus datos, porque son el comprobante de la otra persona y un registro contable.</li>
          <li>Bloquear a cualquier usuario para no ver su contenido ni tratar con él.</li>
          <li>Pedir una copia de tus datos o hacer cualquier consulta: <Contact />.</li>
        </ul>
      </section>

      <section className="stack">
        <h2 className="h3">Menores de edad</h2>
        <p>MARKETZONE es para mayores de 18 años. Si detectamos una cuenta de un menor, la eliminamos.</p>
      </section>

      <section className="stack">
        <h2 className="h3">Cambios a este aviso</h2>
        <p>Si cambia algo importante, lo avisaremos dentro de la app antes de que aplique.</p>
      </section>
    </Doc>
  );
}

export function Terms() {
  const { settings } = useApp();
  return (
    <Doc title="Términos de uso">
      <p>Al crear una cuenta o usar MARKETZONE aceptas estos términos. Si no estás de acuerdo, no uses la app.</p>

      <section className="stack">
        <h2 className="h3">Qué es MARKETZONE</h2>
        <p>Un lugar donde personas y negocios publican artículos de moda, sneakers, streetwear, accesorios, bolsos y belleza, y donde otras personas los compran o hacen ofertas. MARKETZONE no es dueño de los artículos ni el vendedor de ellos.</p>
      </section>

      <section className="stack">
        <h2 className="h3">Tu cuenta</h2>
        <ul>
          <li>Debes tener al menos 18 años y dar datos verdaderos.</li>
          <li>Eres responsable de lo que pase con tu cuenta. No compartas tu contraseña.</li>
          <li>Puedes eliminar tu cuenta cuando quieras desde Ajustes.</li>
        </ul>
      </section>

      <section className="stack">
        <h2 className="h3">Si vendes</h2>
        <ul>
          <li>Solo publica artículos que tengas y puedas enviar. Describe su estado con honestidad e incluye fotos reales de cualquier defecto.</li>
          <li>Prohibido: falsificaciones o réplicas, artículos robados, armas, drogas, contenido sexual, productos de belleza abiertos o vencidos, y cualquier artículo cuya venta sea ilegal.</li>
          <li>Cuando aceptas una oferta o alguien paga, te comprometes a enviar el artículo por ese precio.</li>
          <li>MARKETZONE cobra una comisión{settings ? ` del ${pct(settings.commission_bps)}` : ""} sobre cada venta completada. Siempre la ves antes de publicar y antes de aceptar una oferta.</li>
        </ul>
      </section>

      <section className="stack">
        <h2 className="h3">Si compras</h2>
        <ul>
          <li>Una oferta aceptada es un compromiso de compra. Si no pagas dentro del plazo, la oferta vence y el artículo vuelve a estar disponible.</li>
          <li>El precio final, el envío y las tarifas se muestran antes de pagar. El servidor revisa el precio y la disponibilidad al confirmar.</li>
          <li>Las reseñas solo se pueden dejar sobre pedidos entregados.</li>
        </ul>
      </section>

      <section className="stack">
        <h2 className="h3">Pagos</h2>
        <p>{settings?.test_mode
          ? "Por ahora MARKETZONE funciona en modo de prueba: los pagos son simulados y no se cobra dinero. Cuando se activen los pagos reales, se procesarán con un proveedor autorizado y se actualizarán estos términos."
          : "Los pagos se procesan con un proveedor autorizado. MARKETZONE nunca guarda números de tarjeta."}</p>
      </section>

      <section className="stack">
        <h2 className="h3">Anuncios</h2>
        <p>Los negocios pueden pagar por aparecer en espacios destacados. Todo espacio pagado se marca como "Patrocinado" o "Publicidad". Los anuncios no pueden prometer descuentos, testimonios ni resultados falsos.</p>
      </section>

      <section className="stack">
        <h2 className="h3">Moderación</h2>
        <p>Podemos retirar publicaciones, anuncios o reseñas que incumplan estos términos, y suspender cuentas que los incumplan de forma grave o repetida. Cualquier usuario puede reportar contenido o bloquear a otra persona.</p>
      </section>

      <section className="stack">
        <h2 className="h3">Responsabilidad</h2>
        <p>Cada vendedor responde por sus artículos y por lo que dice de ellos. MARKETZONE se ofrece tal como está y hace lo razonable para que funcione bien y de forma segura, pero no garantiza que nunca falle.</p>
      </section>

      <section className="stack">
        <h2 className="h3">Cambios y contacto</h2>
        <p>Si cambiamos estos términos, lo avisaremos en la app antes de que apliquen. Para cualquier duda, <Contact />.</p>
        <p>Lee también el <Link to="/privacidad" className="link">Aviso de privacidad</Link>.</p>
      </section>
    </Doc>
  );
}
