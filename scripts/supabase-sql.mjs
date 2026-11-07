/**
 * Consulta/roda SQL no projeto do Supabase pela **Management API**.
 *
 * POR QUE ISTO EXISTE
 * -------------------
 * A CLI do Supabase guarda o token (Personal Access Token) no **Gerenciador de
 * Credenciais do Windows**, no alvo `Supabase CLI:supabase`. Esse token é o
 * mesmo que o `npx supabase login` grava. A Management API tem o endpoint
 * `POST /v1/projects/{ref}/database/query`, que roda SQL e devolve as linhas.
 *
 * Com isso:
 *   - o AppID da Woovi (que fica em `app_settings`, fora do git) pode ser lido
 *     sem pedir o `service_role` para o usuario;
 *   - migrations podem ser aplicadas sem abrir o SQL Editor.
 *
 * ORDEM DE PRECEDENCIA DO TOKEN
 * ------------------------------
 *   1. `SUPABASE_ACCESS_TOKEN` no ambiente (PAT);
 *   2. Gerenciador de Credenciais do Windows (`Supabase CLI:supabase`);
 *   3. nada — o script explica o que fazer.
 *
 * COMO USA
 * --------
 *   node scripts/supabase-sql.mjs --query "select key, value from app_settings"
 *   node scripts/supabase-sql.mjs database/add-woovi-gateway.sql
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const API = "https://api.supabase.com/v1/projects";

for (const nome of [".env.local", ".env"]) {
  try {
    process.loadEnvFile(path.join(ROOT, nome));
  } catch {
    /* sem .env — ok */
  }
}

/** Ref do projeto: vem do .env (mesma fonte do resto do projeto). */
export function refDoProjeto() {
  const url = (process.env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
  if (!url) return "";
  try {
    return new URL(url).hostname.split(".")[0];
  } catch {
    return "";
  }
}

/**
 * Lê o token do Gerenciador de Credenciais do Windows.
 * Só funciona no Windows e devolve null em qualquer outro sistema.
 */
function lerTokenDoCredentialManager() {
  if (process.platform !== "win32") return null;
  const ps = `
$ErrorActionPreference = 'Stop'
$src = @'
using System;
using System.Runtime.InteropServices;
public static class CredDividePass {
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct CREDENTIAL {
        public uint Flags; public uint Type; public IntPtr TargetName; public IntPtr Comment;
        public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
        public uint CredentialBlobSize; public IntPtr CredentialBlob; public uint Persist;
        public uint AttributeCount; public IntPtr Attributes; public IntPtr TargetAlias; public IntPtr UserName;
    }
    [DllImport("advapi32.dll", EntryPoint = "CredReadW", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern bool CredRead(string target, uint type, int flags, out IntPtr credentialPtr);
    [DllImport("advapi32.dll", EntryPoint = "CredFree", SetLastError = true)]
    public static extern void CredFree(IntPtr credentialPtr);
    public static string ReadGeneric(string target) {
        IntPtr ptr;
        if (!CredRead(target, 1, 0, out ptr)) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
        try {
            CREDENTIAL c = (CREDENTIAL)Marshal.PtrToStructure(ptr, typeof(CREDENTIAL));
            int size = (int)c.CredentialBlobSize;
            byte[] blob = new byte[size];
            Marshal.Copy(c.CredentialBlob, blob, 0, size);
            return System.Text.Encoding.UTF8.GetString(blob).Trim();
        } finally { CredFree(ptr); }
    }
}
'@
Add-Type -TypeDefinition $src -Language CSharp
[CredDividePass]::ReadGeneric('Supabase CLI:supabase')
`;
  try {
    const out = execFileSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", ps], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const token = String(out).trim();
    return token.startsWith("sbp_") ? token : null;
  } catch {
    return null;
  }
}

/** Token do Supabase: env primeiro, depois o Credential Manager. */
export function lerTokenSupabase() {
  const doEnv = (process.env.SUPABASE_ACCESS_TOKEN || "").trim();
  if (doEnv.startsWith("sbp_")) return doEnv;
  return lerTokenDoCredentialManager();
}

/**
 * Roda SQL e devolve as linhas.
 * @returns {Promise<Array<object>>}
 */
export async function consultarSql(sql, ref = refDoProjeto()) {
  const token = lerTokenSupabase();
  if (!token) {
    throw new Error(
      "Sem token do Supabase. Rode `npx supabase login` (ou exporte SUPABASE_ACCESS_TOKEN).",
    );
  }
  if (!ref) throw new Error("Sem VITE_SUPABASE_URL no .env — nao sei o ref do projeto.");

  const resp = await fetch(`${API}/${ref}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql }),
  });
  const texto = await resp.text();
  if (!resp.ok) {
    throw new Error(`Management API ${resp.status}: ${texto.slice(0, 400)}`);
  }
  try {
    const dados = JSON.parse(texto);
    return Array.isArray(dados) ? dados : [];
  } catch {
    return [];
  }
}

/* ------------------------------------------------------------------ */
/* CLI                                                                 */
/* ------------------------------------------------------------------ */
const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (invokedDirectly) {
  const ref = refDoProjeto();
  // aceita "--query=SQL" e "--query SQL"
  const flagQuery = process.argv.find((a) => a.startsWith("--query="));
  const indiceQuery = process.argv.indexOf("--query");
  const querySolto = indiceQuery >= 0 ? process.argv[indiceQuery + 1] : null;
  const arquivo = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : null;

  const sql = flagQuery
    ? flagQuery.slice("--query=".length)
    : querySolto
      ? querySolto
      : arquivo
        ? fs.readFileSync(path.join(ROOT, arquivo), "utf8")
        : null;

  if (!sql) {
    console.error(
      'uso: node scripts/supabase-sql.mjs --query "select ..." | node scripts/supabase-sql.mjs <arquivo.sql>',
    );
    process.exitCode = 1;
  } else {
    console.log(`projeto: ${ref}`);
    try {
      const linhas = await consultarSql(sql, ref);
      if (!linhas.length) {
        console.log("(nenhuma linha)");
      } else {
        console.log(linhas);
      }
    } catch (e) {
      console.error(`ERRO: ${e.message}`);
      process.exitCode = 1;
    }
  }
}
