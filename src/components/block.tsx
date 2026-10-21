// Bloquear a un usuario: deja de ver sus productos y ninguno puede comprarle ni ofertarle al otro.
import { useState } from "react";
import { useApp } from "../app/state";
import { clearCache, useAction } from "../app/query";
import { navigate } from "../app/router";
import { Button, ErrorBox, Sheet, useToast } from "../ui/kit";
import { t } from "../i18n";

export function BlockButton({ userId, username }: { userId: string; username: string }) {
  const { api, session } = useApp();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const block = useAction(() => api.toggleBlock(userId), {
    onSuccess: () => {
      clearCache();
      setOpen(false);
      toast(t("Bloqueaste a @{0}. Puedes desbloquearlo en Ajustes.", [username]), "ok");
      navigate("/");
    },
  });
  if (!session || session.user.id === userId) return null;
  return (
    <>
      <Button variant="ghost" size="sm" icon="block" onClick={() => setOpen(true)}>{t("Bloquear")}</Button>
      <Sheet open={open} onClose={() => setOpen(false)} title={t("¿Bloquear a @{0}?", [username])}
        footer={<><Button variant="ghost" onClick={() => setOpen(false)}>{t("Cancelar")}</Button><Button variant="danger" loading={block.pending} onClick={() => void block.run()}>{t("Bloquear")}</Button></>}>
        <ul className="stack muted" style={{ margin: 0, paddingLeft: 18, gap: 8 }}>
          <li>{t("Dejarás de ver sus productos y su tienda.")}</li>
          <li>{t("Ninguno de los dos podrá comprarle ni hacerle ofertas al otro.")}</li>
          <li>{t("Se cancelan las ofertas abiertas entre ustedes.")}</li>
          <li>{t("No se le avisa. Puedes desbloquearlo cuando quieras desde Ajustes.")}</li>
        </ul>
        <ErrorBox error={block.error} />
      </Sheet>
    </>
  );
}
