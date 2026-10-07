import { defineConfig } from 'vite';
import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

// Generate the offline inventory from the finished build, including Vite's
// hashed assets. Relative URLs support both username.github.io and /project/.
function offlineInventory() {
  let outputDirectory;
  return {
    name: 'card-compass-offline-inventory',
    apply: 'build',
    configResolved(config) {
      outputDirectory = path.resolve(config.root, config.build.outDir);
    },
    async closeBundle() {
      async function filesAt(directory, prefix = '') {
        const entries = await readdir(directory, { withFileTypes: true });
        const result = [];
        for (const entry of entries) {
          const relative = `${prefix}${entry.name}`;
          if (entry.isDirectory()) result.push(...await filesAt(path.join(directory, entry.name), `${relative}/`));
          else if (!['sw.js', '.nojekyll'].includes(relative)) result.push(relative);
        }
        return result;
      }
      const files = (await filesAt(outputDirectory)).sort();
      const digest = createHash('sha256');
      for (const file of files) {
        digest.update(file);
        digest.update(await readFile(path.join(outputDirectory, file)));
      }
      const template = await readFile(path.join(outputDirectory, 'sw.js'), 'utf8');
      // Include worker code in the version so a worker-only fix creates a new cache.
      digest.update(template);
      const worker = template
        .replace('"__BUILD_ID__"', JSON.stringify(digest.digest('hex').slice(0, 16)))
        .replace('/* __PRECACHE__ */ []', JSON.stringify(files));
      await writeFile(path.join(outputDirectory, 'sw.js'), worker);
      await writeFile(path.join(outputDirectory, '.nojekyll'), '');
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [offlineInventory()],
  build: { target: 'safari16', sourcemap: false },
});
