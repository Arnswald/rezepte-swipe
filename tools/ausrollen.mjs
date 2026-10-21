// Rezepte-App neu ausrollen: Portainer-Stack 10 mit neuem Image (nach grünem CI auf main).
//   node tools/ausrollen.mjs                 → Pull + Redeploy
//   node tools/ausrollen.mjs NAME=wert …     → vorher Umgebungsvariablen im Compose setzen
//                                              (Wert "@datei" = Inhalt der Datei, wird nie ausgegeben)
// Schlüssel: ~/.config/second-brain/portainer.token und cloudflare-access.json (nie ins Repo).
import { readFileSync } from "node:fs";
import { homedir } from "node:os";

const H = homedir();
const cf = JSON.parse(readFileSync(H + "/.config/second-brain/cloudflare-access.json", "utf8"));
const kopf = {
  "X-API-Key": readFileSync(H + "/.config/second-brain/portainer.token", "utf8").trim(),
  "CF-Access-Client-Id": cf.id,
  "CF-Access-Client-Secret": cf.secret,
  "Content-Type": "application/json",
};
const B = "https://portainer.christianarns.de/api";
const st = await (await fetch(`${B}/stacks/10`, { headers: kopf })).json();
let file = (await (await fetch(`${B}/stacks/10/file`, { headers: kopf })).json()).StackFileContent;
for (const arg of process.argv.slice(2)) {
  const i = arg.indexOf("=");
  const name = arg.slice(0, i);
  let wert = arg.slice(i + 1);
  if (wert.startsWith("@")) wert = readFileSync(wert.slice(1).replace(/^~/, H), "utf8").trim();
  const re = new RegExp(`^(\\s*- )${name}=.*$`, "m");
  file = re.test(file) ? file.replace(re, `$1${name}=${wert}`) : file.replace(/(\n(\s*)- SITE_URL=[^\n]*)/, `$1\n$2- ${name}=${wert}`);
  console.log("gesetzt:", name);
}
const r = await fetch(`${B}/stacks/10?endpointId=${st.EndpointId}`, {
  method: "PUT",
  headers: kopf,
  body: JSON.stringify({ stackFileContent: file, env: st.Env, prune: false, pullImage: true }),
});
console.log("Ausrollen:", r.status, r.ok ? "ok" : (await r.text()).slice(0, 200));
