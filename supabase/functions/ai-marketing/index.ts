import { handler } from "./handler.ts";
declare const Deno: { serve(h: (r: Request) => Promise<Response>): void };
Deno.serve(handler);
