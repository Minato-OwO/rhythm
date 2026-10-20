import test from 'node:test';
import assert from 'node:assert/strict';
import { serverOptions } from '../scripts/server-options.mjs';

test('通常起動は従来のローカル接続先を使う', () => {
  assert.deepEqual(serverOptions([], {}), { host: '127.0.0.1', port: 5173, cert: null, key: null });
  assert.equal(serverOptions([], { PORT: ' ', RENDER: 'false' }).host, '127.0.0.1');
});

test('RenderとPORT指定環境では外部から接続できるアドレスで待ち受ける', () => {
  for (const env of [{ PORT: '12345', RENDER: 'true' }, { PORT: '12345' }]) {
    assert.deepEqual(serverOptions([], env), { host: '0.0.0.0', port: 12345, cert: null, key: null });
  }
  assert.equal(serverOptions([], { RENDER: 'true' }).port, 10000);
  assert.equal(serverOptions([], { RENDER: 'true' }).host, '0.0.0.0');
});

test('CLIのポートとホストを環境変数より優先する', () => {
  assert.deepEqual(serverOptions(['--host', '127.0.0.1', '--port', '8080'], { PORT: '10000', RENDER: 'true' }), {
    host: '127.0.0.1', port: 8080, cert: null, key: null,
  });
  assert.equal(serverOptions(['--host', '0.0.0.0'], {}).port, 5173);
});

test('ローカルHTTPSと設定値の検証を維持する', () => {
  assert.deepEqual(serverOptions(['--cert', './certs/cert.pem', '--key', './certs/key.pem'], {}), {
    host: '127.0.0.1', port: 5173, cert: './certs/cert.pem', key: './certs/key.pem',
  });
  for (const value of ['0', '-1', '65536', '1.5', 'invalid']) {
    assert.throws(() => serverOptions([], { PORT: value }), /ポートは/);
  }
  assert.throws(() => serverOptions(['--port'], {}), /値を指定/);
  assert.throws(() => serverOptions(['--cert', 'cert.pem'], {}), /両方指定/);
});
