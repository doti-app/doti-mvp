const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 3000);

loadLocalEnv();

const apiHandlers = {
  '/api/auth-config': require('./api/auth-config')
};

const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.webp': 'image/webp'
};

function loadLocalEnv() {
  const envPath = path.join(ROOT, '.env.local');
  if (!fs.existsSync(envPath)) return;

  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator < 1) continue;
    const name = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[name] === undefined) process.env[name] = value;
  }
}

function sendJson(response, statusCode, body) {
  response.statusCode = statusCode;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.end(JSON.stringify(body));
}

function enhanceResponse(response) {
  response.status = statusCode => {
    response.statusCode = statusCode;
    return response;
  };
  response.json = body => {
    if (!response.hasHeader('Content-Type')) {
      response.setHeader('Content-Type', 'application/json; charset=utf-8');
    }
    response.end(JSON.stringify(body));
    return response;
  };
  return response;
}

async function readBody(request) {
  if (!['POST', 'PUT', 'PATCH'].includes(request.method)) return undefined;
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  if (!chunks.length) return undefined;
  const raw = Buffer.concat(chunks).toString('utf8');
  const contentType = request.headers['content-type'] || '';
  if (contentType.includes('application/json')) {
    try {
      return JSON.parse(raw);
    } catch (_) {
      return {};
    }
  }
  return raw;
}

async function serveApi(request, response, pathname) {
  const handler = apiHandlers[pathname];
  if (!handler) return false;
  if (process.env.DOTI_LOCAL_MODE === 'true') {
    if (pathname === '/api/auth-config') {
      sendJson(response, 200, { configured: true, localMode: true });
    } else {
      sendJson(response, 403, {
        error: 'API remota bloqueada no modo local seguro.'
      });
    }
    return true;
  }
  request.body = await readBody(request);
  await handler(request, enhanceResponse(response));
  return true;
}

function resolveStaticFile(pathname) {
  let relativePath;
  try {
    relativePath = decodeURIComponent(pathname);
  } catch (_) {
    return null;
  }

  if (relativePath === '/') relativePath = '/index.html';
  let candidate = path.resolve(ROOT, `.${relativePath}`);
  if (!candidate.startsWith(`${ROOT}${path.sep}`)) return null;

  if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
    candidate = path.join(candidate, 'index.html');
  } else if (!path.extname(candidate) && fs.existsSync(`${candidate}.html`)) {
    candidate = `${candidate}.html`;
  }
  return candidate;
}

function serveStatic(response, pathname) {
  const filePath = resolveStaticFile(pathname);
  if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    sendJson(response, 404, { error: 'Arquivo não encontrado.' });
    return;
  }

  response.statusCode = 200;
  response.setHeader(
    'Content-Type',
    mimeTypes[path.extname(filePath).toLowerCase()] || 'application/octet-stream'
  );
  response.setHeader('Cache-Control', 'no-store, max-age=0');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  fs.createReadStream(filePath).pipe(response);
}

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
    if (url.pathname.startsWith('/api/')) {
      if (!(await serveApi(request, response, url.pathname))) {
        sendJson(response, 404, { error: 'API não encontrada.' });
      }
      return;
    }
    serveStatic(response, url.pathname);
  } catch (error) {
    console.error(error);
    if (!response.headersSent) {
      sendJson(response, 500, { error: 'Erro no servidor local.' });
    } else {
      response.end();
    }
  }
});

server.listen(PORT, () => {
  console.log('');
  console.log(`Doti local: http://localhost:${PORT}`);
  console.log('Pressione Ctrl+C para encerrar.');
  console.log('');
});

module.exports = server;
