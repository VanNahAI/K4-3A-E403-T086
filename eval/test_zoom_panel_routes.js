const http = require('http');
const path = require('path');
const { spawn } = require('child_process');

const PORT = 3198;

function request(urlPath) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: PORT, path: urlPath }, response => {
      let body = '';
      response.on('data', chunk => { body += chunk; });
      response.on('end', () => resolve({
        status: response.statusCode,
        type: String(response.headers['content-type'] || ''),
        location: String(response.headers.location || ''),
        body
      }));
    }).on('error', reject);
  });
}

async function waitForServer() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      if ((await request('/api/health')).status === 200) return;
    } catch (error) {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Test server không khởi động.');
}

async function run() {
  const server = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT), ENABLE_SIMULATION: 'false' },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  try {
    await waitForServer();
    const [entry, lecturer, student, legacyLecturer, css, panelJs, sdkHost, sdkStudent, success, portal] = await Promise.all([
      request('/zoom-app'),
      request('/zoom-app/lecturer?zoom_app=1'),
      request('/zoom-app/student?zoom_app=1'),
      request('/lecturer'),
      request('/style.css'),
      request('/pip_companion.js'),
      request('/zoom_app.js'),
      request('/zoom_student.js'),
      request('/zoom-auth-success'),
      request('/')
    ]);

    const cases = {
      entryLoadsRoleRouter: entry.status === 200 && entry.body.includes('src="/zoom_entry.js"'),
      lecturerLoadsCp3Companion: lecturer.status === 200 && lecturer.body.includes('id="pip-lecturer-container"'),
      studentLoadsCp3Companion: student.status === 200 && student.body.includes('id="pip-student-container"'),
      legacyLecturerRedirectsToRoleRouter: legacyLecturer.status === 302 && legacyLecturer.location === '/zoom-app',
      panelUsesAbsoluteAssets: lecturer.body.includes('href="/style.css"') && lecturer.body.includes('src="/pip_companion.js"'),
      cssIsServed: css.status === 200 && css.type.startsWith('text/css'),
      panelLogicIsServed: panelJs.status === 200 && panelJs.type.startsWith('application/javascript'),
      hostSdkLogicIsServed: sdkHost.status === 200 && sdkHost.body.includes('curatorZoomLecturerReady'),
      studentSdkLogicIsServed: sdkStudent.status === 200 && sdkStudent.body.includes('curatorZoomStudentReady'),
      oauthHasDedicatedSuccessPage: success.status === 200 && success.body.includes('Đã thêm Curator AI thành công'),
      localPortalNoLongerTargetsLecturerRoute: portal.status === 200 && portal.body.includes('href="/host"') && !portal.body.includes('href="/lecturer"')
    };

    Object.entries(cases).forEach(([name, passed]) => {
      console.log(`${name}: ${passed ? '✅ ĐẠT' : '❌ LỖI'}`);
    });
    if (Object.values(cases).some(passed => !passed)) process.exitCode = 1;
  } finally {
    server.kill('SIGTERM');
  }
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
