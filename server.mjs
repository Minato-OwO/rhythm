import { createServer as createHttpServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { readFile, readdir, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, relative, isAbsolute, extname, sep } from 'node:path';
import { ensureDemoAudio } from './scripts/demo-audio.mjs';
import { serverOptions } from './scripts/server-options.mjs';

const root = fileURLToPath(new URL('.', import.meta.url));
const { host, port, cert, key } = serverOptions();
const mime = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4',
  '.glb': 'model/gltf-binary',
};

async function modelFiles(directory, prefix = '') {
  const entries = await readdir(directory, { withFileTypes: true });
  const results = await Promise.all(entries.filter(entry => !entry.name.startsWith('.')).map(async entry => {
    const path = prefix + entry.name;
    if (entry.isDirectory()) return modelFiles(resolve(directory, entry.name), path + '/');
    return entry.isFile() && extname(entry.name).toLowerCase() === '.glb' ? [path] : [];
  }));
  return results.flat().sort();
}

async function songList() {
  const folders = await readdir(resolve(root, 'songs'), { withFileTypes: true });
  const groups = await Promise.all(folders.filter(folder => folder.isDirectory() && !folder.name.startsWith('.')).map(async folder => {
    const directory = resolve(root, 'songs', folder.name);
    const entries = await readdir(directory, { withFileTypes: true });
    const files = entries.filter(entry => entry.isFile() && /^chart(?:_.+)?\.json$/i.test(entry.name))
      .map(entry => entry.name).sort((a, b) => Number(!/^chart\.json$/i.test(a)) - Number(!/^chart\.json$/i.test(b)) || a.localeCompare(b, 'ja', { numeric: true }));
    if (!files.length) return [];
    const groupedByFolder = files.some(filename => /^chart_.+\.json$/i.test(filename));
    const models = await modelFiles(directory);
    return Promise.all(files.map(async filename => {
      let contents;
      try { contents = await readFile(resolve(directory, filename), 'utf8'); }
      catch (error) { if (error.code === 'ENOENT') return null; throw error; }
      let metadata = {};
      try {
        const parsed = JSON.parse(contents.replace(/^\uFEFF/, ''));
        if (parsed && typeof parsed === 'object') metadata = parsed;
      } catch { /* 不正なJSONは選択時にファイル名付きで通知する。 */ }
      const namedDifficulty = filename.match(/^chart_(.+)\.json$/i)?.[1];
      const difficulty = namedDifficulty || (typeof metadata.difficulty === 'string' && metadata.difficulty.trim())
        || (typeof metadata.osu?.difficulty === 'string' && metadata.osu.difficulty.trim()) || 'Normal';
      const title = typeof metadata.title === 'string' ? metadata.title : folder.name;
      const songTitle = typeof metadata.songTitle === 'string' ? metadata.songTitle : typeof metadata.osu?.title === 'string' ? metadata.osu.title : title;
      const setId = String(metadata.osu?.beatmapSetId ?? '');
      return {
        id: /^chart\.json$/i.test(filename) ? folder.name : folder.name + '/' + filename,
        groupId: !groupedByFolder && /^[1-9]\d*$/.test(setId) ? 'osu:' + setId : 'folder:' + folder.name,
        songTitle,
        title: namedDifficulty && !title.includes('[' + difficulty + ']') ? title + ' [' + difficulty + ']' : title,
        artist: typeof metadata.artist === 'string' ? metadata.artist : '',
        difficulty,
        flashWarning: metadata.flashWarning === true,
        flashWarningText: typeof metadata.flashWarningText === 'string' ? metadata.flashWarningText.trim() : '',
        level: typeof metadata.level === 'number' && Number.isFinite(metadata.level) ? metadata.level : null,
        bpm: Number.isFinite(metadata.bpm) ? metadata.bpm : null,
        chartUrl: './songs/' + encodeURIComponent(folder.name) + '/' + encodeURIComponent(filename),
        models,
      };
    }));
  }));
  return groups.flat().filter(Boolean).sort((a, b) => a.songTitle.localeCompare(b.songTitle, 'ja') || (a.level ?? Infinity) - (b.level ?? Infinity) || a.difficulty.localeCompare(b.difficulty, 'ja', { numeric: true }));
}

async function handle(request, response) {
  if (!['GET', 'HEAD'].includes(request.method)) {
    response.writeHead(405, { Allow: 'GET, HEAD' }).end();
    return;
  }
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    if (pathname === '/editor') {
      response.writeHead(302, { Location: '/editor/' }).end();
      return;
    }
    if (pathname === '/api/songs') {
      const body = JSON.stringify({ songs: await songList() });
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-store' });
      response.end(request.method === 'HEAD' ? undefined : body);
      return;
    }
    const file = resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname === '/editor/' ? '/editor/index.html' : pathname));
    const pathFromRoot = relative(root, file);
    if (isAbsolute(pathFromRoot) || pathFromRoot === '..' || pathFromRoot.startsWith('..' + sep) || pathFromRoot.split(/[\\/]/).some(part => part.startsWith('.') || part === 'node_modules' || part === 'certs')) {
      response.writeHead(403).end('Forbidden');
      return;
    }
    const info = await stat(file);
    if (!info.isFile()) { response.writeHead(404).end('Not found'); return; }
    response.writeHead(200, {
      'Content-Type': mime[extname(file).toLowerCase()] ?? 'application/octet-stream',
      'Content-Length': info.size,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    if (request.method === 'HEAD') { response.end(); return; }
    const stream = createReadStream(file);
    stream.on('error', () => response.destroy());
    stream.pipe(response);
  } catch (error) {
    response.writeHead(error instanceof URIError ? 400 : 404).end('Not found');
  }
}

await ensureDemoAudio();

const server = cert
  ? createHttpsServer({ cert: await readFile(resolve(cert)), key: await readFile(resolve(key)) }, handle)
  : createHttpServer(handle);
server.on('error', error => {
  console.error(`サーバーを起動できません: ${error.message}`);
  process.exitCode = 1;
});
server.listen(port, host, () => {
  const displayHost = host === '0.0.0.0' ? 'localhost' : host;
  console.log(`FOUR FLOW: ${cert ? 'https' : 'http'}://${displayHost}:${port}`);
  console.log(`待ち受け: ${host}:${port}`);
  if (process.env.RENDER === 'true' && process.env.RENDER_EXTERNAL_URL) console.log(`公開URL: ${process.env.RENDER_EXTERNAL_URL}`);
  else if (host === '0.0.0.0') console.log('LAN接続時は、このPCのIPアドレスを使用してください。');
});
