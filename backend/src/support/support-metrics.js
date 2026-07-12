// V2-10-16 — support response metrics (pure). Derived from message roles + event
// times, so a replayed (deduped) message never changes a metric.
//
//   messages: [{ direction, eventAt }]  (chronological)
//   first response = first outbound after the first inbound
//   subsequent responses = each outbound that answers a later inbound
//   resolution time = first inbound → resolvedAt

export function computeMetrics(messages = [], { resolvedAt = null, reopenedCount = 0 } = {}) {
  const ordered = [...messages].sort((a, b) => new Date(a.eventAt) - new Date(b.eventAt));
  const firstInbound = ordered.find((m) => m.direction === "inbound");
  const firstInboundMs = firstInbound ? +new Date(firstInbound.eventAt) : null;

  let firstResponseMs = null;
  if (firstInboundMs != null) {
    const firstOut = ordered.find((m) => m.direction === "outbound" && +new Date(m.eventAt) >= firstInboundMs);
    if (firstOut) firstResponseMs = +new Date(firstOut.eventAt) - firstInboundMs;
  }

  // Subsequent-response times: for each inbound after an outbound, the wait until
  // the next outbound.
  const subsequent = [];
  let awaitingSince = null;
  for (const m of ordered) {
    if (m.direction === "inbound") { if (awaitingSince == null) awaitingSince = +new Date(m.eventAt); }
    else if (m.direction === "outbound" && awaitingSince != null) { subsequent.push(+new Date(m.eventAt) - awaitingSince); awaitingSince = null; }
  }
  // The first of these is the first-response; the rest are follow-ups.
  const followUps = subsequent.slice(1);

  const resolutionMs = (firstInboundMs != null && resolvedAt) ? +new Date(resolvedAt) - firstInboundMs : null;

  return {
    first_response_ms: firstResponseMs,
    avg_followup_ms: followUps.length ? Math.round(followUps.reduce((a, b) => a + b, 0) / followUps.length) : null,
    resolution_ms: resolutionMs,
    reopened_count: reopenedCount,
    awaiting_reply: awaitingSince != null // an unanswered inbound is outstanding
  };
}
