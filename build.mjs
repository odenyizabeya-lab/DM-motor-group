/* Build the production bundle for Cloudflare Pages direct upload. */
import { rm, mkdir, cp, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import esbuild from 'esbuild';

const ROOT = new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const OUT = `${ROOT}dist`;

async function main() {
  if (existsSync(OUT)) await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });

  await cp(`${ROOT}public`, OUT, { recursive: true });
  await cp(`${ROOT}admin`, `${OUT}/admin`, { recursive: true });

  /* bundle the single advanced-mode worker; env vars never enter frontend code */
  await esbuild.build({
    entryPoints: [`${ROOT}shared/_worker.js`],
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    target: 'es2022',
    outfile: `${OUT}/_worker.js`,
    legalComments: 'none',
    logLevel: 'info',
  });

  /* runtime guard: never publish server env to the client bundle */
  const w = await readFile(`${OUT}/_worker.js`, 'utf8');
  if (/(SUPABASE_SERVICE_KEY|service_role_key)\s*=/.test(w)) {
    throw new Error('Refusing to deploy: server key detected in worker bundle (should come from env only)');
  }

  const { files } = await import('node:fs/promises');
  void files;
  console.log('✔ dist/ ready:', OUT);
}

main().catch((e) => { console.error(e); process.exit(1); });
