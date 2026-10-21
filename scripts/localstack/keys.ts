// Genera las claves anon y service_role locales (JWT firmados con el secreto local).
import { signJwt } from "./jwt.ts";
const SECRET = process.env.MZ_JWT_SECRET ?? "local-dev-jwt-secret-with-at-least-32-characters";
const exp = Math.floor(Date.now() / 1000) + 10 * 365 * 24 * 3600;
const anon = await signJwt({ iss: "supabase-local", role: "anon", exp }, SECRET);
const service = await signJwt({ iss: "supabase-local", role: "service_role", exp }, SECRET);
console.log(JSON.stringify({ anon, service }));
