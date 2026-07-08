const DAY_MS = 24 * 60 * 60 * 1000;

export function calculateStorageDeadline(receivedAt, freeStorageDays = 90, now = new Date()) {
  if (!receivedAt) {
    return {
      freeUntil: null,
      daysLeft: null,
      expired: false
    };
  }

  const received = new Date(receivedAt);
  if (Number.isNaN(received.getTime())) {
    return {
      freeUntil: null,
      daysLeft: null,
      expired: false
    };
  }

  const freeUntil = new Date(received.getTime() + Number(freeStorageDays || 90) * DAY_MS);
  const diff = freeUntil.getTime() - now.getTime();
  return {
    freeUntil: freeUntil.toISOString(),
    daysLeft: Math.max(0, Math.ceil(diff / DAY_MS)),
    expired: diff < 0
  };
}
