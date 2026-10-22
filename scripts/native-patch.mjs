// Ajusta los proyectos nativos que genera `npx cap add` (se ejecuta en GitHub Actions).
//   node scripts/native-patch.mjs ios|android
// - Versión visible = package.json; número de compilación = GITHUB_RUN_NUMBER.
// - iOS: textos de permisos de cámara y fotos (obligatorios para subir fotos) y declaración de cifrado.
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const platform = process.argv[2];
const version = JSON.parse(readFileSync("package.json", "utf8")).version;
const build = process.env.GITHUB_RUN_NUMBER ?? "1";

function edit(path, fn) {
  if (!existsSync(path)) { console.error(`No existe ${path}`); process.exit(1); }
  const before = readFileSync(path, "utf8");
  const after = fn(before);
  writeFileSync(path, after);
  console.log(`ajustado: ${path}`);
}

if (platform === "ios") {
  const keys = {
    NSCameraUsageDescription: "MARKETXONE usa la cámara para que tomes fotos de los artículos que vendes.",
    NSPhotoLibraryUsageDescription: "MARKETXONE accede a tus fotos para que elijas las imágenes de tus publicaciones.",
    NSPhotoLibraryAddUsageDescription: "MARKETXONE puede guardar imágenes en tus fotos cuando lo pidas.",
  };
  edit("ios/App/App/Info.plist", (s) => {
    let out = s;
    for (const [k, v] of Object.entries(keys)) {
      if (!out.includes(`<key>${k}</key>`)) out = out.replace(/<dict>/, `<dict>\n\t<key>${k}</key>\n\t<string>${v}</string>`);
    }
    if (!out.includes("ITSAppUsesNonExemptEncryption")) {
      out = out.replace(/<dict>/, "<dict>\n\t<key>ITSAppUsesNonExemptEncryption</key>\n\t<false/>");
    }
    out = out.replace(/(<key>CFBundleDisplayName<\/key>\s*<string>)[^<]*(<\/string>)/, "$1MARKETXONE$2");
    return out;
  });
  edit("ios/App/App.xcodeproj/project.pbxproj", (s) => s
    .replace(/MARKETING_VERSION = [^;]+;/g, `MARKETING_VERSION = ${version};`)
    .replace(/CURRENT_PROJECT_VERSION = [^;]+;/g, `CURRENT_PROJECT_VERSION = ${build};`));
} else if (platform === "android") {
  edit("android/app/build.gradle", (s) => s
    .replace(/versionCode \d+/, `versionCode ${build}`)
    .replace(/versionName "[^"]*"/, `versionName "${version}"`));
} else {
  console.error("Uso: node scripts/native-patch.mjs ios|android");
  process.exit(1);
}
