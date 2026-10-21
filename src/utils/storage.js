const API_BASE = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
const ADMIN_KEY = import.meta.env.VITE_ADMIN_KEY || '';

const CACHE_KEY = 'stagepass.lastPhoneNumber';

function uuid() {
  try {
    return crypto.randomUUID()
  } catch {
    return 'xxxx-xxxx-xxxx'.replace(/x/g, () => (Math.random() * 16 | 0).toString(16))
  }
}
const MEMBERS_KEY = 'stagepass.members';
const VISITS_KEY = 'stagepass.visits';

const MILESTONES = [
  { count: 5, label: 'Supporter' },
  { count: 10, label: 'Patron' },
  { count: 20, label: 'Founding Member' },
];

function getTodaySAST() {
  const now = new Date();
  const offset = now.getTimezoneOffset();
  const sastOffset = -120;
  const local = new Date(now.getTime() + (sastOffset - offset) * 60000);
  return local.toISOString().slice(0, 10);
}

function nextMilestone(totalVisits) {
  for (const m of MILESTONES) {
    if (totalVisits < m.count) return m;
  }
  return { count: totalVisits, label: 'Founding Member' };
}

function getLocalMembers() {
  try {
    return JSON.parse(localStorage.getItem(MEMBERS_KEY) || '[]');
  } catch {
    return [];
  }
}

function saveLocalMembers(members) {
  try {
    localStorage.setItem(MEMBERS_KEY, JSON.stringify(members));
  } catch {}
}

function getLocalVisits() {
  try {
    return JSON.parse(localStorage.getItem(VISITS_KEY) || '[]');
  } catch {
    return [];
  }
}

function saveLocalVisits(visits) {
  try {
    localStorage.setItem(VISITS_KEY, JSON.stringify(visits));
  } catch {}
}

function localLookupMember(phoneNumber) {
  if (!phoneNumber) return null;
  const members = getLocalMembers();
  const member = members.find(m => m.phoneNumber === phoneNumber);
  if (!member) return null;
  return {
    exists: true,
    firstName: member.firstName,
    totalVisits: member.totalVisits,
  };
}

function localRecordVisit({ firstName, lastName, phoneNumber }) {
  if (!phoneNumber) throw new Error('phoneNumber is required');

  const members = getLocalMembers();
  const visits = getLocalVisits();
  const today = getTodaySAST();
  const now = new Date().toISOString();
  const existing = members.find(m => m.phoneNumber === phoneNumber);

  if (existing) {
    if (existing.lastVisitDate === today) {
      const milestone = nextMilestone(existing.totalVisits);
      return {
        firstName: existing.firstName,
        lastName: existing.lastName || '',
        totalVisits: existing.totalVisits,
        isReturning: true,
        alreadyCheckedInToday: true,
        milestone,
      };
    }
    const totalVisits = existing.totalVisits + 1;
    existing.totalVisits = totalVisits;
    existing.lastVisitAt = now;
    existing.lastVisitDate = today;

    saveLocalMembers(members);

    visits.push({
      visitId: uuid(),
      memberId: phoneNumber,
      timestamp: now,
    });
    saveLocalVisits(visits);

    const milestone = nextMilestone(totalVisits);
    return {
      firstName: existing.firstName,
      lastName: existing.lastName || '',
      totalVisits,
      isReturning: true,
      alreadyCheckedInToday: false,
      milestone,
    };
  }

  const resolvedFirstName = firstName || 'Friend';
  const newMember = {
    phoneNumber,
    firstName: resolvedFirstName,
    lastName: lastName || '',
    totalVisits: 1,
    createdAt: now,
    lastVisitAt: now,
    lastVisitDate: today,
  };

  members.push(newMember);
  saveLocalMembers(members);

  visits.push({
    visitId: uuid(),
    memberId: phoneNumber,
    timestamp: now,
  });
  saveLocalVisits(visits);

  const milestone = nextMilestone(1);
  return {
    firstName: resolvedFirstName,
    lastName: lastName || '',
    totalVisits: 1,
    isReturning: false,
    alreadyCheckedInToday: false,
    milestone,
  };
}

export function getCachedPhoneNumber() {
  try {
    return localStorage.getItem(CACHE_KEY) || '';
  } catch {
    return '';
  }
}

export function setCachedPhoneNumber(phoneNumber) {
  try {
    localStorage.setItem(CACHE_KEY, phoneNumber);
  } catch {}
}

export async function lookupMember(phoneNumber) {
  if (!phoneNumber) return null;

  if (API_BASE) {
    try {
      const res = await fetch(
        `${API_BASE}/members?phoneNumber=${encodeURIComponent(phoneNumber)}`
      );
      if (res.ok) {
        const data = await res.json();
        return data.exists ? data : null;
      }
    } catch {}
  }

  return localLookupMember(phoneNumber);
}

export async function recordVisit({ firstName, lastName, phoneNumber }) {
  if (API_BASE) {
    try {
      const res = await fetch(`${API_BASE}/checkin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ firstName, lastName, phoneNumber }),
      });
      if (res.ok) return res.json();
    } catch {}
  }

  return localRecordVisit({ firstName, lastName, phoneNumber });
}

export function getMembers() {
  return getLocalMembers();
}

export function getVisits() {
  return getLocalVisits();
}

export async function fetchAdminData() {
  if (API_BASE && ADMIN_KEY) {
    try {
      const headers = { 'x-api-key': ADMIN_KEY };
      const [membersRes, visitsRes] = await Promise.all([
        fetch(`${API_BASE}/admin/members`, { headers }),
        fetch(`${API_BASE}/admin/visits`, { headers }),
      ]);
      if (membersRes.ok && visitsRes.ok) {
        const membersData = await membersRes.json();
        const visitsData = await visitsRes.json();
        return {
          members: membersData.members || [],
          visits: visitsData.visits || [],
          source: 'cloud',
        };
      }
    } catch {}
  }

  return {
    members: getLocalMembers(),
    visits: getLocalVisits(),
    source: 'local',
  };
}

const CONNECTION_WEEK_KEY = 'stagepass.connectionWeek';
const CONNECTION_WEEK_COUNT_KEY = 'stagepass.connectionWeekCount';
const CONNECTION_WEEK_DATE_KEY = 'stagepass.connectionWeekDate';

export function getNextConnectionSlot() {
  const today = getTodaySAST();
  let week = 0;
  let weekCount = 0;
  let lastDate = '';
  try {
    week = parseInt(localStorage.getItem(CONNECTION_WEEK_KEY) || '0', 10);
    weekCount = parseInt(localStorage.getItem(CONNECTION_WEEK_COUNT_KEY) || '0', 10);
    lastDate = localStorage.getItem(CONNECTION_WEEK_DATE_KEY) || '';
  } catch {}

  if (lastDate !== today) {
    week++;
    weekCount = 0;
    localStorage.setItem(CONNECTION_WEEK_KEY, String(week));
    localStorage.setItem(CONNECTION_WEEK_DATE_KEY, today);
  }

  const itemIndex = weekCount % 4;
  localStorage.setItem(CONNECTION_WEEK_COUNT_KEY, String(weekCount + 1));

  return { weekIndex: week - 1, itemIndex };
}

export function getMemberByPhone(phoneNumber) {
  return getLocalMembers().find(m => m.phoneNumber === phoneNumber) || null;
}
