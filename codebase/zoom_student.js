(function () {
  if (window.location.pathname !== '/zoom-app/student') return;

  window.curatorZoomStudentReady = (async () => {
    if (!window.zoomSdk) throw new Error('Không tải được Zoom Apps SDK.');

    await window.zoomSdk.config({
      version: '0.16',
      popoutSize: { width: 480, height: 720 },
      capabilities: ['getRunningContext', 'getUserContext', 'getMeetingContext']
    });

    const context = await window.zoomSdk.getRunningContext();
    if (context.runningContext !== 'inMeeting') {
      throw new Error('Hãy mở Curator AI trong một Zoom Meeting.');
    }

    const user = await window.zoomSdk.getUserContext();
    const meeting = await window.zoomSdk.getMeetingContext().catch(() => ({}));
    document.body.classList.add('zoom-app-context', 'zoom-student-context');
    document.title = meeting.meetingTopic
      ? `Hỏi đáp · ${meeting.meetingTopic}`
      : 'Hỏi đáp Học viên · Curator AI';

    return {
      screenName: String(user.screenName || '').trim() || 'Học viên Zoom',
      role: String(user.role || 'participant'),
      meetingID: meeting.meetingID || null
    };
  })();
})();
