// Outreach drafts tailored to what the audit found.

const BROKEN = new Set(['dead', 'parked', 'placeholder', 'broken', 'unreachable']);

export function draftEmail(lead, audit, status, { sender, yourName, place }) {
  const from = sender || '[your business]';
  const me = yourName || '[Your name]';
  const where = lead.city || (place || '').split(',')[0] || 'the area';
  const host = audit?.host;
  const personal = '[Add one real, specific detail you noticed about them.]';
  let subject, body;

  if (status === 'none' || status === 'social' || status === 'likely-none') {
    subject = `A website for ${lead.name}`;
    body = `I came across ${lead.name} while looking at local businesses in ${where}. ${personal}

${status === 'social'
    ? `I noticed your online presence is mainly your ${/facebook|fb\./i.test(audit?.url || '') ? 'Facebook' : 'social'} page. Those are great for regulars, but people searching Google for a ${lead.category} near them usually land on a business's own site first, and that's where they decide to call.`
    : `I couldn't find a website for you. Most customers now look a business up online before they visit or call, so a simple site with your hours, services and a tap-to-call button tends to bring in people who would otherwise go to a competitor.`}`;
  } else if (BROKEN.has(status)) {
    subject = `Heads-up: ${host || 'your website'} isn't working`;
    const what = {
      dead: `the address ${host} no longer resolves — it looks like the domain may have expired`,
      parked: `${host} is currently showing a "domain parked / for sale" page instead of your business`,
      placeholder: `${host} is only showing a placeholder page`,
      broken: `${host} is returning an error page`,
      unreachable: `${host} isn't loading at the moment`,
    }[status];
    body = `I was looking up ${lead.name} and wanted to give you a quick heads-up: ${what}. Anyone who finds you on Google or Maps and clicks through is hitting a dead end.

${personal}`;
  } else {
    const fixes = (audit?.analysis?.checks || []).filter(c => c.pass === false).sort((a, b) => b.weight - a.weight).slice(0, 3).map(c => `• ${c.fix}`);
    subject = `A few quick wins for ${host || lead.name}`;
    body = `I came across ${lead.name} while looking at local businesses in ${where} and spent a few minutes on your site. ${personal}

${fixes.length ? `A few things stood out that are probably costing you customers:\n${fixes.join('\n')}` : 'The site is in good shape — I had a couple of small ideas that could help it convert more visitors.'}`;
  }

  const text = `Subject: ${subject}

Hi ${lead.name} team,

${body}

I'm ${me} with ${from}. We build fast, mobile-friendly websites for local businesses, and I'd be glad to put together a few ideas for ${lead.name} — no obligation.

Would you be open to a 10-minute call next week?

Best,
${me}
${from}`;
  return { subject, text };
}
