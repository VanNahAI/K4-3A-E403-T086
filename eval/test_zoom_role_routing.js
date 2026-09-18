const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'codebase', 'zoom_entry.js'), 'utf8');

async function routeFor(role, runningContext = 'inMeeting') {
  let domReadyHandler = null;
  let destination = null;
  const status = { textContent: '', classList: { add() {} } };
  const spinner = { hidden: false };
  const window = {
    zoomSdk: {
      config: async () => ({ runningContext }),
      getRunningContext: async () => ({ runningContext }),
      getUserContext: async () => ({ role })
    },
    location: {
      replace(value) { destination = value; }
    }
  };
  const document = {
    addEventListener(event, handler) {
      if (event === 'DOMContentLoaded') domReadyHandler = handler;
    },
    getElementById(id) {
      if (id === 'zoom-entry-status') return status;
      if (id === 'zoom-entry-spinner') return spinner;
      return null;
    }
  };
  vm.runInNewContext(source, { window, document, console });
  await domReadyHandler();
  return { destination, status: status.textContent, spinnerHidden: spinner.hidden };
}

async function run() {
  const host = await routeFor('host');
  const coHost = await routeFor('co-host');
  const participant = await routeFor('participant');
  const guest = await routeFor('guest');
  const outsideMeeting = await routeFor('host', 'inMainClient');

  const cases = {
    hostGetsLecturerCockpit: host.destination === '/zoom-app/lecturer?zoom_app=1',
    coHostGetsLecturerCockpit: coHost.destination === '/zoom-app/lecturer?zoom_app=1',
    participantGetsStudentUi: participant.destination === '/zoom-app/student?zoom_app=1',
    guestGetsStudentUi: guest.destination === '/zoom-app/student?zoom_app=1',
    outsideMeetingDoesNotRoute: outsideMeeting.destination === null && outsideMeeting.spinnerHidden
  };

  Object.entries(cases).forEach(([name, passed]) => {
    console.log(`${name}: ${passed ? '✅ ĐẠT' : '❌ LỖI'}`);
  });
  if (Object.values(cases).some(passed => !passed)) process.exitCode = 1;
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
