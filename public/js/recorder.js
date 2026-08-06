// 마이크로 짧은 목소리를 녹음한다.
//
// 브라우저는 안전한 연결에서만 마이크를 열어 준다. localhost 는 예외로
// 허용되지만, 배포한 사이트라면 https 여야 한다. http 로 열면
// navigator.mediaDevices 자체가 없다 — 그래서 지원 여부부터 확인한다.

const MAX_MS = 1500;   // 점프 소리라 길 이유가 없다. 길면 착지 후까지 이어진다.

export const recorder = {
  supported() {
    return !!(navigator.mediaDevices?.getUserMedia && window.MediaRecorder);
  },

  // 왜 못 쓰는지 사람이 읽을 수 있게 알려 준다
  unsupportedReason() {
    if (!window.isSecureContext) return 'https 로 접속해야 마이크를 쓸 수 있습니다.';
    if (!navigator.mediaDevices?.getUserMedia) return '이 브라우저는 마이크 녹음을 지원하지 않습니다.';
    if (!window.MediaRecorder) return '이 브라우저는 녹음 저장을 지원하지 않습니다.';
    return '';
  },

  // 녹음을 시작하고 { stop, done } 을 돌려준다.
  //   stop()  — 지금 멈춘다
  //   done    — 다 끝나면 Blob 으로 풀리는 약속. 최대 길이가 지나면 저절로 멈춘다.
  async start() {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
    });

    // 브라우저마다 만들 수 있는 형식이 다르다. 되는 걸 고른다.
    const type = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg']
      .find((t) => MediaRecorder.isTypeSupported?.(t));

    const rec = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
    const chunks = [];
    rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };

    const done = new Promise((resolve, reject) => {
      rec.onstop = () => {
        // 마이크를 놓아 준다. 안 놓으면 탭에 녹음 표시가 계속 남는다.
        for (const track of stream.getTracks()) track.stop();
        resolve(new Blob(chunks, { type: rec.mimeType || 'audio/webm' }));
      };
      rec.onerror = (e) => {
        for (const track of stream.getTracks()) track.stop();
        reject(e.error ?? new Error('녹음에 실패했습니다.'));
      };
    });

    rec.start();
    const timer = setTimeout(() => {
      if (rec.state !== 'inactive') rec.stop();
    }, MAX_MS);

    return {
      maxMs: MAX_MS,
      stop() {
        clearTimeout(timer);
        if (rec.state !== 'inactive') rec.stop();
      },
      done
    };
  }
};
