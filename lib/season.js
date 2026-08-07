// 시즌 = 달력의 한 달.
//
// 랭킹을 영원히 쌓아 두면 1위가 한 번 정해진 뒤로는 아무도 못 넘어서
// 굳어 버린다. 달마다 새로 시작하고, 끝난 시즌의 상위권은 명예의 전당에
// 남긴다.
//
// 기준 시각은 한국 시간이다. 서버가 어느 나라에 떠 있든 같은 날 같은
// 시즌이어야 하므로, 서버의 지역 설정에 기대지 않고 직접 계산한다.

const KST_OFFSET_MS = 9 * 3600_000;

// 'YYYY-MM-DD' — 한국 날짜. 이용 통계를 날짜별로 묶을 때 쓴다.
export function dayOf(at = Date.now()) {
  const d = new Date(at + KST_OFFSET_MS);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}` +
    `-${String(d.getUTCDate()).padStart(2, '0')}`;
}

// 'YYYY-MM'
export function seasonOf(at = Date.now()) {
  const d = new Date(at + KST_OFFSET_MS);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

// '2026년 8월'
export function seasonName(key) {
  const [year, month] = key.split('-');
  return `${year}년 ${Number(month)}월`;
}

// 이번 시즌이 끝나기까지 남은 시간(밀리초). 화면에 남은 기간을 보여 줄 때 쓴다.
export function msLeftInSeason(at = Date.now()) {
  const d = new Date(at + KST_OFFSET_MS);
  const next = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
  return next - (at + KST_OFFSET_MS);
}
