// CLI指定を優先し、Render等のPORTがある環境では外部向けに待ち受ける。
export function serverOptions(args = process.argv.slice(2), env = process.env) {
  function option(name, fallback) {
    const index = args.indexOf(name);
    if (index === -1) return fallback;
    if (!args[index + 1] || args[index + 1].startsWith('--')) throw new Error(`${name}の値を指定してください。`);
    return args[index + 1];
  }
  const environmentPort = env.PORT?.trim();
  const onRender = env.RENDER === 'true';
  const host = option('--host', environmentPort || onRender ? '0.0.0.0' : '127.0.0.1');
  const port = Number(option('--port', environmentPort || (onRender ? '10000' : '5173')));
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('ポートは1〜65535で指定してください。');
  const cert = option('--cert', null);
  const key = option('--key', null);
  if (Boolean(cert) !== Boolean(key)) throw new Error('--certと--keyを両方指定してください。');
  return { host, port, cert, key };
}
