// Bloquear a un usuario: deja de ver sus productos y ninguno puede comprarle ni ofertarle al otro.
import { useState } from "react";
import { useApp } from "../app/state";
import { clearCache, useAction } from "../app/query";
import { navigate } from "../app/router";
import { Button, ErrorBox, Sheet, useToast } from "../ui/kit";

export function BlockButton({ userId, username }: { userId: string; username: string }) {
  const { api, session } = useApp();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const block = useAction(() => api.toggleBlock(userId), {
    onSuccess: () => {
      clearCache();
      setOpen(false);
      toast(`Bloqueaste a @${username}. Puedes desbloquearlo en Ajustes.`, "ok");
      navigate("/");
    },
  });
  if (!session || session.user.id === userId) return null;
  return (
    <>
      <Button variant="ghost" size="sm" icon="block" onClick={() => setOpen(true)}>Bloquear</Button>
      <Sheet open={open} onClose={() => setOpen(false)} title={`¿Bloquear a @${username}?`}
        footer={<><Button variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button><Button variant="danger" loading={block.pending} onClick={() => void block.run()}>Bloquear</Button></>}>
        <ul className="stack muted" style={{ margin: 0, paddingLeft: 18, gap: 8 }}>
          <li>Dejarás de ver sus productos y su tienda.</li>
          <li>Ninguno de los dos podrá comprarle ni hacerle ofertas al otro.</li>
          <li>Se cancelan las ofertas abiertas entre ustedes.</li>
          <li>No se le avisa. Puedes desbloquearlo cuando quieras desde Ajustes.</li>
        </ul>
        <ErrorBox error={block.error} />
      </Sheet>
    </>
  );
}
