#!/usr/bin/env python3
"""Servidor SMTP mínimo que guarda los correos en disco (pruebas de recuperación de contraseña)."""
import os, socketserver, sys, time
OUT = sys.argv[1] if len(sys.argv) > 1 else "/tmp/mail"
os.makedirs(OUT, exist_ok=True)
class H(socketserver.StreamRequestHandler):
    def w(self, s): self.wfile.write((s + "\r\n").encode())
    def handle(self):
        self.w("220 localhost ESMTP sink")
        data, rcpt = None, []
        while True:
            line = self.rfile.readline()
            if not line: return
            cmd = line.decode(errors="replace").strip()
            up = cmd.upper()
            if data is not None:
                if cmd == ".":
                    name = os.path.join(OUT, f"{time.time():.6f}.eml")
                    with open(name, "w") as f: f.write("\n".join(data))
                    data = None; self.w("250 OK")
                else: data.append(cmd[1:] if cmd.startswith("..") else cmd)
                continue
            if up.startswith("EHLO"): self.w("250-localhost"); self.w("250 AUTH PLAIN LOGIN")
            elif up.startswith("HELO"): self.w("250 localhost")
            elif up.startswith("AUTH"): self.w("235 OK")
            elif up.startswith("MAIL") or up.startswith("RCPT") or up.startswith("RSET") or up.startswith("NOOP"): self.w("250 OK")
            elif up == "DATA": data = []; self.w("354 End with .")
            elif up == "QUIT": self.w("221 Bye"); return
            else: self.w("250 OK")
class S(socketserver.ThreadingTCPServer): allow_reuse_address = True
S(("127.0.0.1", 2525), H).serve_forever()
